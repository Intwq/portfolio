// Builds the site from src/ into dist/. No dependencies: run with `node build.js`.
// Projects live in src/projects/*.json, site text in src/site.json, images in src/images/.
const fs = require("fs");
const path = require("path");

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
  <a class="mark" href="${u.root}" aria-label="${esc(site.name)}, home"><span>${esc(site.name)}</span></a>
  <span class="hud-role">${esc(site.role)}</span>
  <nav class="nav" aria-label="Main">
    <a href="${u.root}${PREVIEW ? "" : ""}#work" data-nav="work">Work</a>
    <a href="${u.about}" data-nav="about">About</a>
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
  const u = make(0);
  const slides = featured.map((p, i) => `
    <figure class="slide${i === 0 ? " is-on" : ""}" data-slide data-title="${esc(p.title)}" data-year="${esc(p.year)}" data-href="${u.work(p.slug)}">
      <img${srcset(p.cover, u, "100vw")} alt=""${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}>
    </figure>`).join("");

  const tiles = projects.map((p, i) => {
    const span = SPANS[i % SPANS.length];
    return `
    <a class="tile s${span}" href="${u.work(p.slug)}" data-reveal data-cursor>
      <div class="tile-media"><img${srcset(p.cover, u, `(max-width: 900px) 100vw, ${Math.round((span / 12) * 100)}vw`)} alt="${esc(p.title)}" loading="lazy" decoding="async" style="view-transition-name:v-${p.slug}"></div>
      <div class="tile-meta">
        <span class="tile-n">${pad(i + 1)}</span>
        <span class="tile-title">${esc(p.title)}</span>
        <span class="tile-cat">${esc(p.category || "")}</span>
        <span class="tile-year">${esc(p.year || "")}</span>
      </div>
    </a>`;
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
  <div class="work-head" data-reveal>
    <h2 id="work-h" class="section-title">Selected work</h2>
    <p class="work-count">${projects.length} projects, ${Math.min(...years)} to ${Math.max(...years)}</p>
  </div>
  <div class="grid">${tiles}
  </div>
</section>`;
  return layout({ depth: 0, body, cls: "page-home", image: featured[0].cover });
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

  const spec = [["Year", p.year], ["Discipline", p.category], ["Tools", p.tools], ["Images", p.images.length || ""]]
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
  <section class="p-gallery" aria-label="Images">${rows}
  </section>
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

// ---------- write ----------
fs.rmSync(OUT, { recursive: true, force: true });
const write = (rel, html) => { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };

write("index.html", homePage());
projects.forEach((p, i) => write(`work/${p.slug}/index.html`, projectPage(p, i)));
write("about/index.html", aboutPage());
// The 404 page is served at any broken URL, so it needs root-absolute links.
write("404.html", notFound().replace(/(href|src)="\.\/(index\.html)?/g, '$1="/'));
copyDir(path.join(SRC, "images"), path.join(OUT, "images"));
copyDir(path.join(SIZES, "images"), path.join(OUT, "images"));
copyDir(path.join(SRC, "assets"), path.join(OUT, "assets"));
fs.copyFileSync(path.join(SRC, "favicon.svg"), path.join(OUT, "favicon.svg"));

console.log(`Built ${projects.length} projects into dist/${PREVIEW ? " (preview links)" : ""}`);
