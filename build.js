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
    p.images = (p.images || []).filter(Boolean);
    p.cover = p.cover || p.images[0] || "";
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
    <p class="foot-line">${esc(site.contact_line || "Have a product to bring to market?")}</p>
    ${site.email ? `<a class="foot-mail" href="mailto:${esc(site.email)}">${esc(site.email)}</a>` : ""}
  </div>
  <div class="foot-row">
    <span>&copy; <span data-year>${new Date().getFullYear()}</span> ${esc(site.name)}${site.location ? ` / ${esc(site.location)}` : ""}</span>
    <span class="foot-links">
      ${site.instagram ? `<a href="${esc(site.instagram)}" rel="noopener">Instagram</a>` : ""}
      ${site.linkedin ? `<a href="${esc(site.linkedin)}" rel="noopener">LinkedIn</a>` : ""}
      <a href="#main" data-top>Back to top</a>
    </span>
    <span class="readout" aria-hidden="true"><span data-pct>000</span>%</span>
  </div>
</footer>
<div class="cursor" aria-hidden="true"><span class="cursor-ring"><span class="cursor-label">View</span></span><span class="cursor-dot"></span></div>
<script src="https://cdn.jsdelivr.net/npm/lenis@1.1.13/dist/lenis.min.js" defer></script>
<script src="${u.asset("assets/site.js")}" defer></script>
</body>
</html>
`;
}

// ---------- pages ----------
const SPANS = [7, 5, 4, 4, 4, 5, 7, 6, 6]; // repeating grid rhythm on a 12-column grid

function homePage() {
  const u = make(1);
  const slides = featured.map((p, i) => `
    <figure class="slide${i === 0 ? " is-on" : ""}" data-slide data-title="${esc(p.title)}" data-year="${esc(p.year)}" data-href="${u.work(p.slug)}">
      <img${srcset(p.cover, u, "100vw")} alt=""${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}>
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
      <div class="tile-media"><img${srcset(p.cover, u, `(max-width: 900px) 100vw, ${Math.round((span / 12) * 100)}vw`)} alt="${esc(p.title)}" loading="lazy" decoding="async" style="view-transition-name:v-${p.slug}"></div>
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
    <p class="hero-tag">${esc(site.tagline)}</p>
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

  const spec = [["Company", p.company], ["Role", p.role], ["Year", p.year], ["Discipline", p.category], ["Status", p.status], ["Tools", p.tools], ["Images", p.images.length || ""]]
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join("");

  const body = `
<article class="project">
  <section class="p-hero">
    <div class="p-hero-media" data-parallax><img${srcset(p.cover, u, "100vw")} alt="" fetchpriority="high" style="view-transition-name:v-${p.slug}"></div>
    <div class="hero-shade"></div>
    <div class="frame" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="p-hero-text">
      <p class="p-index">Project ${pad(i + 1)} of ${pad(projects.length)}</p>
      <h1 class="p-title" data-split>${esc(p.title)}</h1>
    </div>
  </section>
  <section class="p-info" data-reveal>
    <dl class="spec">${spec}</dl>
    <div class="p-desc">${p.description ? paras(p.description) : ""}</div>
  </section>
  ${caseStudy(p)}
  ${rows ? `<section class="p-gallery" aria-label="Images">${caseStudy(p) ? `<h2 class="cs-title gal-title">Gallery</h2>` : ""}${rows}
  </section>` : ""}
  <a class="p-next" href="${u.work(next.slug)}" data-cursor>
    <span class="p-next-media"><img${srcset(next.cover, u, "100vw")} alt="" loading="lazy"></span>
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
  const u = make(1);
  const picks = projects.filter((p) => p.featured).slice(0, 3);
  const list = (t) => lines(t).map((c) => `<li>${esc(c)}</li>`).join("");
  const capGroups = Array.isArray(site.capabilities)
    ? site.capabilities
    : [{ title: "Capabilities", items: site.capabilities || "" }];

  const stats = (site.stats || []).filter((s) => s && s.value).map((s) => `
      <div class="stat"><dt>${esc(s.label || "")}</dt><dd>${esc(s.value)}</dd></div>`).join("");

  const jobs = (site.experience || []).filter((j) => j && (j.company || j.role)).map((j) => `
      <li class="job" data-reveal>
        <span class="job-dates">${esc(j.dates || "")}</span>
        <div class="job-head"><h3 class="job-co">${esc(j.company || "")}</h3><p class="job-role">${esc(j.role || "")}</p></div>
        <p class="job-sum">${esc(j.summary || "")}</p>
      </li>`).join("");

  const collabs = lines(site.collaborations).map((c) => `<li>${esc(c)}</li>`).join("");

  const body = `
