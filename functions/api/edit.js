// POST /api/edit — backend for the on-page editor (src/assets/edit.js).
//
// Runs on Cloudflare Pages Functions. Needs these settings in the Cloudflare dashboard
// (Workers & Pages > portfolio > Settings > Variables and secrets), added as encrypted secrets:
//   EDIT_PASSWORD  the password typed into the lock prompt
//   GITHUB_TOKEN   a fine-grained GitHub token with "Contents: read and write" on this repo only
// Optional: GITHUB_REPO (default "Intwq/portfolio"), GITHUB_BRANCH (default "main").
//
// action "login": checks the password, returns a signed token valid for 4 hours.
// action "save":  checks the token, applies text changes to src/site.json / src/projects/*.json,
//                 and commits them to GitHub in one commit (which triggers the normal rebuild).
// Only existing text fields can be changed; nothing can be added, deleted or uploaded.

const enc = new TextEncoder();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}
const same = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const secretOf = (env) => `${env.EDIT_PASSWORD}::${env.GITHUB_TOKEN}`;   // rotating either one signs everyone out

const FILE_OK = /^src\/(site\.json|projects\/[a-z0-9][a-z0-9-]*\.json)$/;
const PTR_OK = /^(\/[A-Za-z0-9_]+){1,4}$/;
const TTL = 4 * 3600;

// ---------- GitHub (git data API, so several files land in one commit) ----------
function gh(env) {
  const repo = env.GITHUB_REPO || "Intwq/portfolio";
  const base = `https://api.github.com/repos/${repo}`;
  return async (path, init = {}) => {
    const r = await fetch(base + path, {
      ...init,
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "portfolio-editor", "x-github-api-version": "2022-11-28", ...(init.body ? { "content-type": "application/json" } : {}) },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`GitHub ${r.status}: ${data.message || "request failed"}`), { gh: r.status });
    return data;
  };
}
const fromB64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));

function setAt(obj, ptr, value) {
  const parts = ptr.split("/").slice(1);
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = Array.isArray(o) ? Number(parts[i]) : parts[i];
    if (o === null || typeof o !== "object" || !(k in o)) throw new Error(`Unknown field ${ptr}`);
    o = o[k];
  }
  const last = Array.isArray(o) ? Number(parts[parts.length - 1]) : parts[parts.length - 1];
  if (o === null || typeof o !== "object" || !(last in o)) throw new Error(`Unknown field ${ptr}`);
  const old = o[last];
  if (old !== null && typeof old === "object" && !Array.isArray(old)) throw new Error(`Not a text field: ${ptr}`);
  // keep the stored type: numbers stay numbers, one-per-line lists stay lists
  if (typeof old === "number") { const n = Number(value); if (!Number.isFinite(n)) throw new Error(`${ptr} must be a number`); o[last] = n; }
  else if (Array.isArray(old)) o[last] = value.split("\n").map((s) => s.trim()).filter(Boolean);
  else o[last] = value;
}

export async function onRequestPost({ request, env }) {
  if (!env.EDIT_PASSWORD || !env.GITHUB_TOKEN) return json({ error: "Editing isn't set up yet: add EDIT_PASSWORD and GITHUB_TOKEN in Cloudflare." }, 503);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Bad request" }, 400); }
  const secret = secretOf(env);

  if (body.action === "login") {
    const given = await hmac(secret, `pw:${String(body.password || "")}`), real = await hmac(secret, `pw:${env.EDIT_PASSWORD}`);
    if (!same(given, real)) { await wait(900); return json({ error: "Wrong password" }, 401); }
    const exp = Math.floor(Date.now() / 1000) + TTL;
    return json({ token: `${exp}.${await hmac(secret, `tok:${exp}`)}`, exp });
  }

  if (body.action === "save") {
    const [exp, sig] = String(body.token || "").split(".");
    if (!exp || !sig || Number(exp) < Date.now() / 1000 || !same(sig, await hmac(secret, `tok:${exp}`))) return json({ error: "Session expired, unlock again" }, 401);
    const list = Array.isArray(body.changes) ? body.changes : [];
    if (!list.length || list.length > 300) return json({ error: "Nothing to save" }, 400);
    const byFile = new Map();
    for (const c of list) {
      const [file, ptr] = String(c.key || "").split("#");
      if (!FILE_OK.test(file || "") || !PTR_OK.test(ptr || "") || typeof c.value !== "string" || c.value.length > 20000) return json({ error: `Can't edit ${c.key}` }, 400);
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push([ptr, c.value.replace(/\r/g, "")]);
    }
    try {
      const api = gh(env), branch = env.GITHUB_BRANCH || "main";
      const ref = await api(`/git/ref/heads/${branch}`);
      const head = ref.object.sha;
      const tree = [];
      for (const [file, edits] of byFile) {
        const cur = await api(`/contents/${file}?ref=${head}`);
        const obj = JSON.parse(fromB64(cur.content));
        for (const [ptr, value] of edits) setAt(obj, ptr, value);
        tree.push({ path: file, mode: "100644", type: "blob", content: JSON.stringify(obj, null, 2) + "\n" });
      }
      const base = await api(`/git/commits/${head}`);
      const t = await api(`/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: base.tree.sha, tree }) });
      const files = [...byFile.keys()].map((f) => f.replace(/^src\/(projects\/)?/, "").replace(/\.json$/, ""));
      const commit = await api(`/git/commits`, { method: "POST", body: JSON.stringify({ message: `Edit text on site: ${files.join(", ")}`, tree: t.sha, parents: [head] }) });
      await api(`/git/refs/heads/${branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
      return json({ ok: true, commit: commit.sha, files });
    } catch (e) {
      return json({ error: e.gh ? `${e.message}. Check the GitHub token's access.` : e.message }, e.gh ? 502 : 400);
    }
  }
  return json({ error: "Unknown action" }, 400);
}

export const onRequestGet = () => json({ error: "Use POST" }, 405);
