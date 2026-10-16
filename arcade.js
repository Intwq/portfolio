// Builds the ARCADE version of the portfolio (a claw machine) into dist/arcade/.
// build.js runs this automatically at the end, so the arcade ships inside the main site.
// Same content as the main site: src/projects/*.json, src/site.json and src/images/.
// Run with `node arcade.js` (after `python3 tools/resize.py` for responsive images).
const fs = require("fs");
const path = require("path");
const { caseStudy } = require("./casestudy");

const SRC = path.join(__dirname, "src");
const OUT = path.join(__dirname, "dist", "arcade");
const UP = "../";   // the arcade lives one folder down; images are shared with the main site
const SIZES = path.join(__dirname, ".sizes");
const WIDTHS = [800, 1600, 2560];

const esc = (s = "") => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const paras = (t = "") => String(t).trim().split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("\n");
const pad = (n) => String(n).padStart(2, "0");
const asset = (p) => String(p || "").replace(/^\/+/, "");

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}

function imageSize(file) {
  try {
    const b = fs.readFileSync(file);
    if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1], len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
  } catch (e) {}
  return null;
}

let META = {};
try { META = JSON.parse(fs.readFileSync(path.join(SIZES, "meta.json"), "utf8")); } catch (e) {}
const edgeOf = (p) => { const m = META[asset(p).replace(/^images\//, "")]; return m && m.edge ? m.edge : "#ffffff"; };

function srcset(p, sizes) {
  const d = imageSize(path.join(SRC, asset(p)));
  if (!d) return ` src="${UP}${asset(p)}"`;
  const base = asset(p).replace(/\.[a-z0-9]+$/i, "");
  const widths = [...new Set([...WIDTHS.filter((w) => w < d.w), ...(d.w <= 2560 ? [d.w] : [])])]
    .filter((w) => fs.existsSync(path.join(SIZES, `${base}-${w}.webp`)));
  if (!widths.length) return ` src="${UP}${asset(p)}" width="${d.w}" height="${d.h}"`;
  const fb = `${base}-${widths.find((w) => w >= 1600) || widths[widths.length - 1]}.webp`;
  return ` src="${UP}${fb}" srcset="${widths.map((w) => `${UP}${base}-${w}.webp ${w}w`).join(", ")}" sizes="${sizes}" width="${d.w}" height="${d.h}"`;
}

// ---------- data (same rules as build.js) ----------
const site = JSON.parse(fs.readFileSync(path.join(SRC, "site.json"), "utf8"));
const projects = fs.readdirSync(path.join(SRC, "projects")).filter((f) => f.endsWith(".json"))
  .map((f) => {
    const p = JSON.parse(fs.readFileSync(path.join(SRC, "projects", f), "utf8"));
    p.slug = slugify(path.basename(f, ".json")) || slugify(p.title);
    p.images = (p.images || []).filter(Boolean);
    p.cover = p.cover || p.images[0] || "";
    p.order = Number(p.order) || 0;
    return p.hidden ? null : p;
  }).filter(Boolean)
  .sort((a, b) => a.order - b.order || (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title));

const iconFor = (p) => {
  if (p.icon) return UP + asset(p.icon);                       // custom pixel art uploaded in the dashboard
  if (fs.existsSync(path.join(SRC, "arcade", "px", `${p.slug}.png`))) return `px/${p.slug}.png`;
  return "";
};

// ---------- case-study styles, reused from the main site (same dark palette) ----------
function caseCss() {
  const css = fs.readFileSync(path.join(SRC, "assets", "style.css"), "utf8").split("\n");
  const grab = (start, stop) => {
    const a = css.findIndex((l) => l.startsWith(start));
    const b = css.findIndex((l, i) => i > a && l.startsWith(stop));
    return a < 0 ? "" : css.slice(a, b < 0 ? undefined : b).join("\n");
  };
  let out = css.filter((l) => /^\.stats? |^\.stat \+ |^\.stat d[dt] /.test(l)).join("\n") + "\n" +
    grab("/* ============ case studies", "/* homepage groups");
  // responsive rules for the case studies: the first 900px block that starts with .brief, up to the footer
  const i900 = css.findIndex((l, i) => l.startsWith("@media (max-width: 900px)") && css[i + 1] && css[i + 1].includes(".brief"));
  if (i900 > 0) { let j = i900; while (j < css.length && !css[j].startsWith("/* ============ footer")) j++; out += "\n" + css.slice(i900, j).join("\n"); }
  return out;
}

// ---------- pages ----------
const FONTS = "https://fonts.googleapis.com/css2?family=Press+Start+2P&family=IBM+Plex+Mono:wght@400;500&display=swap";

function fragment(p, i) {
  const spec = [["Company", p.company], ["Role", p.role], ["Year", p.year], ["Discipline", p.category], ["Status", p.status], ["Tools", p.tools]]
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");
  const gal = p.images.filter((im) => im !== p.cover || p.images.length === 1);
  return `<article class="pj">
  ${p.cover ? `<figure class="pj-hero" style="background:${edgeOf(p.cover)}"><img${srcset(p.cover, "(max-width: 1100px) 94vw, 1100px")} alt="${esc(p.title)}"></figure>` : ""}
  <header class="pj-head">
    <p class="pj-n">PRJ ${pad(i + 1)} / ${pad(projects.length)}${p.category ? ` · ${esc(p.category)}` : ""}</p>
    <h2 class="pj-title">${esc(p.title)}</h2>
  </header>
  <section class="pj-info"><dl class="spec">${spec}</dl><div class="pj-desc">${paras(p.description || "")}</div></section>
  <div class="cs-wrap js">${caseStudy(p)}</div>
  ${gal.length ? `<section class="pj-gal"><h3 class="cs-title">Gallery</h3><div class="gal">${gal.map((im, k) =>
    `<a href="${UP}${asset(im)}" target="_blank" rel="noopener"><img${srcset(im, "(max-width: 700px) 94vw, 540px")} alt="${esc(p.title)}, image ${k + 1}" loading="lazy" decoding="async"></a>`).join("")}</div></section>` : ""}
</article>`;
}

function indexPage() {
  const data = projects.map((p, i) => ({
    slug: p.slug, title: p.title, year: p.year || "", cat: p.category || "", section: p.section || "Design work",
    icon: iconFor(p), n: i + 1,
  }));
  const groups = [];
  for (const d of data) { let g = groups.find((x) => x.name === d.section); if (!g) groups.push(g = { name: d.section, items: [] }); g.items.push(d); }
  groups.sort((a, b) => (b.name === "Product launches") - (a.name === "Product launches"));

  const prize = (d) => `<button class="prize" type="button" data-slug="${d.slug}" aria-label="Grab ${esc(d.title)}"><img src="${d.icon}" alt="" width="52" height="52" draggable="false"></button>`;
  const row = (d) => `<li><button type="button" class="ix-row" data-open="${d.slug}"><img src="${d.icon}" alt="" width="52" height="52"><span class="ix-n">${pad(d.n)}</span><span class="ix-t">${esc(d.title)}</span><span class="ix-y">${esc(d.year)}</span></button></li>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(site.name)} | Arcade</title>
<meta name="description" content="${esc(site.name)}, ${esc(site.role)}. The portfolio as a claw machine: grab a prize to open a project.">
<meta name="theme-color" content="#eef0ff">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="arcade.css">
</head>
<body>
<main class="machine" id="machine">
  <canvas class="bg" id="bg" aria-hidden="true"></canvas>
  <canvas class="rig" id="rig" aria-hidden="true"></canvas>
  <div class="pit" id="pit"><div class="fx" id="fx" aria-hidden="true"><div class="rays"></div><div class="rays rays-2"></div><div class="glow"></div></div>${data.map(prize).join("")}</div>
</main>



<a class="logo" href="./" aria-label="${esc(site.name)} arcade, reload">
  <span class="logo-dt" data-text="${esc(site.name.split(" ").map((w) => w[0]).join(""))}">${esc(site.name.split(" ").map((w) => w[0]).join(""))}</span>
  <span class="logo-sub">${esc(site.name.toUpperCase())}<br>CLAW / ARCADE-01</span>
</a>

<aside class="readout px-panel" aria-label="Contact and details">
  <p><b>${esc(site.name)}</b><br>${esc(site.role)}</p>
  <p>${esc(site.location || "")}</p>
  <dl>
    ${site.email ? `<div><dt>Mail</dt><dd><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></dd></div>` : ""}
    ${site.linkedin ? `<div><dt>In</dt><dd><a href="${esc(site.linkedin)}" rel="noopener" target="_blank">LinkedIn ↗</a></dd></div>` : ""}
    <div><dt>Site</dt><dd><a href="../portfolio/">Full portfolio</a> · <a href="../">Menu</a></dd></div>
    <div><dt>Prizes</dt><dd>${pad(projects.length)}</dd></div>
    <div><dt>Time</dt><dd data-clock>--:--:--</dd></div>
    <div><dt>Sound</dt><dd><button type="button" class="snd" data-sound aria-pressed="false">Off</button></dd></div>
  </dl>
</aside>

<p class="hint" id="hint" aria-live="polite"><span class="led"></span><span data-hint>Move to aim · Click a prize, or hit the red button</span></p>
<button class="big-red" id="big-red" type="button" aria-label="Drop the claw on the nearest prize"><span class="br-cap" aria-hidden="true"></span><span class="br-label">Grab</span></button>

<nav class="drawer" id="drawer" aria-label="All projects">
  <button class="tab" type="button" aria-expanded="false" aria-controls="ix"><span class="tab-arrow" aria-hidden="true">→</span><span class="tab-txt">Index</span></button>
  <div class="ix" id="ix">
    <p class="ix-head">Skip the game <span>${pad(projects.length)} projects</span></p>
    ${groups.map((g) => `<p class="ix-g">${esc(g.name)} <span>${pad(g.items.length)}</span></p><ul>${g.items.map(row).join("")}</ul>`).join("")}
  </div>
</nav>

<div class="win" id="win" role="dialog" aria-modal="true" aria-labelledby="win-title" hidden>
  <div class="win-bar">
    <span class="win-led"></span><span class="win-title" id="win-title">Loading</span>
    <button class="win-x" type="button" data-close aria-label="Close and drop the prize">×</button>
  </div>
  <div class="win-body" id="win-body"></div>
</div>

<script>window.ARCADE=${JSON.stringify(data)};</script>
<script src="game.js" defer></script>
</body>
</html>
`;
}

// ---------- write ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "p"), { recursive: true });
fs.writeFileSync(path.join(OUT, "index.html"), indexPage());
projects.forEach((p, i) => fs.writeFileSync(path.join(OUT, "p", `${p.slug}.html`), fragment(p, i)));
fs.writeFileSync(path.join(OUT, "arcade.css"),
  fs.readFileSync(path.join(SRC, "arcade", "arcade.css"), "utf8") + "\n\n/* ---- case-study sections (generated from the main site's style.css) ---- */\n.win-body {\n" + caseCss() + "\n}\n");
fs.copyFileSync(path.join(SRC, "arcade", "game.js"), path.join(OUT, "game.js"));
copyDir(path.join(SRC, "arcade", "px"), path.join(OUT, "px"));

console.log(`Arcade: ${projects.length} prizes built into dist/arcade/`);
