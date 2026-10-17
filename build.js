// Builds the site from src/ into dist/. No dependencies: run with `node build.js`.
// Projects live in src/projects/*.json, site text in src/site.json, images in src/images/.
const fs = require("fs");
const path = require("path");
const { caseStudy } = require("./casestudy");

const SRC = path.join(__dirname, "src");
const OUT = path.join(__dirname, "dist");
const PREVIEW = process.env.PREVIEW === "1"; // links end in index.html (for file previews)
const SIZES = path.join(__dirname, ".sizes"); // web-sized copies made by tools/resize.py
const WIDTHS = [800, 1600, 2560];              // keep in sync with tools/resize.py

// ---------- helpers ----------
const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slugify = (s) =>
  String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const paras = (t = "") =>
  String(t).trim().split(/\n\s*\n/).filter(Boolean)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("\n");
const lines = (t = "") => String(t).split("\n").map((l) => l.trim()).filter(Boolean);
const pad = (n) => String(n).padStart(2, "0");

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    e.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}

// Read pixel size of a JPEG/PNG/WebP without libraries (used to lay out the gallery).
function imageSize(file) {
  try {
    const b = fs.readFileSync(file);
    if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1], len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
          return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
    if (b.toString("ascii", 8, 12) === "WEBP") {
      const t = b.toString("ascii", 12, 16);
      if (t === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (t === "VP8L") { const n = b.readUInt32LE(21); return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 }; }
      if (t === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    }
  } catch (e) {}
  return null;
}

// ---------- data ----------
const site = JSON.parse(fs.readFileSync(path.join(SRC, "site.json"), "utf8"));
const projects = fs.readdirSync(path.join(SRC, "projects"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    const p = JSON.parse(fs.readFileSync(path.join(SRC, "projects", f), "utf8"));
    p.slug = slugify(path.basename(f, ".json")) || slugify(p.title);
    p._file = `src/projects/${f}`;
    p.images = (p.images || []).filter(Boolean);
    p.cover = p.cover || p.images[0] || "";
    p.fp = p.focus ? `object-position:${String(p.focus).replace(/[^0-9.% a-z]/gi, "")};` : "";
    p.order = Number(p.order) || 0;
    if (p.hidden) return null;
    return p;
  })
  .filter(Boolean)
  .sort((a, b) => a.order - b.order || (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title));

const years = projects.map((p) => p.year).filter(Boolean);
const featured = projects.filter((p) => p.featured).slice(0, 6);
if (!featured.length) featured.push(...projects.slice(0, 4));

// ---------- urls ----------
// Every link is relative, so the site works from any folder or domain.
const make = (depth) => {
  const root = depth ? "../".repeat(depth) : "./";
  const page = (p) => root + p + (PREVIEW ? "index.html" : "");
  return {
    root: PREVIEW ? root + "index.html" : root,
    asset: (p) => root + String(p).replace(/^\/+/, ""),
    work: (slug) => page(`work/${slug}/`),
    home: page("portfolio/"),
    arcade: page("arcade/"),
    about: page("about/"),
  };
};

const srcPath = (p) => path.join(SRC, String(p).replace(/^\/+/, ""));
const dims = (p) => imageSize(srcPath(p));
const wh = (p) => { const d = dims(p); return d ? ` width="${d.w}" height="${d.h}"` : ""; };

// srcset: the browser downloads the smallest WebP copy that is still sharp on the visitor's
// screen (up to 2560px wide). The full-resolution original is loaded when someone clicks to zoom.
// If the copies are missing (e.g. Pillow unavailable), the original is used directly.
function srcset(p, u, sizes) {
  const d = dims(p);
  if (!d) return ` src="${u.asset(p)}"`;
  const base = String(p).replace(/^\/+/, "").replace(/\.[a-z0-9]+$/i, "");
  const widths = [...WIDTHS.filter((w) => w < d.w), ...(d.w <= WIDTHS[WIDTHS.length - 1] ? [d.w] : [])];
  const have = [...new Set(widths)].filter((w) => fs.existsSync(path.join(SIZES, `${base}-${w}.webp`)));
  if (!have.length) return ` src="${u.asset(p)}"${wh(p)}`;
  const set = have.map((w) => `${u.asset(`${base}-${w}.webp`)} ${w}w`);
  const fallback = u.asset(`${base}-${have.find((w) => w >= 1600) || have[have.length - 1]}.webp`);
  return ` src="${fallback}" srcset="${set.join(", ")}" sizes="${sizes}" width="${d.w}" height="${d.h}"`;
}

// ---------- on-page editor ----------
// Text that can be edited from the page is marked with data-ed="<file>#<json pointer>", and the raw
// source value is shipped in a JSON block, so the editor shows exactly what's in the file (paragraph
// breaks and list lines included). Saving goes through functions/api/edit.js, which commits to GitHub.
let EDV = {};
const ED = (file) => (ptr, raw) => {
  if (raw === undefined || raw === null || (typeof raw === "object" && !Array.isArray(raw))) return "";
  const key = `${file}#${ptr}`;
  EDV[key] = Array.isArray(raw) ? raw.join("\n") : String(raw);
  return ` data-ed="${esc(key)}"`;
};
const SITE = ED("src/site.json");
const edBlock = () => Object.keys(EDV).length
  ? `<script type="application/json" id="ed-src">${JSON.stringify(EDV).replace(/</g, "\\u003c")}</script>` : "";

// ---------- layout ----------
const FONTS = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Unbounded:wght@300;400;500;600&display=swap";

function layout({ depth, title, desc, body, cls = "", image = "" }) {
  const u = make(depth);
  const fullTitle = title ? `${title} | ${site.name}` : `${site.name} | ${site.role}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc || site.tagline)}">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(desc || site.tagline)}">
${image ? `<meta property="og:image" content="${esc(u.asset(image))}">` : ""}
<meta name="theme-color" content="#060708">
<link rel="icon" href="${u.asset("favicon.svg")}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${u.asset("assets/style.css")}">
</head>
<body class="${cls}">
<a class="skip" href="#main">Skip to content</a>
<header class="hud" data-hud>
  <a class="mark" href="${u.home}" aria-label="${esc(site.name)}, home"><span>${esc(site.name)}</span></a>
  <span class="hud-role">${esc(site.role)}</span>
  <nav class="nav" aria-label="Main">
    <a href="${u.home}#work" data-nav="work">Work</a>
    <a href="${u.about}" data-nav="about">About</a>
    <a href="${u.arcade}">Arcade</a>
    ${site.email ? `<a href="mailto:${esc(site.email)}">Contact</a>` : ""}
  </nav>
</header>
<div class="progress" aria-hidden="true"><i data-progress></i></div>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="foot-big">
    <p class="foot-line"${site.contact_line ? SITE("/contact_line", site.contact_line) : ""}>${esc(site.contact_line || "Have a product to bring to market?")}</p>
    ${site.email ? `<a class="foot-mail" href="mailto:${esc(site.email)}">${esc(site.email)}</a>` : ""}
  </div>
  <div class="foot-row">
    <span>&copy; <span data-year>${new Date().getFullYear()}</span> ${esc(site.name)}${site.location ? ` / ${esc(site.location)}` : ""}</span>
    <span class="foot-links">
      ${site.instagram ? `<a href="${esc(site.instagram)}" rel="noopener">Instagram</a>` : ""}
      ${site.linkedin ? `<a href="${esc(site.linkedin)}" rel="noopener">LinkedIn</a>` : ""}
      <a href="#main" data-top>Back to top</a>
      <button class="ed-lock" type="button" data-ed-lock aria-label="Edit site text" title="Edit"><svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg></button>
    </span>
    <span class="readout" aria-hidden="true"><span data-pct>000</span>%</span>
  </div>
</footer>
<div class="cursor" aria-hidden="true"><span class="cursor-ring"><span class="cursor-label">View</span></span><span class="cursor-dot"></span></div>
<script src="https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js" defer></script>
<script src="${u.asset("assets/site.js")}" defer></script>
${edBlock()}
<script src="${u.asset("assets/edit.js")}" defer></script>
</body>
</html>
`;
}

// ---------- pages ----------
const SPANS = [7, 5, 4, 4, 4, 5, 7, 6, 6]; // repeating grid rhythm on a 12-column grid