<section class="about">
  <div class="about-head">
    <p class="p-index">About${site.location ? ` / ${esc(site.location)}` : ""}</p>
    <h1 class="about-title" data-split>${esc(site.role)}</h1>
    <p class="about-tag">${esc(site.tagline)}</p>
  </div>

  ${stats ? `<dl class="stats" data-reveal>${stats}
  </dl>` : ""}

  <div class="about-body" data-reveal>
    <div class="about-bio">${paras(site.about)}</div>
    <div class="about-side">
      ${capGroups.map((g) => `<h2 class="mini">${esc(g.title || "")}</h2><ul class="caps">${list(g.items)}</ul>`).join("\n      ")}
    </div>
  </div>

  ${jobs ? `<div class="block">
    <h2 class="section-title block-title" data-reveal>Experience</h2>
    <ol class="jobs">${jobs}
    </ol>
  </div>` : ""}

  <div class="block facts" data-reveal>
    ${site.education ? `<div><h2 class="mini">Education</h2><p class="fact-main">${lines(site.education).map(esc).join("<br>")}</p></div>` : ""}
    ${site.recognition ? `<div><h2 class="mini">Recognition and teaching</h2><ul class="caps">${list(site.recognition)}</ul></div>` : ""}
    ${site.languages ? `<div><h2 class="mini">Languages</h2><ul class="caps">${list(site.languages)}</ul></div>` : ""}
  </div>

  ${collabs ? `<div class="block" data-reveal>
    <h2 class="mini">Brands and collaborations</h2>
    <ul class="collabs">${collabs}</ul>
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
    <a class="strip-item" href="${u.work(p.slug)}" data-cursor><img${srcset(p.cover, u, "(max-width: 560px) 100vw, 33vw")} alt="${esc(p.title)}" loading="lazy"><span>${esc(p.title)}</span></a>`).join("")}
  </div>
