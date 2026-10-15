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

  const MODELS = [
    // 1. railing base shoe: extrusion with chambers, glass, clamp wedges, anchors, drilled side, exploded end cap
    { cam: { yaw: -0.62, pitch: 0.42, zoom: 1.25, fx: 0.05, fy: 0.0 }, comp: 0, build: () => {
      const U = [[-50, 0], [50, 0], [50, 70], [36, 70], [36, 24], [-36, 24], [-36, 70], [-50, 70]];
      const st = [
        ...extrudeZ(U, -90, 90, "o"),
        ...style(extrudeZ(R2(-46, 8, -40, 60), -90, 90, "f", 4), "f"), ...style(extrudeZ(R2(40, 8, 46, 60), -90, 90, "f", 4), "f"),
        ...style(extrudeZ(R2(-22, 6, 22, 16), -90, 90, "f", 4), "f"),
        ...box(-7, 30, -90, 7, 175, 90), { s: "h", p: [[0, 32, -90], [0, 173, -90]] },
        ...[-80, -50, -20, 10, 40, 70].map((z) => ({ s: "f", p: [[-7, 175, z], [7, 175, z]] })),
        ...style(move(box(-50, 0, -90, 50, 4, 90), 0, -8, 0), "f"),
      ];
      for (const z of [-62, -12, 38]) {
        st.push(...style(extrudeZ([[-36, 24], [-7, 32], [-7, 64], [-36, 58]], z, z + 30), "a"));
        st.push(...style(extrudeZ([[36, 24], [7, 32], [7, 64], [36, 58]], z, z + 30), "a"));
        st.push(ring([-7, 62, z + 15], 2.2, "x", "o"), ring([7, 62, z + 15], 2.2, "x", "o"));
      }
      for (const z of [-75, 0, 75]) { st.push(...hex([0, 24, z], 6, 4)); st.push(...style(cyl([0, 0, z], 3, -40, 24, "y", 1, 4), "h")); }
      for (const z of [-60, -20, 20, 60]) st.push(ring([50, 42, z], 4.5, "x", "o"), ring([50, 42, z], 2.5, "x", "f"));
      const cap = U.map(([x, y]) => [x, y, 118]);
      st.push({ s: "o", p: close(cap) }, { s: "f", p: close(U.map(([x, y]) => [x, y, 124])) });
      U.forEach(([x, y], i) => i % 2 === 0 && st.push({ s: "h", p: [[x, y, 92], [x, y, 114]] }));
      for (let x = -120; x <= 120; x += 30) st.push({ s: "f", p: [[x, -8, -130], [x, -8, 130]] });
      return st;
    } },
    // 2. ladder pull: twin tubes, standoffs through glass, washers, set screws, rounded caps
    { cam: { yaw: -0.85, pitch: 0.28, zoom: 1.4, fx: 0.0, fy: -0.02 }, comp: 1, build: () => {
      const st = [...box(-4, -120, -70, 4, 160, 70)];
      for (const x of [-36, 36]) {
        st.push(...cyl([x, 0, 0], 11, -120, 150, "y", 12, 10));
        for (let k = 1; k <= 4; k++) st.push(ring([x, 150 + Math.sin(k / 4 * Math.PI / 2) * 11, 0], Math.cos(k / 4 * Math.PI / 2) * 11, "y", k === 4 ? "o" : "f"));
        st.push(ring([x, -120, 0], 7, "y", "f"));
      }
      for (const y of [0, 110]) {
        st.push(...cyl([0, y, 0], 6, -26, 26, "x", 4, 8));
        for (const x of [-4, 4]) st.push(ring([x, y, 0], 10, "x", "a"), ring([x * 1.6, y, 0], 10, "x", "a"));
        st.push(ring([-36, y + 6, 11], 1.6, "z", "o"), ring([36, y + 6, 11], 1.6, "z", "o"));
      }
      for (let y = -110; y < 160; y += 22) st.push({ s: "f", p: [[4, y, 70], [4, y + 14, 56]] });
      return st;
    } },
    // 3. geared deadbolt: chamfered housing, gear on a hub, rack on the bolt, screws
    { cam: { yaw: -0.55, pitch: 0.5, zoom: 1.5, fx: -0.05, fy: 0.0 }, comp: 2, build: () => {
      const hous = [[-70, -44], [44, -44], [52, -36], [52, 36], [44, 44], [-70, 44], [-78, 36], [-78, -36]];
      const st = [...extrudeZ(hous, -12, 12, "o"), ...style(extrudeZ([[-62, -36], [36, -36], [36, 36], [-62, 36]], 12, 14, "f"), "f")];
      st.push(...style(extrudeZ(G2(-14, 0, 30, 14, 5), 14, 24), "a"), ...cyl([-14, 0, 0], 9, 14, 34, "z", 3, 8), ring([-14, 0, 34], 4, "z", "o"));
      for (let a = 0; a < 6; a++) { const ang = a / 6 * TAU; st.push({ s: "f", p: [[-14 + Math.cos(ang) * 10, Math.sin(ang) * 10, 24], [-14 + Math.cos(ang) * 22, Math.sin(ang) * 22, 24]] }); }
      st.push(...box(20, -12, -8, 128, 12, 8), ...style(box(128, -12, -8, 134, 12, 8), "o"));
      const rack = []; for (let x = 22; x <= 96; x += 6) rack.push([x, 12, 8], [x + 3, 17, 8]); st.push({ s: "o", p: rack }, { s: "f", p: rack.map(([x, y]) => [x, y, -8]) });
      for (const [x, y] of [[-66, -34], [40, -34], [-66, 34], [40, 34]]) { st.push(...hex([x, y, 14], 4.5, 3, "z")); st.push({ s: "f", p: [[x - 3, y, 17], [x + 3, y, 17]] }); }
      st.push(...style(box(150, -26, -16, 176, 26, 16), "h"));
      return st;
    } },
    // 4. barn-door roller in its track, hanger plate, soft-close block
    { cam: { yaw: -0.5, pitch: 0.32, zoom: 1.4, fx: 0.08, fy: 0.1 }, comp: 3, build: () => {
      const C = [[-16, 0], [16, 0], [16, 30], [9, 30], [9, 6], [-9, 6], [-9, 30], [-16, 30]];
      const st = [...swapX(extrudeZ(C, -140, 160, "o"))];
      for (const x of [-40, 80]) {
        st.push(...cyl([x, 18, 0], 10, -6, 6, "z", 3, 12), ...cyl([x, 18, 0], 2.5, -20, 20, "z", 1, 6), ring([x, 18, 6], 6, "z", "f"));
        st.push(...box(x - 14, -70, 20, x + 14, 22, 25));
        st.push(ring([x, -20, 25], 3.5, "z", "o"), ring([x, -50, 25], 3.5, "z", "o"), ...hex([x, 18, 25], 4, 3, "z"));
      }
      st.push(...style(box(110, 8, -7, 150, 18, 7), "a"), ...style(box(150, 8, -4, 158, 18, 4), "a"));
      st.push(...box(-90, -220, 14, 140, -70, 30));
      for (let x = -80; x < 140; x += 40) st.push({ s: "f", p: [[x, -80, 30], [x + 20, -100, 30]] });
      return st;
    } },
    // 5. sphere speaker: lat/long shell, tilted driver, twisted stand, base
    { cam: { yaw: -0.4, pitch: 0.25, zoom: 1.45, fx: 0.0, fy: 0.12 }, comp: 4, build: () => {
      const st = [], c = [0, 40, 0], R = 52;
      for (let k = -3; k <= 3; k++) { const y = Math.sin(k / 4 * Math.PI / 2) * R; st.push(ring([0, 40 + y, 0], Math.sqrt(R * R - y * y), "y", k === 0 ? "o" : "f")); }
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI, p = []; for (let i = 0; i <= 48; i++) { const b = i / 48 * TAU; p.push([Math.cos(a) * Math.cos(b) * R, 40 + Math.sin(b) * R, Math.sin(a) * Math.cos(b) * R]); } st.push({ s: k === 0 ? "o" : "f", p }); }
      const n = [-0.45, 0.12, 0.88], ln = Math.hypot(...n), nn = n.map((v) => v / ln);
      const t1 = [nn[2], 0, -nn[0]], t1l = Math.hypot(...t1), u1 = t1.map((v) => v / t1l), v1 = [nn[1] * u1[2] - nn[2] * u1[1], nn[2] * u1[0] - nn[0] * u1[2], nn[0] * u1[1] - nn[1] * u1[0]];
      for (const [rr, d, s] of [[26, 0.86, "o"], [20, 0.9, "f"], [14, 0.94, "a"], [6, 1.02, "a"]]) {
        const p = []; for (let i = 0; i <= 48; i++) { const a = i / 48 * TAU; p.push([0, 1, 2].map((j) => c[j] + nn[j] * R * d + (u1[j] * Math.cos(a) + v1[j] * Math.sin(a)) * rr)); } st.push({ s, p });
      }
      for (let k = 0; k < 5; k++) { const p = []; for (let i = 0; i <= 60; i++) { const y = -12 - i * 1.4, a = i / 60 * Math.PI * 2.2 + k / 5 * TAU, r = 8 + i * 0.45; p.push([Math.cos(a) * r, y, Math.sin(a) * r]); } st.push({ s: "o", p }); }
      st.push(...cyl([0, -98, 0], 46, -104, -98, "y", 1, 12));
      return st;
    } },
    // 6. tapered door rail: wedge body, glass, lock cylinder, hidden wedges, end cap
    { cam: { yaw: -0.7, pitch: 0.36, zoom: 1.2, fx: 0.08, fy: 0.0 }, comp: 5, build: () => {
      const body = [[-130, 0], [130, 0], [118, 40], [-118, 40]];
      const st = [...extrudeZ(body, -12, 12, "o"), ...style(extrudeZ([[-110, 34], [110, 34], [106, 40], [-106, 40]], -12, 12, "f"), "f")];
      st.push(...box(-112, 38, -5, 112, 190, 5));
      for (const x of [-80, -20, 40]) st.push(...style(extrudeZ([[x, 14], [x + 34, 14], [x + 30, 30], [x + 4, 30]], -9, 9), "h"));
      st.push(...cyl([80, 18, 0], 8, 12, 20, "z", 2, 10), { s: "a", p: [[80, 13, 20.5], [80, 23, 20.5]] }, ring([80, 18, 20], 3, "z", "a"));
      st.push(...style(extrudeZ(body.map(([x, y]) => [x, y]), 18, 22), "f").slice(0, 2));
      st.push(...style(move(extrudeZ([[118, 0], [130, 0], [118, 40]], -12, 12), 22, 0, 0), "a"));
      return st;
    } },
  ].map((m) => {
    const strokes = m.build(); let total = 0;
    strokes.forEach((s) => { s.len = 0; for (let i = 1; i < s.p.length; i++) s.len += Math.hypot(s.p[i][0] - s.p[i - 1][0], s.p[i][1] - s.p[i - 1][1], s.p[i][2] - s.p[i - 1][2]); total += s.len; });
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    strokes.forEach((s) => s.p.forEach((p) => p.forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); })));
    return { ...m, strokes, total, centre: lo.map((v, i) => (v + hi[i]) / 2), size: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) };
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
      const base = { o: 0.95, f: 0.5, h: 0.45, a: 1 }[s.s] * near * fade;
      x.strokeStyle = s.s === "a" ? accent(base) : ink(base);
      x.lineWidth = s.s === "o" ? lw : s.s === "a" ? lw * 1.3 : 1;
      x.setLineDash(s.s === "h" ? [5 * u + 2, 4 * u + 1] : []);
      x.beginPath(); x.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]); x.stroke();
    }
    x.setLineDash([]);
  }

  // 01: smooth, light ink on black
  const c1 = document.getElementById("art"), x1 = c1.getContext("2d");
  // 02: drawn at 1/3 resolution in black on white, then snapped to a few hard tones
  const PIX = 3, c2 = document.getElementById("art8"), x2 = c2.getContext("2d", { willReadFrequently: true });
  const red = [215, 25, 33];
  const BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const SET1 = [4, 0, 1], SET2 = [2, 3, 5];   // 01: sphere speaker, base shoe, ladder pull · 02: deadbolt, barn roller, door rail
  const PAL1 = ["#e0412f", "#f0b92c", "#2f5fd0", "#e9e3d3"];
  const PAL2 = [[215, 25, 33], [242, 190, 40], [40, 80, 200], [11, 11, 13]];
  const PAL2css = PAL2.map((c) => "rgb(" + c.join(",") + ")");
  function frame(now) {
    const t = reduce ? 0 : (now - t0) / 1000;
    // 01: smooth lines over the colour blocks, on blueprint navy
    const d = Math.min(2, devicePixelRatio || 1), W1 = c1.clientWidth, H1 = c1.clientHeight;
    if (c1.width !== Math.round(W1 * d) || c1.height !== Math.round(H1 * d)) { c1.width = Math.round(W1 * d); c1.height = Math.round(H1 * d); }
    x1.setTransform(d, 0, 0, d, 0, 0); x1.clearRect(0, 0, W1, H1);
    art(x1, W1, H1, t, 1, (a) => "rgba(240,242,246," + a + ")", (a) => "rgba(255,206,58," + a + ")", (a) => "rgba(120,170,255," + a + ")", PAL1, "all", SET1);
    // 02: same frame at 1/3 resolution; colour blocks snapped to four flat colours, lines to hard tones
    const W2 = Math.ceil(c2.clientWidth / PIX), H2 = Math.ceil(c2.clientHeight / PIX);
    if (c2.width !== W2 || c2.height !== H2) { c2.width = W2; c2.height = H2; }
    x2.clearRect(0, 0, W2, H2);
    art(x2, W2, H2, t, 1 / PIX, null, null, null, PAL2css, "shapes", SET2);
    const A = x2.getImageData(0, 0, W2, H2).data;
    x2.clearRect(0, 0, W2, H2);
    art(x2, W2, H2, t, 1 / PIX, (a) => "rgba(11,11,13," + Math.min(1, a * 1.6) + ")", (a) => "rgba(215,25,33," + Math.min(1, a * 1.4) + ")", (a) => "rgba(11,11,13,0.12)", PAL2css, "lines", SET2);
    const img = x2.getImageData(0, 0, W2, H2), p = img.data;
    for (let i = 0; i < p.length; i += 4) {
      const a = p[i + 3], f = a / 255, isRed = a && p[i] > 120 && p[i + 1] < 90;
      let c = null;
      if (isRed && f > 0.25) c = red;
      else if (f > 0.42) c = [11, 11, 13];
      else if (f > 0.2) c = [150, 150, 160];
      else if (A[i + 3] > ((BAY[((i >> 2) / W2 | 0) % 4 * 4 + ((i >> 2) % W2) % 4] + 0.5) / 16) * 255) {   // colour block: snap to the nearest of four (dithered as it fades)
        let best = 0, bd = Infinity;
        PAL2.forEach((q, j) => { const dd = (q[0] - A[i]) ** 2 + (q[1] - A[i + 1]) ** 2 + (q[2] - A[i + 2]) ** 2; if (dd < bd) { bd = dd; best = j; } });
        c = PAL2[best];
      } else if (f > 0.07) c = [226, 226, 232];
      if (c) { p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; p[i + 3] = 255; } else p[i + 3] = 0;
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