function homePage() {
  EDV = {};
  const u = make(1);
  const slides = featured.map((p, i) => `
    <figure class="slide${i === 0 ? " is-on" : ""}" data-slide data-title="${esc(p.title)}" data-year="${esc(p.year)}" data-href="${u.work(p.slug)}">
      <img${srcset(p.cover, u, "100vw")} alt=""${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}${p.fp ? ` style="${p.fp}"` : ""}>
    </figure>`).join("");

  // Projects are grouped into sections (e.g. "Product launches", "Design work"), in order of first appearance.
  const groups = [];
  projects.forEach((p) => {
    const name = p.section || "Design work";
    let g = groups.find((x) => x.name === name);
    if (!g) groups.push((g = { name, items: [] }));
    g.items.push(p);
  });
  let n = 0;
  // Lay tiles out in rows of the rhythm below; the last row of a section always fills the width.
  const ROWS = [[7, 5], [4, 4, 4], [5, 7], [6, 6]];
  const spansFor = (count) => {
    const out = []; let r = 0;
    while (out.length < count) {
      const left = count - out.length;
      let row = ROWS[r++ % ROWS.length];
      if (left < row.length) row = left === 1 ? [12] : [6, 6];
      out.push(...row.slice(0, left));
    }
    return out;
  };
  const tile = (p, i, arr) => {
    const span = spansFor(arr.length)[i];
    return `
    <a class="tile s${span}" href="${u.work(p.slug)}" data-reveal data-cursor>
      <div class="tile-media"><img${srcset(p.cover, u, `(max-width: 900px) 100vw, ${Math.round((span / 12) * 100)}vw`)} alt="${esc(p.title)}" loading="lazy" decoding="async" style="${p.fp}view-transition-name:v-${p.slug}"></div>
      <div class="tile-meta">
        <span class="tile-n">${pad(++n)}</span>
        <span class="tile-title">${esc(p.title)}</span>
        <span class="tile-cat">${esc(p.category || "")}</span>
        <span class="tile-year">${esc(p.year || "")}</span>
      </div>
    </a>`;
  };
  const sections = groups.map((g, gi) => {
    const ys = g.items.map((p) => p.year).filter(Boolean);
    const sub = g.items.find((p) => p.company) ? g.items.find((p) => p.company).company + ", " : "";
    return `
  <div class="work-group">
  <div class="work-head" data-reveal>
    <h2 ${gi === 0 ? 'id="work-h" ' : ""}class="section-title">${esc(g.name)}</h2>
    <p class="work-count">${g.items.length} projects, ${sub}${Math.min(...ys)}${Math.max(...ys) !== Math.min(...ys) ? ` to ${Math.max(...ys)}` : ""}</p>
  </div>
  <div class="grid">${g.items.map(tile).join("")}
  </div>
  </div>`;
  }).join("");

  const body = `
<section class="hero" data-hero aria-label="Featured work">
  <div class="hero-stage">
    <div class="slides" data-parallax>${slides}</div>
    <div class="hero-shade"></div>
  </div>
  <div class="frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
  <div class="hero-text">
    <h1 class="hero-title" data-split>${esc(site.name)}</h1>
    <p class="hero-tag"${SITE("/tagline", site.tagline)}>${esc(site.tagline)}</p>
  </div>
  <a class="readout-card" href="${u.work(featured[0].slug)}" data-readout>
    <span class="rc-idx"><span data-ro-i>01</span> / ${pad(featured.length)}</span>
    <span class="rc-title" data-ro-title>${esc(featured[0].title)}</span>
    <span class="rc-year" data-ro-year>${esc(featured[0].year)}</span>
    <span class="rc-bar"><i data-ro-bar></i></span>
  </a>
  <a class="hero-down" href="#work">Scroll to work</a>
</section>

<section class="work" id="work" aria-labelledby="work-h">
${sections}
</section>`;
  return layout({ depth: 1, body, cls: "page-home", image: featured[0].cover });
}

function galleryRows(images) {
  // Landscape images run full width; consecutive portrait/square images pair up side by side.
  const items = images.map((src) => { const d = dims(src); return { src, tall: d ? d.w / d.h < 1.25 : false }; });
  const rows = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].tall && items[i + 1] && items[i + 1].tall) { rows.push([items[i], items[i + 1]]); i++; }
    else rows.push([items[i]]);
  }
  return rows;
}

function projectPage(p, i) {
  EDV = {};
  const E = ED(p._file);
  const u = make(2);
  const next = projects[(i + 1) % projects.length];
  let n = 0;
  const rows = galleryRows(p.images).map((row) => `
    <div class="row${row.length > 1 ? " pair" : ""}">${row.map((it) => {
      const k = n++;
      return `
      <figure class="fig" data-reveal>
        <button class="fig-btn" type="button" data-lb="${k}" data-full="${u.asset(it.src)}" data-cursor aria-label="Open image ${k + 1} of ${p.images.length} at full size">
          <img${srcset(it.src, u, row.length > 1 ? "(max-width: 560px) 100vw, 48vw" : "(max-width: 900px) 100vw, 94vw")} alt="${esc(p.title)}, image ${k + 1}" loading="lazy" decoding="async">
        </button>
        <figcaption>Fig. ${pad(k + 1)}</figcaption>
      </figure>`;
    }).join("")}
    </div>`).join("");

  const spec = [["Company", p.company, "company"], ["Role", p.role, "role"], ["Year", p.year, "year"], ["Discipline", p.category, "category"], ["Status", p.status, "status"], ["Tools", p.tools, "tools"], ["Images", p.images.length || ""]]
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v, f]) => `<div><dt>${k}</dt><dd${f ? E(`/${f}`, v) : ""}>${esc(v)}</dd></div>`).join("");

  const body = `
<article class="project">
  <section class="p-hero">
    <div class="p-hero-media" data-parallax><img${srcset(p.cover, u, "100vw")} alt="" fetchpriority="high" style="${p.fp}view-transition-name:v-${p.slug}"></div>
    <div class="hero-shade"></div>
    <div class="frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="p-hero-text">
      <p class="p-index">Project ${pad(i + 1)} of ${pad(projects.length)}</p>
      <h1 class="p-title" data-split${E("/title", p.title)}>${esc(p.title)}</h1>
    </div>
  </section>
  <section class="p-info" data-reveal>
    <dl class="spec">${spec}</dl>
    <div class="p-desc"${p.description ? E("/description", p.description) : ""}>${p.description ? paras(p.description) : ""}</div>
  </section>
  ${caseStudy(p, E)}
  ${rows ? `<section class="p-gallery" aria-label="Images">${caseStudy(p) ? `<h2 class="cs-title gal-title">Gallery</h2>` : ""}${rows}
  </section>` : ""}
  <a class="p-next" href="${u.work(next.slug)}" data-cursor>
    <span class="p-next-media"><img${srcset(next.cover, u, "100vw")} alt="" loading="lazy"${next.fp ? ` style="${next.fp}"` : ""}></span>
    <span class="p-next-label">Next project</span>
    <span class="p-next-title">${esc(next.title)}</span>
  </a>
</article>
<div class="lightbox" data-lightbox hidden role="dialog" aria-modal="true" aria-label="Image viewer">
  <img alt="" data-lb-img>
  <span class="lb-count" data-lb-count></span>
  <button class="lb-btn lb-prev" type="button" data-lb-prev aria-label="Previous image">Prev</button>
  <button class="lb-btn lb-next" type="button" data-lb-next aria-label="Next image">Next</button>
  <button class="lb-btn lb-close" type="button" data-lb-close aria-label="Close viewer">Close</button>
</div>`;
  return layout({ depth: 2, title: p.title, desc: (p.description || "").split("\n")[0].slice(0, 160) || `${p.title}, ${p.year}`, body, cls: "page-project", image: p.cover });
}

function aboutPage() {
  EDV = {};
  const u = make(1);
  const picks = projects.filter((p) => p.featured).slice(0, 3);
  const list = (t) => lines(t).map((c) => `<li>${esc(c)}</li>`).join("");
  const capPtr = Array.isArray(site.capabilities) ? (i) => `/capabilities/${i}/items` : () => "/capabilities";
  const capGroups = Array.isArray(site.capabilities)
    ? site.capabilities
    : [{ title: "Capabilities", items: site.capabilities || "" }];

  const stats = (site.stats || []).map((s, i) => s && s.value ? `
      <div class="stat"><dt${SITE(`/stats/${i}/label`, s.label)}>${esc(s.label || "")}</dt><dd${SITE(`/stats/${i}/value`, s.value)}>${esc(s.value)}</dd></div>` : "").join("");

  const jobs = (site.experience || []).map((j, i) => j && (j.company || j.role) ? `
      <li class="job" data-reveal>
        <span class="job-dates"${SITE(`/experience/${i}/dates`, j.dates)}>${esc(j.dates || "")}</span>
        <div class="job-head"><h3 class="job-co"${SITE(`/experience/${i}/company`, j.company)}>${esc(j.company || "")}</h3><p class="job-role"${SITE(`/experience/${i}/role`, j.role)}>${esc(j.role || "")}</p></div>
        <p class="job-sum"${SITE(`/experience/${i}/summary`, j.summary)}>${esc(j.summary || "")}</p>
      </li>` : "").join("");

  const collabs = lines(site.collaborations).map((c) => `<li>${esc(c)}</li>`).join("");

  const body = `
<section class="about">
  <div class="about-head">
    <p class="p-index">About${site.location ? ` / ${esc(site.location)}` : ""}</p>
    <h1 class="about-title" data-split${SITE("/role", site.role)}>${esc(site.role)}</h1>
    <p class="about-tag"${SITE("/tagline", site.tagline)}>${esc(site.tagline)}</p>
  </div>

  ${stats ? `<dl class="stats" data-reveal>${stats}
  </dl>` : ""}

  <div class="about-body" data-reveal>
    <div class="about-bio"${SITE("/about", site.about)}>${paras(site.about)}</div>
    <div class="about-side">
      ${capGroups.map((g, i) => `<h2 class="mini"${Array.isArray(site.capabilities) ? SITE(`/capabilities/${i}/title`, g.title) : ""}>${esc(g.title || "")}</h2><ul class="caps"${SITE(capPtr(i), g.items)}>${list(g.items)}</ul>`).join("\n      ")}
    </div>
  </div>

  ${jobs ? `<div class="block">
    <h2 class="section-title block-title" data-reveal>Experience</h2>
    <ol class="jobs">${jobs}
    </ol>
  </div>` : ""}

  <div class="block facts" data-reveal>
    ${site.education ? `<div><h2 class="mini">Education</h2><p class="fact-main"${SITE("/education", site.education)}>${lines(site.education).map(esc).join("<br>")}</p></div>` : ""}
    ${site.recognition ? `<div><h2 class="mini">Recognition and teaching</h2><ul class="caps"${SITE("/recognition", site.recognition)}>${list(site.recognition)}</ul></div>` : ""}
    ${site.languages ? `<div><h2 class="mini">Languages</h2><ul class="caps"${SITE("/languages", site.languages)}>${list(site.languages)}</ul></div>` : ""}
  </div>

  ${collabs ? `<div class="block" data-reveal>
    <h2 class="mini">Brands and collaborations</h2>
    <ul class="collabs"${SITE("/collaborations", site.collaborations)}>${collabs}</ul>
  </div>` : ""}

  <div class="block contact" data-reveal>
    <h2 class="mini">Contact</h2>
    <dl class="contact-list">
      ${site.email ? `<div><dt>Email</dt><dd><a class="link" href="mailto:${esc(site.email)}">${esc(site.email)}</a></dd></div>` : ""}
      ${site.linkedin ? `<div><dt>LinkedIn</dt><dd><a class="link" href="${esc(site.linkedin)}" rel="noopener">${esc(site.linkedin.replace(/^https?:\/\/(www\.)?/, ""))}</a></dd></div>` : ""}
      ${site.location ? `<div><dt>Based in</dt><dd>${esc(site.location)}</dd></div>` : ""}
    </dl>
  </div>

  <div class="about-strip" data-reveal>${picks.map((p) => `
    <a class="strip-item" href="${u.work(p.slug)}" data-cursor><img${srcset(p.cover, u, "(max-width: 560px) 100vw, 33vw")} alt="${esc(p.title)}" loading="lazy"${p.fp ? ` style="${p.fp}"` : ""}><span>${esc(p.title)}</span></a>`).join("")}
  </div>
</section>`;
  return layout({ depth: 1, title: "About", desc: lines(site.about)[0], body, cls: "page-about" });
}

