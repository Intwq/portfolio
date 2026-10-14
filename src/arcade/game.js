// ARCADE: a pixel-art claw machine. The rig (rail, trolley, chain, claw) is drawn into a
// low-resolution pixel buffer and scaled up with hard edges. Prizes are little rigid bodies that
// fall, bump, overlap and settle into a pile. Click a prize: the claw drops, grabs it out of the
// pile, lifts it, the prize shakes in golden light and opens into the project window.
// Close (×) and the claw carries it back and drops it onto the pile.
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
    out: "#1a1430",
    // rail + trolley: soft lilac-grey metal
    m0: "#7d7aa6", m1: "#a9a7cc", m2: "#d3d2ec", m3: "#ffffff",
    // claw: bubblegum pink + cream
    k0: "#c2457a", k1: "#ff7eb0", k2: "#ffb3d1", k3: "#ffe3ef",
    cream: "#fff6e6", cream2: "#f0dcc0",
    eye: "#1a1430", eyeHi: "#ffffff", blush: "#ff8fa8",
    mint: "#7ee0c4", mintD: "#3fae95", yel: "#ffd23f", yelD: "#e0a800", red: "#ff4d6d",
    chain0: "#8d8ab5", chain1: "#c9c7e6",
  }).map(([k, v]) => [k, rgb(v)]));

  let W = 0, H = 0, PX = 2, LW = 0, LH = 0, S = 104, RAIL = 64, FLOOR = 34, U = 1;
  let rig = null;
  const pointer = { x: 0, y: 0, seen: false };
  const trolley = { x: 0, v: 0, tx: 0 };
  const N = 16;
  const pts = Array.from({ length: N }, () => ({ x: 0, y: 0, px: 0, py: 0 }));
  let len = 160, lenT = 160;
  const claw = { open: 1, openT: 1 };
  let mode = "follow";
  let held = null, timer = 0, current = null, clock = 0, clawAng = 0, blinkT = 3;

  const prizes = $$(".prize", pit).map((el, i) => ({
    el, i, slug: el.dataset.slug, d: DATA.find((d) => d.slug === el.dataset.slug),
    x: 0, y: 0, vx: 0, vy: 0, scale: 1, dyn: true, sleep: 0, homeX: 0,
  }));
  const rnd = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const anchorY = () => RAIL + 13 * PX;

  // ---------- pixel helpers ----------
  function makeBuf(w, h) { const img = new ImageData(w, h); return { img, u: new Uint32Array(img.data.buffer), w, h }; }
  const pset = (b, x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < b.w && y < b.h) b.u[y * b.w + x] = c; };
  const rect = (b, x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pset(b, x + i, y + j, c); };
  const disc = (b, cx, cy, r, c) => { const R = Math.ceil(r); cx = Math.round(cx); cy = Math.round(cy); for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) if (i * i + j * j <= r * r + 0.3) pset(b, cx + i, cy + j, c); };
  function thick(b, x0, y0, x1, y1, r, c) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 0; k <= n; k++) disc(b, x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n, r, c);
  }
  function ellipseFill(b, cx, cy, rx, ry, ang, fill) {   // fill(lx, ly, nx, ny) -> colour; nx,ny = normalised position
    const R = Math.ceil(Math.max(rx, ry)) + 1, c = Math.cos(ang), s = Math.sin(ang);
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const lx = i * c + j * s, ly = -i * s + j * c;          // into the ellipse's frame
      const nx = lx / rx, ny = ly / ry;
      if (nx * nx + ny * ny <= 1) pset(b, cx + i, cy + j, fill(lx, ly, nx, ny));
    }
  }
  function outline(b, x0, y0, x1, y1) {
    x0 = Math.max(1, x0 | 0); y0 = Math.max(1, y0 | 0); x1 = Math.min(b.w - 2, x1 | 0); y1 = Math.min(b.h - 2, y1 | 0);
    const u = b.u, w = b.w, mark = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * w + x;
      if (!u[i] && (u[i - 1] || u[i + 1] || u[i - w] || u[i + w])) mark.push(i);
    }
    mark.forEach((i) => { u[i] = P.out; });
  }

  // ---------- static background: soft sky, a few clouds, rail, floor ----------
  function drawBackground() {
    const b = makeBuf(LW, LH);
    const bands = ["#dff0ff", "#e6f0ff", "#ecf0ff", "#f2f0fd", "#f8f1f9", "#fdf2f4"].map(rgb);
    const BAY = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
    for (let y = 0; y < LH; y++) {
      const t = (y / LH) * (bands.length - 1), k = Math.floor(t), f = t - k;
      for (let x = 0; x < LW; x++) b.u[y * LW + x] = bands[Math.min(bands.length - 1, k + (f * 16 > BAY[y & 3][x & 3] ? 1 : 0))];
    }
    // three soft pixel clouds
    const cloud = (cx, cy, s) => {
      const blobs = [[0, 0, 1], [-1.1, 0.35, 0.7], [1.1, 0.3, 0.75], [-0.4, -0.45, 0.65], [0.5, -0.35, 0.7]];
      blobs.forEach(([dx, dy, r]) => disc(b, cx + dx * s, cy + dy * s, r * s, rgb("#ffffff")));
      rect(b, cx - 1.6 * s, cy + 0.6 * s, 3.2 * s, 1, rgb("#d9e6fb"));
    };
    cloud(LW * 0.18, LH * 0.3, Math.max(6, LH * 0.028));
    cloud(LW * 0.62, LH * 0.2, Math.max(5, LH * 0.022));
    cloud(LW * 0.86, LH * 0.42, Math.max(4, LH * 0.018));
    // floor: a clean tiled ledge
    const floorTop = Math.round((H - FLOOR) / PX);
    rect(b, 0, floorTop, LW, LH - floorTop, rgb("#efe7fb"));
    for (let x = 0; x < LW; x += 12) rect(b, x, floorTop + 3, 1, LH - floorTop, rgb("#e2d8f5"));
    rect(b, 0, floorTop, LW, 1, P.out);
    rect(b, 0, floorTop + 1, LW, 2, P.k2);
    // rail: rounded lilac beam with little bolts, two soft hangers per 160px
    const RL = Math.round(RAIL / PX);
    for (let x = 40; x < LW - 20; x += 120) { rect(b, x - 1, 0, 3, RL - 4, P.m1); rect(b, x - 1, 0, 1, RL - 4, P.m2); }
    rect(b, 0, RL - 5, LW, 1, P.out);
    rect(b, 0, RL - 4, LW, 1, P.m3);
    rect(b, 0, RL - 3, LW, 6, P.m2);
    rect(b, 0, RL + 2, LW, 2, P.m1);
    rect(b, 0, RL + 4, LW, 1, P.out);
    for (let x = 6; x < LW; x += 14) { pset(b, x, RL - 1, P.m1); pset(b, x, RL - 2, P.m3); }
    bgC.width = LW; bgC.height = LH;
    bgX.putImageData(b.img, 0, 0);
  }

  // ---------- dynamic rig: trolley, chain, cute claw ----------
  function drawRig() {
    const b = rig; b.u.fill(0);
    const RL = Math.round(RAIL / PX), tx = Math.round(trolley.x / PX);
    let bx0 = tx - 18, bx1 = tx + 18, by0 = RL - 12, by1 = RL + 20;

    // chain: alternating round beads
    let carry = 0, n = 0;
    for (let i = 0; i < N - 1; i++) {
      const ax = pts[i].x / PX, ay = pts[i].y / PX, cx = pts[i + 1].x / PX, cy = pts[i + 1].y / PX;
      const d = Math.hypot(cx - ax, cy - ay) || 0.001;
      let t = carry;
      while (t < d) {
        const x = ax + (cx - ax) * t / d, y = ay + (cy - ay) * t / d;
        if (n++ % 2) { pset(b, x, y, P.chain1); pset(b, x, y + 1, P.chain0); }
        else { disc(b, x, y, 1.2, P.chain0); pset(b, x - 0.5, y - 0.5, P.chain1); }
        bx0 = Math.min(bx0, x - 3); bx1 = Math.max(bx1, x + 3); by1 = Math.max(by1, y + 3);
        t += 3;
      }
      carry = t - d;
    }

    // trolley: a little rounded cart with two wheels and a mint lamp
    const spin = Math.round(trolley.x / PX) % 4;
    for (const wx of [tx - 7, tx + 7]) {
      disc(b, wx, RL - 7, 2.6, P.m0); pset(b, wx, RL - 7, P.m2);
      pset(b, wx + [1, 0, -1, 0][spin], RL - 7 + [0, 1, 0, -1][spin], P.m3);
    }
    ellipseFill(b, tx, RL + 8, 12, 5.5, 0, (lx, ly, nx, ny) => (ny < -0.45 ? P.m3 : ny > 0.55 ? P.m1 : P.m2));
    rect(b, tx - 9, RL - 5, 2, 9, P.m1); rect(b, tx + 8, RL - 5, 2, 9, P.m1);
    const lamp = mode === "follow" ? ((clock * 1.5 | 0) % 2 ? P.mint : P.mintD) : P.yel;
    disc(b, tx + 6, RL + 7, 1.6, lamp);
    pset(b, tx - 6, RL + 7, P.m1); pset(b, tx - 3, RL + 7, P.m1); pset(b, tx, RL + 7, P.m1);

    // cute claw
    const last = pts[N - 1], prev = pts[N - 2];
    const raw = Math.atan2(-(last.x - prev.x), last.y - prev.y);
    clawAng += (Math.max(-0.4, Math.min(0.4, raw)) - clawAng) * 0.25;
    const ang = clawAng, cs = Math.cos(ang), sn = Math.sin(ang);
    const ox = last.x / PX, oy = last.y / PX;
    const T = (lx, ly) => [ox + (lx * U) * cs - (ly * U) * sn, oy + (lx * U) * sn + (ly * U) * cs];
    const o = claw.open;

    const arm = (side) => {
      const sh = [side * 8.5, 9];
      const a1 = side * (0.15 + o * 0.6), L1 = 7.5;
      const el = [sh[0] + Math.sin(a1) * L1, sh[1] + Math.cos(a1) * L1];
      const a2 = a1 - side * (0.75 + (1 - o) * 0.5), L2 = 7;
      const tp = [el[0] + Math.sin(a2) * L2, el[1] + Math.cos(a2) * L2];
      const [sx, sy] = T(...sh), [ex, ey] = T(...el), [qx, qy] = T(...tp);
      thick(b, sx, sy, ex, ey, 1.8 * U, P.k1);
      thick(b, ex, ey, qx, qy, 1.6 * U, P.k1);
      disc(b, ex, ey, 1.6 * U, P.k2);
      disc(b, qx, qy, 2.4 * U, P.cream); pset(b, qx - U * 0.7, qy - U * 0.8, P.m3);       // mitten tip
      bx0 = Math.min(bx0, qx - 6, ex - 6); bx1 = Math.max(bx1, qx + 6, ex + 6); by1 = Math.max(by1, qy + 6, ey + 6);
    };
    arm(-1); arm(1);
    // antenna + bobble
    const [a0x, a0y] = T(0, -2), [a1x, a1y] = T(0, -6);
    thick(b, a0x, a0y, a1x, a1y, 0.6, P.k0);
    // round body
    ellipseFill(b, ox + (-0 * cs - 4 * sn) * U, oy + (0 * sn + 4 * cs) * U, 11 * U, 8.5 * U, ang, (lx, ly, nx, ny) => {
      const l = -nx * 0.45 - ny * 0.75;
      return l > 0.62 ? P.k3 : l > 0.05 ? P.k2 : ny > 0.7 ? P.k0 : P.k1;
    });
    // face plate
    const fcx = ox + (-0 * cs - 5 * sn) * U, fcy = oy + (0 * sn + 5 * cs) * U;
    ellipseFill(b, fcx, fcy, 7 * U, 4.6 * U, ang, (lx, ly, nx, ny) => (ny > 0.55 ? P.cream2 : P.cream));
    // eyes: blink, happy when holding, stars on the reveal
    blinkT -= 1 / 60;
    const blinking = blinkT < 0.12; if (blinkT < 0) blinkT = 2.5 + rnd(clock) * 3;
    for (const side of [-1, 1]) {
      const [ex, ey] = T(side * 3.4, 4.6);
      if (mode === "reveal" || mode === "open") {
        pset(b, ex, ey, P.yelD); pset(b, ex - 1, ey, P.yel); pset(b, ex + 1, ey, P.yel); pset(b, ex, ey - 1, P.yel); pset(b, ex, ey + 1, P.yel);
      } else if (held || blinking) {
        pset(b, ex - 1, ey, P.eye); pset(b, ex, ey - 1, P.eye); pset(b, ex + 1, ey, P.eye);                     // ^ ^
      } else {
        ellipseFill(b, ex, ey, Math.max(1.1, 1.05 * U), Math.max(1.6, 1.7 * U), ang, () => P.eye);   // tall shiny eyes
        pset(b, ex - 0.5, ey - U, P.eyeHi);
      }
      const [bxx, byy] = T(side * 5.6, 6.6);
      pset(b, bxx, byy, P.blush); pset(b, bxx + side, byy, P.blush);
    }
    const [mx, my] = T(0, 6.6);
    if (held || mode === "reveal" || mode === "open") { pset(b, mx - 1, my, P.k0); pset(b, mx, my + 1, P.k0); pset(b, mx + 1, my, P.k0); }
    else pset(b, mx, my, P.k0);
    disc(b, a1x, a1y, 1.8, mode === "follow" ? P.yel : P.mint);
    pset(b, a1x - 0.6, a1y - 0.6, P.m3);

    bx0 = Math.min(bx0, ox - 20 * U); bx1 = Math.max(bx1, ox + 20 * U); by1 = Math.max(by1, oy + 26 * U); by0 = Math.min(by0, oy - 12 * U);
    outline(b, bx0 - 2, by0 - 2, bx1 + 2, by1 + 2);
    rigX.putImageData(b.img, 0, 0);
  }

  // ---------- layout ----------
  function layout(first) {
    W = innerWidth; H = innerHeight;
    PX = W >= 1800 ? 3 : 2;
    const css = getComputedStyle(document.documentElement);
    RAIL = parseFloat(css.getPropertyValue("--rail")) || 64;
    FLOOR = parseFloat(css.getPropertyValue("--floor")) || 34;
    LW = Math.ceil(W / PX); LH = Math.ceil(H / PX);
    for (const c of [bgC, rigC]) { c.style.width = LW * PX + "px"; c.style.height = LH * PX + "px"; }
    rigC.width = LW; rigC.height = LH; rig = makeBuf(LW, LH);
    // prize size in whole pixel steps: big on wide screens, 1x on phones
    const n = prizes.length, perRow = (s) => Math.floor((W - 20) / (s * 0.82));
    const pileH = (s) => Math.ceil(n / perRow(s)) * s * 0.78;
    const room = (H - FLOOR - RAIL) * 0.55;
    S = W >= 700 && pileH(104) < room ? 104 : 52;
    U = Math.max(1, (S / PX) / 34);
    document.documentElement.style.setProperty("--s", S + "px");
    if (!pointer.seen) { pointer.x = W * 0.5; pointer.y = Math.max(anchorY() + 140, H * 0.32); }
    if (!trolley.x) { trolley.x = trolley.tx = pointer.x; pts.forEach((p, i) => { p.x = p.px = trolley.x; p.y = p.py = anchorY() + (len * i) / (N - 1); }); }
    if (first) {
      // drop the prizes in from above, shuffled, so the pile builds itself
      const order = prizes.map((p, i) => i).sort((a, b) => rnd(a + 40) - rnd(b + 40));
      order.forEach((idx, k) => {
        const p = prizes[idx];
        p.x = S * 0.5 + ((k * 0.618034) % 1) * (W - S) + (rnd(idx * 3 + 1) - 0.5) * S * 0.4;
        p.y = -S - k * S * 0.35;
        p.vx = 0; p.vy = 0; p.dyn = true; p.sleep = 0;
      });
    } else {
      prizes.forEach((p) => { p.sleep = 0; p.x = Math.max(S * 0.4, Math.min(W - S * 0.4, p.x)); });
    }
    drawBackground();
  }

  // ---------- pile physics: circles that overlap a little, with gravity, friction and sleep ----------
  const G = 2600;
  const radius = () => S * 0.34;          // smaller than the sprite, so neighbours overlap a bit
  const foot = () => S * 0.42;            // centre-to-floor distance
  function pilePhysics(dt) {
    const r = radius(), floorY = H - FLOOR, wallL = S * 0.36, wallR = W - S * 0.36;
    const live = prizes.filter((p) => p.dyn);
    for (const p of live) {
      if (p.sleep > 0.4) continue;
      p.vy += G * dt; p.vx *= 0.995;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let it = 0; it < 4; it++) {
      for (const p of live) {
        if (p.y > floorY - foot()) { p.y = floorY - foot(); if (p.vy > 0) p.vy = p.vy > 300 ? -p.vy * 0.18 : 0; p.vx *= 0.8; }
        if (p.x < wallL) { p.x = wallL; p.vx = Math.abs(p.vx) * 0.3; }
        if (p.x > wallR) { p.x = wallR; p.vx = -Math.abs(p.vx) * 0.3; }
      }
      for (let i = 0; i < prizes.length; i++) {
        const a = prizes[i];
        if (!a.dyn && a !== held) continue;
        for (let j = i + 1; j < prizes.length; j++) {
          const b = prizes[j];
          if (!b.dyn && b !== held) continue;
          if (!a.dyn && !b.dyn) continue;
          const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, min = r * 2;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, pen = min - d;
          const wa = a.dyn ? (b.dyn ? 0.5 : 1) : 0, wb = b.dyn ? (a.dyn ? 0.5 : 1) : 0;
          a.x -= nx * pen * wa; a.y -= ny * pen * wa; b.x += nx * pen * wb; b.y += ny * pen * wb;
          const rvx = b.vx - a.vx, rvy = b.vy - a.vy, vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            const jn = -(1.1 * vn) / ((a.dyn ? 1 : 0) + (b.dyn ? 1 : 0) || 1);
            if (a.dyn) { a.vx -= jn * nx; a.vy -= jn * ny; }
            if (b.dyn) { b.vx += jn * nx; b.vy += jn * ny; }
            // friction along the contact
            const tx = -ny, ty = nx, vt = rvx * tx + rvy * ty, jt = vt * 0.2;
            if (a.dyn) { a.vx += jt * tx; a.vy += jt * ty; }
            if (b.dyn) { b.vx -= jt * tx; b.vy -= jt * ty; }
          }
          if (pen > 1.5) { a.sleep = 0; b.sleep = 0; }
        }
      }
    }
    for (const p of live) {
      const sp = Math.hypot(p.vx, p.vy);
      p.sleep = sp < 18 ? p.sleep + dt : 0;
      if (p.sleep > 0.4) { p.vx = 0; p.vy = 0; }
    }
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
    if (mode !== "follow" || !win.hidden) return;
    current = p; p.homeX = p.x; mode = "seek"; timer = 0; claw.openT = 1;
    say(`Grabbing ${p.d.title}…`);
    beep(440, 0.05); beep(660, 0.05, "square", 0.04, 0.06);
  }
  const gripOffset = () => 19 * U * PX;
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
      lenT = near ? Math.max(minL, p.y - ay - gripOffset() + S * 0.04) : Math.min(len, minL + 40);
      const g = grip();
      if (near && Math.abs(len - lenT) < 3 && Math.abs(g.x - p.x) < S * 0.25) { mode = "grab"; timer = 0; claw.openT = 0; beep(200, 0.12, "sawtooth", 0.04); }
      if ((timer += dt) > 6) { mode = "grab"; timer = 0; claw.openT = 0; }
    } else if (mode === "grab") {
      if ((timer += dt) > 0.3) { held = current; held.dyn = false; held.el.style.zIndex = "900"; held.el.classList.add("held"); mode = "lift"; timer = 0; beep(520, 0.05); prizes.forEach((q) => { q.sleep = 0; }); }
    } else if (mode === "lift") {
      lenT = minL + 20; timer += dt;
      if (len - lenT < 40) trolley.tx = W / 2;
      if ((timer > 0.6 && Math.abs(trolley.x - W / 2) < 10 && Math.abs(len - lenT) < 4) || timer > 5) { mode = "reveal"; timer = 0; startReveal(); }
    } else if (mode === "reveal") {
      timer += dt;
      const cx = W / 2, cy = Math.max(anchorY() + S * 1.6, H * 0.42), k = Math.min(1, timer / 0.5), e = 1 - Math.pow(1 - k, 3);
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
      const dropX = Math.max(S, Math.min(W - S, held.homeX));
      lenT = minL + 20; trolley.tx = dropX; timer += dt;
      if ((Math.abs(trolley.x - dropX) < 6 && Math.abs(trolley.v) < 80) || timer > 5) { mode = "release"; timer = 0; claw.openT = 1; beep(300, 0.06); }
    } else if (mode === "release") {
      if ((timer += dt) > 0.2) {
        const p = held; held = null;
        p.el.classList.remove("held", "show"); p.dyn = true; p.sleep = 0; p.vx = trolley.v * 0.3; p.vy = 0;
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

    if (held && ["grab", "lift", "return", "release"].includes(mode)) {
      const g = grip(), nx = g.x, ny = g.y + S * 0.12;
      held.vx = (nx - held.x) / dt; held.vy = (ny - held.y) / dt;     // so it shoves its neighbours
      held.x = nx; held.y = ny;
    }
    pilePhysics(dt);
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
    for (const p of prizes) {
      const x = Math.round((p.x - (S * p.scale) / 2) / PX) * PX, y = Math.round((p.y - (S * p.scale) / 2) / PX) * PX;
      p.el.style.transform = `translate(${x}px, ${y}px) scale(${p.scale})`;
      p.el.style.transformOrigin = "0 0";
      if (p.dyn) p.el.style.zIndex = String(10 + Math.round(p.y / 4));      // lower in the pile = in front
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
  addEventListener("resize", () => layout(false));
  layout(true);
  requestAnimationFrame(frame);
})();
