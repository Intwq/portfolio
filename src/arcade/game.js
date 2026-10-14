// ARCADE: claw machine. A trolley runs on the top rail, a verlet-simulated chain hangs from it,
// and the claw at the end follows the pointer. Click a prize: the claw drops, grabs it, lifts it,
// the prize shakes in golden light and opens into the project window. Close (×) to drop it back.
(() => {
  const DATA = window.ARCADE || [];
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canvas = $("#rig"), ctx = canvas.getContext("2d");
  const pit = $("#pit"), fx = $("#fx"), win = $("#win"), winBody = $("#win-body"), winTitle = $("#win-title");
  const lcd = $("[data-lcd]"), hint = $("[data-hint]");
  const INK = "#111111", SIGNAL = "#ff4f00", BODY = "#2a2a2a";

  let W = 0, H = 0, DPR = 1, S = 72, RAIL = 64;
  const pointer = { x: 0, y: 0, seen: false };
  const trolley = { x: 0, v: 0, tx: 0 };
  const N = 18;
  const pts = Array.from({ length: N }, () => ({ x: 0, y: 0, px: 0, py: 0 }));
  let len = 160, lenT = 160;
  const claw = { open: 1, openT: 1 };
  let mode = "follow";      // follow | seek | grab | lift | reveal | open | stow | return | release
  let held = null, timer = 0, current = null;

  // ---------- prizes ----------
  const prizes = $$(".prize", pit).map((el, i) => ({
    el, i, slug: el.dataset.slug, d: DATA.find((d) => d.slug === el.dataset.slug),
    x: 0, y: 0, hx: 0, hy: 0, rot: 0, hrot: 0, vy: 0, vx: 0, vr: 0, falling: false, scale: 1,
  }));
  // seeded randomness so the pile looks the same on every visit
  const rnd = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function layout() {
    W = innerWidth; H = innerHeight; DPR = Math.min(2, devicePixelRatio || 1);
    canvas.width = W * DPR; canvas.height = H * DPR;
    RAIL = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--rail")) || 64;
    const n = prizes.length, margin = W < 700 ? 14 : 40;
    // shrink prizes until the pile fits in the lower ~58% of the screen
    S = Math.max(46, Math.min(84, W / 15));
    let cols, rows, cell;
    for (;;) {
      cell = S * 1.22; cols = Math.max(3, Math.floor((W - margin * 2) / cell)); rows = Math.ceil(n / cols);
      if (rows * S * 0.98 < H * 0.58 || S <= 40) break;
      S -= 2;
    }
    document.documentElement.style.setProperty("--s", S + "px");
    const floorY = H - 34, rowH = S * 0.92;
    const used = Math.min(cols, n), x0 = (W - (used - 1) * cell) / 2;
    prizes.forEach((p, k) => {
      const r = Math.floor(k / cols), c = k % cols;
      const inRow = Math.min(cols, n - r * cols);
      const rx0 = (W - (inRow - 1) * cell) / 2 + (r % 2 ? cell * 0.25 : -cell * 0.1);
      p.hx = Math.max(margin + S / 2, Math.min(W - margin - S / 2, rx0 + c * cell + (rnd(k) - 0.5) * cell * 0.22));
      p.hy = floorY - S * 0.5 - r * rowH - rnd(k + 9) * S * 0.12;
      p.hrot = (rnd(k + 3) - 0.5) * 26;
      if (p !== held && !p.falling && !(current && current === p)) { p.x = p.hx; p.y = p.hy; p.rot = p.hrot; }
      p.el.style.zIndex = String(100 - r);
    });
    if (!pointer.seen) { pointer.x = W * 0.5; pointer.y = Math.max(RAIL + 160, H * 0.3); }
    if (!trolley.x) { trolley.x = trolley.tx = pointer.x; resetRope(); }
  }

  function resetRope() {
    const ax = trolley.x, ay = RAIL + 12;
    pts.forEach((p, i) => { p.x = p.px = ax; p.y = p.py = ay + (len * i) / (N - 1); });
  }

  // ---------- input ----------
  const machine = $("#machine");
  const setPointer = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.seen = true; };
  addEventListener("pointermove", setPointer, { passive: true });
  addEventListener("pointerdown", setPointer, { passive: true });

  prizes.forEach((p) => {
    p.el.addEventListener("click", (e) => { e.stopPropagation(); grab(p); });
    p.el.addEventListener("pointerenter", () => { if (mode === "follow") show(`${p.d.title}`); });
    p.el.addEventListener("pointerleave", () => { if (mode === "follow") show("Insert coin"); });
    p.el.addEventListener("focus", () => { if (mode === "follow") show(p.d.title); });
  });
  const show = (t) => { lcd.textContent = t; };

  // ---------- sound (tiny synth, off by default) ----------
  let AC = null, sound = false;
  try { sound = localStorage.getItem("arcade-sound") === "1"; } catch (e) {}
  const sndBtn = $("[data-sound]");
  const paintSnd = () => { sndBtn.textContent = sound ? "On" : "Off"; sndBtn.setAttribute("aria-pressed", String(sound)); };
  paintSnd();
  sndBtn.addEventListener("click", () => { sound = !sound; paintSnd(); try { localStorage.setItem("arcade-sound", sound ? "1" : "0"); } catch (e) {} beep(880, 0.06); });
  function beep(f, dur = 0.08, type = "square", vol = 0.05, when = 0) {
    if (!sound) return;
    try {
      AC = AC || new (window.AudioContext || window.webkitAudioContext)();
      const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + when;
      o.type = type; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(AC.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }
  const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.16, "square", 0.045, i * 0.09));

  // ---------- the grab sequence ----------
  function grab(p) {
    if (mode !== "follow" || p.falling) return;
    current = p; mode = "seek"; timer = 0;
    trolley.tx = p.x; claw.openT = 1;
    show("Aiming…"); hint.textContent = "Grabbing " + p.d.title;
    beep(440, 0.05); beep(660, 0.05, "square", 0.04, 0.06);
  }

  const gripOffset = () => S * 0.5;
  function grip() {
    const a = pts[N - 1], b = pts[N - 2];
    const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy) || 1;
    return { x: a.x + (dx / d) * gripOffset(), y: a.y + (dy / d) * gripOffset(), ang: Math.atan2(-dx, dy) };
  }

  function openWindow(d, ox, oy) {
    win.hidden = false;
    win.style.setProperty("--ox", `${ox - (W - win.offsetWidth) / 2}px`);
    win.style.setProperty("--oy", `${oy - (H - win.offsetHeight) / 2}px`);
    win.classList.add("closed");
    winTitle.textContent = `${String(d.n).padStart(2, "0")} / ${d.title}`;
    winBody.innerHTML = `<p class="win-load">Loading…</p>`;
    winBody.scrollTop = 0;
    requestAnimationFrame(() => requestAnimationFrame(() => win.classList.remove("closed")));
    load(d.slug).then((html) => { if (win.dataset.slug === d.slug) { winBody.innerHTML = html; animateCharts(); } });
    win.dataset.slug = d.slug;
    setTimeout(() => $("[data-close]", win).focus({ preventScroll: true }), 300);
    show(d.title);
  }
  const cache = {};
  const load = (slug) => cache[slug] || (cache[slug] = fetch(`p/${slug}.html`).then((r) => r.text()).catch(() => `<p class="win-load">Couldn't load this project.</p>`));
  function animateCharts() {
    const els = $$(".chart, .gates", winBody);
    if (!("IntersectionObserver" in window) || reduce) { els.forEach((e) => e.classList.add("is-in")); return; }
    const io = new IntersectionObserver((es) => es.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } }), { root: winBody, threshold: 0.15 });
    els.forEach((e) => io.observe(e));
  }

  let fromIndex = false;
  function closeWindow() {
    if (win.hidden || win.classList.contains("closed")) return;
    win.classList.add("closed");
    fx.classList.remove("on");
    beep(330, 0.08); beep(220, 0.1, "square", 0.04, 0.08);
    setTimeout(() => { win.hidden = true; winBody.innerHTML = ""; delete win.dataset.slug; }, 450);
    if (fromIndex) { fromIndex = false; show("Insert coin"); return; }
    if (current) { current.el.classList.remove("shake"); mode = "stow"; timer = 0; }
  }
  $("[data-close]", win).addEventListener("click", closeWindow);
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeWindow(); });

  // ---------- index drawer ----------
  const drawer = $("#drawer"), tab = $(".tab", drawer);
  machine.addEventListener("pointerdown", () => { drawer.classList.remove("open"); tab.setAttribute("aria-expanded", "false"); });
  tab.addEventListener("click", () => { const o = !drawer.classList.contains("open"); drawer.classList.toggle("open", o); tab.setAttribute("aria-expanded", String(o)); });
  $$("[data-open]", drawer).forEach((b) => b.addEventListener("click", () => {
    if (mode !== "follow" || !win.hidden) return;
    const d = DATA.find((x) => x.slug === b.dataset.open), r = b.getBoundingClientRect();
    drawer.classList.remove("open"); tab.setAttribute("aria-expanded", "false");
    fromIndex = true; beep(660, 0.06);
    openWindow(d, r.left + 18, r.top + r.height / 2);
  }));

  // ---------- clock ----------
  const clock = $("[data-clock]");
  const tick = () => { const t = new Date(); clock.textContent = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); };
  tick(); setInterval(tick, 1000);

  // ---------- simulation ----------
  const G = 2600;
  function step(dt) {
    const ay = RAIL + 12;
    const minL = S * 0.35, maxL = H - ay - S * 0.4;

    // targets per mode
    if (mode === "follow") {
      trolley.tx = Math.max(S * 0.5, Math.min(W - S * 0.5, pointer.x));
      lenT = Math.max(minL, Math.min(maxL, pointer.y - ay - gripOffset()));
      claw.openT = 1;
    } else if (mode === "seek") {
      const p = current;
      trolley.tx = p.x;
      const near = Math.abs(trolley.x - p.x) < 6 && Math.abs(trolley.v) < 60;
      lenT = near ? Math.max(minL, p.y - ay - gripOffset() + S * 0.1) : Math.min(len, minL + S);
      const g = grip();
      if (near && Math.abs(len - lenT) < 3 && Math.abs(g.x - p.x) < S * 0.3) { mode = "grab"; timer = 0; claw.openT = 0; beep(200, 0.12, "sawtooth", 0.04); show("Grab!"); }
      if ((timer += dt) > 6) { mode = "grab"; timer = 0; claw.openT = 0; }
    } else if (mode === "grab") {
      if ((timer += dt) > 0.28) { held = current; held.el.classList.add("held"); mode = "lift"; timer = 0; show("Lifting…"); beep(520, 0.05); }
    } else if (mode === "lift") {
      lenT = minL; timer += dt;
      if (len - minL < 30) trolley.tx = W / 2;
      if (timer > 0.6 && Math.abs(trolley.x - W / 2) < 10 && Math.abs(len - minL) < 4) { mode = "reveal"; timer = 0; startReveal(); }
      if (timer > 5) { mode = "reveal"; timer = 0; startReveal(); }
    } else if (mode === "reveal") {
      timer += dt;
      const cx = W / 2, cy = Math.max(RAIL + S * 2, H * 0.42), k = Math.min(1, timer / 0.5), e = 1 - Math.pow(1 - k, 3);
      const g = grip();
      current.x = g.x + (cx - g.x) * e; current.y = g.y + (cy - g.y) * e; current.rot = current.rot * (1 - e); current.scale = 1 + e * 1.4;
      fx.style.transform = `translate(${current.x}px, ${current.y}px)`;
      if (timer > (reduce ? 0.4 : 1.35) && win.hidden) { mode = "open"; openWindow(current.d, current.x, current.y); current.el.style.opacity = "0"; }
    } else if (mode === "open") {
      lenT = minL; trolley.tx = W / 2;
    } else if (mode === "stow") {
      timer += dt;
      const g = grip(), k = Math.min(1, timer / 0.45), e = k * k;
      current.el.style.opacity = "1";
      current.x += (g.x - current.x) * e; current.y += (g.y - current.y) * e; current.scale += (1 - current.scale) * e;
      if (k >= 1) { held = current; mode = "return"; timer = 0; show("Returning…"); }
    } else if (mode === "return") {
      lenT = minL; trolley.tx = held.hx; timer += dt;
      if ((Math.abs(trolley.x - held.hx) < 6 && Math.abs(trolley.v) < 80) || timer > 5) { mode = "release"; timer = 0; claw.openT = 1; beep(300, 0.06); }
    } else if (mode === "release") {
      if ((timer += dt) > 0.18) {
        const p = held; held = null;
        p.el.classList.remove("held", "show"); p.falling = true; p.vy = 0; p.vx = (p.hx - p.x) * 2; p.vr = (rnd(p.i + Date.now()) - 0.5) * 400;
        current = null; mode = "follow"; show("Insert coin"); hint.textContent = "Move to aim. Click a prize to grab it.";
      }
    }

    // trolley: damped spring towards its target (this swing is what drives the chain physics)
    const stiff = mode === "follow" ? 95 : 55, damp = mode === "follow" ? 16 : 13;
    trolley.v += ((trolley.tx - trolley.x) * stiff - trolley.v * damp) * dt;
    trolley.v = Math.max(-2600, Math.min(2600, trolley.v));
    trolley.x += trolley.v * dt;

    // chain length eases to its target
    const speed = mode === "follow" ? 2200 : mode === "seek" ? 620 : 900;
    const dl = lenT - len;
    len += Math.sign(dl) * Math.min(Math.abs(dl), speed * dt, Math.abs(dl) * 12 * dt + 2);

    // verlet integration
    const rest = len / (N - 1);
    pts[0].x = trolley.x; pts[0].y = ay;
    for (let i = 1; i < N; i++) {
      const p = pts[i];
      const vx = (p.x - p.px) * 0.985, vy = (p.y - p.py) * 0.985;
      p.px = p.x; p.py = p.y;
      p.x += vx; p.y += vy + G * dt * dt;
    }
    const wLast = held ? 0.12 : 0.22;
    for (let it = 0; it < 14; it++) {
      for (let i = 0; i < N - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.0001;
        const wa = i === 0 ? 0 : 1, wb = i + 1 === N - 1 ? wLast : 1, wsum = wa + wb;
        const diff = (d - rest) / d / wsum;
        a.x += dx * diff * wa; a.y += dy * diff * wa;
        b.x -= dx * diff * wb; b.y -= dy * diff * wb;
      }
      pts[0].x = trolley.x; pts[0].y = ay;
    }

    claw.open += (claw.openT - claw.open) * Math.min(1, dt * 14);

    // held prize hangs in the claw
    if (held && (mode === "grab" || mode === "lift" || mode === "return" || mode === "release")) {
      const g = grip();
      held.x = g.x; held.y = g.y + S * 0.08; held.rot = (g.ang * 180) / Math.PI;
    }
    // dropped prizes fall back to their spot
    prizes.forEach((p) => {
      if (!p.falling) return;
      p.vy += G * 0.8 * dt; p.y += p.vy * dt; p.x += (p.hx - p.x) * Math.min(1, dt * 6); p.rot += p.vr * dt;
      if (p.y >= p.hy) {
        p.y = p.hy;
        if (Math.abs(p.vy) > 140) { p.vy *= -0.38; p.vr *= 0.5; beep(120 + Math.abs(p.vy) * 0.2, 0.04, "triangle", 0.05); }
        else { p.falling = false; p.vy = 0; p.x = p.hx; p.rot = p.hrot; }
      }
    });
  }

  function startReveal() {
    current.el.classList.add("show");
    if (!reduce) current.el.classList.add("shake");
    held = null;
    fx.style.transform = `translate(${current.x}px, ${current.y}px)`;
    fx.classList.add("on");
    show("Prize!"); fanfare();
  }

  // ---------- drawing ----------
  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ay = RAIL + 12;

    // rail
    ctx.fillStyle = INK; ctx.fillRect(0, RAIL - 4, W, 8);
    ctx.fillStyle = "#e9e9e6";
    for (let x = 12; x < W; x += 36) ctx.fillRect(x, RAIL - 1, 14, 2);

    // chain
    const LINK = Math.max(6, S * 0.11);
    let carry = 0, n = 0;
    ctx.lineWidth = Math.max(1.6, S * 0.03); ctx.strokeStyle = "#3a3a38"; ctx.lineCap = "round";
    for (let i = 0; i < N - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      let t = carry;
      while (t < d) {
        const x = a.x + (dx * t) / d, y = a.y + (dy * t) / d;
        ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
        ctx.beginPath();
        if (n++ % 2) { ctx.moveTo(-LINK * 0.55, 0); ctx.lineTo(LINK * 0.55, 0); }
        else ctx.ellipse(0, 0, LINK * 0.62, LINK * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke(); ctx.restore();
        t += LINK;
      }
      carry = t - d;
    }

    // trolley
    const tw = Math.max(46, S * 0.9);
    ctx.fillStyle = INK; roundRect(trolley.x - tw / 2, RAIL - 12, tw, 22, 6); ctx.fill();
    ctx.fillStyle = "#e9e9e6"; ctx.fillRect(trolley.x - tw / 2 + 6, RAIL - 6, tw - 12, 2);
    ctx.fillStyle = SIGNAL; ctx.beginPath(); ctx.arc(trolley.x + tw / 2 - 9, RAIL + 3, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#e9e9e6"; ctx.beginPath(); ctx.arc(trolley.x, ay - 2, 3, 0, Math.PI * 2); ctx.fill();

    // claw
    const last = pts[N - 1], prev = pts[N - 2];
    const ang = Math.atan2(-(last.x - prev.x), last.y - prev.y);
    ctx.save(); ctx.translate(last.x, last.y); ctx.rotate(ang);
    const hw = S * 0.3, hh = S * 0.24;
    // arms
    const o = claw.open;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const side of [-1, 1]) {
      const sx = side * hw * 0.62, sy = hh * 0.85;
      const a1 = side * (0.18 + o * 0.55);                         // outward swing
      const L1 = S * 0.3, L2 = S * 0.32;
      const ex = sx + Math.sin(a1) * L1, ey = sy + Math.cos(a1) * L1;
      const a2 = a1 - side * (0.95 + (1 - o) * 0.25);              // finger curls in
      const fx2 = ex + Math.sin(a2) * L2, fy2 = ey + Math.cos(a2) * L2;
      ctx.strokeStyle = INK; ctx.lineWidth = Math.max(4, S * 0.085);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(fx2, fy2); ctx.stroke();
      ctx.strokeStyle = "#5c5c58"; ctx.lineWidth = Math.max(1.4, S * 0.025);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = SIGNAL; ctx.beginPath(); ctx.arc(fx2, fy2, Math.max(2.5, S * 0.045), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e9e9e6"; ctx.beginPath(); ctx.arc(ex, ey, Math.max(1.6, S * 0.025), 0, Math.PI * 2); ctx.fill();
    }
    // hub
    ctx.fillStyle = BODY; roundRect(-hw, 0, hw * 2, hh, Math.min(10, hh * 0.45)); ctx.fill();
    ctx.fillStyle = "#e9e9e6"; ctx.fillRect(-hw + 6, hh * 0.32, hw * 2 - 22, 2);
    ctx.fillStyle = mode === "follow" ? SIGNAL : "#b6ff5a";
    ctx.beginPath(); ctx.arc(hw - 9, hh * 0.38, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = INK; ctx.fillRect(-4, -6, 8, 8);
    ctx.restore();

    // aim line (follow mode): faint dotted line to the floor under the claw
    if (mode === "follow" && pointer.seen) {
      const g = grip();
      ctx.strokeStyle = "rgba(17,17,17,0.22)"; ctx.lineWidth = 1; ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.moveTo(g.x, g.y + S * 0.2); ctx.lineTo(g.x, H - 38); ctx.stroke(); ctx.setLineDash([]);
    }

    // prizes (DOM)
    for (const p of prizes) {
      p.el.style.transform = `translate(${p.x - S / 2}px, ${p.y - S / 2}px) rotate(${p.rot}deg) scale(${p.scale})`;
    }
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- loop ----------
  let last = performance.now(), acc = 0;
  const DT = 1 / 120;
  function frame(t) {
    acc += Math.min(0.1, (t - last) / 1000); last = t;
    while (acc >= DT) { step(DT); acc -= DT; }
    draw();
    requestAnimationFrame(frame);
  }
  addEventListener("resize", layout);
  layout();
  prizes.forEach((p) => { p.y = p.hy - H; p.falling = true; p.vy = rnd(p.i) * 400; p.vr = 0; });   // intro: the pile drops in
  requestAnimationFrame(frame);
})();