function notFound() {
  EDV = {};
  const body = `<section class="nf"><p class="p-index">Error 404</p><h1 class="about-title">Signal lost</h1><p class="about-tag">This page doesn't exist. <a class="link" href="/">Go to the homepage</a></p></section>`;
  return layout({ depth: 0, title: "Page not found", body, cls: "page-about" });
}

// ---------- entry page: pick a version ----------
function chooserPage() {
  const u = make(0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(site.name)} | ${esc(site.role)}</title>
<meta name="description" content="${esc(site.tagline)}">
<meta property="og:title" content="${esc(site.name)} | ${esc(site.role)}">
<meta property="og:description" content="${esc(site.tagline)}">
<meta name="theme-color" content="#060708">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Unbounded:wght@200;300;400&family=Press+Start+2P&display=swap">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { overflow: hidden; background: #060708; font: 400 13px/1.5 "IBM Plex Mono", monospace; -webkit-font-smoothing: antialiased; }
  .split { display: flex; height: 100vh; height: 100dvh; }
  .side { position: relative; flex: 1 1 0; min-width: 0; min-height: 0; overflow: hidden; text-decoration: none; display: block; transition: flex-grow 0.8s cubic-bezier(0.22, 1, 0.36, 1); }
  .side:hover, .side:focus-visible { flex-grow: 1.35; }
  .side:focus-visible { outline: 2px solid #ff5b1f; outline-offset: -6px; }
  .side > * { pointer-events: none; }

  /* 01: portfolio, abstract artwork */
  .one { background: #070c14; color: #e9ebee; }
  .one canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .one::after { content: ""; position: absolute; inset: 0; background: radial-gradient(120% 90% at 60% 45%, transparent 40%, rgba(0,0,0,0.75)); }
  .one .txt { position: absolute; z-index: 2; left: clamp(20px, 4vw, 56px); bottom: clamp(24px, 6vh, 64px); max-width: 32ch; padding: 10px 14px 12px; margin: -10px -14px; background: #070c14; }
  .one .n { font: 200 clamp(64px, 11vw, 168px)/0.85 "Unbounded", sans-serif; letter-spacing: -0.04em; }
  .one .h { margin: 18px 0 8px; font: 400 clamp(18px, 2vw, 26px)/1.1 "Unbounded", sans-serif; text-transform: uppercase; }
  .one .s { margin: 0; color: #868d97; font-size: 12px; }
  .one .go { margin-top: 18px; display: inline-flex; gap: 10px; align-items: center; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; }
  .one .go i { width: 34px; height: 1px; background: #ff5b1f; transition: width 0.6s; }
  .one:hover .go i { width: 70px; }

  /* 02: arcade, the same artwork as 01 but white and 8-bit */
  .two { background: #ffffff; color: #0b0b0d; font-family: "Press Start 2P", "IBM Plex Mono", monospace; }
  .two canvas { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; }
  .two .txt { position: absolute; z-index: 2; left: clamp(20px, 4vw, 56px); bottom: clamp(24px, 6vh, 64px); max-width: 32ch; padding: 10px 14px 12px; margin: -10px -14px; background: #ffffff; }
  .two .n { font-size: clamp(54px, 9vw, 136px); line-height: 0.9; letter-spacing: -0.04em; }
  .two .h { margin: 22px 0 10px; font-size: clamp(14px, 1.6vw, 21px); line-height: 1.2; text-transform: uppercase; }
  .two .s { margin: 0; color: #6b6b72; font: 400 12px/1.5 "IBM Plex Mono", monospace; }
  .two .go { margin-top: 18px; display: inline-flex; gap: 10px; align-items: center; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; }
  .two .go i { width: 34px; height: 4px; background: #d71921; transition: width 0.4s steps(4); }
  .two:hover .go i { width: 70px; }

  /* centre seam */
  .seam { position: fixed; z-index: 5; left: 50%; top: 0; bottom: 0; width: 0; pointer-events: none; }
  .head { position: fixed; z-index: 6; top: 30px; left: 50%; translate: -50% 0; pointer-events: none; text-align: center; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #868d97; mix-blend-mode: difference; }
  .head b { display: block; font: 400 13px "Unbounded", sans-serif; letter-spacing: 0.24em; color: #fff; margin-bottom: 4px; }
  @media (max-width: 760px), (max-aspect-ratio: 4/5) {
    .split { flex-direction: column; }
    .side:hover, .side:focus-visible { flex-grow: 1.15; }
    .head { top: 14px; bottom: auto; left: 16px; translate: none; text-align: left; mix-blend-mode: normal; }
    .one .txt { bottom: 22px; }
    .one .txt, .two .txt { bottom: 22px; }
  }
  @media (prefers-reduced-motion: reduce) { .side { transition: none; } }
</style>
</head>
<body>
<p class="head"><b>${esc(site.name)}</b>Choose a version · click a side</p>
<main class="split">
  <a class="side one" href="${u.home}" aria-label="Option 1: the portfolio">
    <canvas id="art" aria-hidden="true"></canvas>
    <div class="txt">
      <div class="n">01</div>
      <p class="h">Portfolio</p>
      <p class="s">${esc(site.role)}. Product launches, research and design work.</p>
      <span class="go"><i></i>Enter</span>
    </div>
  </a>
  <a class="side two" href="${u.arcade}" aria-label="Option 2: the arcade claw machine">
    <canvas id="art8" aria-hidden="true"></canvas>
    <div class="txt">
      <div class="n">02</div>
      <p class="h">Arcade</p>
      <p class="s">The same projects, inside an 8-bit claw machine. Grab one to open it.</p>
      <span class="go"><i></i>Press start</span>
    </div>
  </a>
</main>
<script>
(() => {
  // One product close-up, rendered twice: smooth and dark for 01, white and 8-bit for 02.
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let mx = 0, my = 0;
  const t0 = performance.now();
  addEventListener("pointermove", (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });

  // ---------- product close-ups: 3/4 wireframe models + Sutnar-style colour blocks, no text ----------
  const TAU = Math.PI * 2;
  // 2D helpers (profiles)
  const R2 = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const C2 = (cx, cy, r, n = 40) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * TAU) * r, cy + Math.sin(i / n * TAU) * r]);
  const G2 = (cx, cy, r, n, dep) => Array.from({ length: n * 4 }, (_, i) => { const k = i % 4, a = i / (n * 4) * TAU, rr = k === 1 || k === 2 ? r : r - dep; return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]; });
  const close = (p) => [...p, p[0]];
  // 3D builders: every model is a list of polylines {p: [[x,y,z]...], s: style}
  // styles: o outline, f fine detail, h hidden (dashed), a accent
  function extrudeZ(poly, z0, z1, s = "o", every = 1) {
    const out = [{ s, p: close(poly.map(([x, y]) => [x, y, z0])) }, { s: "f", p: close(poly.map(([x, y]) => [x, y, z1])) }];
    poly.forEach(([x, y], i) => { if (i % every === 0) out.push({ s: "f", p: [[x, y, z0], [x, y, z1]] }); });
    return out;
  }
  const swapX = (st) => st.map((o) => ({ ...o, p: o.p.map(([a, b, c]) => [c, b, a]) }));       // extrude along x instead of z
  const swapY = (st) => st.map((o) => ({ ...o, p: o.p.map(([a, b, c]) => [a, c, b]) }));       // extrude along y
  const box = (x0, y0, z0, x1, y1, z1, s = "o") => extrudeZ(R2(x0, y0, x1, y1), z0, z1, s);
  function ring(c, r, axis, s = "f", n = 48) {          // circle in the plane normal to an axis
    const p = [];
    for (let i = 0; i <= n; i++) { const a = i / n * TAU, u = Math.cos(a) * r, v = Math.sin(a) * r;
      p.push(axis === "x" ? [c[0], c[1] + u, c[2] + v] : axis === "y" ? [c[0] + u, c[1], c[2] + v] : [c[0] + u, c[1] + v, c[2]]); }
    return { s, p };
  }
  function cyl(c, r, h0, h1, axis, rings = 2, gens = 8, s = "o") {   // wireframe cylinder along an axis
    const at = (h) => axis === "x" ? [h, c[1], c[2]] : axis === "y" ? [c[0], h, c[2]] : [c[0], c[1], h];
    const out = [];
    for (let i = 0; i <= rings; i++) out.push(ring(at(h0 + (h1 - h0) * i / rings), r, axis, i === 0 || i === rings ? s : "f"));
    for (let g = 0; g < gens; g++) { const a = g / gens * TAU, u = Math.cos(a) * r, v = Math.sin(a) * r;
      const off = (p) => axis === "x" ? [p[0], p[1] + u, p[2] + v] : axis === "y" ? [p[0] + u, p[1], p[2] + v] : [p[0] + u, p[1] + v, p[2]];
      out.push({ s: "f", p: [off(at(h0)), off(at(h1))] }); }
    return out;
  }
  const hex = (c, r, h, axis = "y", s = "o") => {
    const pts = Array.from({ length: 6 }, (_, i) => [Math.cos(i / 6 * TAU + 0.5) * r, Math.sin(i / 6 * TAU + 0.5) * r]);
    let st = extrudeZ(pts, 0, h, s);
    st = axis === "y" ? swapY(st) : axis === "x" ? swapX(st) : st;
    return st.map((o) => ({ ...o, p: o.p.map(([x, y, z]) => [x + c[0], y + c[1], z + c[2]]) }));
  };
  const move = (st, dx, dy, dz) => st.map((o) => ({ ...o, p: o.p.map(([x, y, z]) => [x + dx, y + dy, z + dz]) }));
  const style = (st, s) => st.map((o) => ({ ...o, s }));

  // ---- technical drawing kit: any-axis circles, tubes, prisms, threads, fasteners, bearings, section hatching ----
  const V3 = { add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; } };
  const AXV = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  function basis(n) { n = V3.norm(typeof n === "string" ? AXV[n] : n); const t = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const u = V3.norm(V3.cross(n, t)); return [n, u, V3.cross(n, u)]; }
  const pt = (c, B, h, r, a) => [0, 1, 2].map((j) => c[j] + B[0][j] * h + (B[1][j] * Math.cos(a) + B[2][j] * Math.sin(a)) * r);
  const circA = (c, n, h, r, s = "f", seg = 36, a0 = 0) => { const B = basis(n); return { s, p: Array.from({ length: seg + 1 }, (_, i) => pt(c, B, h, r, a0 + i / seg * TAU)) }; };
  const polyA = (c, n, h, r, k, s = "f", a0 = 0) => circA(c, n, h, r, s, k, a0);
  const cline = (c, n, h0, h1) => { const B = basis(n); return { s: "c", p: [pt(c, B, h0, 0, 0), pt(c, B, h1, 0, 0)] }; };
  function tube(c, n, r, h0, h1, s = "o", gens = 4, rings = 0) {
    const B = basis(n), out = [circA(c, n, h0, r, s), circA(c, n, h1, r, s)];
    for (let i = 1; i <= rings; i++) out.push(circA(c, n, h0 + (h1 - h0) * i / (rings + 1), r, "f"));
    for (let g = 0; g < gens; g++) { const a = g / gens * TAU + 0.4; out.push({ s: "f", p: [pt(c, B, h0, r, a), pt(c, B, h1, r, a)] }); }
    return out;
  }
  function prismA(c, n, h0, h1, r, k, s = "o", a0 = 0.5) {
    const B = basis(n), out = [polyA(c, n, h0, r, k, s, a0), polyA(c, n, h1, r, k, s, a0)];
    for (let i = 0; i < k; i++) out.push({ s: "f", p: [pt(c, B, h0, r, a0 + i / k * TAU), pt(c, B, h1, r, a0 + i / k * TAU)] });
    return out;
  }
  function helixA(c, n, r, h0, h1, pitch, s = "f") {
    const B = basis(n), turns = Math.abs(h1 - h0) / pitch, N = Math.max(8, Math.ceil(turns * 18)), p = [];
    for (let i = 0; i <= N; i++) { const f = i / N; p.push(pt(c, B, h0 + (h1 - h0) * f, r, f * turns * TAU)); }
    return { s, p };
  }
  // n points out of the work, toward the head; the shank runs back along -n. ex pulls it out along n (exploded).
  function screw(c, n, { d = 6, len = 30, head = "socket", ex = 0 } = {}) {
    const B = basis(n), cc = [0, 1, 2].map((j) => c[j] + B[0][j] * ex), r = d / 2, out = [];
    let s0 = 0;
    if (head === "socket") out.push(...tube(cc, n, d * 0.78, 0, d, "o", 6), polyA(cc, n, d, d * 0.3, 6, "f"), circA(cc, n, d, d * 0.62, "f"));
    else if (head === "hex") out.push(...prismA(cc, n, 0, d * 0.65, d * 0.92, 6, "o"), circA(cc, n, d * 0.65, d * 0.8, "f"));
    else if (head === "pan") { out.push(...tube(cc, n, d * 0.95, 0, d * 0.32, "o", 6), circA(cc, n, d * 0.5, d * 0.72, "f"), circA(cc, n, d * 0.6, d * 0.4, "f"));
      for (const a of [0, Math.PI / 2]) out.push({ s: "f", p: [pt(cc, B, d * 0.6, d * 0.3, a), pt(cc, B, d * 0.6, d * 0.3, a + Math.PI)] }); }
    else if (head === "csk") { s0 = -d * 0.5; out.push(circA(cc, n, 0, d, "o"), circA(cc, n, s0, r, "f"));
      for (let g = 0; g < 6; g++) { const a = g / 6 * TAU; out.push({ s: "f", p: [pt(cc, B, 0, d, a), pt(cc, B, s0, r, a)] }); }
      for (const a of [0.4, 0.4 + Math.PI / 2]) out.push({ s: "f", p: [pt(cc, B, 0, d * 0.5, a), pt(cc, B, 0, d * 0.5, a + Math.PI)] }); }
    else out.push(circA(cc, n, 0, r, "o"), polyA(cc, n, 0, d * 0.28, 6, "f"));   // grub screw
    const tip = -len;
    out.push(circA(cc, n, s0, r, "f"), circA(cc, n, tip + r * 0.5, r, "f"), circA(cc, n, tip, r * 0.55, "f"));
    for (const a of [0.5, 0.5 + Math.PI]) out.push({ s: "o", p: [pt(cc, B, s0, r, a), pt(cc, B, tip + r * 0.5, r, a), pt(cc, B, tip, r * 0.55, a)] });
    out.push(helixA(cc, n, r, s0 - r * 0.4, tip + r * 0.6, Math.max(0.8, d * 0.32), "f"));
    out.push(cline(cc, n, d * 1.6, tip - d));
    if (ex) out.push({ s: "h", p: [pt(c, B, 0, 0, 0), pt(cc, B, tip, 0, 0)] });
    return out;
  }
  const nut = (c, n, d) => [...prismA(c, n, 0, d * 0.8, d * 0.92, 6, "o"), circA(c, n, 0, d / 2, "f"), circA(c, n, d * 0.8, d / 2, "f"), circA(c, n, d * 0.8, d * 0.8, "f")];
  function washer(c, n, ro, ri, t, s = "o") {
    const B = basis(n), out = [circA(c, n, 0, ro, s), circA(c, n, t, ro, "f"), circA(c, n, 0, ri, "f"), circA(c, n, t, ri, "f")];
    for (let g = 0; g < 4; g++) { const a = g / 4 * TAU + 0.4; out.push({ s: "f", p: [pt(c, B, 0, ro, a), pt(c, B, t, ro, a)] }); }
    return out;
  }
  function bearing(c, n, ro, ri, w, k = 9) {
    const B = basis(n), out = [], ra = ro * 0.84, rb = ri * 1.3, rm = (ra + rb) / 2, rball = (ra - rb) / 2 * 0.95;
    for (const h of [-w / 2, w / 2]) out.push(circA(c, n, h, ro, "o"), circA(c, n, h, ra, "f"), circA(c, n, h, rb, "f"), circA(c, n, h, ri, "o"));
    for (let g = 0; g < 8; g++) { const a = g / 8 * TAU; out.push({ s: "f", p: [pt(c, B, -w / 2, ro, a), pt(c, B, w / 2, ro, a)] }); }
    for (let i = 0; i < k; i++) {
      const a = i / k * TAU, bc = pt(c, B, 0, rm, a), tan = [0, 1, 2].map((j) => -B[1][j] * Math.sin(a) + B[2][j] * Math.cos(a));
      out.push(circA(bc, n, 0, rball, "a", 14), circA(bc, tan, 0, rball, "f", 14));
    }
    out.push(circA(c, n, 0, rm, "h"));
    return out;
  }
  function hatch2(poly, sp, ang = 0.785) {
    const c = Math.cos(ang), s = Math.sin(ang), R = poly.map(([x, y]) => [x * c + y * s, -x * s + y * c]), ys = R.map((p) => p[1]), out = [];
    for (let y = Math.min(...ys) + sp / 2; y < Math.max(...ys); y += sp) {
      const xs = [];
      for (let i = 0; i < R.length; i++) { const a = R[i], b = R[(i + 1) % R.length]; if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) out.push([[xs[i] * c - y * s, xs[i] * s + y * c], [xs[i + 1] * c - y * s, xs[i + 1] * s + y * c]]);
    }
    return out;
  }
  const hatchZ = (poly, z, sp, ang) => hatch2(poly, sp, ang).map(([a, b]) => ({ s: "t", p: [[a[0], a[1], z], [b[0], b[1], z]] }));
  const hatchX = (polyZY, x, sp, ang) => swapX(hatchZ(polyZY, x, sp, ang));

  const MODELS = [
    // 1. glass railing base shoe, cut open: serrated walls, taper-wedge clamps, gasket, setting blocks, anchors in a slab, end cap pulled off
    { cam: { yaw: -0.62, pitch: 0.34, zoom: 2.0, fx: 0.02, fy: 0.04, at: [0, 45, -20] }, comp: 0, build: () => {
      const st = [], Z0 = -70, Z1 = 70;
      const teeth = (sd) => { const p = []; for (let y = 76; y > 30; y -= 6) p.push([30 * sd, y], [27 * sd, y - 3]); return p; };
      const U = [[-40, 0], [40, 0], [40, 80], [35, 85], [30, 80], ...teeth(1), [30, 22], [-30, 22], ...teeth(-1).reverse(), [-30, 80], [-35, 85], [-40, 80]];
      st.push(...extrudeZ(U, Z0, Z1, "o", 4), ...hatchZ(U, Z0, 4.5));
      for (const x of [-22, 22]) st.push(ring([x, 10, Z0], 3.4, "z", "o"), ring([x, 10, Z1], 3.4, "z", "f"), { s: "f", p: [[x, 13.4, Z0], [x, 13.4, Z1]] });
      st.push(...box(-6, 30, Z0, 6, 230, Z1), { s: "f", p: [[0, 30, Z0], [0, 230, Z0]] }, ...hatchZ(R2(-6, 30, 6, 230), Z0, 7, 2.36), cline([0, 0, Z0], "y", -10, 250));
      for (const z of [-58, 38]) st.push(...style(box(-10, 22, z, 10, 30, z + 20), "f"));
      for (const sd of [-1, 1]) {
        const wedge = [[7 * sd, 32], [14 * sd, 32], [26 * sd, 76], [7 * sd, 76]];
        for (const z of [-62, -14, 34]) { st.push(...style(extrudeZ(wedge, z, z + 24), "a")); for (let y = 41; y < 76; y += 9) { const x = (14 + (y - 32) / 44 * 12) * sd; st.push({ s: "a", p: [[x, y, z], [x - 2.5 * sd, y + 2, z]] }); } }
        const gk = [[6 * sd, 85]]; for (let i = 0; i <= 6; i++) gk.push([(8 + i * 3.6) * sd, i % 2 ? 78 : 81]); gk.push([30 * sd, 81], [30 * sd, 85]);
        st.push({ s: "o", p: close(gk.map(([x, y]) => [x, y, Z0])) }, { s: "f", p: gk.map(([x, y]) => [x, y, Z1]) });
      }
      for (const z of [-22, 18]) st.push(...washer([0, 22, z], "y", 9, 4.4, 2), ...screw([0, 24, z], [0, 1, 0], { d: 8, len: 78, head: "hex" }));
      st.push({ s: "f", p: close([[-95, 0, Z0], [95, 0, Z0], [95, -70, Z0], [-95, -70, Z0]]) }, { s: "f", p: [[-95, 0, Z0], [-95, 0, Z1]] }, { s: "f", p: [[95, 0, Z0], [95, 0, Z1]] }, ...hatchZ(R2(-95, -70, 95, 0), Z0, 9, -0.6));
      const capP = [[-40, 0], [40, 0], [40, 80], [35, 85], [30, 80], [30, 22], [-30, 22], [-30, 80], [-35, 85], [-40, 80]];
      st.push(...extrudeZ(capP, Z0 - 36, Z0 - 30, "o"));
      for (const [x, y] of [[-40, 0], [40, 0], [40, 80], [-40, 80]]) st.push({ s: "h", p: [[x, y, Z0 - 30], [x, y, Z0]] });
      for (const x of [-22, 22]) st.push(...screw([x, 10, Z0 - 52], [0, 0, -1], { d: 5, len: 16, head: "csk" }), { s: "h", p: [[x, 10, Z0 - 36], [x, 10, Z0]] });
      return st;
    } },
    // 2. back-to-back ladder pull through glass: tubes with wall, domed caps, standoffs, nylon washers, threaded rod, grub screws; back half exploded off
    { cam: { yaw: -0.72, pitch: 0.3, zoom: 1.45, fx: 0.0, fy: 0.02, at: [0, 30, 0] }, comp: 1, build: () => {
      const st = [], EX = -40;
      st.push(...box(-6, -150, -70, 6, 180, 70), ...hatchZ(R2(-6, -150, 6, 180), -70, 7, 2.36), { s: "f", p: [[0, -150, -70], [0, 180, -70]] });
      for (const y of [0, 110]) st.push(ring([6, y, 0], 7, "x", "f"), ring([-6, y, 0], 7, "x", "f"));
      for (const sd of [1, -1]) {
        const X = (v) => v * sd + (sd < 0 ? EX : 0), tx = X(52), T = [tx, 0, 0];
        st.push(...tube(T, "y", 13, -125, 150, "o", 6, 5), circA(T, "y", 150, 11.2, "f"), circA(T, "y", -125, 11.2, "f"), cline(T, "y", -150, 180));
        for (let k = 1; k <= 3; k++) { const a = k / 4 * Math.PI / 2; st.push(circA(T, "y", 150 + Math.sin(a) * 13, Math.cos(a) * 13, "f"), circA(T, "y", -125 - Math.sin(a) * 13, Math.cos(a) * 13, "f")); }
        for (const y of [0, 110]) {
          const a0 = Math.min(X(8.4), X(40)), a1 = Math.max(X(8.4), X(40)), S = [0, y, 0];
          st.push(...tube(S, "x", 8, a0, a1, "o", 6, 1), circA(S, "x", sd > 0 ? a1 - 2 : a0 + 2, 9, "f"));
          st.push(...style(washer([X(6), y, 0], [sd, 0, 0], 11, 4, 2.4), "a"));
          st.push(...screw([X(26), y - 8, 0], [0, -1, 0], { d: 4, len: 7, head: "none", ex: sd > 0 ? 18 : 0 }));
        }
      }
      for (const y of [0, 110]) st.push(helixA([0, y, 0], "x", 3.4, -26, 40, 2.2, "f"), circA([0, y, 0], "x", -26, 3.4, "o"), cline([0, y, 0], "x", -125, 115), { s: "h", p: [[-26, y + 5, 0], [EX - 8, y + 5, 0]] });
      return st;
    } },
    // 3. geared mortise deadbolt, cover lifted: hub with square drive, pinion on a rack, detent spring, anti-saw pins, faceplate, strike and box
    { cam: { yaw: -0.5, pitch: 0.6, zoom: 1.9, fx: 0.0, fy: 0.02, at: [30, 0, 10] }, comp: 2, build: () => {
      const st = [];
      const hous = [[-75, -52], [56, -52], [60, -48], [60, 58], [56, 62], [-75, 62], [-79, 58], [-79, -48]];
      st.push(...extrudeZ(hous, -14, 12, "o"), { s: "f", p: close([[-73, -46], [54, -46], [54, 56], [-73, 56]].map(([x, y]) => [x, y, 12])) });
      st.push(...extrudeZ(hous, 44, 47, "o"));
      for (const [x, y] of [[-70, -42], [48, -42], [-70, 52], [48, 52]]) {
        st.push(...tube([x, y, 0], "z", 4.5, -10, 12, "f", 3), circA([x, y, 0], "z", 12, 2, "f"), circA([x, y, 0], "z", 47, 2.4, "f"));
        st.push(...screw([x, y, 64], [0, 0, 1], { d: 4, len: 14, head: "pan" }), { s: "h", p: [[x, y, 50], [x, y, 12]] });
      }
      const H = [-30, 10, 0];
      st.push(...tube(H, "z", 13, -10, 10, "o", 8), polyA(H, "z", 10, 6.5, 4, "o", Math.PI / 4), polyA(H, "z", -10, 6.5, 4, "f", Math.PI / 4), cline(H, "z", -30, 70));
      st.push(...style(extrudeZ(G2(-30, 10, 26, 14, 5), -4, 4), "a"));
      for (let g = 0; g < 4; g++) { const a = g / 4 * TAU + 0.3; st.push(circA([-30 + Math.cos(a) * 17, 10 + Math.sin(a) * 17, 0], "z", 4, 3.5, "a", 16)); }
      st.push(...box(-55, -40, -8, 130, -16, 8));
      const rack = []; for (let x = -54; x <= 0; x += 5.6) rack.push([x, -16, 8], [x + 1.4, -11.5, 8], [x + 4.2, -11.5, 8], [x + 5.6, -16, 8]);
      st.push({ s: "a", p: rack }, { s: "f", p: rack.map(([x, y]) => [x, y, -8]) });
      st.push(...hatchX(R2(-8, -40, 8, -16), 130, 3.5), { s: "f", p: [[124, -40, 8], [130, -34, 8]] }, { s: "f", p: [[124, -16, 8], [130, -22, 8]] });
      for (const x of [92, 112]) st.push(...tube([x, -28, 0], "z", 3, -8, 8, "f", 4));
      st.push(helixA([0, -28, 0], "x", 6, -76, -55, 3.4, "a"), circA([0, -28, 0], "x", -76, 6, "f"), circA([0, -28, 0], "x", -55, 6, "f"), cline([0, -28, 0], "x", -84, 140));
      st.push(...box(60, -74, -18, 66, 84, 18));
      for (const y of [-62, 72]) st.push(...screw([66, y, 0], [1, 0, 0], { d: 5, len: 26, head: "csk" }));
      st.push(...box(150, -74, -18, 154, 70, 18), { s: "o", p: close([[150, -44, -10], [150, -12, -10], [150, -12, 10], [150, -44, 10]]) });
      st.push(...style(box(154, -44, -10, 186, -12, 10), "h"));
      for (const y of [-62, 58]) st.push(...screw([150, y, 0], [-1, 0, 0], { d: 5, len: 26, head: "csk" }));
      return st;
    } },
    // 4. barn-door roller on a flat-bar track: bearing wheels, axle bolts and nuts, spacers, hanger plates and lag bolts, wall standoffs, soft-close damper
    { cam: { yaw: -0.48, pitch: 0.3, zoom: 1.9, fx: 0.04, fy: 0.04, at: [10, 10, 10] }, comp: 3, build: () => {
      const st = [];
      st.push(...swapX(extrudeZ(R2(-3, -20, 3, 20), -150, 175, "o")), ...hatchX(R2(-3, -20, 3, 20), -150, 3, 0.8));
      for (const x of [-110, 20, 150]) {
        st.push(...tube([x, 0, 0], "z", 8, -30, -3, "o", 6), ...tube([x, 0, 0], "z", 14, -36, -30, "f", 6));
        st.push(...washer([x, 0, 3], "z", 9, 4.5, 2), ...screw([x, 0, 5], [0, 0, 1], { d: 8, len: 70, head: "hex" }));
      }
      for (const x of [-50, 80]) {
        const W = [x, 36, 0];
        st.push(...tube(W, "z", 16, -6, 6, "o", 12), circA(W, "z", 0, 14, "f"), circA(W, "z", -3, 15, "f"), circA(W, "z", 3, 15, "f"));
        st.push(...bearing(W, "z", 9, 3.6, 8, 8));
        st.push(...tube(W, "z", 5, 6, 10, "f", 4));
        const arc = []; for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI; arc.push([x + Math.cos(a) * 15, 36 + Math.sin(a) * 15]); }
        st.push(...extrudeZ([...arc, [x - 15, -62], [x + 15, -62]], 10, 15, "o", 5));
        st.push(...screw([x, 36, 15], [0, 0, 1], { d: 7, len: 26, head: "hex" }), ...nut([x, 36, -7], [0, 0, -1], 7));
        for (const y of [-22, -48]) st.push(...screw([x, y, 10], [0, 0, -1], { d: 6, len: 36, head: "hex", ex: x > 0 && y < -30 ? 26 : 0 }));
      }
      st.push(...box(-95, -210, 15, 150, -42, 55), ...hatchX([[15, -210], [55, -210], [55, -42], [15, -42]], -95, 8, 0.25));
      st.push(...style(box(20, -42, 15, 40, -30, 24), "f"));
      st.push(...style(tube([0, -34, 26], "x", 6, 100, 132, "o", 6, 2), "a"), ...style(tube([0, -34, 26], "x", 2, 132, 160, "f", 3), "a"), helixA([0, -34, 26], "x", 4, 134, 158, 3, "a"), cline([0, -34, 26], "x", 90, 180));
      st.push(...box(160, -30, -3, 166, -20, 3), ...screw([163, -20, 0], [0, 1, 0], { d: 3, len: 8, head: "socket", ex: 28 }));
      return st;
    } },
    // 5. sphere speaker, driver pulled forward: basket, surround, cone, dust cap, motor stack, pan-head screws; helix stand on a threaded rod; sectioned base
    { cam: { yaw: -0.4, pitch: 0.22, zoom: 1.6, fx: 0.0, fy: 0.06, at: [-8, 20, 15] }, comp: 4, build: () => {
      const st = [], c = [0, 40, 0], R = 52;
      for (let k = -3; k <= 3; k++) { const y = Math.sin(k / 4 * Math.PI / 2) * R; st.push(ring([0, 40 + y, 0], Math.sqrt(R * R - y * y), "y", k === 0 ? "o" : "f")); }
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI, p = []; for (let i = 0; i <= 48; i++) { const b = i / 48 * TAU; p.push([Math.cos(a) * Math.cos(b) * R, 40 + Math.sin(b) * R, Math.sin(a) * Math.cos(b) * R]); } st.push({ s: k === 0 ? "o" : "f", p }); }
      st.push(ring([0, 40, 0], R - 3, "y", "f"));
      const nn = V3.norm([-0.45, 0.12, 0.88]), B = basis(nn), hc = Math.sqrt(R * R - 28 * 28);
      st.push(circA(c, nn, hc, 28, "o"), circA(c, nn, hc - 3, 27, "f"));
      for (let g = 0; g < 4; g++) st.push(circA(pt(c, B, hc, 31, g / 4 * TAU + 1.19), nn, 0, 1.4, "f", 10));
      const D = V3.add(c, V3.mul(nn, hc + 40));
      st.push(circA(D, nn, 0, 30, "o"), circA(D, nn, -2, 30, "f"), circA(D, nn, 0, 25, "f"));
      st.push(circA(D, nn, 1.8, 23.5, "f"), circA(D, nn, 2.4, 21.5, "f"), circA(D, nn, 1.8, 19.5, "f"));
      st.push(circA(D, nn, 0, 18.5, "o"), circA(D, nn, -6, 13, "f"), circA(D, nn, -12, 8.5, "f"));
      for (let g = 0; g < 12; g++) { const a = g / 12 * TAU; st.push({ s: "f", p: [pt(D, B, 0, 18.5, a), pt(D, B, -12, 8.5, a)] }); }
      st.push(circA(D, nn, -10.5, 7, "a"), circA(D, nn, -9.2, 5, "a"), circA(D, nn, -8.6, 2.5, "a"));
      for (let g = 0; g < 4; g++) { const a = g / 4 * TAU + 0.4; st.push({ s: "o", p: [pt(D, B, -1, 27, a), pt(D, B, -10, 22, a), pt(D, B, -22, 13, a)] }); }
      st.push(...tube(D, nn, 13, -24, -22, "o", 6), ...tube(D, nn, 16, -33, -24, "o", 10, 1), ...tube(D, nn, 13, -36, -33, "o", 6), circA(D, nn, -36, 3, "f"), cline(D, nn, 20, -hc - 50));
      for (let g = 0; g < 4; g++) st.push(...screw(pt(D, B, 0, 28, g / 4 * TAU + 1.19), nn, { d: 3, len: 8, head: "pan", ex: 14 }));
      for (const a of [0.4, 0.4 + Math.PI]) st.push({ s: "h", p: [pt(D, B, -2, 30, a), pt(c, B, hc, 28, a)] });
      for (let k = 0; k < 5; k++) { const p = []; for (let i = 0; i <= 60; i++) { const y = -14 - i * 1.4, a = i / 60 * Math.PI * 2.2 + k / 5 * TAU, r = 9 + i * 0.45; p.push([Math.cos(a) * r, y, Math.sin(a) * r]); } st.push({ s: "o", p }); }
      st.push(...tube([0, 0, 0], "y", 11, -14, -4, "o", 6), ...screw([11, -9, 0], [1, 0, 0], { d: 3, len: 6, head: "none", ex: 10 }));
      st.push(helixA([0, 0, 0], "y", 3.5, -98, -14, 2.4, "f"), cline([0, 0, 0], "y", -125, 110));
      st.push(...tube([0, 0, 0], "y", 46, -108, -98, "o", 12), circA([0, 0, 0], "y", -98, 43, "f"), ...hatchZ(R2(0, -108, 46, -98), 0, 2.6));
      for (let g = 0; g < 4; g++) { const a = g / 4 * TAU + 0.8; st.push(...tube([Math.cos(a) * 36, 0, Math.sin(a) * 36], "y", 5, -112, -108, "f", 4)); }
      st.push(...nut([0, -108, 0], [0, -1, 0], 7), ...tube([0, -103, 46], "z", 4, 0, 10, "f", 4));
      return st;
    } },
    // 6. tapered glass-door bottom rail: sectioned profile, glass on setting blocks, taper shims, pin-tumbler cylinder, drop bolt, brush seal, exploded end cap
    { cam: { yaw: -0.7, pitch: 0.34, zoom: 1.9, fx: 0.04, fy: 0.04, at: [60, 30, 0] }, comp: 5, build: () => {
      const st = [];
      const P = [[-22, 0], [22, 0], [18, 60], [8, 62], [8, 14], [-8, 14], [-8, 62], [-18, 60]];
      st.push(...swapX(extrudeZ(P, -140, 140, "o", 2)), ...hatchX(P, -140, 4));
      st.push(...box(-130, 20, -6, 75, 200, 6), { s: "f", p: [[-130, 20, 0], [-130, 200, 0]] }, cline([-130, 0, 0], "y", -20, 220));
      for (const x of [-100, 40]) st.push(...style(box(x, 14, -6, x + 28, 20, 6), "f"));
      for (const sd of [-1, 1]) for (const x of [-120, -40, 20]) st.push(...style(swapX(extrudeZ([[6.2 * sd, 24], [7.8 * sd, 24], [7.8 * sd, 60], [6.2 * sd, 52]], x, x + 40)), "a"));
      const L = [105, 34, 0];
      st.push(...tube(L, "z", 11, -26, 26, "o", 8), ...tube(L, "z", 7.5, -26, 26, "f", 4), cline(L, "z", -44, 44));
      st.push({ s: "o", p: [[103, 40, 26.2], [107, 37, 26.2], [103, 34, 26.2], [107, 31, 26.2], [104, 28, 26.2]] });
      st.push(...style(box(99, 45, -22, 111, 62, 22), "f"));
      for (const z of [-16, -8, 0, 8, 16]) {
        st.push(...tube([105, 0, z], "y", 1.7, 34, 46, "f", 2), ...tube([105, 0, z], "y", 1.7, 46, 52, "a", 2), helixA([105, 0, z], "y", 1.6, 52, 61, 1.1, "f"));
      }
      st.push(...style(extrudeZ([[96, 34], [114, 34], [110, 18], [100, 18]], -3, 3), "a"));
      st.push(...box(98, -34, -5, 112, 18, 5), ...hatchZ(R2(98, -34, 112, 18), 5, 3.5, 0.5));
      for (let x = -136; x <= 136; x += 4) for (const z of [-6, 6]) st.push({ s: "f", p: [[x, 0, z], [x + 1, -9, z * 1.3]] });
      st.push(...swapX(extrudeZ(P, 172, 178, "o")));
      for (const [z, y] of [[-22, 0], [22, 0], [18, 60], [-18, 60]]) st.push({ s: "h", p: [[140, y, z], [172, y, z]] });
      for (const y of [10, 44]) st.push(...screw([196, y, 15 * (y > 20 ? 0.8 : 0)], [1, 0, 0], { d: 4.5, len: 16, head: "csk" }), { s: "h", p: [[178, y, 15 * (y > 20 ? 0.8 : 0)], [140, y, 15 * (y > 20 ? 0.8 : 0)]] });
      return st;
    } },
  ].map((m) => {
    const strokes = m.build(); let total = 0;
    strokes.forEach((s) => { s.len = 0; for (let i = 1; i < s.p.length; i++) s.len += Math.hypot(s.p[i][0] - s.p[i - 1][0], s.p[i][1] - s.p[i - 1][1], s.p[i][2] - s.p[i - 1][2]); total += s.len; });
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    strokes.forEach((s) => s.s !== "c" && s.p.forEach((p) => p.forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); })));
    return { ...m, strokes, total, centre: m.cam.at || lo.map((v, i) => (v + hi[i]) / 2), size: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
  });

  // Sutnar-style compositions: big flat circles, slabs, a bar-and-arrow and a dot field, per model
  const COMPS = [
    [["c", 0.66, 0.42, 0.3, 0], ["r", 0.06, 0.1, 0.16, 0.6, 1], ["arrow", 0.3, 0.06, 0.52, 0.3, 3], ["dots", 0.78, 0.08, 4, 4, 2]],
    [["r", 0.52, 0.12, 0.36, 0.42, 2], ["c", 0.3, 0.3, 0.17, 1], ["arrow", 0.88, 0.9, 0.62, 0.62, 0], ["dots", 0.08, 0.06, 5, 3, 3]],
    [["c", 0.42, 0.46, 0.34, 1], ["r", 0.72, 0.06, 0.2, 0.5, 0], ["arrow", 0.08, 0.3, 0.36, 0.3, 3], ["dots", 0.68, 0.7, 4, 3, 2]],
    [["r", 0.08, 0.36, 0.86, 0.18, 2], ["c", 0.74, 0.24, 0.16, 0], ["arrow", 0.3, 0.08, 0.3, 0.32, 3], ["dots", 0.12, 0.08, 3, 4, 1]],
    [["c", 0.56, 0.36, 0.28, 0], ["c", 0.3, 0.62, 0.1, 1], ["r", 0.8, 0.5, 0.12, 0.36, 2], ["arrow", 0.92, 0.12, 0.7, 0.3, 3]],
    [["r", 0.1, 0.18, 0.5, 0.26, 1], ["c", 0.76, 0.56, 0.22, 2], ["arrow", 0.12, 0.62, 0.42, 0.62, 0], ["dots", 0.66, 0.08, 5, 2, 3]],
  ];
  const CYCLE = 9, DRAW = 4.2, ERASE = 0.8;

  // Each Sutnar element rides its own slow closed curve (Catmull-Rom loop through four points),
  // and arrows are thick cubic Béziers whose handles sway, so the whole composition breathes.
  const hs = (i, k) => { const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
  function drift(seed, t, period, amp) {
    const P = [0, 1, 2, 3].map((i) => { const a = i / 4 * TAU + hs(seed, i) * 1.2, r = amp * (0.45 + hs(seed, i + 5) * 0.55); return [Math.cos(a) * r, Math.sin(a) * r]; });
    const u = ((t / period + hs(seed, 9)) % 1) * 4, i = Math.floor(u), f = u - i;
    const p0 = P[(i + 3) % 4], p1 = P[i], p2 = P[(i + 1) % 4], p3 = P[(i + 2) % 4], f2 = f * f, f3 = f2 * f;
    return [0, 1].map((j) => 0.5 * (2 * p1[j] + (p2[j] - p0[j]) * f + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * f2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * f3));
  }
  const bez = (a, b, c, d, f) => { const g = 1 - f; return [0, 1].map((j) => g * g * g * a[j] + 3 * g * g * f * b[j] + 3 * g * f * f * c[j] + f * f * f * d[j]); };
  function drawComp(x, W, H, comp, grow, pal, t, seed) {
    const s = Math.min(W, H), e = (k) => Math.max(0, Math.min(1, grow * 1.6 - k * 0.18));
    comp.forEach((sh, k) => {
      const g = 1 - Math.pow(1 - e(k), 3); if (g <= 0) return;
      const sd = seed * 10 + k, [dx, dy] = reduce ? [0, 0] : drift(sd, t, 11 + hs(sd, 7) * 9, s * (sh[0] === "dots" ? 0.03 : 0.06));
      x.fillStyle = pal[sh[sh.length - 1]]; x.strokeStyle = x.fillStyle;
      if (sh[0] === "c") { x.beginPath(); x.arc(sh[1] * W + dx, sh[2] * H + dy, sh[3] * s * g, 0, TAU); x.fill(); }
      else if (sh[0] === "r") x.fillRect(sh[1] * W + dx, sh[2] * H + dy, sh[3] * W * g, sh[4] * H);
      else if (sh[0] === "arrow") {
        const A0 = [sh[1] * W + dx, sh[2] * H + dy], [ex, ey] = reduce ? [0, 0] : drift(sd + 50, t, 13, s * 0.05), A3 = [sh[3] * W + ex, sh[4] * H + ey];
        const L = Math.hypot(A3[0] - A0[0], A3[1] - A0[1]), nx = -(A3[1] - A0[1]) / L, ny = (A3[0] - A0[0]) / L;
        const b1 = 0.35 * Math.sin(t * 0.45 + sd), b2 = 0.35 * Math.sin(t * 0.37 + sd * 2 + 1.7);
        const A1 = [A0[0] + (A3[0] - A0[0]) * 0.33 + nx * L * b1, A0[1] + (A3[1] - A0[1]) * 0.33 + ny * L * b1];
        const A2 = [A0[0] + (A3[0] - A0[0]) * 0.66 - nx * L * b2, A0[1] + (A3[1] - A0[1]) * 0.66 - ny * L * b2];
        const w = s * 0.022, hd = s * 0.06, N = 48, pts = [];
        for (let i = 0; i <= N * g; i++) pts.push(bez(A0, A1, A2, A3, i / N));
        if (pts.length < 2) return;
        const end = pts[pts.length - 1], prev = pts[pts.length - 2], a = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
        x.lineWidth = w; x.lineCap = "butt"; x.lineJoin = "round"; x.setLineDash([]);
        x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (const p of pts) x.lineTo(p[0], p[1]); x.stroke();
        x.save(); x.translate(end[0], end[1]); x.rotate(a);
        x.beginPath(); x.moveTo(hd * 0.6, 0); x.lineTo(-hd * 0.4, -hd * 0.55); x.lineTo(-hd * 0.4, hd * 0.55); x.fill(); x.restore();
      } else if (sh[0] === "dots") {
        const gap = s * 0.035, r = s * 0.008;
        for (let i = 0; i < sh[3]; i++) for (let j = 0; j < sh[4]; j++) if ((i + j) / (sh[3] + sh[4]) < g) {
          const wv = reduce ? 0 : Math.sin(t * 0.9 - (i + j) * 0.55) * gap * 0.25;
          x.beginPath(); x.arc(sh[1] * W + dx + i * gap, sh[2] * H + dy + j * gap + wv, r, 0, TAU); x.fill(); }
      }
    });
  }

  function art(x, W, H, t, u, ink, accent, grid, pal, layer, set) {
    const m = 18 * u;
    // each side cycles through its own three products, so the two halves never show the same one
    const k = Math.floor(t / CYCLE), ph = t - k * CYCLE, mod = MODELS[set[k % set.length]];
    const prog = reduce ? 1 : ph < DRAW ? 1 - Math.pow(1 - ph / DRAW, 2) : 1;
    const fade = reduce ? 1 : ph > CYCLE - ERASE ? 1 - (ph - (CYCLE - ERASE)) / ERASE : 1;
    if (layer !== "lines") {
      x.globalAlpha = fade; drawComp(x, W, H, COMPS[mod.comp], reduce ? 1 : Math.min(1, ph / 1.4), pal, t, mod.comp + 1); x.globalAlpha = 1;
      if (layer === "shapes") return;
    }
    // fine frame + grid
    x.lineWidth = 1; x.setLineDash([]);
    x.strokeStyle = grid(0.08);
    for (let gx = m; gx < W - m; gx += 50 * u) { x.beginPath(); x.moveTo(Math.round(gx) + 0.5, m); x.lineTo(Math.round(gx) + 0.5, H - m); x.stroke(); }
    for (let gy = m; gy < H - m; gy += 50 * u) { x.beginPath(); x.moveTo(m, Math.round(gy) + 0.5); x.lineTo(W - m, Math.round(gy) + 0.5); x.stroke(); }
    x.strokeStyle = ink(0.4); x.strokeRect(Math.round(m) + 0.5, Math.round(m) + 0.5, Math.round(W - 2 * m), Math.round(H - 2 * m));

    // the model, in a slowly drifting three-quarter view
    const cam = mod.cam, yaw = cam.yaw + Math.sin(t * 0.25) * 0.06 + mx * 0.12, pitch = cam.pitch + my * 0.06;
    const cy_ = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const sc = cam.zoom * Math.min(W, H) * 0.9 / mod.size, F = mod.size * 2.6;
    const ox = W * (0.56 + cam.fx), oy = H * (0.44 + cam.fy), C = mod.centre;
    const proj = (p) => {
      const X = p[0] - C[0], Y = p[1] - C[1], Z = p[2] - C[2];
      const x1 = X * cy_ - Z * sy_, z1 = X * sy_ + Z * cy_;
      const y2 = Y * cp - z1 * sp, z2 = Y * sp + z1 * cp;
      const f = F / (F + z2);
      return [ox + x1 * f * sc, oy - y2 * f * sc, z2];
    };
    const dz = mod.size * 0.7;
    let budget = prog * mod.total;
    const lw = Math.max(1, 1.25 * u);
    for (const s of mod.strokes) {
      if (budget <= 0) break;
      let left = Math.min(s.len, budget); budget -= s.len;
      const pts = [proj(s.p[0])];
      for (let i = 1; i < s.p.length && left > 0; i++) {
        const a = s.p[i - 1], b = s.p[i], seg = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), f = Math.min(1, left / (seg || 1));
        pts.push(proj([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f])); left -= seg;
      }
      const depth = pts.reduce((v, p) => v + p[2], 0) / pts.length, near = Math.max(0.3, Math.min(1, 0.75 - depth / dz));
      const base = { o: 0.95, f: 0.5, h: 0.45, a: 1, c: 0.4, t: 0.3 }[s.s] * near * fade;
      x.strokeStyle = s.s === "a" ? accent(base) : ink(base);
      x.lineWidth = s.s === "o" ? lw : s.s === "a" ? lw * 1.3 : 1;
      x.setLineDash(s.s === "h" ? [5 * u + 2, 4 * u + 1] : s.s === "c" ? [16 * u + 4, 3 * u + 2, 2 * u + 1, 3 * u + 2] : []);
      x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]); x.stroke();
    }
    x.setLineDash([]);
  }

  // 01: smooth, light ink on black
  const c1 = document.getElementById("art"), x1 = c1.getContext("2d");
  // 02: drawn straight into a 1/3-resolution pixel grid, like hand-placed pixel art (no smoothing, no thresholding).
  // A tiny canvas-like context: 1px Bresenham lines, round pixel brushes for thick strokes, crisp circle and polygon
  // fills, checker-dither for fades and shading, and a fixed set of tones chosen by stroke weight and depth.
  const PIX = 3, c2 = document.getElementById("art8"), x2 = c2.getContext("2d");
  const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const TONE = [null, [11, 11, 13], [118, 118, 128], [196, 196, 204], [215, 25, 33], [242, 190, 40], [40, 80, 200], [150, 12, 22], [196, 136, 18], [22, 46, 140], [214, 214, 222]];
  const PRI = [0, 5, 3, 2, 6, 3, 3, 3, 3, 3, 1];
  const FILLS = [[4, 215, 25, 33], [5, 242, 190, 40], [6, 40, 80, 200], [1, 11, 11, 13]];
  const parseC = (() => { const m = new Map(); return (s) => { let v = m.get(s); if (!v) { const n = (String(s).match(/[\\d.]+/g) || [0, 0, 0]).map(Number); v = [n[0], n[1], n[2], n.length > 3 ? n[3] : 1]; m.set(s, v); } return v; }; })();
  function pixelCtx() {
    let W = 0, H = 0, buf = null, pri = null, T = [1, 0, 0, 1, 0, 0], stack = [], subs = [], circles = [], dash = [];
    const tp = (x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]];
    const put = (x, y, idx, alpha) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      if (alpha < 1 && (BAY[(y & 3) * 4 + (x & 3)] + 0.5) / 16 >= alpha) return;
      const i = y * W + x; if (PRI[idx] >= pri[i]) { buf[i] = idx; pri[i] = PRI[idx]; }
    };
    const strokeTone = (s) => { const [r, g, , a] = parseC(s); if (r > 150 && g < 90) return a > 0.15 ? 4 : 0; return a > 0.55 ? 1 : a > 0.26 ? 2 : a > 0.13 ? 3 : a > 0.05 ? 10 : 0; };
    const fillTone = (s) => { const [r, g, bb] = parseC(s); let best = 1, bd = Infinity; for (const [k, R, G, B] of FILLS) { const d = (R - r) ** 2 + (G - g) ** 2 + (B - bb) ** 2; if (d < bd) { bd = d; best = k; } } return best; };
    const dark = (k) => (k >= 4 && k <= 6 ? k + 3 : k);
    const ctx = {
      fillStyle: "#000", strokeStyle: "#000", lineWidth: 1, globalAlpha: 1, lineCap: "butt", lineJoin: "miter", lineDashOffset: 0,
      size(w, h) { if (w !== W || h !== H) { W = w; H = h; buf = new Uint8Array(W * H); pri = new Uint8Array(W * H); } },
      clearRect() { buf.fill(0); pri.fill(0); },
      setTransform(a, b, c, d, e, f) { T = [a, b, c, d, e, f]; },
      save() { stack.push(T.slice()); }, restore() { T = stack.pop() || [1, 0, 0, 1, 0, 0]; },
      translate(x, y) { T[4] += T[0] * x + T[2] * y; T[5] += T[1] * x + T[3] * y; },
      rotate(a) { const c = Math.cos(a), s = Math.sin(a), [a0, b0, c0, d0] = T; T[0] = a0 * c + c0 * s; T[1] = b0 * c + d0 * s; T[2] = -a0 * s + c0 * c; T[3] = -b0 * s + d0 * c; },
      setLineDash(d) { dash = d.map((v) => Math.max(1, Math.round(v))); },
      beginPath() { subs = []; circles = []; },
      moveTo(x, y) { subs.push([tp(x, y)]); },
      lineTo(x, y) { if (!subs.length) subs.push([]); subs[subs.length - 1].push(tp(x, y)); },
      arc(x, y, r) { const [cx, cy] = tp(x, y); circles.push([cx, cy, r * Math.hypot(T[0], T[1])]); },
      fill() {
        const k = fillTone(ctx.fillStyle), al = ctx.globalAlpha, kd = dark(k);
        for (const [cx, cy, r] of circles) {                     // pixel circle with a dithered shadow crescent, lower right
          for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
            const dx = x + 0.5 - cx, dy = y + 0.5 - cy; if (dx * dx + dy * dy > r * r) continue;
            const sx = dx + r * 0.28, sy = dy + r * 0.28, sh = r > 6 && sx * sx + sy * sy > (r * 1.04) ** 2;
            put(x, y, sh && ((x + y) & 1) ? kd : k, al);
          }
        }
        for (const P of subs) {                                   // even-odd scanline polygon fill
          if (P.length < 3) continue; const ys = P.map((p) => p[1]);
          for (let y = Math.floor(Math.min(...ys)); y <= Math.max(...ys); y++) {
            const yc = y + 0.5, xs = [];
            for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
            xs.sort((p, q) => p - q);
            for (let i = 0; i + 1 < xs.length; i += 2) for (let x = Math.round(xs[i]); x < Math.round(xs[i + 1]); x++) put(x, y, k, al);
          }
        }
      },
      fillRect(x, y, w, h) {                                       // block with a dithered 2px shade down its right edge
        const [x0, y0] = tp(x, y), [x1, y1] = tp(x + w, y + h), k = fillTone(ctx.fillStyle), kd = dark(k), al = ctx.globalAlpha;
        const X0 = Math.round(Math.min(x0, x1)), X1 = Math.round(Math.max(x0, x1)), Y0 = Math.round(Math.min(y0, y1)), Y1 = Math.round(Math.max(y0, y1));
        for (let yy = Y0; yy < Y1; yy++) for (let xx = X0; xx < X1; xx++) put(xx, yy, X1 - xx <= 2 && X1 - X0 > 8 && ((xx + yy) & 1) ? kd : k, al);
      },
      strokeRect(x, y, w, h) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y); ctx.stroke(); },
      stroke() {
        const thick = ctx.lineWidth >= 1.8, k = thick ? fillTone(ctx.strokeStyle) : strokeTone(ctx.strokeStyle); if (!k) return;
        const al = thick ? ctx.globalAlpha : 1, rr = Math.max(0.5, ctx.lineWidth / 2 * Math.hypot(T[0], T[1])), R = Math.ceil(rr);
        let step = Math.round(-ctx.lineDashOffset), di = 0, left = dash.length ? dash[0] : Infinity;
        const dot = (x, y) => {
          if (dash.length) { const on = di % 2 === 0; if (--left <= 0) { di = (di + 1) % dash.length; left = dash[di]; } if (!on) return; }
          if (k === 10) { if ((x + y) % 3 === 0) put(x, y, k, al); return; }   // faint guide lines: dotted, like a pixel artist's grid
          if (!thick) return put(x, y, k, al);
          for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) if (i * i + j * j <= rr * rr + 0.3) put(x + i, y + j, k, al);
        };
        for (const P of subs) for (let s = 1; s < P.length; s++) {   // Bresenham, one clean pixel per step
          let x0 = Math.round(P[s - 1][0]), y0 = Math.round(P[s - 1][1]); const x1 = Math.round(P[s][0]), y1 = Math.round(P[s][1]);
          const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
          if (dx > 4000 || -dy > 4000) continue;
          for (;;) { if (s === 1 || x0 !== Math.round(P[s - 1][0]) || y0 !== Math.round(P[s - 1][1])) dot(x0, y0); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
        }
        void step;
      },
      blit(target) {
        const img = target.createImageData(W, H), p = img.data;
        for (let i = 0; i < buf.length; i++) { const c = TONE[buf[i]]; if (c) { p[i * 4] = c[0]; p[i * 4 + 1] = c[1]; p[i * 4 + 2] = c[2]; p[i * 4 + 3] = 255; } }
        target.putImageData(img, 0, 0);
      },
    };
    return ctx;
  }
  const px2 = pixelCtx();
  const SET1 = [4, 0, 1], SET2 = [2, 3, 5];   // 01: sphere speaker, base shoe, ladder pull · 02: deadbolt, barn roller, door rail
  const PAL1 = ["#e0412f", "#f0b92c", "#2f5fd0", "#e9e3d3"];
  const PAL2 = [[215, 25, 33], [242, 190, 40], [40, 80, 200], [11, 11, 13]];
  const PAL2css = PAL2.map((c) => "rgb(" + c.join(",") + ")");
  function frame(now) {
    const t = reduce ? 0 : Math.max(0, (now - t0) / 1000);
    // 01: smooth lines over the colour blocks, on blueprint navy
    const d = Math.min(2, devicePixelRatio || 1), W1 = c1.clientWidth, H1 = c1.clientHeight;
    if (c1.width !== Math.round(W1 * d) || c1.height !== Math.round(H1 * d)) { c1.width = Math.round(W1 * d); c1.height = Math.round(H1 * d); }
    x1.setTransform(d, 0, 0, d, 0, 0); x1.clearRect(0, 0, W1, H1);
    art(x1, W1, H1, t, 1, (a) => "rgba(240,242,246," + a + ")", (a) => "rgba(255,206,58," + a + ")", (a) => "rgba(120,170,255," + a + ")", PAL1, "all", SET1);
    // 02: the same scene placed pixel by pixel at 1/3 resolution
    const W2 = Math.ceil(c2.clientWidth / PIX), H2 = Math.ceil(c2.clientHeight / PIX);
    if (c2.width !== W2 || c2.height !== H2) { c2.width = W2; c2.height = H2; }
    px2.size(W2, H2); px2.clearRect();
    art(px2, W2, H2, t, 1 / PIX, (a) => "rgba(11,11,13," + a + ")", (a) => "rgba(215,25,33," + a + ")", (a) => "rgba(11,11,13,0.1)", PAL2css, "all", SET2);
    px2.blit(x2);
    if (!reduce) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
</script>
</body>
</html>
`;
}

// ---------- write ----------
fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, html) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };

write("index.html", chooserPage());
write("portfolio/index.html", homePage());
projects.forEach((p, i) => write(`work/${p.slug}/index.html`, projectPage(p, i)));
write("about/index.html", aboutPage());
// The 404 page is served at any broken URL, so it needs root-absolute links.
write("404.html", notFound().replace(/(href|src)="\.\/(index\.html)?/g, '$1="/'));
copyDir(path.join(SRC, "images"), path.join(OUT, "images"));
copyDir(path.join(SIZES, "images"), path.join(OUT, "images"));
copyDir(path.join(SRC, "assets"), path.join(OUT, "assets"));
fs.copyFileSync(path.join(SRC, "favicon.svg"), path.join(OUT, "favicon.svg"));

console.log(`Built ${projects.length} projects into dist/${PREVIEW ? " (preview links)" : ""}`);

// The arcade (claw machine) version is built into dist/arcade/ from the same content.
require("./arcade");
