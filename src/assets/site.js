(() => {
  const doc = document.documentElement;
  doc.classList.add("js");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
  };

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (!reduce && window.Lenis) {
    lenis = new window.Lenis({ duration: 1.15, easing: (t) => 1 - Math.pow(1 - t, 4), smoothWheel: true });
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  const scrollToEl = (el) => (lenis ? lenis.scrollTo(el, { offset: 0 }) : el.scrollIntoView({ behavior: reduce ? "auto" : "smooth" }));
  $$('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    const id = a.getAttribute("href").slice(1);
    const el = id === "main" ? document.body : document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    id === "main" ? (lenis ? lenis.scrollTo(0) : window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" })) : scrollToEl(el);
  }));
  // Arriving at /#work from another page
  if (location.hash === "#work") { const w = document.getElementById("work"); if (w) setTimeout(() => scrollToEl(w), 60); }

  /* ---------- header, progress, readout ---------- */
  const hud = $("[data-hud]");
  const bar = $("[data-progress]");
  const pct = $("[data-pct]");
  let lastY = 0, maxScroll = 1, ticking = false;
  const measure = () => { maxScroll = Math.max(1, doc.scrollHeight - innerHeight); };
  measure();
  addEventListener("resize", measure, { passive: true });
  addEventListener("load", measure);
  if ("ResizeObserver" in window) new ResizeObserver(measure).observe(document.body);
  const update = () => {
    ticking = false;
    const y = window.scrollY;
    const max = maxScroll;
    const p = Math.min(1, y / max);
    if (bar) bar.style.transform = `scaleX(${p})`;
    if (pct) pct.textContent = String(Math.round(p * 100)).padStart(3, "0");
    if (hud) {
      hud.classList.toggle("is-solid", y > 40);
      hud.classList.toggle("is-hidden", y > lastY && y > innerHeight * 0.6);
    }
    lastY = y;
  };
  // one update per frame however many scroll events arrive, with the page height cached instead of re-read each time
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  addEventListener("scroll", onScroll, { passive: true });
  update();

  // Mark the current nav item
  if (document.body.classList.contains("page-about")) { const a = $('[data-nav="about"]'); a && a.setAttribute("aria-current", "page"); }

  /* ---------- split titles into letters ---------- */
  $$("[data-split]").forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    let i = 0;
    el.setAttribute("aria-label", el.textContent.trim());
    el.innerHTML = words.map((w) =>
      `<span class="w" aria-hidden="true">${Array.from(w).map((c) => `<span class="ch" style="--i:${i++}">${c.replace(/&/, "&amp;").replace(/</, "&lt;")}</span>`).join("")}</span>`
    ).join(" ");
  });
  const playTitles = () => $$("[data-split]").forEach((el) => el.classList.add("is-in"));

  /* ---------- reveal on scroll ---------- */
  if ("IntersectionObserver" in window && !reduce) {
    const io = new IntersectionObserver((entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
    }), { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    $$("[data-reveal]").forEach((el) => io.observe(el));
  } else {
    $$("[data-reveal]").forEach((el) => el.classList.add("is-in"));
  }

  /* ---------- intro (home page, first visit per session) ---------- */
  const isHome = document.body.classList.contains("page-home");
  if (isHome && !reduce && !store.get("dt-intro")) {
    store.set("dt-intro", "1");
    const intro = document.createElement("div");
    intro.className = "intro";
    intro.innerHTML = `<span class="intro-line"></span><span class="intro-name">${($(".mark span") || {}).textContent || ""}</span><span class="intro-count">000</span>`;
    document.body.appendChild(intro);
    const count = $(".intro-count", intro);
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 1300);
      count.textContent = String(Math.round(k * 100)).padStart(3, "0");
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    setTimeout(() => { intro.classList.add("is-out"); setTimeout(playTitles, 250); }, 1450);
    setTimeout(() => intro.remove(), 2600);
  } else {
    requestAnimationFrame(playTitles);
  }

  /* ---------- hero slideshow ---------- */
  const slides = $$("[data-slide]");
  if (slides.length) {
    const card = $("[data-readout]");
    const roI = $("[data-ro-i]"), roT = $("[data-ro-title]"), roY = $("[data-ro-year]"), roBar = $("[data-ro-bar]");
    const DUR = 6500;
    let idx = 0, paused = false;
    const show = (n) => {
      slides[idx].classList.remove("is-on");
      idx = (n + slides.length) % slides.length;
      const s = slides[idx];
      s.classList.add("is-on");
      const img = s.querySelector("img"); img && img.removeAttribute("loading");
      roI.textContent = String(idx + 1).padStart(2, "0");
      roT.textContent = s.dataset.title;
      roY.textContent = s.dataset.year;
      card.href = s.dataset.href;
    };
    if (slides.length > 1 && !reduce) {
      let last = performance.now(), elapsed = 0;
      const loop = (t) => {
        const dt = Math.min(100, t - last); last = t;
        if (!paused) elapsed += dt;
        const k = elapsed / DUR;
        roBar.style.transform = `scaleX(${Math.min(1, k)})`;
        if (k >= 1) { show(idx + 1); elapsed = 0; }
        requestAnimationFrame(loop);
      };
      card.addEventListener("pointerenter", () => { paused = true; });
      card.addEventListener("pointerleave", () => { paused = false; });
      requestAnimationFrame(loop);
      document.addEventListener("visibilitychange", () => { paused = document.hidden; });
    }
  }

  /* ---------- parallax on hero images (mouse + scroll) ---------- */
  const par = $("[data-parallax]");
  if (par && !reduce) {
    let mx = 0, my = 0, cx = 0, cy = 0;
    if (finePointer) addEventListener("pointermove", (e) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });
    let lt = performance.now(), shown = "";
    const loop = (t) => {
      const dt = Math.min(0.05, (t - lt) / 1000); lt = t;
      const k = 1 - Math.exp(-dt * 3.1);                 // same feel at 60, 120 or 144 Hz
      cx += (mx - cx) * k; cy += (my - cy) * k;
      const scY = window.scrollY;
      if (scY < innerHeight * 1.2) {                     // skip work once the hero is off screen
        const tr = `translate3d(${(-cx * 18).toFixed(2)}px, ${(-cy * 12 + Math.min(scY, innerHeight) * 0.18).toFixed(2)}px, 0)`;
        if (tr !== shown) { par.style.transform = tr; shown = tr; }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ---------- custom cursor ---------- */
  const cursor = $(".cursor");
  if (cursor && finePointer && !reduce) {
    doc.classList.add("has-cursor");
    const dot = $(".cursor-dot", cursor), ring = $(".cursor-ring", cursor);
    let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
    addEventListener("pointermove", (e) => { x = e.clientX; y = e.clientY; }, { passive: true });
    let lt = performance.now(), dShown = "", rShown = "";
    const loop = (t) => {
      const dt = Math.min(0.05, (t - lt) / 1000); lt = t;
      const k = 1 - Math.exp(-dt * 10.5);                // time-based easing: identical at any refresh rate
      rx += (x - rx) * k; ry += (y - ry) * k;
      const d = `translate3d(${x}px, ${y}px, 0)`, rr = `translate3d(${rx.toFixed(2)}px, ${ry.toFixed(2)}px, 0)`;
      if (d !== dShown) { dot.style.transform = d; dShown = d; }
      if (rr !== rShown) { ring.style.transform = rr; rShown = rr; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    document.addEventListener("pointerover", (e) => {
      const t = e.target.closest("[data-cursor]");
      cursor.classList.toggle("is-view", !!t);
    });
    document.addEventListener("pointerleave", () => cursor.classList.remove("is-view"));
  }

  /* ---------- lightbox ---------- */
  const lb = $("[data-lightbox]");
  if (lb) {
    const btns = $$("[data-lb]");
    const imgs = btns.map((b) => b.querySelector("img"));
    const big = $("[data-lb-img]", lb), count = $("[data-lb-count]", lb);
    let cur = 0, lastFocus = null;
    const set = (n) => {
      cur = (n + imgs.length) % imgs.length;

      const small = imgs[cur].currentSrc || imgs[cur].src;
      const src = btns[cur].dataset.full || small;
      big.src = small; // show the already-loaded copy instantly, then swap in full resolution
      big.alt = imgs[cur].alt; big.style.opacity = 1;
      const k = cur, pre = new Image();
      pre.onload = () => { if (cur === k) big.src = src; };
      pre.src = src;
      count.textContent = `${String(cur + 1).padStart(2, "0")} / ${String(imgs.length).padStart(2, "0")}`;
    };
    const open = (n) => {
      lastFocus = document.activeElement;
      lb.hidden = false; set(n);
      requestAnimationFrame(() => lb.classList.add("is-open"));
      lenis && lenis.stop(); document.body.style.overflow = "hidden";
      $("[data-lb-close]", lb).focus();
    };
    const close = () => {
      lb.classList.remove("is-open");
      setTimeout(() => { lb.hidden = true; }, 400);
      lenis && lenis.start(); document.body.style.overflow = "";
      lastFocus && lastFocus.focus();
    };
    $$("[data-lb]").forEach((b) => b.addEventListener("click", () => open(+b.dataset.lb)));
    $("[data-lb-close]", lb).addEventListener("click", close);
    $("[data-lb-prev]", lb).addEventListener("click", () => set(cur - 1));
    $("[data-lb-next]", lb).addEventListener("click", () => set(cur + 1));
    lb.addEventListener("click", (e) => { if (e.target === lb) close(); });
    addEventListener("keydown", (e) => {
      if (lb.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") set(cur + 1);
      if (e.key === "ArrowLeft") set(cur - 1);
    });
    let sx = null;
    lb.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 50) set(cur + (dx < 0 ? 1 : -1));
      sx = null;
    });
  }
})();
