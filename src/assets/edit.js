// On-page text editor.
// The lock in the footer asks for the password, then every piece of text marked data-ed becomes
// editable in place. Save sends only what changed to /api/edit (a Cloudflare Pages Function), which
// checks the password server-side and commits the change to GitHub; the site then rebuilds itself.
// Nothing secret lives in this file: the password and GitHub key are only on the server.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const lock = $("[data-ed-lock]");
  if (!lock) return;
  const srcEl = $("#ed-src");
  const SRC = srcEl ? JSON.parse(srcEl.textContent) : {};
  const API = "/api/edit";
  const KEY = "ed-token";
  const getTok = () => { try { const t = JSON.parse(sessionStorage.getItem(KEY) || "null"); return t && t.exp > Date.now() / 1000 ? t.token : null; } catch (e) { return null; } };
  const setTok = (t) => { try { t ? sessionStorage.setItem(KEY, JSON.stringify(t)) : sessionStorage.removeItem(KEY); } catch (e) {} };

  // ---------- small UI pieces ----------
  const ui = document.createElement("div");
  ui.className = "ed-ui";
  ui.innerHTML = `
    <div class="ed-modal" data-ed-modal hidden role="dialog" aria-modal="true" aria-labelledby="ed-h">
      <form class="ed-card" data-ed-form>
        <p class="ed-k">Editor</p>
        <h2 class="ed-h" id="ed-h">Enter password</h2>
        <input class="ed-in" type="password" name="password" autocomplete="current-password" aria-label="Password" required>
        <p class="ed-msg" data-ed-msg role="status"></p>
        <div class="ed-row"><button type="button" class="ed-btn ghost" data-ed-cancel>Cancel</button><button type="submit" class="ed-btn">Unlock</button></div>
      </form>
    </div>
    <div class="ed-bar" data-ed-bar hidden>
      <span class="ed-dot"></span><span class="ed-state" data-ed-state>Editing. Click any outlined text to change it.</span>
      <span class="ed-count" data-ed-count></span>
      <button type="button" class="ed-btn ghost" data-ed-discard>Discard</button>
      <button type="button" class="ed-btn ghost" data-ed-done>Lock</button>
      <button type="button" class="ed-btn" data-ed-save disabled>Save</button>
    </div>`;
  document.body.appendChild(ui);
  const modal = $("[data-ed-modal]", ui), form = $("[data-ed-form]", ui), msg = $("[data-ed-msg]", ui), input = $("input", form);
  const bar = $("[data-ed-bar]", ui), state = $("[data-ed-state]", ui), count = $("[data-ed-count]", ui), saveBtn = $("[data-ed-save]", ui);

  const els = () => $$("[data-ed]");
  const norm = (s) => String(s || "").replace(/\r/g, "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  // Read what's actually typed, not what's displayed: innerText would apply CSS (uppercase titles etc.).
  function textOf(el) {
    let out = "";
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) out += c.nodeValue;
        else if (c.nodeName === "BR") out += "\n";
        else if (c.nodeType === 1) { const block = /^(DIV|P|LI)$/.test(c.nodeName); if (block && out && !out.endsWith("\n")) out += "\n"; walk(c); }
      }
    };
    walk(el);
    return out;
  }
  let editing = false;
  const original = new Map();   // element -> rendered HTML, restored on Discard / Lock

  function changes() {
    const out = [];
    for (const el of els()) {
      const key = el.dataset.ed;
      if (!(key in SRC)) continue;
      const now = norm(textOf(el)), was = norm(SRC[key]);
      if (now !== was) out.push({ key, value: now });
    }
    return out;
  }
  function refresh() {
    const n = changes().length;
    count.textContent = n ? `${n} change${n > 1 ? "s" : ""}` : "";
    saveBtn.disabled = !n;
    els().forEach((el) => el.classList.toggle("ed-dirty", norm(textOf(el)) !== norm(SRC[el.dataset.ed])));
  }

  function start() {
    editing = true;
    document.documentElement.classList.add("editing");
    for (const el of els()) {
      if (!(el.dataset.ed in SRC)) continue;
      original.set(el, el.innerHTML);
      el.textContent = SRC[el.dataset.ed];          // show the raw source, with its paragraph breaks
      try { el.contentEditable = "plaintext-only"; } catch (e) {}
      if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
      el.spellcheck = true;
    }
    bar.hidden = false;
    state.textContent = "Editing. Click any outlined text to change it.";
    refresh();
  }
  function stop(restore) {
    editing = false;
    document.documentElement.classList.remove("editing");
    for (const el of els()) {
      el.removeAttribute("contenteditable");
      el.classList.remove("ed-dirty");
      if (restore && original.has(el)) el.innerHTML = original.get(el);
    }
    original.clear();
    bar.hidden = true;
  }

  // keep links and the page's own click handlers from firing while text is being edited
  document.addEventListener("click", (e) => {
    if (!editing) return;
    const inEd = e.target.closest("[data-ed]");
    if (inEd && e.target.closest("a")) e.preventDefault();
  }, true);
  document.addEventListener("input", (e) => { if (editing && e.target.closest("[data-ed]")) refresh(); });
  // plain-text paste only (a fallback for browsers without plaintext-only editing)
  document.addEventListener("paste", (e) => {
    if (!editing || !e.target.closest("[data-ed]")) return;
    e.preventDefault();
    document.execCommand("insertText", false, (e.clipboardData || window.clipboardData).getData("text/plain"));
  });

  // ---------- server calls ----------
  async function call(body) {
    const r = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    let data = {};
    try { data = await r.json(); } catch (e) {}
    if (!r.ok) throw Object.assign(new Error(data.error || `Request failed (${r.status})`), { status: r.status });
    return data;
  }

  lock.addEventListener("click", () => {
    if (editing) return;
    if (!Object.keys(SRC).length) { alertBar("There's no editable text on this page."); return; }
    if (getTok()) { start(); return; }
    modal.hidden = false; msg.textContent = ""; input.value = ""; setTimeout(() => input.focus(), 30);
  });
  $("[data-ed-cancel]", ui).addEventListener("click", () => { modal.hidden = true; });
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) modal.hidden = true; });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "Checking…";
    try {
      const t = await call({ action: "login", password: input.value });
      setTok(t); modal.hidden = true; input.value = ""; start();
    } catch (err) { msg.textContent = err.status === 401 ? "That password isn't right." : err.message; input.select(); }
  });

  saveBtn.addEventListener("click", async () => {
    const list = changes();
    if (!list.length) return;
    const token = getTok();
    if (!token) { stop(false); setTok(null); modal.hidden = false; msg.textContent = "Your session ran out. Unlock again; your edits are still on the page."; editing = true; return; }
    saveBtn.disabled = true; state.textContent = "Saving…";
    try {
      const r = await call({ action: "save", token, changes: list });
      list.forEach((c) => { SRC[c.key] = c.value; });
      refresh();
      state.textContent = `Saved. The live site updates in about 2 minutes${r.commit ? ` (commit ${r.commit.slice(0, 7)})` : ""}.`;
    } catch (err) {
      if (err.status === 401) setTok(null);
      state.textContent = `Not saved: ${err.message}`;
      saveBtn.disabled = false;
    }
  });
  $("[data-ed-discard]", ui).addEventListener("click", () => { stop(true); start(); });
  $("[data-ed-done]", ui).addEventListener("click", () => {
    if (changes().length && !confirm("Discard unsaved changes?")) return;
    stop(true); setTok(null);
  });
  addEventListener("beforeunload", (e) => { if (editing && changes().length) { e.preventDefault(); e.returnValue = ""; } });

  function alertBar(t) { bar.hidden = false; state.textContent = t; count.textContent = ""; setTimeout(() => { if (!editing) bar.hidden = true; }, 2600); }
})();