</section>`;
  return layout({ depth: 1, title: "About", desc: lines(site.about)[0], body, cls: "page-about" });
}

function notFound() {
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
  // One blueprint plot, rendered twice: smooth and dark for 01, white and 8-bit for 02.
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let mx = 0, my = 0;
  const t0 = performance.now();
  addEventListener("pointermove", (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });

  // ---------- blueprint sheets: line drawings of products, no text ----------
  // Units: a 240 x 170 sheet, y down. Stroke styles: o outline, h hidden, c centreline,
  // d dimension (arrows, no numbers), x hatching, a accent.
  const TAU = Math.PI * 2;
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const circ = (cx, cy, r, a0 = 0, a1 = TAU, n = 64) => { const p = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return p; };
  const rrect = (x, y, w, h, r) => { const p = []; [[x + w - r, y + r, -Math.PI / 2], [x + w - r, y + h - r, 0], [x + r, y + h - r, Math.PI / 2], [x + r, y + r, Math.PI]].forEach(([cx, cy, a]) => p.push(...circ(cx, cy, r, a, a + Math.PI / 2, 8))); p.push(p[0]); return p; };
  const gear = (cx, cy, r, n, dep) => { const p = []; for (let i = 0; i <= n * 4; i++) { const k = i % 4, a = (i / (n * 4)) * TAU, rr = k === 1 || k === 2 ? r : r - dep; p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return p; };
  function hatch(poly, gap, ang, holes = []) {   // section lines clipped to a polygon, skipping any holes
    const c = Math.cos(ang), s = Math.sin(ang), rings = [poly, ...holes].map((r) => r.map(([x, y]) => [x * c + y * s, -x * s + y * c]));
    let y0 = Infinity, y1 = -Infinity; rings[0].forEach((p) => { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    const out = [];
    for (let y = y0 + gap / 2; y < y1; y += gap) {
      const xs = [];
      for (const rot of rings) for (let i = 0; i < rot.length - 1; i++) { const [ax, ay] = rot[i], [bx, by] = rot[i + 1]; if ((ay > y) !== (by > y)) xs.push(ax + (y - ay) * (bx - ax) / (by - ay)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) out.push({ s: "x", p: [[xs[k], y], [xs[k + 1], y]].map(([u, v]) => [u * c - v * s, u * s + v * c]) });
    }
    return out;
  }
  const O = (p) => ({ s: "o", p }), Hd = (p) => ({ s: "h", p }), Cl = (p) => ({ s: "c", p }), A = (p) => ({ s: "a", p });
  function dim(x0, y0, x1, y1, off) {       // extension lines + dimension line with arrows, no number
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), nx = -dy / L * off, ny = dx / L * off, sg = Math.sign(off) * 3;
    return [
      { s: "d", p: [[x0, y0], [x0 + nx + (nx / Math.abs(off || 1)) * 3, y0 + ny + (ny / Math.abs(off || 1)) * 3]] },
      { s: "d", p: [[x1, y1], [x1 + nx + (nx / Math.abs(off || 1)) * 3, y1 + ny + (ny / Math.abs(off || 1)) * 3]] },
      { s: "d", p: [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny]], arrows: true },
    ];
  }
  const SHEETS = [
    // base shoe railing in section: extrusion, glass, clamp, anchor, slab
    () => {
      const walls = [[70, 140], [70, 70], [92, 70], [92, 118], [148, 118], [148, 70], [170, 70], [170, 140], [70, 140]];
      return [
        Cl([[120, 2], [120, 166]]),
        O(walls), O(rect(76, 80, 10, 30)), O(rect(154, 80, 10, 30)), O(rect(98, 124, 44, 10)),
        O(rect(113, 6, 14, 112)), Hd([[120, 10], [120, 114]]),
        A([[94, 94], [112, 90], [112, 116], [94, 116], [94, 94]]), A([[146, 94], [128, 90], [128, 116], [146, 116], [146, 94]]),
        O(circ(112, 88, 1.6)), O(circ(128, 88, 1.6)),
        Hd(rect(116, 118, 8, 34)),
        O([[30, 140], [210, 140]]),
        ...hatch(walls, 4, Math.PI / 4, [rect(76, 80, 10, 30), rect(154, 80, 10, 30), rect(98, 124, 44, 10), rect(116, 118, 8, 22)]),
        ...hatch(rect(30, 140, 180, 14), 6, -Math.PI / 4, [rect(116, 140, 8, 14)]),
        ...dim(70, 70, 170, 70, -12), ...dim(170, 70, 170, 140, -18),
      ];
    },
    // back-to-back ladder pulls through glass, with a tube section detail
    () => [
      Cl([[87, 2], [87, 160]]), Cl([[153, 2], [153, 160]]),
      O(rrect(80, 10, 14, 140, 7)), O(rrect(146, 10, 14, 140, 7)),
      O(rect(117, 0, 6, 160)), Hd([[120, 2], [120, 158]]),
      O(rect(94, 36, 52, 8)), O(rect(94, 116, 52, 8)),
      A(rect(116, 37, 8, 6)), A(rect(116, 117, 8, 6)),
      O(circ(205, 40, 14)), O(circ(205, 40, 10)), ...hatch(circ(205, 40, 14), 3, Math.PI / 4, [circ(205, 40, 10)]),
      Cl([[186, 40], [224, 40]]), Cl([[205, 21], [205, 59]]),
      ...dim(80, 10, 80, 150, 16), ...dim(146, 40, 146, 120, -26),
    ],
    // barn-door slider: track, two rollers, hangers, glass panel, soft-close block
    () => [
      O(rect(16, 28, 208, 10)), Hd([[18, 34], [222, 34]]),
      ...[70, 170].flatMap((cx) => [O(circ(cx, 33, 10)), O(circ(cx, 33, 3)), Cl([[cx - 14, 33], [cx + 14, 33]]), Cl([[cx, 19], [cx, 47]]), O(rect(cx - 4, 42, 8, 30))]),
      A(rect(186, 30, 24, 6)),
      O(rect(46, 70, 148, 86)), O([[60, 84], [76, 100]]), O([[68, 82], [90, 104]]),
      O(rect(112, 160, 16, 6)),
      ...dim(16, 28, 224, 28, 12), ...dim(46, 156, 194, 156, -10),
    ],
    // geared deadbolt: housing, gear on its pitch circle, bolt in section, strike
    () => [
      O(rrect(30, 44, 112, 80, 8)),
      Cl([[44, 84], [136, 84]]), Cl([[86, 46], [86, 122]]),
      A(gear(86, 84, 28, 12, 5)), { s: "c", p: circ(86, 84, 25) }, O(circ(86, 84, 9)), O(circ(86, 84, 3)),
      O(rect(142, 72, 62, 24)), ...hatch(rect(142, 72, 62, 24), 4, Math.PI / 4),
      Hd(rect(198, 60, 24, 48)),
      { s: "d", p: circ(86, 84, 38, -2.4, -1.2, 18), arrows: true },
      ...dim(142, 96, 204, 96, -16),
    ],
    // all-glass entrance in plan: walls, two leaves on pivots, swing arcs
    () => {
      const wl = rect(10, 70, 40, 16), wr = rect(190, 70, 40, 16);
      const leaf = (hx, ang) => { const L = 66, c = Math.cos(ang), s = Math.sin(ang), n = [-s * 2.5, c * 2.5]; return [[hx + n[0], 78 + n[1]], [hx + c * L + n[0], 78 + s * L + n[1]], [hx + c * L - n[0], 78 + s * L - n[1]], [hx - n[0], 78 - n[1]], [hx + n[0], 78 + n[1]]]; };
      return [
        O(wl), O(wr), ...hatch(wl, 4, Math.PI / 4), ...hatch(wr, 4, Math.PI / 4),
        O([[50, 86], [190, 86]]), Cl([[120, 20], [120, 130]]),
        O(leaf(54, -1.22)), O(leaf(186, Math.PI + 1.22)),
        Hd(circ(54, 78, 66, -1.22, 0, 24)), Hd(circ(186, 78, 66, Math.PI, Math.PI + 1.22, 24)),
        A(circ(54, 78, 2.5)), A(circ(186, 78, 2.5)),
        ...dim(54, 86, 186, 86, -22),
      ];
    },
    // speaker: sphere with driver on a twisted stand
    () => {
      const st = [];
      for (let k = 0; k < 4; k++) { const p = []; for (let i = 0; i <= 30; i++) { const y = 100 + i * 1.6, ph = (i / 30) * Math.PI * 1.5 + k * Math.PI / 2; p.push([120 + Math.sin(ph) * (10 + i * 0.6), y]); } st.push(O(p)); }
      return [
        Cl([[120, 6], [120, 166]]),
        O(circ(120, 58, 42)), Hd(circ(120, 58, 38, 0.3, 2.6, 24)),
        O(circ(104, 60, 17)), O(circ(104, 60, 12)), A(circ(104, 60, 5)),
        ...st, O([[80, 150], [160, 150]]), O(rect(84, 150, 72, 6)),
        ...dim(78, 58, 162, 58, -50),
      ];
    },
  ].map((f) => {
    const strokes = f(); let total = 0;
    strokes.forEach((s) => { s.len = 0; for (let i = 1; i < s.p.length; i++) s.len += Math.hypot(s.p[i][0] - s.p[i - 1][0], s.p[i][1] - s.p[i - 1][1]); total += s.len; });
    return { strokes, total };
  });
  const CYCLE = 8, DRAW = 3.6, ERASE = 0.8;

  function art(x, W, H, t, u, ink, sig, bpGrid) {
    const m = 18 * u;
    // blueprint grid + sheet frame + an empty title block
    for (const [g, a] of [[10 * u, 0.04], [50 * u, 0.09]]) {
      x.strokeStyle = bpGrid(a); x.lineWidth = 1; x.setLineDash([]);
      for (let gx = m; gx < W - m; gx += g) { x.beginPath(); x.moveTo(Math.round(gx) + 0.5, m); x.lineTo(Math.round(gx) + 0.5, H - m); x.stroke(); }
      for (let gy = m; gy < H - m; gy += g) { x.beginPath(); x.moveTo(m, Math.round(gy) + 0.5); x.lineTo(W - m, Math.round(gy) + 0.5); x.stroke(); }
    }
    x.strokeStyle = ink(0.4); x.strokeRect(Math.round(m) + 0.5, Math.round(m) + 0.5, Math.round(W - 2 * m), Math.round(H - 2 * m));
    for (let k = 1; k < 8; k++) { const gx = Math.round(m + (W - 2 * m) * k / 8) + 0.5, gy = Math.round(m + (H - 2 * m) * k / 8) + 0.5;
      x.beginPath(); x.moveTo(gx, m); x.lineTo(gx, m + 6 * u); x.moveTo(gx, H - m); x.lineTo(gx, H - m - 6 * u); x.moveTo(m, gy); x.lineTo(m + 6 * u, gy); x.moveTo(W - m, gy); x.lineTo(W - m - 6 * u, gy); x.stroke(); }
    if (W > 520 * u) {
      const tw = 170 * u, th = 54 * u, tx = W - m - tw, ty = H - m - th;
      x.strokeStyle = ink(0.35); x.strokeRect(Math.round(tx) + 0.5, Math.round(ty) + 0.5, Math.round(tw), Math.round(th));
      x.beginPath();
      x.moveTo(tx, ty + th * 0.5); x.lineTo(tx + tw, ty + th * 0.5);
      x.moveTo(tx + tw * 0.62, ty); x.lineTo(tx + tw * 0.62, ty + th);
      x.moveTo(tx + tw * 0.81, ty + th * 0.5); x.lineTo(tx + tw * 0.81, ty + th);
      x.stroke();
    }

    // the current sheet, plotted stroke by stroke
    const k = Math.floor(t / CYCLE), ph = t - k * CYCLE, sh = SHEETS[k % SHEETS.length];
    const prog = reduce ? 1 : ph < DRAW ? 1 - Math.pow(1 - ph / DRAW, 2) : 1;
    const fade = reduce ? 1 : ph > CYCLE - ERASE ? 1 - (ph - (CYCLE - ERASE)) / ERASE : 1;
    const sc = Math.min((W - 2 * m) * 0.8 / 240, (H - 2 * m) * 0.66 / 170);
    const ox = W * 0.58 - 120 * sc - mx * 16 * u, oy = H * 0.42 - 85 * sc - my * 12 * u;
    const P = ([px, py]) => [ox + px * sc, oy + py * sc];
    let budget = prog * sh.total;
    const lw = Math.max(1, 1.3 * u * 1.15);
    for (const s of sh.strokes) {
      if (budget <= 0) break;
      const st = {
        o: [ink(0.9 * fade), [], lw], h: [ink(0.5 * fade), [5 * u + 2, 4 * u + 1], 1], c: [ink(0.35 * fade), [12 * u + 3, 3 * u + 1, 2 * u + 1, 3 * u + 1], 1],
        d: [ink(0.55 * fade), [], 1], x: [ink(0.28 * fade), [], 1], a: [sig(fade), [], lw * 1.3],
      }[s.s];
      x.strokeStyle = st[0]; x.setLineDash(st[1]); x.lineWidth = st[2];
      let left = Math.min(s.len, budget); budget -= s.len;
      x.beginPath();
      const p0 = P(s.p[0]); x.moveTo(p0[0], p0[1]);
      for (let i = 1; i < s.p.length && left > 0; i++) {
        const a = s.p[i - 1], b = s.p[i], seg = Math.hypot(b[0] - a[0], b[1] - a[1]), f = Math.min(1, left / (seg || 1));
        const q = P([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); x.lineTo(q[0], q[1]); left -= seg;
      }
      x.stroke();
      if (s.arrows && budget >= 0) {
        x.setLineDash([]); x.fillStyle = st[0];
        const ends = [[s.p[0], s.p[1]], [s.p[s.p.length - 1], s.p[s.p.length - 2]]];
        for (const [tip, from] of ends) {
          const [tx2, ty2] = P(tip), [fx, fy] = P(from), an = Math.atan2(ty2 - fy, tx2 - fx), al = Math.max(3, 7 * u);
          x.beginPath(); x.moveTo(tx2, ty2); x.lineTo(tx2 - Math.cos(an - 0.32) * al, ty2 - Math.sin(an - 0.32) * al); x.lineTo(tx2 - Math.cos(an + 0.32) * al, ty2 - Math.sin(an + 0.32) * al); x.fill();
        }
      }
    }
    x.setLineDash([]);
  }

  // 01: smooth, light ink on black
  const c1 = document.getElementById("art"), x1 = c1.getContext("2d");
  // 02: drawn at 1/3 resolution in black on white, then snapped to a few hard tones
  const PIX = 3, c2 = document.getElementById("art8"), x2 = c2.getContext("2d", { willReadFrequently: true });
  const red = [215, 25, 33];
  function frame(now) {
    const t = reduce ? 0 : (now - t0) / 1000;
    // 01
    const d = Math.min(2, devicePixelRatio || 1), W1 = c1.clientWidth, H1 = c1.clientHeight;
    if (c1.width !== Math.round(W1 * d) || c1.height !== Math.round(H1 * d)) { c1.width = Math.round(W1 * d); c1.height = Math.round(H1 * d); }
    x1.setTransform(d, 0, 0, d, 0, 0); x1.clearRect(0, 0, W1, H1);
    art(x1, W1, H1, t, 1, (a) => "rgba(233,235,238," + a + ")", (f) => "rgba(255,91,31," + f + ")", (a) => "rgba(120,170,255," + a + ")");
    // 02
    const W2 = Math.ceil(c2.clientWidth / PIX), H2 = Math.ceil(c2.clientHeight / PIX);
    if (c2.width !== W2 || c2.height !== H2) { c2.width = W2; c2.height = H2; }
    x2.clearRect(0, 0, W2, H2);
    art(x2, W2, H2, t, 1 / PIX, (a) => "rgba(11,11,13," + Math.min(1, a * 1.7) + ")", (f) => "rgba(215,25,33," + f + ")", (a) => (a > 0.05 ? "rgba(11,11,13,0.12)" : "rgba(0,0,0,0)"));
    const img = x2.getImageData(0, 0, W2, H2), p = img.data;
    for (let i = 0, n = 0; i < p.length; i += 4, n++) {
      const a = p[i + 3];
      if (!a) continue;
      const isRed = p[i] > 120 && p[i + 1] < 90, f = a / 255;
      // three-tone pixel ink: strong strokes go black, faint ones a light grey, nothing in between
      if (isRed && f > 0.25) { p[i] = red[0]; p[i + 1] = red[1]; p[i + 2] = red[2]; p[i + 3] = 255; }
      else if (f > 0.42) { p[i] = 11; p[i + 1] = 11; p[i + 2] = 13; p[i + 3] = 255; }
      else if (f > 0.2) { p[i] = 172; p[i + 1] = 172; p[i + 2] = 180; p[i + 3] = 255; }
      else if (f > 0.07) { p[i] = 232; p[i + 1] = 232; p[i + 2] = 236; p[i + 3] = 255; }
      else p[i + 3] = 0;
    }
    x2.putImageData(img, 0, 0);
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
