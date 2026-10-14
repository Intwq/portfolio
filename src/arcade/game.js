// ARCADE: a pixel-art claw machine. Everything mechanical is drawn into low-resolution pixel
// buffers and scaled up with hard edges. A trolley rides an I-beam, a verlet-simulated chain hangs
// from it, and the claw follows the pointer. Click a prize: the claw drops, grabs, lifts, the prize
// shakes in golden light and opens into the project window. Close (×) and it is dropped back.
(() => {
  const DATA = window.ARCADE || [];
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const bgC = $("#bg"), bgX = bgC.getContext("2d");
  const rigC = $("#rig"), rigX = rigC.getContext("2d");
  const pit = $("#pit"), fx = $("#fx"), win = $("#win"), winBody = $("#win-body"), winTitle = $("#win-title");
  const hint = $("[data-hint]");
  const DEFAULT_HINT = "Move to aim · Click a prize to grab it";

  // ---------- colours (ABGR for the pixel buffers) ----------
  const rgb = (h) => { const n = parseInt(h.slice(1), 16); return (255 << 24 | (n & 255) << 16 | (n >> 8 & 255) << 8 | n >> 16) >>> 0; };
  const P = Object.fromEntries(Object.entries({
    out: "#0a0814", s0: "#2a2846", s1: "#56597e", s2: "#9aa2c2", s3: "#eef2ff",
    d0: "#120f22", d1: "#25213d", d2: "#3f3a5e", red: "#e0263f", red2: "#ff8a9a", ora: "#ff6a14", ora2: "#ffc27a",
    cyan: "#22e4ff", cyanD: "#0f3550", yel: "#f0b000", gold: "#fff0a0", ceil: "#241e48", ceil2: "#3a3470",
  }).map(([k, v]) => [k, rgb(v)]));

  let W = 0, H = 0, PX = 2, LW = 0, LH = 0, S = 104, RAIL = 64, FLOOR = 34, U = 1;
  let rigImg = null, rig = null;
  const pointer = { x: 0, y: 0, seen: false };
  const trolley = { x: 0, v: 0, tx: 0 };
  const N = 18;
  const pts = Array.from({ length: N }, () => ({ x: 0, y: 0, px: 0, py: 0 }));
  let len = 160, lenT = 160;
  const claw = { open: 1, openT: 1 };
  let mode = "follow";
  let held = null, timer = 0, current = null, clock = 0, clawAng = 0;

  const prizes = $$(".prize", pit).map((el, i) => ({
    el, i, slug: el.dataset.slug, d: DATA.find((d) => d.slug === el.dataset.slug),
    x: 0, y: 0, hx: 0, hy: 0, vy: 0, falling: false, scale: 1,
  }));
  const rnd = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const anchorY = () => RAIL + 16 * PX;

  // ---------- pixel helpers (work on a Uint32 buffer of size LW x LH) ----------
  function makeBuf(w, h) { const img = new ImageData(w, h); return { img, u: new Uint32Array(img.data.buffer), w, h }; }
  const pset = (b, x, y, c) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < b.w && y < b.h) b.u[y * b.w + x] = c; };
  const rect = (b, x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pset(b, x + i, y + j, c); };
  const disc = (b, cx, cy, r, c) => { const R = Math.ceil(r); for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) if (i * i + j * j <= r * r + 0.3) pset(b, Math.round(cx) + i, Math.round(cy) + j, c); };
  function thick(b, x0, y0, x1, y1, r, c) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k <= n; k++) disc(b, x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, r, c);
  }
  function line(b, x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
    for (;;) { pset(b, x0, y0, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
  }
  function poly(b, pts, c) {
    let y0 = Infinity, y1 = -Infinity;
    pts.forEach((p) => { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      const xs = [], yc = y + 0.5;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > yc) !== (yj > yc)) xs.push(xi + (yc - yi) * (xj - xi) / (yj - yi));
      }
      xs.sort((a, b2) => a - b2);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) pset(b, x, y, c);
    }
  }
  function outline(b, x0, y0, x1, y1) {   // hard black outline around everything drawn in the box
    x0 = Math.max(1, x0 | 0); y0 = Math.max(1, y0 | 0); x1 = Math.min(b.w - 2, x1 | 0); y1 = Math.min(b.h - 2, y1 | 0);
    const u = b.u, w = b.w, mark = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (u[i]) continue;
      if (u[i - 1] || u[i + 1] || u[i - w] || u[i + w]) mark.push(i);
    }
    mark.forEach((i) => { u[i] = P.out; });
  }

  // ---------- static background: night sky, skyline, gantry, floor ----------
  function drawBackground() {
    const b = makeBuf(LW, LH);
    const bands = ["#221651", "#1d1446", "#18113b", "#140e31", "#110c28", "#0e0a21", "#0b0919"].map(rgb);
    const BAY = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    for (let y = 0; y < LH; y++) {
      const t = (y / LH) * (bands.length - 1), k = Math.floor(t), f = t - k;
      for (let x = 0; x < LW; x++) b.u[y * LW + x] = bands[Math.min(bands.length - 1, k + (f * 16 > BAY[y & 3][x & 3] ? 1 : 0))];
    }
    // stars
    for (let k = 0; k < LW * LH / 520; k++) {
      const x = rnd(k) * LW, y = rnd(k + 999) * LH * 0.62;
      pset(b, x, y, rnd(k + 5) > 0.85 ? P.s3 : rgb("#6f68a8"));
      if (rnd(k + 7) > 0.97) { pset(b, x + 1, y, rgb("#6f68a8")); pset(b, x - 1, y, rgb("#6f68a8")); pset(b, x, y + 1, rgb("#6f68a8")); pset(b, x, y - 1, rgb("#6f68a8")); }
    }
    // moon
    const mx = Math.round(LW * 0.2), my = Math.round(LH * 0.3), mr = Math.max(10, Math.round(LH * 0.07));
    disc(b, mx, my, mr + 2, rgb("#2b1f5c"));
    disc(b, mx, my, mr, rgb("#f3d9ff"));
    disc(b, mx + mr * 0.35, my - mr * 0.1, mr * 0.95, rgb("#c9a8f0"));
    disc(b, mx + mr * 0.5, my - mr * 0.15, mr * 0.9, rgb("#221651"));
    // skyline (two layers)
    const floorTop = Math.round((H - FLOOR) / PX);
    const skyTop = Math.round(LH * 0.46);
    for (const layer of [{ c: rgb("#1c1742"), win: 0, min: 0.25, max: 0.85, seed: 1 }, { c: rgb("#130f2e"), win: 1, min: 0.1, max: 0.6, seed: 2 }]) {
      let x = -4, k = layer.seed * 100;
      while (x < LW) {
        const w = 8 + Math.floor(rnd(k++) * 18), h = Math.round((floorTop - skyTop) * (layer.min + rnd(k++) * (layer.max - layer.min)));
        const top = floorTop - h;
        rect(b, x, top, w, h, layer.c);
        if (rnd(k++) > 0.6) rect(b, x + Math.floor(w / 2), top - 4, 1, 4, layer.c);       // antenna
        if (layer.win) for (let yy = top + 3; yy < floorTop - 2; yy += 4) for (let xx = x + 2; xx < x + w - 2; xx += 3)
          if (rnd(xx * 7 + yy * 13) > 0.78) pset(b, xx, yy, [P.cyan, rgb("#ff3fb4"), P.yel, rgb("#6f68a8")][Math.floor(rnd(xx + yy) * 4)]);
        x += w + Math.floor(rnd(k++) * 4);
      }
    }
    // floor: steel grate with a neon edge
    rect(b, 0, floorTop, LW, LH - floorTop, rgb("#16122e"));
    for (let x = 0; x < LW; x += 6) rect(b, x, floorTop + 3, 1, LH - floorTop, rgb("#0c0a1c"));
    rect(b, 0, floorTop, LW, 1, P.cyan);
    rect(b, 0, floorTop + 1, LW, 1, P.cyanD);
    // ceiling + hangers + I-beam
    const RL = Math.round(RAIL / PX);
    rect(b, 0, 0, LW, 6, P.ceil); rect(b, 0, 6, LW, 1, P.ceil2); rect(b, 0, 7, LW, 1, P.out);
    for (let x = 6; x < LW; x += 12) pset(b, x, 3, P.ceil2);
    for (let x = 30; x < LW - 10; x += 70) {
      rect(b, x - 1, 8, 3, RL - 13, P.s1); rect(b, x - 1, 8, 1, RL - 13, P.s2);
      rect(b, x - 3, 8, 7, 2, P.s2); rect(b, x - 3, RL - 7, 7, 2, P.s1);
    }
    rect(b, 0, RL - 6, LW, 1, P.out);
    rect(b, 0, RL - 5, LW, 1, P.s3); rect(b, 0, RL - 4, LW, 1, P.s2);              // top flange
    rect(b, 0, RL - 3, LW, 6, P.s1);                                               // web
    for (let x = 4; x < LW; x += 10) { pset(b, x, RL - 1, P.s2); pset(b, x, RL, P.s0); }
    rect(b, 0, RL + 3, LW, 1, P.s2); rect(b, 0, RL + 4, LW, 1, P.s0);              // bottom flange
    rect(b, 0, RL + 5, LW, 1, P.out);
    rect(b, 0, RL + 6, LW, 1, P.cyanD);
    for (const x0 of [0, LW - 16]) for (let i = 0; i < 16; i++) for (let j = 0; j < 6; j++)
      pset(b, x0 + i, RL - 3 + j, ((i + j) >> 2) % 2 ? P.yel : P.out);              // hazard ends
    bgC.width = LW; bgC.height = LH;
    bgX.putImageData(b.img, 0, 0);
  }

  // ---------- dynamic rig: trolley, chain, claw ----------
  function drawRig() {
    const b = rig; b.u.fill(0);
    const RL = Math.round(RAIL / PX), tx = Math.round(trolley.x / PX);
    let bx0 = tx - 16, bx1 = tx + 16, by0 = RL - 12, by1 = RL + 20;

    // chain
    let carry = 0, n = 0;
    for (let i = 0; i < N - 1; i++) {
      const ax = pts[i].x / PX, ay = pts[i].y / PX, cx = pts[i + 1].x / PX, cy = pts[i + 1].y / PX;
      const d = Math.hypot(cx - ax, cy - ay) || 0.001;
      let t = carry;
      while (t < d) {
        const x = Math.round(ax + (cx - ax) * t / d), y = Math.round(ay + (cy - ay) * t / d);
        if (n++ % 2) { pset(b, x, y, P.s3); pset(b, x, y + 1, P.s2); }
        else { pset(b, x - 1, y, P.s2); pset(b, x + 1, y, P.s1); pset(b, x, y - 1, P.s2); pset(b, x, y + 1, P.s1); }
        bx0 = Math.min(bx0, x - 3); bx1 = Math.max(bx1, x + 3); by1 = Math.max(by1, y + 3);
        t += 3;
      }
      carry = t - d;
    }

    // trolley: wheels on the top flange, body hanging under the beam
    const spin = Math.round(trolley.x / PX) % 4;
    for (const wx of [tx - 7, tx + 7]) {
      disc(b, wx, RL - 8, 2.6, P.d1); pset(b, wx, RL - 8, P.s2);
      pset(b, wx + [1, 0, -1, 0][spin], RL - 8 + [0, 1, 0, -1][spin], P.s3);
    }
    rect(b, tx - 9, RL - 6, 2, 12, P.s0); rect(b, tx + 8, RL - 6, 2, 12, P.s0);    // side plates
    rect(b, tx - 12, RL + 6, 25, 8, P.s1);
    rect(b, tx - 12, RL + 6, 25, 1, P.s3); rect(b, tx - 12, RL + 7, 1, 7, P.s2); rect(b, tx + 12, RL + 7, 1, 7, P.s0);
    for (let i = 0; i < 25; i++) pset(b, tx - 12 + i, RL + 13, (i >> 1) % 2 ? P.yel : P.out);   // hazard band
    const blink = (clock * 2 | 0) % 2 === 0 || mode !== "follow";
    rect(b, tx + 7, RL + 9, 3, 2, blink ? (mode === "follow" ? P.red : P.cyan) : P.d2);
    rect(b, tx - 9, RL + 9, 10, 2, P.d1);                                           // vent
    for (let i = 0; i < 10; i += 2) pset(b, tx - 9 + i, RL + 9, P.d2);
    rect(b, tx - 3, RL + 14, 7, 3, P.d1); rect(b, tx - 2, RL + 14, 5, 1, P.ora);    // spool

    // claw
    const last = pts[N - 1], prev = pts[N - 2];
    const raw = Math.atan2(-(last.x - prev.x), last.y - prev.y);
    clawAng += (Math.max(-0.45, Math.min(0.45, raw)) - clawAng) * 0.25;          // heavy claw: tilts, never flips
    const ang = clawAng, cs = Math.cos(ang), sn = Math.sin(ang);
    const ox = last.x / PX, oy = last.y / PX;
    const T = (lx, ly) => [ox + (lx * U) * cs - (ly * U) * sn, oy + (lx * U) * sn + (ly * U) * cs];
    const o = claw.open;
    const arm = (side, back) => {
      const sh = [side * 7, 13];
      const a1 = side * (0.22 + o * 0.72), L1 = back ? 6 : 9;
      const el = [sh[0] + Math.sin(a1) * L1, sh[1] + Math.cos(a1) * L1];
      const a2 = a1 - side * (1.05 + (1 - o) * 0.35), L2 = back ? 6 : 9;
      const tp = [el[0] + Math.sin(a2) * L2, el[1] + Math.cos(a2) * L2];
      const [s0x, s0y] = T(...sh), [e0x, e0y] = T(...el), [t0x, t0y] = T(...tp);
      thick(b, s0x, s0y, e0x, e0y, 1.4 * U, back ? P.s0 : P.s2);
      if (!back) line(b, s0x, s0y, e0x, e0y, P.s3);
      thick(b, e0x, e0y, t0x, t0y, 1.1 * U, back ? P.d1 : P.s1);
      disc(b, e0x, e0y, 1.8 * U, back ? P.d1 : P.d2); pset(b, e0x, e0y, P.s2);
      disc(b, t0x, t0y, 1.1 * U, back ? P.red : P.ora); pset(b, t0x, t0y, back ? P.red : P.ora2);
      bx0 = Math.min(bx0, t0x - 4, e0x - 4); bx1 = Math.max(bx1, t0x + 4, e0x + 4); by1 = Math.max(by1, t0y + 4, e0y + 4);
    };
    arm(0.55, true);                                                   // back prong (behind the hub)
    poly(b, [T(-2, -1), T(2, -1), T(2, 3), T(-2, 3)], P.d1);           // neck
    poly(b, [T(-9, 3), T(9, 3), T(11, 6), T(11, 11), T(8, 14), T(-8, 14), T(-11, 11), T(-11, 6)], P.s1);   // hub
    poly(b, [T(-9, 3), T(9, 3), T(10, 5), T(-10, 5)], P.s3);
    poly(b, [T(-11, 11), T(11, 11), T(8, 14), T(-8, 14)], P.s0);
    poly(b, [T(-7, 7), T(7, 7), T(7, 9.6), T(-7, 9.6)], P.out);        // visor
    const eye = mode === "follow" ? P.red : mode === "open" ? P.gold : P.cyan;
    poly(b, [T(-6, 7.6), T(6, 7.6), T(6, 9), T(-6, 9)], eye);
    const scan = Math.round(((clock * 6) % 12) - 6);
    const [ex, ey] = T(scan, 8.2); pset(b, ex, ey, mode === "follow" ? P.red2 : P.s3);
    poly(b, [T(-13, 6), T(-11, 6), T(-11, 10), T(-13, 10)], P.d2);
    poly(b, [T(11, 6), T(13, 6), T(13, 10), T(11, 10)], P.d2);
    arm(-1, false); arm(1, false);
    bx0 = Math.min(bx0, ox - 20 * U); bx1 = Math.max(bx1, ox + 20 * U); by1 = Math.max(by1, oy + 20 * U); by0 = Math.min(by0, oy - 4);

    outline(b, bx0 - 2, by0 - 2, bx1 + 2, by1 + 2);
    rigX.putImageData(b.img, 0, 0);
  }

  // ---------- layout ----------
  function layout() {
    W = innerWidth; H = innerHeight;
    PX = W >= 1800 ? 3 : 2;
    const css = getComputedStyle(document.documentElement);
    RAIL = parseFloat(css.getPropertyValue("--rail")) || 64;
    FLOOR = parseFloat(css.getPropertyValue("--floor")) || 34;
    LW = Math.ceil(W / PX); LH = Math.ceil(H / PX);
    for (const c of [bgC, rigC]) { c.style.width = LW * PX + "px"; c.style.height = LH * PX + "px"; }
    rigC.width = LW; rigC.height = LH; rig = makeBuf(LW, LH);

    const n = prizes.length, margin = W < 700 ? 10 : 36, room = (H - FLOOR - RAIL - 140) * 0.66;
    let cols, rows, cell;
    const fits = (s) => { cell = s * 1.06; cols = Math.max(3, Math.floor((W - margin * 2 - s) / cell) + 1); rows = Math.ceil(n / cols); return rows * s * 0.84 + s * 0.3 < room; };
    S = W >= 900 && fits(156) ? 156 : W >= 700 && fits(104) ? 104 : 52;
    fits(S);
    U = Math.max(0.9, (S / PX) / 40);
    document.documentElement.style.setProperty("--s", S + "px");
    const floorY = H - FLOOR, rowH = S * 0.84;
    prizes.forEach((p, k) => {
      const r = Math.floor(k / cols), c = k % cols;
      const inRow = Math.min(cols, n - r * cols);
      const x0 = (W - (inRow - 1) * cell) / 2 + (r % 2 ? cell * 0.22 : 0);
      p.hx = Math.round(Math.max(margin + S / 2, Math.min(W - margin - S / 2, x0 + c * cell + (rnd(k) - 0.5) * cell * 0.18)));
      p.hy = Math.round(floorY - S * 0.46 - r * rowH - rnd(k + 9) * S * 0.08);
      if (p !== held && !p.falling && current !== p) { p.x = p.hx; p.y = p.hy; }
      p.el.style.zIndex = String(100 - r);
    });
    if (!pointer.seen) { pointer.x = W * 0.5; pointer.y = Math.max(anchorY() + 140, H * 0.32); }
    if (!trolley.x) { trolley.x = trolley.tx = pointer.x; pts.forEach((p, i) => { p.x = p.px = trolley.x; p.y = p.py = anchorY() + (len * i) / (N - 1); }); }
    drawBackground();
  }

  // ---------- input ----------
  const machine = $("#machine");
  const setPointer = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.seen = true; };
  addEventListener("pointermove", setPointer, { passive: true });
  addEventListener("pointerdown", setPointer, { passive: true });
  const say = (t) => { hint.textContent = t; };

  prizes.forEach((p) => {
    p.el.addEventListener("click", (e) => { e.stopPropagation(); grab(p); });
    const over = () => { if (mode === "follow") say(`▶ ${p.d.title}${p.d.year ? " · " + p.d.year : ""}`); };
    p.el.addEventListener("pointerenter", over); p.el.addEventListener("focus", over);
    p.el.addEventListener("pointerleave", () => { if (mode === "follow") say(DEFAULT_HINT); });
  });

  // ---------- sound (tiny square-wave synth, off by default) ----------
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
  const fanfare = () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => beep(f, 0.12, "square", 0.045, i * 0.08));

  // ---------- grab sequence ----------
  function grab(p) {
    if (mode !== "follow" || p.falling || !win.hidden) return;
    current = p; mode = "seek"; timer = 0; claw.openT = 1;
    say(`Grabbing ${p.d.title}…`);
    beep(440, 0.05); beep(660, 0.05, "square", 0.04, 0.06);
  }
  const gripOffset = () => 24 * U * PX;
  function grip() {
    const a = pts[N - 1];
    return { x: a.x - Math.sin(clawAng) * gripOffset(), y: a.y + Math.cos(clawAng) * gripOffset() };
  }

  const cache = {};
  const load = (slug) => cache[slug] || (cache[slug] = fetch(`p/${slug}.html`).then((r) => r.text()).catch(() => `<p class="win-load">Couldn't load this project.</p>`));
  function openWindow(d, ox, oy) {
    win.hidden = false;
    win.style.setProperty("--ox", `${ox - (W - win.offsetWidth) / 2}px`);
    win.style.setProperty("--oy", `${oy - (H - win.offsetHeight) / 2}px`);
    win.classList.add("closed");
    winTitle.textContent = `${String(d.n).padStart(2, "0")} / ${d.title}`;
    winBody.innerHTML = `<p class="win-load">Loading…</p>`;
    winBody.scrollTop = 0;
    win.dataset.slug = d.slug;
    requestAnimationFrame(() => requestAnimationFrame(() => win.classList.remove("closed")));
    load(d.slug).then((html) => { if (win.dataset.slug === d.slug) { winBody.innerHTML = html; animateCharts(); } });
    setTimeout(() => $("[data-close]", win).focus({ preventScroll: true }), 300);
  }
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
    setTimeout(() => { win.hidden = true; winBody.innerHTML = ""; delete win.dataset.slug; }, 420);
    if (fromIndex) { fromIndex = false; say(DEFAULT_HINT); return; }
    if (current) { current.el.classList.remove("shake"); mode = "stow"; timer = 0; say("Returning prize…"); }
  }
  $("[data-close]", win).addEventListener("click", closeWindow);
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeWindow(); });

  // ---------- index drawer ----------
  const drawer = $("#drawer"), tab = $(".tab", drawer);
  const setDrawer = (o) => { drawer.classList.toggle("open", o); tab.setAttribute("aria-expanded", String(o)); };
  tab.addEventListener("click", () => setDrawer(!drawer.classList.contains("open")));
  machine.addEventListener("pointerdown", () => setDrawer(false));
  $$("[data-open]", drawer).forEach((b) => b.addEventListener("click", () => {
    if (mode !== "follow" || !win.hidden) return;
    const d = DATA.find((x) => x.slug === b.dataset.open), r = b.getBoundingClientRect();
    setDrawer(false); fromIndex = true; beep(660, 0.06);
    openWindow(d, r.left + 26, r.top + r.height / 2);
  }));

  // ---------- clock ----------
  const clk = $("[data-clock]");
  const tickClock = () => { clk.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); };
  tickClock(); setInterval(tickClock, 1000);

  // ---------- simulation ----------
  const G = 2600;
  function step(dt) {
    clock += dt;
    const ay = anchorY();
    const minL = 6 * PX, maxL = H - FLOOR - ay - gripOffset() - S * 0.2;
    if (mode === "follow") {
      trolley.tx = Math.max(20 * PX, Math.min(W - 20 * PX, pointer.x));
      lenT = Math.max(minL, Math.min(maxL, pointer.y - ay - gripOffset()));
      claw.openT = 1;
    } else if (mode === "seek") {
      const p = current;
      trolley.tx = p.x;
      const near = Math.abs(trolley.x - p.x) < 6 && Math.abs(trolley.v) < 60;
      lenT = near ? Math.max(minL, p.y - ay - gripOffset() + S * 0.05) : Math.min(len, minL + 40);
      const g = grip();
      if (near && Math.abs(len - lenT) < 3 && Math.abs(g.x - p.x) < S * 0.25) { mode = "grab"; timer = 0; claw.openT = 0; beep(200, 0.12, "sawtooth", 0.04); }
      if ((timer += dt) > 6) { mode = "grab"; timer = 0; claw.openT = 0; }
    } else if (mode === "grab") {
      if ((timer += dt) > 0.3) { held = current; held.el.classList.add("held"); mode = "lift"; timer = 0; beep(520, 0.05); }
    } else if (mode === "lift") {
      lenT = minL + 20; timer += dt;
      if (len - lenT < 40) trolley.tx = W / 2;
      if ((timer > 0.6 && Math.abs(trolley.x - W / 2) < 10 && Math.abs(len - lenT) < 4) || timer > 5) { mode = "reveal"; timer = 0; startReveal(); }
    } else if (mode === "reveal") {
      timer += dt;
      const cx = W / 2, cy = Math.max(anchorY() + S * 1.6, H * 0.44), k = Math.min(1, timer / 0.5), e = 1 - Math.pow(1 - k, 3);
      const g = grip();
      current.x = g.x + (cx - g.x) * e; current.y = g.y + (cy - g.y) * e; current.scale = 1 + e * (S < 100 ? 1.6 : 0.9);
      fx.style.transform = `translate(${current.x}px, ${current.y}px)`;
      if (timer > (reduce ? 0.4 : 1.4) && win.hidden) { mode = "open"; openWindow(current.d, current.x, current.y); current.el.style.opacity = "0"; }
    } else if (mode === "open") {
      lenT = minL + 20; trolley.tx = W / 2;
    } else if (mode === "stow") {
      timer += dt;
      const g = grip(), k = Math.min(1, timer / 0.45), e = k * k;
      current.el.style.opacity = "1";
      current.x += (g.x - current.x) * e; current.y += (g.y - current.y) * e; current.scale += (1 - current.scale) * e;
      if (k >= 1) { current.el.classList.remove("show"); held = current; mode = "return"; timer = 0; }
    } else if (mode === "return") {
      lenT = minL + 20; trolley.tx = held.hx; timer += dt;
      if ((Math.abs(trolley.x - held.hx) < 6 && Math.abs(trolley.v) < 80) || timer > 5) { mode = "release"; timer = 0; claw.openT = 1; beep(300, 0.06); }
    } else if (mode === "release") {
      if ((timer += dt) > 0.2) {
        const p = held; held = null;
        p.el.classList.remove("held", "show"); p.falling = true; p.vy = 0;
        current = null; mode = "follow"; say(DEFAULT_HINT);
      }
    }

    const stiff = mode === "follow" ? 95 : 55, damp = mode === "follow" ? 16 : 13;
    trolley.v += ((trolley.tx - trolley.x) * stiff - trolley.v * damp) * dt;
    trolley.v = Math.max(-2600, Math.min(2600, trolley.v));
    trolley.x += trolley.v * dt;

    const speed = mode === "follow" ? 2200 : mode === "seek" ? 620 : 900, dl = lenT - len;
    len += Math.sign(dl) * Math.min(Math.abs(dl), speed * dt, Math.abs(dl) * 12 * dt + 2);

    const rest = len / (N - 1);
    pts[0].x = trolley.x; pts[0].y = ay;
    for (let i = 1; i < N; i++) {
      const p = pts[i], vx = (p.x - p.px) * 0.985, vy = (p.y - p.py) * 0.985;
      p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + G * dt * dt;
    }
    const wLast = held ? 0.12 : 0.22;
    for (let it = 0; it < 14; it++) {
      for (let i = 0; i < N - 1; i++) {
        const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.0001;
        const wa = i === 0 ? 0 : 1, wb = i + 1 === N - 1 ? wLast : 1, diff = (d - rest) / d / (wa + wb);
        a.x += dx * diff * wa; a.y += dy * diff * wa; b.x -= dx * diff * wb; b.y -= dy * diff * wb;
      }
      pts[0].x = trolley.x; pts[0].y = ay;
    }
    claw.open += (claw.openT - claw.open) * Math.min(1, dt * 14);

    if (held && ["grab", "lift", "return", "release"].includes(mode)) { const g = grip(); held.x = g.x; held.y = g.y + S * 0.1; }
    prizes.forEach((p) => {
      if (!p.falling) return;
      p.vy += G * 0.8 * dt; p.y += p.vy * dt; p.x += (p.hx - p.x) * Math.min(1, dt * 6);
      if (p.y >= p.hy) {
        p.y = p.hy;
        if (Math.abs(p.vy) > 160) { p.vy *= -0.32; beep(120 + Math.abs(p.vy) * 0.2, 0.04, "triangle", 0.05); }
        else { p.falling = false; p.vy = 0; p.x = p.hx; }
      }
    });
  }
  function startReveal() {
    current.el.classList.add("show");
    if (!reduce) current.el.classList.add("shake");
    held = null;
    fx.style.transform = `translate(${current.x}px, ${current.y}px)`;
    fx.classList.add("on");
    say(`★ Prize: ${current.d.title}`); fanfare();
  }

  function draw() {
    drawRig();
    // prizes snap to the pixel grid so they stay crisp
    for (const p of prizes) {
      const x = Math.round((p.x - (S * p.scale) / 2) / PX) * PX, y = Math.round((p.y - (S * p.scale) / 2) / PX) * PX;
      p.el.style.transform = `translate(${x}px, ${y}px) scale(${p.scale})`;
      p.el.style.transformOrigin = "0 0";
    }
  }

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
  prizes.forEach((p) => { p.y = p.hy - H; p.falling = true; p.vy = rnd(p.i) * 500; });   // the pile drops in
  requestAnimationFrame(frame);
})();
