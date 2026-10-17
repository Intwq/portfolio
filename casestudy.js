// Case-study sections for product-launch projects: key numbers, overview, stage-gate
// timeline, research charts, customer quotes and SWOT. Every section is optional; a
// project with none of these fields renders exactly like a normal portfolio project.
//
// Charts are written as HTML/CSS (plus a small SVG for line paths) so their text stays
// readable at phone width. Data comes from the project JSON in the same shape the
// editing dashboard writes: lists as one-item-per-line text, numbers as comma lists.

const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const lines = (t) => (Array.isArray(t) ? t : String(t || "").split("\n")).map((l) => String(l).trim()).filter(Boolean);
const nums = (t) => (Array.isArray(t) ? t : String(t || "").split(",")).map((v) => {
  const s = String(v).trim();
  return s === "" || s === "-" ? null : Number(s);
});
const paras = (t = "") => String(t).trim().split(/\n\s*\n/).filter(Boolean)
  .map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");

function fmt(v, c) {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  const d = c.decimals !== undefined && c.decimals !== "" ? Number(c.decimals) : (Math.abs(v) < 10 && v % 1 ? 1 : 0);
  const n = Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${c.prefix || ""}${n}${c.suffix || ""}`;
}

function series(c) {
  return (c.series || []).map((s) => ({ name: s.name || "", values: nums(s.values), highlight: !!s.highlight, dashed: !!s.dashed }));
}
const isHi = (c, label) => lines(c.highlight).some((h) => h.toLowerCase() === String(label).toLowerCase());

// ---------- chart types ----------
function hbar(c) {
  const labels = lines(c.labels), s = series(c)[0] || { values: [] };
  const max = Math.max(...s.values.filter((v) => v !== null), 0) || 1;
  return `<div class="hb">${labels.map((l, i) => {
    const v = s.values[i];
    return `
      <div class="hb-row${isHi(c, l) ? " hi" : ""}" style="--i:${i}">
        <span class="hb-label">${esc(l)}</span>
        <span class="hb-track"><i class="hb-fill" style="width:${((v || 0) / max) * 100}%"></i></span>
        <span class="hb-val">${fmt(v, c)}</span>
      </div>`;
  }).join("")}</div>`;
}

function bar(c) {
  const labels = lines(c.labels), ss = series(c);
  const max = Math.max(...ss.flatMap((s) => s.values).filter((v) => v !== null), 0) || 1;
  const legend = ss.length > 1 ? legendHtml(ss) : "";
  return `${legend}<div class="vb" style="--n:${labels.length}">${labels.map((l, i) => `
      <div class="vb-col${isHi(c, l) ? " hi" : ""}">
        <div class="vb-bars">${ss.map((s, k) => {
          const v = s.values[i];
          if (v === null || v === undefined) return `<span class="vb-bar empty"></span>`;
          return `<span class="vb-bar s${k}${s.highlight ? " hi" : ""}" style="--h:${(v / max) * 100}%;--i:${i + k}"><b>${fmt(v, c)}</b></span>`;
        }).join("")}</div>
        <span class="vb-label">${esc(l)}</span>
      </div>`).join("")}
    </div>`;
}

function legendHtml(ss) {
  return `<ul class="legend">${ss.map((s, k) => `<li class="s${k}${s.highlight ? " hi" : ""}${s.dashed ? " dashed" : ""}"><i></i>${esc(s.name)}</li>`).join("")}</ul>`;
}

function line(c) {
  const labels = lines(c.labels), ss = series(c);
  const all = ss.flatMap((s) => s.values).filter((v) => v !== null);
  let lo = c.min !== undefined && c.min !== "" ? Number(c.min) : Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || 1;
  lo = c.min !== undefined && c.min !== "" ? lo : Math.max(0, lo - pad);
  hi += pad;
  const n = labels.length;
  const x = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v) => 100 - ((v - lo) / (hi - lo)) * 100;
  const paths = ss.map((s, k) => {
    const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v)]));
    let d = "", pen = false;
    pts.forEach((p) => { if (!p) { pen = false; return; } d += `${pen ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`; pen = true; });
    return `<path class="ln s${k}${s.highlight ? " hi" : ""}${s.dashed ? " dashed" : ""}" d="${d}" vector-effect="non-scaling-stroke"/>`;
  }).join("");
  const dots = ss.map((s, k) => s.values.map((v, i) => v === null ? "" :
    `<span class="dot s${k}${s.highlight ? " hi" : ""}" style="left:${x(i)}%;top:${y(v)}%;--i:${i}">${c.show_values === false || c.show_values === "false" ? "" : `<b>${fmt(v, c)}</b>`}</span>`).join("")).join("");
  const grid = [0, 25, 50, 75, 100].map((g) => `<i style="top:${g}%"></i>`).join("");
  return `${ss.length > 1 ? legendHtml(ss) : ""}
    <div class="lc"><div class="lc-plot"><span class="lc-grid">${grid}</span>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>${dots}</div>
      <div class="lc-x" style="--n:${n}">${labels.map((l) => `<span>${esc(l)}</span>`).join("")}</div>
    </div>`;
}

const SEG = 6;
function split(c) {
  // One 100% bar with a legend of large percentages.
  const labels = lines(c.labels), v = (series(c)[0] || { values: [] }).values;
  const tot = v.reduce((a, b) => a + (b || 0), 0) || 1;
  return `<div class="sp">
      <div class="sp-bar">${labels.map((l, i) => `<i class="g${i % SEG}${isHi(c, l) ? " hi" : ""}" style="flex:${v[i] || 0};--i:${i}"></i>`).join("")}</div>
      <ul class="sp-key">${labels.map((l, i) => `<li class="g${i % SEG}${isHi(c, l) ? " hi" : ""}"><b>${fmt(((v[i] || 0) / tot) * 100, { suffix: "%", decimals: c.decimals ?? 0 })}</b><span><i></i>${esc(l)}</span></li>`).join("")}</ul>
    </div>`;
}

function stack(c) {
  // Several rows of 100% bars (e.g. survey answers). Series = segments, labels = rows.
  const rows = lines(c.labels), ss = series(c);
  return `${legendHtml(ss).replace('class="legend"', 'class="legend seg"')}
    <div class="st">${rows.map((r, i) => `
      <div class="st-row">
        <span class="st-label">${esc(r)}</span>
        <span class="st-bar">${ss.map((s, k) => { const v = s.values[i] || 0; return v ? `<i class="g${k % SEG}" style="flex:${v};--i:${i}">${v >= 8 ? fmt(v, { suffix: c.suffix ?? "%", decimals: 0 }) : ""}</i>` : ""; }).join("")}</span>
      </div>`).join("")}
    </div>`;
}

function table(c) {
  const cols = String(c.columns || "").split("|").map((s) => s.trim());
  const hiCol = cols.findIndex((h) => isHi(c, h));
  const rows = lines(c.rows).map((r) => r.split("|").map((s) => s.trim()));
  return `<div class="tb-wrap"><table class="tb">
      <thead><tr>${cols.map((h, i) => `<th${i === hiCol ? ' class="hi"' : ""} scope="col">${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr class="${isHi(c, r[0]) ? "hi" : ""}">${r.map((v, i) => i === 0 ? `<th scope="row">${esc(v)}</th>` : `<td${i === hiCol ? ' class="hi"' : ""}>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
}

function words(c) {
  const labels = lines(c.labels), v = (series(c)[0] || { values: [] }).values;
  const max = Math.max(...v.filter((x) => x !== null), 1);
  return `<p class="wd">${labels.map((l, i) => `<span style="--w:${(v[i] || 1) / max};--i:${i}"${isHi(c, l) ? ' class="hi"' : ""}>${esc(l)}</span>`).join(" ")}</p>`;
}

const TYPES = { hbar, bar, line, split, stack, table, words };

function chart(c, k, E = NOE) {
  const fn = TYPES[c.type] || hbar;
  const at = (f) => E(`/charts/${c._i}/${f}`, c[f]);
  return `
    <figure class="chart${c.wide ? " wide" : ""} t-${esc(c.type || "hbar")}" data-reveal>
      <figcaption class="chart-head">
        <span class="chart-n">Fig. R${String(k + 1).padStart(2, "0")}</span>
        <h3${at("title")}>${esc(c.title || "")}</h3>
        ${c.caption ? `<p${at("caption")}>${esc(c.caption)}</p>` : ""}
      </figcaption>
      <div class="chart-body">${fn(c)}</div>
      ${c.note ? `<p class="chart-note">${esc(c.note)}</p>` : ""}
    </figure>`;
}

// ---------- sections ----------
// E(pointer, raw) returns the attribute that marks text as editable in the on-page editor
// (a JSON pointer into this project's file). The arcade build passes nothing, so it's a no-op there.
const NOE = () => "";
const keep = (arr, ok) => (arr || []).map((x, i) => (x && typeof x === "object" ? { ...x, _i: i } : x)).filter(ok);
const GATES = ["G0", "G1", "G2", "G3", "G4", "G5"];
const GATE_NAMES = { G0: "Concept", G1: "Define", G2: "Develop", G3: "Validate", G4: "Launch", G5: "Post-launch" };

function gatesHtml(p) {
  const list = (p.gates || []).filter((g) => g && g.gate);
  if (!list.length) return "";
  const byGate = Object.fromEntries(list.map((g) => [String(g.gate).toUpperCase().replace(/\s/g, ""), g]));
  const reached = GATES.filter((g) => byGate[g] && (byGate[g].done === true || byGate[g].done === "true"));
  const last = reached.length ? GATES.indexOf(reached[reached.length - 1]) : -1;
  return `
  <section class="cs-block" aria-labelledby="g-${p.slug}">
    <h2 class="cs-title" id="g-${p.slug}">Stage-gate progress</h2>
    <ol class="gates" data-reveal style="--done:${last + 1}">${GATES.map((g, i) => {
      const it = byGate[g] || {};
      const state = i <= last ? "done" : i === last + 1 ? "next" : "todo";
      return `
      <li class="gate ${state}" style="--i:${i}">
        <span class="gate-id">${g}</span>
        <span class="gate-name">${esc(it.label || GATE_NAMES[g])}</span>
        <span class="gate-date">${esc(it.date || (state === "done" ? "" : "Planned"))}</span>
      </li>`;
    }).join("")}
    </ol>
  </section>`;
}

function roleHtml(p, E = NOE) {
  const groups = keep(p.stakeholders, (g) => g && (g.group || g.members));
  if (!p.my_role && !groups.length) return "";
  return `
  <section class="cs-block" aria-labelledby="m-${p.slug}">
    <h2 class="cs-title" id="m-${p.slug}">My role</h2>
    <div class="role" data-reveal>
      ${p.my_role ? `<div class="role-text"${E("/my_role", p.my_role)}>${paras(p.my_role)}</div>` : ""}
      ${groups.length ? `<div class="sh">
        <p class="sh-head">Stakeholders I coordinated</p>
        <dl class="sh-list">${groups.map((g, i) => `
          <div style="--i:${i}"><dt${E(`/stakeholders/${g._i}/group`, g.group)}>${esc(g.group || "")}</dt><dd${E(`/stakeholders/${g._i}/members`, g.members)}>${esc(lines(g.members).join(" · "))}</dd></div>`).join("")}
        </dl></div>` : ""}
    </div>
  </section>`;
}

function recoveryHtml(p, E = NOE) {
  const steps = keep(p.recovery, (r) => r && r.text);
  if (!steps.length) return "";
  return `
  <section class="cs-block" aria-labelledby="w-${p.slug}">
    <h2 class="cs-title" id="w-${p.slug}"${p.recovery_title ? E("/recovery_title", p.recovery_title) : ""}>${esc(p.recovery_title || "Plan to win back the market")}</h2>
    ${p.recovery_intro ? `<div class="cs-intro"${E("/recovery_intro", p.recovery_intro)}>${paras(p.recovery_intro)}</div>` : ""}
    <ol class="plan" data-reveal>${steps.map((r, i) => `
      <li style="--i:${i}"><span class="plan-n">${String(i + 1).padStart(2, "0")}</span><div><h3${E(`/recovery/${r._i}/label`, r.label)}>${esc(r.label || "")}</h3><div${E(`/recovery/${r._i}/text`, r.text)}>${paras(r.text)}</div></div></li>`).join("")}
    </ol>
  </section>`;
}

function challengesHtml(p, E = NOE) {
  const list = keep(p.challenges, (c) => c && (c.challenge || c.resolution));
  if (!list.length) return "";
  return `
  <section class="cs-block" aria-labelledby="c-${p.slug}">
    <h2 class="cs-title" id="c-${p.slug}">Challenges and resolutions</h2>
    <ol class="cr">${list.map((c, i) => `
      <li data-reveal>
        <span class="cr-n">${String(i + 1).padStart(2, "0")}</span>
        <div class="cr-c"><span class="cr-k">Challenge</span><div${E(`/challenges/${c._i}/challenge`, c.challenge)}>${paras(c.challenge)}</div></div>
        <div class="cr-r"><span class="cr-k">Resolution</span><div${E(`/challenges/${c._i}/resolution`, c.resolution)}>${paras(c.resolution)}</div></div>
      </li>`).join("")}
    </ol>
  </section>`;
}

function caseStudy(p, E = NOE) {
  const metrics = keep(p.metrics, (m) => m && m.value);
  const brief = keep(p.brief, (b) => b && b.text);
  const charts = keep(p.charts, (c) => c && c.type);
  const study = keep(p.study, (s) => s && s.text);
  const quotes = keep(p.quotes, (q) => q && q.quote);
  const swot = p.swot || {};
  const swotKeys = [["strengths", "Strengths"], ["weaknesses", "Weaknesses"], ["opportunities", "Opportunities"], ["threats", "Threats"]]
    .filter(([k]) => lines(swot[k]).length);
  if (!metrics.length && !brief.length && !study.length && !charts.length && !quotes.length && !swotKeys.length && !(p.gates || []).length
    && !p.my_role && !(p.challenges || []).length && !(p.recovery || []).length) return "";
  const pair = (list, key, b) => `
      <div><dt${E(`/${key}/${b._i}/label`, b.label)}>${esc(b.label || "")}</dt><dd${E(`/${key}/${b._i}/text`, b.text)}>${paras(b.text)}</dd></div>`;

  return `
<div class="cs">
  ${metrics.length ? `<dl class="stats cs-stats" data-reveal>${metrics.map((m) => `
    <div class="stat"><dt${E(`/metrics/${m._i}/label`, m.label)}>${esc(m.label || "")}</dt><dd${E(`/metrics/${m._i}/value`, m.value)}>${esc(m.value)}</dd></div>`).join("")}
  </dl>` : ""}

  ${brief.length ? `<section class="cs-block" aria-labelledby="o-${p.slug}">
    <h2 class="cs-title" id="o-${p.slug}">Overview</h2>
    <dl class="brief" data-reveal>${brief.map((b) => pair(brief, "brief", b)).join("")}
    </dl>
  </section>` : ""}

  ${study.length ? `<section class="cs-block" aria-labelledby="d-${p.slug}">
    <h2 class="cs-title" id="d-${p.slug}">Design language</h2>
    ${p.study_intro ? `<div class="cs-intro"${E("/study_intro", p.study_intro)}>${paras(p.study_intro)}</div>` : ""}
    <dl class="brief" data-reveal>${study.map((s) => pair(study, "study", s)).join("")}
    </dl>
  </section>` : ""}

  ${roleHtml(p, E)}

  ${gatesHtml(p)}

  ${recoveryHtml(p, E)}

  ${charts.length ? `<section class="cs-block" aria-labelledby="r-${p.slug}">
    <h2 class="cs-title" id="r-${p.slug}">Research</h2>
    ${p.research_intro ? `<div class="cs-intro"${E("/research_intro", p.research_intro)}>${paras(p.research_intro)}</div>` : ""}
    <div class="charts">${charts.map((c, k) => chart(c, k, E)).join("")}
    </div>
  </section>` : ""}

  ${challengesHtml(p, E)}

  ${quotes.length ? `<section class="cs-block" aria-labelledby="q-${p.slug}">
    <h2 class="cs-title" id="q-${p.slug}">Voice of the customer</h2>
    <div class="quotes">${quotes.map((q) => `
      <blockquote class="quote" data-reveal><p${E(`/quotes/${q._i}/quote`, q.quote)}>${esc(q.quote)}</p>${q.source ? `<footer${E(`/quotes/${q._i}/source`, q.source)}>${esc(q.source)}</footer>` : ""}</blockquote>`).join("")}
    </div>
  </section>` : ""}

  ${swotKeys.length ? `<section class="cs-block" aria-labelledby="s-${p.slug}">
    <h2 class="cs-title" id="s-${p.slug}">Situational analysis</h2>
    <div class="swot" data-reveal>${swotKeys.map(([k, name]) => `
      <div class="sw sw-${k}"><h3><span>${name[0]}</span>${name}</h3><ul${E(`/swot/${k}`, swot[k])}>${lines(swot[k]).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`).join("")}
    </div>
  </section>` : ""}
</div>`;
}

module.exports = { caseStudy };
