/* Lab3D: a small dependency-free 3D renderer for the lab pages. Canvas 2D only: perspective projection and the painter's algorithm.
   Lab3D.grid({ rows, cols, wall, height, view }) draws a grid map (walls as blocks, colored and lifted tiles, a path tube, a robot, START/GOAL flags).
   Lab3D.tree({ height, view }) draws a search tree as cones (one level per depth) or as a flat diagram.
   Lab3D.palette() returns the resolved theme colors the views use, so 2D legends can match.
   Nothing touches the DOM until a view is created. */
(function () {
  "use strict";
  const TAU = Math.PI * 2, HALF_PI = Math.PI / 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  const FONT = '"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

  /* ---------- colors: any CSS color; "var(--name)" is resolved against the page theme and cached until the theme changes ---------- */
  const colorCache = new Map();
  let probe = null, pal = null;
  function resolveVars(s) {
    if (s.indexOf("var(") < 0) return s;
    const st = getComputedStyle(document.documentElement);
    for (let i = 0; i < 4 && s.indexOf("var(") >= 0; i++) {
      const next = s.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (m, name, fb) => st.getPropertyValue(name).trim() || (fb || "").trim() || "transparent");
      if (next === s) break;
      s = next;
    }
    return s;
  }
  const hex2 = (v) => (v < 16 ? "0" : "") + v.toString(16);
  function mk(r, g, b, a = 1) {
    r = clamp(Math.round(r), 0, 255); g = clamp(Math.round(g), 0, 255); b = clamp(Math.round(b), 0, 255); a = clamp(a, 0, 1);
    return { r, g, b, a, css: a >= 1 ? `#${hex2(r)}${hex2(g)}${hex2(b)}` : `rgba(${r},${g},${b},${+a.toFixed(3)})`, sh: new Map() };
  }
  function parseColor(input) {
    const key = input == null ? "" : String(input);
    let c = colorCache.get(key);
    if (c) return c;
    const s = resolveVars(key.trim());
    let r = 128, g = 128, b = 128, a = 1, m;
    if ((m = /^#([0-9a-f]{3,8})$/i.exec(s))) {
      let h = m[1];
      if (h.length < 6) h = h.split("").map((ch) => ch + ch).join("");
      r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
      if (h.length === 8) a = parseInt(h.slice(6, 8), 16) / 255;
    } else if ((m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(s))) {
      r = +m[1]; g = +m[2]; b = +m[3];
      if (m[4] != null) a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : +m[4];
    } else if (s) {
      if (!probe) { const pc = document.createElement("canvas"); pc.width = pc.height = 1; probe = pc.getContext("2d", { willReadFrequently: true }); }
      probe.clearRect(0, 0, 1, 1); probe.fillStyle = "#808080"; probe.fillStyle = s; probe.fillRect(0, 0, 1, 1);
      const d = probe.getImageData(0, 0, 1, 1).data;
      r = d[0]; g = d[1]; b = d[2]; a = d[3] / 255;
    }
    c = mk(r, g, b, a);
    colorCache.set(key, c);
    return c;
  }
  /* the color scaled by k (k < 1 darker, k > 1 lighter), as a cached CSS string */
  function shade(c, k) {
    let s = c.sh.get(k);
    if (s === undefined) {
      const f = (v) => clamp(Math.round(k <= 1 ? v * k : v + (255 - v) * (k - 1)), 0, 255);
      s = c.a >= 1 ? `rgb(${f(c.r)},${f(c.g)},${f(c.b)})` : `rgba(${f(c.r)},${f(c.g)},${f(c.b)},${c.a})`;
      c.sh.set(k, s);
    }
    return s;
  }
  const mixC = (a, b, t) => mk(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
  const lum = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  function tune(c, fn) {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    let h = 0, s = 0;
    if (d) {
      s = d / (1 - Math.abs(2 * l - 1));
      h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    const [H, S, L] = fn(h, s, l), C = (1 - Math.abs(2 * L - 1)) * S, X = C * (1 - Math.abs(((H / 60) % 2) - 1)), M = L - C / 2;
    const [r1, g1, b1] = H < 60 ? [C, X, 0] : H < 120 ? [X, C, 0] : H < 180 ? [0, C, X] : H < 240 ? [0, X, C] : H < 300 ? [X, 0, C] : [C, 0, X];
    return mk((r1 + M) * 255, (g1 + M) * 255, (b1 + M) * 255);
  }
  function computePalette() {
    const v = (n) => parseColor(`var(--${n})`);
    const panel = v("panel"), ink = v("ink"), ink2 = v("ink-2"), muted = v("muted"), line = v("line"), lagoon = v("lagoon"), coral = v("coral"), mint2 = v("mint-2"), focus = v("focus");
    const dark = lum(panel) < 0.35;
    const goal = tune(coral, (h, s, l) => [h, Math.max(s, 0.78), clamp(l - (dark ? 0.1 : 0.16), 0.4, 0.7)]);
    const start = tune(mint2, (h, s, l) => [h, Math.max(s, 0.55), dark ? clamp(l, 0.5, 0.6) : clamp(l, 0.36, 0.42)]);
    const path = tune(lagoon, (h, s) => [(h + 48) % 360, Math.max(s, 0.62), dark ? 0.7 : 0.55]);
    return {
      dark,
      bg: panel.css, panel: panel.css, ink: ink.css, muted: muted.css, line: line.css,
      floor: mixC(panel, line, dark ? 0.45 : 0.6).css,
      grid: (dark ? mixC(line, ink, 0.12) : mixC(line, ink2, 0.12)).css,
      wall: (dark ? mixC(muted, panel, 0.38) : mixC(ink2, line, 0.4)).css,
      start: start.css, goal: goal.css, path: path.css, robot: lagoon.css, pulse: focus.css,
      frontier: focus.css, expanded: mixC(muted, panel, dark ? 0.3 : 0.25).css, current: lagoon.css, cutoff: muted.css,
      edge: mixC(muted, panel, 0.35).css,
    };
  }
  /* one watcher for theme changes (data-theme on <html> or the system scheme), shared by all live views */
  const themeSubs = new Set();
  let themeMO = null, themeMQ = null;
  function themeChanged() { colorCache.clear(); pal = null; for (const f of themeSubs) f(); }
  function watchTheme(fn) {
    themeSubs.add(fn);
    if (!themeMO) {
      themeMO = new MutationObserver(themeChanged);
      themeMO.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
      themeMQ = matchMedia("(prefers-color-scheme: dark)");
      themeMQ.addEventListener("change", themeChanged);
    }
    return () => {
      themeSubs.delete(fn);
      if (!themeSubs.size && themeMO) { themeMO.disconnect(); themeMQ.removeEventListener("change", themeChanged); themeMO = themeMQ = null; }
    };
  }
  function getPal() {
    if (!themeMO) colorCache.clear();   // nothing watches the theme: resolve afresh
    if (!pal || !themeMO) pal = computePalette();
    return pal;
  }
  const textOn = (bg) => (lum(parseColor(bg)) > 0.6 ? "#0b1220" : "#ffffff");

  /* ---------- the camera of the view being drawn. Drawing is synchronous, so one set of module variables is enough; P() leaves the
     screen position (device pixels) in sx, sy and the depth in sz ---------- */
  let camX = 0, camY = 0, camZ = 0, fx = 0, fy = 0, fz = -1, rx = 1, rz = 0, ux = 0, uy = 1, uz = 0, FZ = 1, OX = 0, OY = 0, NEAR = 0.1, DPR = 1;
  let sx = 0, sy = 0, sz = 1, C = null;
  function P(x, y, z) {
    const dx = x - camX, dy = y - camY, dz = z - camZ;
    let d = dx * fx + dy * fy + dz * fz;
    if (d < NEAR) d = NEAR;
    sz = d;
    const k = FZ / d;
    sx = OX + (dx * rx + dz * rz) * k;
    sy = OY - (dx * ux + dy * uy + dz * uz) * k;
  }
  /* yaw turns around the vertical axis (0: camera on the +z side, looking toward -z), pitch is the elevation (pi/2: straight down) */
  function orient(yaw, pitch) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy0 = Math.sin(yaw);
    fx = -cp * sy0; fy = -sp; fz = -cp * cy;
    rx = cy; rz = -sy0;
    ux = -rz * fy; uy = rz * fx - rx * fz; uz = rx * fy;
  }
  /* scale and centering that fit the points pts = [x, y, z, x, y, z, ...] (or the corners of the box b = [x0, x1, y0, y1, z0, z1]) into the
     drawing area, for a camera at distance D looking at the center of b */
  function fitBox(b, pts, yaw, pitch, D, W, H, mt, mb, ms) {
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy0 = Math.sin(yaw);
    const ffx = -cp * sy0, ffy = -sp, ffz = -cp * cy, rrx = cy, rrz = -sy0, uux = -rrz * ffy, uuy = rrz * ffx - rrx * ffz, uuz = rrx * ffy;
    const ex = (b[0] + b[1]) / 2 - ffx * D, ey = (b[2] + b[3]) / 2 - ffy * D, ez = (b[4] + b[5]) / 2 - ffz * D;
    if (!pts || !pts.length) { pts = []; for (let i = 0; i < 8; i++) pts.push(b[i & 1], b[2 + ((i >> 1) & 1)], b[4 + (i >> 2)]); }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const dx = pts[i] - ex, dy = pts[i + 1] - ey, dz = pts[i + 2] - ez;
      const d = Math.max(D * 0.05, dx * ffx + dy * ffy + dz * ffz), px = (dx * rrx + dz * rrz) / d, py = (dx * uux + dy * uuy + dz * uuz) / d;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    const F = Math.min((W - 2 * ms) / Math.max(1e-6, x1 - x0), (H - mt - mb) / Math.max(1e-6, y1 - y0));
    return { F: Math.max(1e-3, F), pcx: (x0 + x1) / 2, pcy: (y0 + y1) / 2 };
  }
  /* drawing helpers on C */
  function quadH(x0, z0, x1, z1, y) {
    P(x0, y, z0); C.moveTo(sx, sy); P(x1, y, z0); C.lineTo(sx, sy); P(x1, y, z1); C.lineTo(sx, sy); P(x0, y, z1); C.lineTo(sx, sy); C.closePath();
  }
  function faceV(ax, az, bx, bz, lo, hi) {
    P(ax, lo, az); C.moveTo(sx, sy); P(bx, lo, bz); C.lineTo(sx, sy); P(bx, hi, bz); C.lineTo(sx, sy); P(ax, hi, az); C.lineTo(sx, sy); C.closePath();
  }
  function ring(x, z, y, rad, n) {
    for (let k = 0; k <= n; k++) { const a = (k / n) * TAU; P(x + rad * Math.cos(a), y, z + rad * Math.sin(a)); if (k) C.lineTo(sx, sy); else C.moveTo(sx, sy); }
    C.closePath();
  }
  function rrect(x, y, w, h, r) {
    C.beginPath();
    if (C.roundRect) C.roundRect(x, y, w, h, r);
    else { C.moveTo(x + r, y); C.arcTo(x + w, y, x + w, y + h, r); C.arcTo(x + w, y + h, x, y + h, r); C.arcTo(x, y + h, x, y, r); C.arcTo(x, y, x + w, y, r); C.closePath(); }
  }
  function haloText(t, x, y, fill, halo) {
    C.lineWidth = 3 * DPR; C.strokeStyle = halo; C.strokeText(t, x, y);
    C.fillStyle = fill; C.fillText(t, x, y);
  }

  let styled = false;
  function injectStyle() {
    if (styled) return;
    styled = true;
    const s = document.createElement("style");
    s.textContent = `
.l3d{position:relative;width:100%;min-width:0}
.l3d-box{position:relative;width:100%;min-width:0;overflow:hidden;border-radius:8px}
.l3d canvas.l3d-canvas{position:absolute;left:0;top:0;display:block;width:100%;height:100%;max-width:none;touch-action:none;cursor:grab;border-radius:8px;background:var(--panel);-webkit-user-select:none;user-select:none}
.l3d canvas.l3d-canvas.l3d-drag{cursor:grabbing}
.l3d-bar{position:absolute;top:8px;left:8px;right:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;pointer-events:none}
.l3d-bar>*{pointer-events:auto}
.l3d-bar button{font-size:.78rem;line-height:1.2;padding:.28em .65em;border-radius:6px;background:color-mix(in srgb,var(--panel) 88%,transparent);color:var(--ink-2);border:1px solid var(--line);backdrop-filter:blur(3px)}
.l3d-bar button:hover{border-color:var(--lagoon);color:var(--lagoon)}
.l3d-bar button[aria-pressed="true"]{background:var(--lagoon);border-color:var(--lagoon);color:var(--panel)}
.l3d-seg{display:inline-flex}
.l3d-seg button{border-radius:0}
.l3d-seg button:first-child{border-radius:6px 0 0 6px}
.l3d-seg button:last-child{border-radius:0 6px 6px 0;margin-left:-1px}
.l3d-hint{position:absolute;right:10px;bottom:7px;font-size:.72rem;color:var(--muted);pointer-events:none;background:color-mix(in srgb,var(--panel) 80%,transparent);padding:0 .4em;border-radius:4px}
.l3d .legend{margin:.45rem 0 0}
.l3d .legend i.l3d-hollow{background:transparent!important;border:2px solid var(--muted);border-radius:50%}
`;
    document.head.appendChild(s);
  }
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  /* ---------- the view: canvas, toolbar, orbit camera, input, render loop. The scene draws; the view decides when ---------- */
  function makeView(opts, scene) {
    injectStyle();
    const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    const height = Math.max(160, +opts.height || scene.height);
    const root = el("div", "l3d"), box = el("div", "l3d-box");
    box.style.height = height + "px";   // the box sets the size; the canvas fills it, so its bitmap size never feeds back into the layout
    const canvas = el("canvas", "l3d-canvas");
    canvas.tabIndex = 0;
    canvas.width = canvas.height = 0;   // sized by the ResizeObserver once the view is in the page
    canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", scene.aria);
    const ctx = canvas.getContext("2d"), cache = document.createElement("canvas"), cctx = cache.getContext("2d");
    const bar = el("div", "l3d-bar"), seg = el("div", "l3d-seg");
    const btn = (t, pressed) => { const b = el("button", "ghost", t); b.type = "button"; if (pressed != null) b.setAttribute("aria-pressed", String(pressed)); return b; };
    const b3d = btn("3D", false), bTop = btn(scene.topLabel, false), bReset = btn("Reset view"), bRot = btn("Auto-rotate", false);
    seg.append(b3d, bTop); bar.append(seg, bReset);
    if (!reduce) bar.append(bRot);
    const coarse = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches);
    const HINT = coarse ? "drag to orbit · pinch to zoom" : "drag to orbit · scroll to zoom";
    const hint = el("div", "l3d-hint", HINT);
    box.append(canvas, bar, hint); root.append(box);
    if (scene.extra) root.append(scene.extra);

    const VIEWS = scene.views, ZMIN = 0.55, ZMAX = 8;
    let mode = opts.view === "top" || opts.view === "flat" || opts.view === "2d" ? "top" : "3d";
    const preset = (m) => ({ yaw: VIEWS[m].yaw, pitch: VIEWS[m].pitch, zoom: 1, flat: m === "top" ? 1 : 0, ox: 0, oy: 0, oz: 0 });
    const cur = preset(mode), goal = preset(mode);
    let rotating = false, dragging = false, dirty = true, visible = true, dead = false, raf = 0, last = 0, tick = 0, dpr = 1, wasLive = false;
    let ms = 0, lastMs = 0, frames = 0;
    const V = { reduce, cur, D: 1, R: 1, tx: 0, ty: 0, tz: 0, b: null, W: 0, H: 0, mt: 0, mb: 0, dpr: 1, floored: false, invalidate: () => { dirty = true; kick(); }, panTo, recenter, size: () => ({ W: canvas.width, H: canvas.height, dpr }) };
    scene.view = V;

    function derive() {
      const b = scene.bounds(), W = canvas.width, H = canvas.height;
      const fl = smooth(cur.flat), R = Math.max(1, 0.5 * Math.hypot(b[1] - b[0], b[3] - b[2], b[5] - b[4]));
      const D = R * 2.1 * (1 + 9 * fl);
      const mt = (44 + (scene.padTop || 0)) * dpr, mb = 24 * dpr, msd = 14 * dpr;
      const fit = fitBox(b, scene.fitPoints ? scene.fitPoints() : null, VIEWS["3d"].yaw + (VIEWS.top.yaw - VIEWS["3d"].yaw) * fl, cur.pitch, D, W, H, mt, mb, msd);
      orient(cur.yaw, cur.pitch);
      const tx = (b[0] + b[1]) / 2 + cur.ox, ty = (b[2] + b[3]) / 2 + cur.oy, tz = (b[4] + b[5]) / 2 + cur.oz;
      camX = tx - fx * D; camY = ty - fy * D; camZ = tz - fz * D;
      FZ = (scene.maxScale ? Math.min(fit.F, scene.maxScale * dpr * D) : fit.F) * cur.zoom;
      /* scenes with a minimum readable scale (trees in flat view): never smaller than that, the camera follows the focus instead */
      const floor = scene.minScale ? scene.minScale * dpr * D * fl : 0;
      V.floored = FZ < floor;
      if (V.floored) FZ = floor;
      OX = W / 2 - FZ * fit.pcx; OY = mt + (H - mt - mb) / 2 + FZ * fit.pcy;
      NEAR = D * 0.05; DPR = dpr;
      V.D = D; V.R = R; V.tx = tx; V.ty = ty; V.tz = tz; V.b = b; V.W = W; V.H = H; V.mt = mt; V.mb = mb; V.fl = fl; V.dpr = dpr;
    }
    /* the point under a screen position on the pan plane: the ground for maps, the plane facing the camera for trees */
    function unproject(px, py) {
      const a = (px - OX) / FZ, c = (OY - py) / FZ;
      const dx = fx + rx * a + ux * c, dy = fy + uy * c, dz = fz + rz * a + uz * c;
      const ground = scene.panPlane === "ground", [nx, ny, nz] = ground ? [0, 1, 0] : [fx, fy, fz];
      const den = dx * nx + dy * ny + dz * nz;
      if (Math.abs(den) < 1e-6) return null;
      const s = ((V.tx - camX) * nx + ((ground ? 0 : V.ty) - camY) * ny + (V.tz - camZ) * nz) / den;
      if (!(s > 0) || s > V.D * 30) return null;
      return [camX + dx * s, camY + dy * s, camZ + dz * s];
    }
    function clampOff() {
      const b = V.b || scene.bounds();
      const hx = (b[1] - b[0]) / 2, hy = (b[3] - b[2]) / 2, hz = (b[5] - b[4]) / 2;
      cur.ox = goal.ox = clamp(cur.ox, -hx, hx); cur.oy = goal.oy = clamp(cur.oy, -hy, hy); cur.oz = goal.oz = clamp(cur.oz, -hz, hz);
    }
    function shift(g0, g1) {
      if (!g0 || !g1) return;
      cur.ox += g0[0] - g1[0]; cur.oy += g0[1] - g1[1]; cur.oz += g0[2] - g1[2];
      clampOff();
    }
    function zoomAt(px, py, f) {
      derive();
      const g0 = unproject(px, py);
      cur.zoom = goal.zoom = clamp(cur.zoom * f, ZMIN, ZMAX);
      goal.ox = cur.ox; goal.oy = cur.oy; goal.oz = cur.oz;
      derive();
      shift(g0, unproject(px, py));
      dirty = true; kick();
    }
    function pan(x0, y0, x1, y1) {
      derive();
      goal.ox = cur.ox; goal.oy = cur.oy; goal.oz = cur.oz;
      shift(unproject(x0, y0), unproject(x1, y1));
      dirty = true; kick();
    }
    function panTo(x, y, z) {
      const b = V.b || scene.bounds();
      goal.ox = x - (b[0] + b[1]) / 2; goal.oy = y - (b[2] + b[3]) / 2; goal.oz = z - (b[4] + b[5]) / 2;
      if (reduce) Object.assign(cur, { ox: goal.ox, oy: goal.oy, oz: goal.oz });
      kick();
    }
    function recenter() {
      goal.ox = goal.oy = goal.oz = 0;
      if (reduce) cur.ox = cur.oy = cur.oz = 0;
      kick();
    }
    function orbit(dxCss, dyCss) {
      if (mode === "top") setMode("3d", true);
      cur.yaw -= dxCss * 0.0085; cur.pitch = clamp(cur.pitch + dyCss * 0.0065, scene.pitchMin, scene.pitchMax);
      goal.yaw = cur.yaw; goal.pitch = cur.pitch;
      dirty = true; kick();
    }
    const nearAngle = (t, c) => t + TAU * Math.round((c - t) / TAU);
    function setMode(m, keepAngles) {
      mode = m;
      goal.flat = m === "top" ? 1 : 0;
      if (!keepAngles) { goal.yaw = nearAngle(VIEWS[m].yaw, cur.yaw); goal.pitch = VIEWS[m].pitch; }
      if (m === "top") rotating = false;
      buttons(); kick();
    }
    function reset() {
      Object.assign(goal, preset(mode));
      goal.yaw = nearAngle(goal.yaw, cur.yaw);
      kick();
    }
    function buttons() {
      b3d.setAttribute("aria-pressed", String(mode === "3d")); bTop.setAttribute("aria-pressed", String(mode === "top"));
      bRot.setAttribute("aria-pressed", String(rotating));
    }
    buttons();
    b3d.addEventListener("click", () => setMode("3d"));
    bTop.addEventListener("click", () => setMode("top"));
    bReset.addEventListener("click", reset);
    bRot.addEventListener("click", () => { rotating = !rotating; if (rotating && mode === "top") setMode("3d"); buttons(); kick(); });

    function stepCam(dt) {
      const k = reduce ? 1 : 1 - Math.exp(-dt * 8.5);
      let moving = false;
      for (const key of ["yaw", "pitch", "zoom", "flat", "ox", "oy", "oz"]) {
        const d = goal[key] - cur[key];
        if (d === 0) continue;
        if (Math.abs(d) < (key === "ox" || key === "oy" || key === "oz" ? 1e-3 : 2e-4)) cur[key] = goal[key];
        else cur[key] += d * k;
        moving = true;
      }
      return moving;
    }
    function kick() { if (!raf && !dead && visible && canvas.width > 1) raf = requestAnimationFrame(frame); }
    function frame(now) {
      raf = 0;
      if (dead) return;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      let anim = stepCam(dt);
      if (rotating && !dragging) { cur.yaw += dt * 0.3; goal.yaw = cur.yaw; anim = true; }
      if (scene.step(dt, now)) anim = true;
      if (!anim && !dirty && wasLive && (++tick & 1)) { kick(); return; }   // only the idle overlay moves: 30 frames a second are enough
      derive();
      if (anim || dirty) {
        const t0 = performance.now();
        C = cctx; cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.globalAlpha = 1;
        scene.render(cctx, now);
        lastMs = performance.now() - t0; ms = frames ? ms * 0.9 + lastMs * 0.1 : lastMs; frames++;
        dirty = false;
      }
      C = ctx; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(cache, 0, 0);
      const live = (wasLive = scene.overlay(ctx, now));
      if (anim || dragging || live) kick();
      else last = 0;
    }
    function resize() {
      const w = box.clientWidth, hh = box.clientHeight;
      if (!w || !hh || dead) return;
      dpr = Math.min(3, window.devicePixelRatio || 1);
      const W = Math.round(w * dpr), H = Math.round(hh * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = cache.width = W; canvas.height = cache.height = H; }
      if (scene.onResize) scene.onResize();
      dirty = true; kick();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(box);
    const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; if (visible) kick(); }) : null;
    if (io) io.observe(canvas);
    const unwatch = watchTheme(() => { if (scene.onTheme) scene.onTheme(); dirty = true; kick(); });

    /* input: drag = orbit, right/middle/shift-drag or two fingers = pan, wheel or pinch = zoom at the pointer, double-click/double-tap = reset */
    const ptrs = new Map();
    let moved = false, panMode = false, downX = 0, downY = 0, pinch = null, lastTap = 0, tapX = 0, tapY = 0, hoverCell = -1, lastType = "mouse", engaged = false;
    canvas.addEventListener("focus", () => { engaged = true; });
    canvas.addEventListener("blur", () => { engaged = false; });
    const devXY = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (canvas.width / Math.max(1, r.width)), (e.clientY - r.top) * (canvas.height / Math.max(1, r.height))]; };
    const handlers = { hover: null, click: null };
    function pickAt(px, py) { if (!scene.pick || !canvas.width) return -1; derive(); return scene.pick(px, py); }
    function setHover(i) {
      if (i === hoverCell) return;
      hoverCell = i;
      if (scene.setHover) { scene.setHover(i); kick(); }
      if (handlers.hover) { const rc = scene.cellOf(i); handlers.hover(rc ? rc[0] : null, rc ? rc[1] : undefined); }
    }
    function twoFinger() {
      const [a, b] = [...ptrs.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    canvas.addEventListener("pointerdown", (e) => {
      lastType = e.pointerType; engaged = true;
      if (e.pointerType === "mouse" && e.button > 2) return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers cannot be captured */ }
      const [x, y] = devXY(e);
      ptrs.set(e.pointerId, { x, y });
      if (ptrs.size === 1) {
        moved = false; downX = x; downY = y;
        panMode = e.button === 1 || e.button === 2 || e.shiftKey || e.ctrlKey || e.metaKey;
      } else if (ptrs.size === 2) { pinch = twoFinger(); moved = true; }
      dragging = true; canvas.classList.add("l3d-drag");
      if (e.pointerType !== "mouse") e.preventDefault();
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = ptrs.get(e.pointerId);
      const [x, y] = devXY(e);
      if (!p) { if (e.pointerType === "mouse" && !e.buttons) setHover(pickAt(x, y)); return; }
      const px = p.x, py = p.y;
      p.x = x; p.y = y;
      if (ptrs.size === 1) {
        if (!moved && Math.hypot(x - downX, y - downY) > 5 * dpr) { moved = true; setHover(-1); }
        if (!moved) return;
        if (panMode) pan(px, py, x, y);
        else orbit((x - px) / dpr, (y - py) / dpr);
      } else if (ptrs.size === 2 && pinch) {
        const q = twoFinger();
        if (pinch.d > 0 && q.d > 0) zoomAt(q.x, q.y, q.d / pinch.d);
        pan(pinch.x, pinch.y, q.x, q.y);
        pinch = q;
      }
    });
    const up = (e) => {
      if (!ptrs.has(e.pointerId)) return;
      const [x, y] = devXY(e);
      ptrs.delete(e.pointerId);
      if (ptrs.size === 1) { pinch = null; const q = [...ptrs.values()][0]; downX = q.x; downY = q.y; }
      if (ptrs.size) return;
      dragging = false; canvas.classList.remove("l3d-drag");
      if (moved || e.type !== "pointerup") { kick(); return; }
      const i = pickAt(x, y);
      if (handlers.click) { const rc = scene.cellOf(i); handlers.click(rc ? rc[0] : null, rc ? rc[1] : undefined); }
      if (e.pointerType !== "mouse") {
        const now = performance.now();
        if (now - lastTap < 320 && Math.hypot(x - tapX, y - tapY) < 30 * dpr) { reset(); lastTap = 0; }
        else { lastTap = now; tapX = x; tapY = y; }
      }
      kick();
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { engaged = false; if (!ptrs.size) setHover(-1); } });
    canvas.addEventListener("dblclick", (e) => { if (lastType === "mouse") { e.preventDefault(); reset(); } });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    /* the wheel zooms only once the view was clicked (or for pinch gestures, which arrive with ctrlKey), so scrolling the page past a view
       never zooms it by accident */
    let hintTimer = 0;
    canvas.addEventListener("wheel", (e) => {
      if (!engaged && !e.ctrlKey) {
        hint.textContent = "click the view first, then scroll to zoom";
        clearTimeout(hintTimer); hintTimer = setTimeout(() => { hint.textContent = HINT; }, 1600);
        return;
      }
      e.preventDefault();
      const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      const [x, y] = devXY(e);
      zoomAt(x, y, Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0016)));
    }, { passive: false });
    canvas.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "ArrowLeft" || k === "ArrowRight") { if (mode === "top") setMode("3d", true); goal.yaw += k === "ArrowLeft" ? 0.2 : -0.2; }
      else if (k === "ArrowUp" || k === "ArrowDown") { if (mode === "top") setMode("3d", true); goal.pitch = clamp(goal.pitch + (k === "ArrowUp" ? 0.12 : -0.12), scene.pitchMin, scene.pitchMax); }
      else if (k === "+" || k === "=") goal.zoom = clamp(goal.zoom * 1.25, ZMIN, ZMAX);
      else if (k === "-" || k === "_") goal.zoom = clamp(goal.zoom / 1.25, ZMIN, ZMAX);
      else if (k === "0" || k === "Home") reset();
      else return;
      e.preventDefault(); kick();
    });

    return {
      el: root,
      setView(v = {}) {
        if (v.view === "top" || v.view === "3d") { setMode(v.view, true); cur.flat = goal.flat; }
        if (v.yaw != null) cur.yaw = goal.yaw = +v.yaw;
        if (v.pitch != null) cur.pitch = goal.pitch = clamp(+v.pitch, scene.pitchMin, scene.pitchMax);
        if (v.zoom != null) cur.zoom = goal.zoom = clamp(+v.zoom, ZMIN, ZMAX);
        dirty = true; kick();
      },
      onHover(fn) { handlers.hover = typeof fn === "function" ? fn : null; },
      onClick(fn) { handlers.click = typeof fn === "function" ? fn : null; },
      stats: () => ({ ms: +ms.toFixed(3), lastMs: +lastMs.toFixed(3), frames }),
      destroy() {
        if (dead) return;
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        ro.disconnect(); if (io) io.disconnect(); unwatch();
      },
      invalidate: V.invalidate,
    };
  }

  /* ---------- the grid map ---------- */
  const WALL_H = 1, RAISE = 0.07, FLAT_H = 0.12, SLAB = 0.35;
  function gridScene(o) {
    const R = Math.max(1, o.rows | 0), Cn = Math.max(1, o.cols | 0), N = R * Cn;
    const wall = new Uint8Array(N), cx0 = new Float32Array(N), cz0 = new Float32Array(N);
    const slot = new Int16Array(N).fill(-1), hT = new Float32Array(N), hC = new Float32Array(N), pAge = new Float32Array(N).fill(-1);
    const order = new Uint32Array(N), dist = new Float64Array(N);
    for (let r = 0, i = 0; r < R; r++) for (let c = 0; c < Cn; c++, i++) { cx0[i] = c + 0.5 - Cn / 2; cz0[i] = r + 0.5 - R / 2; order[i] = i; }
    const setWalls = (fn) => { for (let r = 0, i = 0; r < R; r++) for (let c = 0; c < Cn; c++, i++) wall[i] = typeof fn === "function" && fn(r, c) ? 1 : 0; };
    setWalls(o.wall);
    let slotIdx = new Map(), slotStr = [], buckets = [];
    let path = [], pathAt = [], pathColor = null, mStart = null, mGoal = null, marks = [], labels = [], pulses = [];
    let robotT = null, robotC = null, first = true, hover = -1, sortX = NaN, sortZ = NaN;
    const bounds = [-Cn / 2, Cn / 2, -SLAB, WALL_H, -R / 2, R / 2];
    const idx = (r, c) => (r >= 0 && c >= 0 && r < R && c < Cn ? r * Cn + c : -1);
    const hE = (i) => (wall[i] ? WALL_H : hC[i]);
    const nbH = (r, c) => { const i = idx(r, c); return i < 0 ? 0 : hE(i); };
    const marker = (m) => { if (!m) return null; const r = Math.round(+m.r), c = Math.round(+m.c), i = idx(r, c); return i < 0 ? null : { r, c, i, label: m.label != null ? String(m.label) : "" }; };

    function sortCells() {
      if (camX === sortX && camZ === sortZ) return;
      sortX = camX; sortZ = camZ;
      for (let i = 0; i < N; i++) { const dx = cx0[i] - camX, dz = cz0[i] - camZ; dist[i] = dx * dx + dz * dz; }
      order.sort((a, b) => dist[b] - dist[a]);
    }
    /* the visible sides of the column over cell i from lo to hi, as subpaths (filled by the caller) */
    function sides(i, lo, hi) {
      const r = (i / Cn) | 0, c = i - r * Cn, x0 = cx0[i] - 0.5, x1 = x0 + 1, z0 = cz0[i] - 0.5, z1 = z0 + 1;
      let n;
      if (camX < x0 && (n = nbH(r, c - 1)) < hi) faceV(x0, z1, x0, z0, Math.max(lo, n), hi);
      if (camX > x1 && (n = nbH(r, c + 1)) < hi) faceV(x1, z0, x1, z1, Math.max(lo, n), hi);
      if (camZ < z0 && (n = nbH(r - 1, c)) < hi) faceV(x0, z0, x1, z0, Math.max(lo, n), hi);
      if (camZ > z1 && (n = nbH(r + 1, c)) < hi) faceV(x1, z1, x0, z1, Math.max(lo, n), hi);
    }
    /* a block: each visible side shaded by the direction it faces, then the top (a hair larger, so neighboring tops show no seams) */
    function block(x0, z0, x1, z1, lo, hi, nL, nR, nB, nF, col, kTop) {
      if (camX < x0 && nL < hi) { C.beginPath(); faceV(x0, z1, x0, z0, Math.max(lo, nL), hi); C.fillStyle = shade(col, 0.8); C.fill(); }
      if (camX > x1 && nR < hi) { C.beginPath(); faceV(x1, z0, x1, z1, Math.max(lo, nR), hi); C.fillStyle = shade(col, 0.64); C.fill(); }
      if (camZ < z0 && nB < hi) { C.beginPath(); faceV(x0, z0, x1, z0, Math.max(lo, nB), hi); C.fillStyle = shade(col, 0.9); C.fill(); }
      if (camZ > z1 && nF < hi) { C.beginPath(); faceV(x1, z1, x0, z1, Math.max(lo, nF), hi); C.fillStyle = shade(col, 0.72); C.fill(); }
      const e = 0.012;
      C.beginPath(); quadH(x0 - e, z0 - e, x1 + e, z1 + e, hi); C.fillStyle = shade(col, kTop); C.fill();
    }
    function cellBlock(i, col, kTop) {
      const r = (i / Cn) | 0, c = i - r * Cn, x0 = cx0[i] - 0.5, z0 = cz0[i] - 0.5;
      block(x0, z0, x0 + 1, z0 + 1, 0, hE(i), nbH(r, c - 1), nbH(r, c + 1), nbH(r - 1, c), nbH(r + 1, c), col, kTop);
    }
    function pulseFx(i, p, a) {
      const top = hE(i), x = cx0[i], z = cz0[i], k = 1 - a;
      C.globalAlpha = 0.7 * k * k; C.beginPath(); quadH(x - 0.5, z - 0.5, x + 0.5, z + 0.5, top + 0.002); C.fillStyle = p.pulse; C.fill();
      const s = 0.42 + 0.2 * a, y = top + 0.05 + a * 0.9;
      C.globalAlpha = 0.9 * k; C.beginPath(); quadH(x - s, z - s, x + s, z + s, y); C.lineWidth = 1.6 * DPR; C.strokeStyle = p.pulse; C.stroke();
      C.globalAlpha = 1;
    }
    function discs(i, p) {
      const top = hE(i) + 0.004;
      if (mStart && mStart.i === i) { C.globalAlpha = 0.45; C.beginPath(); ring(cx0[i], cz0[i], top, 0.42, 22); C.fillStyle = p.start; C.fill(); }
      if (mGoal && mGoal.i === i) { C.globalAlpha = 0.4; C.beginPath(); ring(cx0[i], cz0[i], top, 0.42, 22); C.fillStyle = p.goal; C.fill(); }
      C.globalAlpha = 1;
    }
    function pathPiece(j, p, col) {
      const n = path.length, here = path[j], y = pathY(j);
      const pts = [];
      if (j > 0) { const q = path[j - 1]; pts.push((q.x + here.x) / 2, (pathY(j - 1) + y) / 2, (q.z + here.z) / 2); }
      pts.push(here.x, y, here.z);
      if (j < n - 1) { const q = path[j + 1]; pts.push((q.x + here.x) / 2, (pathY(j + 1) + y) / 2, (q.z + here.z) / 2); }
      P(here.x, y, here.z);
      const s = FZ / sz, scr = [];
      for (let k = 0; k < pts.length; k += 3) { P(pts[k], pts[k + 1], pts[k + 2]); scr.push(sx, sy); }
      P(here.x, y, here.z);
      const ex = sx, ey = sy, end = j === 0 || j === n - 1;
      const layer = (w, style, alpha) => {
        C.globalAlpha = alpha; C.lineWidth = Math.max(w * s, DPR); C.strokeStyle = style;
        C.beginPath(); C.moveTo(scr[0], scr[1]); for (let k = 2; k < scr.length; k += 2) C.lineTo(scr[k], scr[k + 1]); C.stroke();
        if (end || n === 1) { C.beginPath(); C.arc(ex, ey, Math.max(w * s, DPR) / 2, 0, TAU); C.fillStyle = style; C.fill(); }
      };
      C.lineJoin = "round"; C.lineCap = "butt";
      layer(0.62, col, p.dark ? 0.3 : 0.22);
      layer(0.22, col, 1);
      layer(0.07, "#ffffff", 0.65);
      C.globalAlpha = 1;
    }
    function pathY(j) { const q = path[j]; return Math.max(0.32, (q.i >= 0 ? hE(q.i) : 0) + 0.15); }
    function robotDraw(p) {
      const x = robotC.c + 0.5 - Cn / 2, z = robotC.r + 0.5 - R / 2;
      const i = idx(Math.round(robotC.r), Math.round(robotC.c)), lo = i >= 0 && !wall[i] ? hC[i] : 0, hi = lo + 0.52, s = 0.34;
      const col = parseColor(p.robot);
      C.beginPath(); ring(x, z, lo + 0.003, 0.5, 18); C.fillStyle = p.ink; C.globalAlpha = 0.18; C.fill(); C.globalAlpha = 1;
      block(x - s, z - s, x + s, z + s, lo, hi, -1, -1, -1, -1, col, 1.1);
      C.beginPath(); quadH(x - s, z - s, x + s, z + s, hi); C.lineWidth = 1.5 * DPR; C.strokeStyle = p.panel; C.stroke();
      C.beginPath(); ring(x, z, hi + 0.001, 0.16, 14); C.fillStyle = "#ffffff"; C.fill();
      C.beginPath(); ring(x, z, hi + 0.002, 0.07, 10); C.fillStyle = col.css; C.fill();
    }
    const POLE_S = 1.25, POLE_G = 1.5;
    function poles(i, p) {
      const x = cx0[i], z = cz0[i], top = hE(i);
      const isS = mStart && mStart.i === i, isG = mGoal && mGoal.i === i;
      for (const [on, hgt, col] of [[isS, POLE_S, p.start], [isG, POLE_G, p.goal]]) {
        if (!on) continue;
        P(x, top, z); const bx = sx, by = sy; P(x, top + hgt, z);
        C.beginPath(); C.moveTo(bx, by); C.lineTo(sx, sy); C.lineWidth = 2.2 * DPR; C.strokeStyle = p.ink; C.globalAlpha = 0.75; C.stroke(); C.globalAlpha = 1;
        const s = FZ / sz;
        if (col === p.start) {
          const rad = Math.max(5.5 * DPR, 0.22 * s);
          C.beginPath(); C.arc(sx, sy, rad, 0, TAU); C.fillStyle = col; C.fill(); C.lineWidth = 2 * DPR; C.strokeStyle = p.panel; C.stroke();
        } else {
          const fh = Math.max(11 * DPR, Math.abs(by - sy) * 0.36), fw = Math.max(15 * DPR, 0.62 * s);
          C.beginPath(); C.moveTo(sx, sy); C.lineTo(sx + fw, sy + fh / 2); C.lineTo(sx, sy + fh); C.closePath();
          C.fillStyle = col; C.fill(); C.lineWidth = 1.2 * DPR; C.strokeStyle = shade(parseColor(col), 0.7); C.stroke();
        }
      }
    }

    const scene = {
      height: 440, aria: "3D map. Drag to orbit, scroll to zoom.", topLabel: "Top view", panPlane: "ground",
      /* small maps get a steep camera, so every cell and its letter stays large and readable */
      views: { "3d": R * Cn <= 200 ? { yaw: -0.12, pitch: 1.3 } : { yaw: -0.32, pitch: 0.8 }, top: { yaw: 0, pitch: HALF_PI } }, pitchMin: 0.22, pitchMax: HALF_PI,
      padTop: 16,   // room for the START/GOAL tags above the top row
      bounds: () => bounds,
      cellOf: (i) => (i >= 0 && i < N ? [(i / Cn) | 0, i % Cn] : null),
      setHover: (i) => { hover = i; },
      update(s) {
        s = s || {};
        const now = performance.now(), reduce = scene.view.reduce;
        if (s.wall) setWalls(s.wall);
        if (slotStr.length > 192) { slotIdx = new Map(); slotStr = []; }
        const color = typeof s.color === "function" ? s.color : null, lift = typeof s.lift === "function" ? s.lift : null;
        for (let r = 0, i = 0; r < R; r++) for (let c = 0; c < Cn; c++, i++) {
          const col = color ? color(r, c) : null;
          let k = -1;
          if (col != null && col !== "" && col !== false) {
            k = slotIdx.get(col);
            if (k === undefined) { k = slotStr.length; slotStr.push(String(col)); slotIdx.set(col, k); }
          }
          slot[i] = k;
          const lv = lift ? +lift(r, c) || 0 : 0;
          hT[i] = wall[i] ? 0 : (k >= 0 ? RAISE : 0) + clamp(lv, 0, 2);
        }
        if (first || reduce) hC.set(hT);
        first = false;
        path = []; pathAt = [];
        for (const q of Array.isArray(s.path) ? s.path : []) {
          if (!q) continue;
          const r = +q[0], c = +q[1], i = idx(Math.round(r), Math.round(c));
          if (i < 0) continue;
          (pathAt[i] || (pathAt[i] = [])).push(path.length);
          path.push({ r, c, i, x: c + 0.5 - Cn / 2, z: r + 0.5 - R / 2 });
        }
        pathColor = s.pathColor || null;
        mStart = marker(s.start); mGoal = marker(s.goal);
        marks = (Array.isArray(s.landmarks) ? s.landmarks : []).map(marker).filter((m) => m && !(mStart && m.i === mStart.i) && !(mGoal && m.i === mGoal.i));
        labels = (Array.isArray(s.labels) ? s.labels : []).filter((l) => l && idx(Math.round(l.r), Math.round(l.c)) >= 0 && l.text != null)
          .map((l) => ({ r: +l.r, c: +l.c, i: idx(Math.round(l.r), Math.round(l.c)), text: String(l.text) }));
        if (!reduce) for (const q of Array.isArray(s.pulse) ? s.pulse : []) { const i = q ? idx(Math.round(q[0]), Math.round(q[1])) : -1; if (i >= 0 && !wall[i]) pulses.push({ i, t0: now }); }
        if (s.robot && isFinite(s.robot[0]) && isFinite(s.robot[1])) {
          robotT = { r: clamp(+s.robot[0], 0, R - 1), c: clamp(+s.robot[1], 0, Cn - 1) };
          if (!robotC || reduce || Math.hypot(robotT.r - robotC.r, robotT.c - robotC.c) > 2.5) robotC = { ...robotT };
        } else robotT = robotC = null;
        scene.view.invalidate();
      },
      step(dt, now) {
        let anim = false;
        const k = 1 - Math.exp(-dt * 11);
        for (let i = 0; i < N; i++) {
          const d = hT[i] - hC[i];
          if (d === 0) continue;
          hC[i] = Math.abs(d) < 0.003 ? hT[i] : hC[i] + d * k;
          anim = true;
        }
        if (robotC && robotT) {
          const dr = robotT.r - robotC.r, dc = robotT.c - robotC.c;
          if (dr || dc) {
            const k2 = 1 - Math.exp(-dt * 18);
            if (Math.abs(dr) + Math.abs(dc) < 0.003) { robotC.r = robotT.r; robotC.c = robotT.c; } else { robotC.r += dr * k2; robotC.c += dc * k2; }
            anim = true;
          }
        }
        if (pulses.length) { pulses = pulses.filter((q) => now - q.t0 < 700); anim = true; }
        return anim;
      },
      render(cx, now) {
        const p = getPal(), W = cx.canvas.width, H = cx.canvas.height;
        cx.fillStyle = p.bg; cx.fillRect(0, 0, W, H);
        sortCells();
        const x0 = -Cn / 2, x1 = Cn / 2, z0 = -R / 2, z1 = R / 2, floorC = parseColor(p.floor), wallC = parseColor(p.wall);
        /* the floor slab and its grid */
        C.beginPath();
        if (camZ > z1) faceV(x1, z1, x0, z1, -SLAB, 0);
        if (camX < x0) faceV(x0, z1, x0, z0, -SLAB, 0);
        if (camX > x1) faceV(x1, z0, x1, z1, -SLAB, 0);
        if (camZ < z0) faceV(x0, z0, x1, z0, -SLAB, 0);
        C.fillStyle = shade(floorC, p.dark ? 0.7 : 0.82); C.fill();
        C.beginPath(); quadH(x0, z0, x1, z1, 0); C.fillStyle = floorC.css; C.fill();
        C.beginPath();
        for (let r = 0; r <= R; r++) { P(x0, 0, z0 + r); C.moveTo(sx, sy); P(x1, 0, z0 + r); C.lineTo(sx, sy); }
        for (let c = 0; c <= Cn; c++) { P(x0 + c, 0, z0); C.moveTo(sx, sy); P(x0 + c, 0, z1); C.lineTo(sx, sy); }
        C.lineWidth = Math.max(1, 0.9 * DPR); C.strokeStyle = p.grid; C.stroke();
        /* low tiles, batched by color: all sides first, then all tops */
        for (const q of pulses) { const a = (now - q.t0) / 700; if (a < 1) pAge[q.i] = Math.max(0, a); }
        const nS = slotStr.length, cols = slotStr.map(parseColor);
        cols.push(floorC);
        while (buckets.length < nS + 1) buckets.push([]);
        for (let k = 0; k <= nS; k++) buckets[k].length = 0;
        for (let i = 0; i < N; i++) {
          if (wall[i] || hC[i] > FLAT_H) continue;
          const k = slot[i];
          if (k < 0 && hC[i] < 0.004) continue;
          buckets[k < 0 ? nS : k].push(i);
        }
        for (let k = 0; k <= nS; k++) {
          const b = buckets[k];
          if (!b.length) continue;
          C.beginPath(); for (const i of b) sides(i, 0, hC[i]);
          C.fillStyle = shade(cols[k], 0.7); C.fill();
        }
        for (let k = 0; k <= nS; k++) {
          const b = buckets[k];
          if (!b.length) continue;
          C.beginPath(); for (const i of b) { const x = cx0[i], z = cz0[i]; quadH(x - 0.5, z - 0.5, x + 0.5, z + 0.5, hC[i]); }
          C.fillStyle = cols[k].css; C.fill();
        }
        const muted = p.muted;
        for (const m of marks) if (!wall[m.i] && hC[m.i] <= FLAT_H) { C.beginPath(); ring(cx0[m.i], cz0[m.i], hC[m.i] + 0.004, 0.16, 12); C.fillStyle = muted; C.globalAlpha = 0.85; C.fill(); C.globalAlpha = 1; }
        for (const m of [mStart, mGoal]) if (m && !wall[m.i] && hC[m.i] <= FLAT_H) discs(m.i, p);
        for (const q of pulses) if (pAge[q.i] >= 0 && hC[q.i] <= FLAT_H) pulseFx(q.i, p, pAge[q.i]);
        /* walls, lifted tiles, the path, markers and the robot, far to near */
        const pc = pathColor ? parseColor(pathColor).css : p.path;
        const ri = robotC ? idx(Math.round(robotC.r), Math.round(robotC.c)) : -1;
        for (let k = 0; k < N; k++) {
          const i = order[k], w = wall[i];
          if (w || hC[i] > FLAT_H) {
            cellBlock(i, w ? (slot[i] >= 0 ? cols[slot[i]] : wallC) : cols[slot[i] >= 0 ? slot[i] : nS], w ? 1.12 : 1.06);
            if (!w) {
              if (pAge[i] >= 0) pulseFx(i, p, pAge[i]);
              if ((mStart && mStart.i === i) || (mGoal && mGoal.i === i)) discs(i, p);
              for (const m of marks) if (m.i === i) { C.beginPath(); ring(cx0[i], cz0[i], hC[i] + 0.004, 0.16, 12); C.fillStyle = muted; C.fill(); }
            }
          }
          const pa = pathAt[i];
          if (pa) for (const j of pa) pathPiece(j, p, pc);
          if (i === ri) robotDraw(p);
          if ((mStart && mStart.i === i) || (mGoal && mGoal.i === i)) poles(i, p);
        }
        for (const q of pulses) pAge[q.i] = -1;
      },
      /* drawn on top of the cached scene every frame: the hover outline, the pulsing goal ring, labels and the START/GOAL tags */
      overlay(cx, now) {
        const p = getPal(), W = cx.canvas.width, H = cx.canvas.height, reduce = scene.view.reduce;
        if (hover >= 0) {
          const x = cx0[hover], z = cz0[hover];
          C.beginPath(); quadH(x - 0.5, z - 0.5, x + 0.5, z + 0.5, hE(hover) + 0.003);
          C.lineWidth = 2 * DPR; C.strokeStyle = p.ink; C.globalAlpha = 0.85; C.stroke(); C.globalAlpha = 1;
        }
        if (mGoal) {
          const top = hE(mGoal.i) + 0.01, ph = reduce ? 0.35 : (now / 1300) % 1;
          C.beginPath(); ring(cx0[mGoal.i], cz0[mGoal.i], top, 0.45 + 0.75 * ph, 30);
          C.lineWidth = 2.4 * DPR; C.strokeStyle = p.goal; C.globalAlpha = reduce ? 0.8 : 0.95 * (1 - ph); C.stroke(); C.globalAlpha = 1;
        }
        C.textAlign = "center"; C.textBaseline = "bottom"; C.lineJoin = "round";
        C.font = `600 ${11 * DPR}px ${FONT}`;
        for (const m of marks) { if (!m.label) continue; P(cx0[m.i], hE(m.i) + 0.3, cz0[m.i]); haloText(m.label, sx, sy - 2 * DPR, p.muted, p.bg); }
        /* labels sit on their tile, as large as the tile allows (big letters on small maps) */
        C.textBaseline = "middle";
        const busy = [[0, 0, 330 * DPR, 40 * DPR]];   // the toolbar, then every label and tag drawn: START/GOAL tags avoid them
        for (const l of labels) {
          P(l.c + 0.5 - Cn / 2, hE(l.i) + 0.04, l.r + 0.5 - R / 2);
          const fs = Math.round(clamp((0.5 * FZ) / sz, 11 * DPR, 26 * DPR));
          C.font = `700 ${fs}px ${FONT}`;
          haloText(l.text, sx, sy, p.ink, p.bg);
          const hw = C.measureText(l.text).width / 2 + 2 * DPR;
          busy.push([sx - hw, sy - fs / 2, sx + hw, sy + fs / 2]);
        }
        C.textBaseline = "bottom";
        const overlap = (x0, y0, x1, y1) => { let a = 0; for (const b of busy) a += Math.max(0, Math.min(x1, b[2]) - Math.max(x0, b[0])) * Math.max(0, Math.min(y1, b[3]) - Math.max(y0, b[1])); return a; };
        const tag = (m, word, hgt, bg, pin) => {
          P(cx0[m.i], hE(m.i) + hgt, cz0[m.i]);
          if (sx < 0 || sx > W || sy < 0 || sy > H + 20 * DPR) return;   // the marker is off screen
          const t = m.label ? `${word} · ${m.label}` : word;
          C.font = `700 ${11.5 * DPR}px ${FONT}`;
          const extra = pin ? Math.max(5.5 * DPR, 0.22 * FZ / sz) + 2 * DPR : 2 * DPR;
          const w = C.measureText(t).width + 14 * DPR, h = 20 * DPR, ax = sx, ay = sy - extra, g = 8 * DPR;
          /* above the marker if that is free, else beside or below it, wherever it covers the least */
          let best = null;
          for (const [x, y] of [[ax - w / 2, ay - h - 7 * DPR], [ax + g, ay - h - g / 2], [ax - w - g, ay - h - g / 2], [ax + 2 * g, ay - h / 2], [ax - w - 2 * g, ay - h / 2], [ax - w / 2, sy + 2.2 * g]]) {
            const bx = clamp(x, 4 * DPR, W - w - 4 * DPR), by = clamp(y, 4 * DPR, H - h - 4 * DPR), s = overlap(bx, by, bx + w, by + h);
            if (!best || s < best.s - 1) best = { bx, by, s };
            if (!s) break;
          }
          const { bx, by } = best;
          busy.push([bx, by, bx + w, by + h]);
          C.globalAlpha = 1;
          const px = clamp(ax, bx + 6 * DPR, bx + w - 6 * DPR), py = clamp(ay, by, by + h);
          if (Math.hypot(px - ax, py - ay) > 2 * DPR) { C.beginPath(); C.moveTo(px, py); C.lineTo(ax, ay); C.lineWidth = 2 * DPR; C.strokeStyle = bg; C.stroke(); }
          rrect(bx, by, w, h, 6 * DPR); C.fillStyle = bg; C.fill();
          C.lineWidth = 1.5 * DPR; C.strokeStyle = p.panel; C.stroke();
          C.fillStyle = textOn(bg); C.textBaseline = "middle"; C.fillText(t, bx + w / 2, by + h / 2 + 0.5 * DPR); C.textBaseline = "bottom";
        };
        if (mStart) tag(mStart, "START", POLE_S, p.start, true);
        if (mGoal) tag(mGoal, "GOAL", POLE_G, p.goal, false);
        return !!mGoal && !reduce;
      },
      /* the tile under a screen point: test tops and visible sides, nearest cells first */
      pick(px, py) {
        sortCells();
        const qx = [0, 0, 0, 0], qy = [0, 0, 0, 0];
        const inQuad = () => {
          let pos = false, neg = false;
          for (let k = 0; k < 4; k++) {
            const k2 = (k + 1) & 3, cr = (qx[k2] - qx[k]) * (py - qy[k]) - (qy[k2] - qy[k]) * (px - qx[k]);
            if (cr > 0) pos = true; else if (cr < 0) neg = true;
            if (pos && neg) return false;
          }
          return true;
        };
        const put = (k, x, y, z) => { P(x, y, z); qx[k] = sx; qy[k] = sy; };
        const face = (ax, az, bx, bz, lo, hi) => { put(0, ax, lo, az); put(1, bx, lo, bz); put(2, bx, hi, bz); put(3, ax, hi, az); return inQuad(); };
        for (let k = N - 1; k >= 0; k--) {
          const i = order[k], h = hE(i), x0 = cx0[i] - 0.5, x1 = x0 + 1, z0 = cz0[i] - 0.5, z1 = z0 + 1;
          put(0, x0, h, z0); put(1, x1, h, z0); put(2, x1, h, z1); put(3, x0, h, z1);
          if (inQuad()) return i;
          if (h > 0.02) {
            if (camX < x0 && face(x0, z1, x0, z0, 0, h)) return i;
            if (camX > x1 && face(x1, z0, x1, z1, 0, h)) return i;
            if (camZ < z0 && face(x0, z0, x1, z0, 0, h)) return i;
            if (camZ > z1 && face(x1, z1, x0, z1, 0, h)) return i;
          }
        }
        return -1;
      },
    };
    return scene;
  }

  /* ---------- the search tree ---------- */
  const KINDS = ["start", "frontier", "expanded", "current", "path", "goal", "cutoff"];
  const KIND_TEXT = { start: "start", frontier: "frontier", expanded: "expanded", current: "being expanded", path: "solution path", goal: "goal", cutoff: "cut off (depth limit)" };
  const LABEL_RANK = { current: 1, goal: 2, start: 3, path: 4, frontier: 5, expanded: 6, cutoff: 7 };
  function treeScene() {
    const LEVEL = 1.6, SLOT = 1.25, SPACE = 1.2, NODE_R = 0.27, GROW = 450;
    let recs = new Map(), list = [], rings = [], focusId = null, pendingFocus = false, bounds = [-1, 1, -1, 1, -1, 1];
    const fitPts = [];
    const legend = el("div", "legend");
    const swatches = {};
    for (const k of KINDS) {
      const s = el("span"), i = el("i");
      if (k === "cutoff") i.className = "l3d-hollow"; else i.style.borderRadius = "50%";
      s.append(i, KIND_TEXT[k]); legend.append(s); swatches[k] = i;
    }
    const paintLegend = () => { const p = getPal(); for (const k of KINDS) if (k !== "cutoff") swatches[k].style.background = p[k]; else swatches[k].style.borderColor = p.cutoff; };

    function layout(nodes) {
      const ids = new Map();
      for (const n of nodes) if (n && n.id != null && !ids.has(n.id)) ids.set(n.id, n);
      const kids = new Map(), roots = [];
      for (const n of ids.values()) {
        const pid = n.parent;
        if (pid == null || pid === n.id || !ids.has(pid)) roots.push(n.id);
        else { if (!kids.has(pid)) kids.set(pid, []); kids.get(pid).push(n.id); }
      }
      /* breadth-first from the roots: depth; nodes caught in a parent cycle become roots */
      const depth = new Map(), bfs = [];
      const visit = (rid) => { depth.set(rid, 0); bfs.push(rid); for (let q = bfs.length - 1; q < bfs.length; q++) { const id = bfs[q]; for (const c of kids.get(id) || []) if (!depth.has(c)) { depth.set(c, depth.get(id) + 1); bfs.push(c); } } };
      for (const rid of roots) visit(rid);
      for (const id of ids.keys()) if (!depth.has(id)) { roots.push(id); visit(id); }
      const leaves = new Map();
      for (let q = bfs.length - 1; q >= 0; q--) { const id = bfs[q], ks = (kids.get(id) || []).filter((c) => depth.get(c) === depth.get(id) + 1); leaves.set(id, ks.length ? ks.reduce((s, c) => s + leaves.get(c), 0) : 1); }
      const kidsOf = (id) => (kids.get(id) || []).filter((c) => depth.get(c) === depth.get(id) + 1);
      const cone = new Map(), flat = new Map(), ringsOut = [];
      /* cones: each root tree on its own axis; a node's children share its angular span by their leaf counts; the radius of a level grows with its size */
      let xoff = 0;
      roots.forEach((rid, t) => {
        const members = [], perDepth = [];
        const st = [rid];
        while (st.length) { const id = st.pop(); members.push(id); const d = depth.get(id); perDepth[d] = (perDepth[d] || 0) + 1; for (const c of kidsOf(id)) st.push(c); }
        const rad = perDepth.map((n, d) => (n <= 1 ? 0 : Math.max(Math.min(d, 3) * 1.05, (n * SPACE) / TAU)));
        const maxR = Math.max(0.6, ...rad);
        if (t) xoff += maxR + 1.4;
        const span = new Map([[rid, [Math.PI, Math.PI + TAU]]]);
        const q = [rid];
        for (let k = 0; k < q.length; k++) {
          const id = q[k], [a0, a1] = span.get(id), d = depth.get(id), mid = (a0 + a1) / 2;
          cone.set(id, [xoff + rad[d] * Math.cos(mid), -d * LEVEL, rad[d] * -Math.sin(mid)]);
          let a = a0;
          const ks = kidsOf(id), tot = ks.reduce((s, c) => s + leaves.get(c), 0) || 1;
          for (const c of ks) { const w = ((a1 - a0) * leaves.get(c)) / tot; span.set(c, [a, a + w]); a += w; q.push(c); }
        }
        rad.forEach((r, d) => { if (r > 0) ringsOut.push({ x: xoff, y: -d * LEVEL, r }); });
        xoff += maxR;
      });
      /* flat: leaves on consecutive slots in order, parents centered over their children (in slot units, centered on 0) */
      let slot = 0;
      const place = (rid) => {
        const st = [[rid, 0]];
        while (st.length) {
          const top = st[st.length - 1], [id, k] = top, ks = kidsOf(id);
          if (!ks.length) { flat.set(id, slot++); st.pop(); continue; }
          if (k < ks.length) { top[1]++; st.push([ks[k], 0]); continue; }
          flat.set(id, (flat.get(ks[0]) + flat.get(ks[ks.length - 1])) / 2);
          st.pop();
        }
        slot += 0.6;
      };
      for (const rid of roots) place(rid);
      let fx0 = Infinity, fx1 = -Infinity, cxa = Infinity, cxb = -Infinity;
      for (const v of flat.values()) { fx0 = Math.min(fx0, v); fx1 = Math.max(fx1, v); }
      for (const v of cone.values()) { cxa = Math.min(cxa, v[0]); cxb = Math.max(cxb, v[0]); }
      const fm = (fx0 + fx1) / 2 || 0, cm = (cxa + cxb) / 2 || 0;
      for (const [id, v] of flat) flat.set(id, v - fm);
      /* cone level spacing follows the spread, so the cones stay cone-shaped */
      let maxD = 1, maxR = 0;
      for (const d of depth.values()) maxD = Math.max(maxD, d);
      for (const r of ringsOut) maxR = Math.max(maxR, r.r);
      const cg = clamp((maxR * 0.95) / maxD, 1, 4.5) / LEVEL;
      for (const v of cone.values()) { v[0] -= cm; v[1] *= cg; }
      for (const r of ringsOut) { r.x -= cm; r.y *= cg; }
      return { ids, depth, cone, flat, span: flat.size ? fx1 - fx0 : 0, maxD, rings: ringsOut };
    }
    /* the flat diagram runs top-down, or left to right when that draws it larger in this box (deep, narrow trees such as a DFS chain);
       the level gap stretches the diagram toward the shape of the box */
    let FL = { flat: new Map(), depth: new Map(), span: 0, maxD: 1 }, fdir = { horiz: false, gap: 1.6 }, aspectKey = 0;
    function chooseFlat() {
      const z = scene.view.size(), d = z.dpr;
      const W = z.W ? (z.W - 28 * d) / d : 900, H = z.H ? (z.H - 84 * d) / d : 300;
      const A = W / Math.max(40, H), span = (FL.span + 1) * SLOT, D = Math.max(1, FL.maxD);
      const gv = clamp(span / (A * D), 1.3, 4), sV = Math.min(W / (span + 1), H / (D * gv + 1.4));
      const gh = clamp((A * span) / D, 1.5, 4), sH = Math.min(W / (D * gh + 1.4), H / (span + 1.4));
      fdir = sH > sV * 1.2 ? { horiz: true, gap: gh } : { horiz: false, gap: gv };
      aspectKey = Math.round(A * 8);
    }
    const flatPos = (id) => { const s = FL.flat.get(id) || 0, d = FL.depth.get(id) || 0; return fdir.horiz ? [d * fdir.gap, -s * SLOT, 0] : [s * SLOT, -d * fdir.gap, 0]; };

    const scene = {
      height: 380, aria: "Search tree. Drag to orbit, scroll to zoom.", topLabel: "Flat view", panPlane: "view",
      views: { "3d": { yaw: 0.5, pitch: 0.36 }, top: { yaw: 0, pitch: 0 } }, pitchMin: -0.35, pitchMax: 1.45,
      minScale: 26, maxScale: 64,   // css pixels per layout unit: nodes and labels stay readable, small trees do not balloon
      padTop: 16,   // the root's rings must clear the toolbar even when the tree is drawn small
      extra: legend,
      bounds: () => bounds,
      fitPoints: () => fitPts,
      cellOf: () => null,
      onTheme: paintLegend,
      update(s) {
        s = s || {};
        const now = performance.now(), reduce = scene.view.reduce;
        const L = layout(Array.isArray(s.nodes) ? s.nodes : []);
        FL = L; chooseFlat();
        const next = new Map(), nl = [];
        for (const [id, n] of L.ids) {
          let r = recs.get(id);
          const kind = KINDS.includes(n.kind) ? n.kind : "expanded";
          if (!r) {
            const pr = n.parent != null ? recs.get(n.parent) || next.get(n.parent) : null;
            const tc = L.cone.get(id), tf = flatPos(id);
            r = { id, born: reduce || !recs.size ? -1e9 : now, c: pr ? pr.c.slice() : tc.slice(), f: pr ? pr.f.slice() : tf.slice(), x: 0, y: 0, z: 0, px: 0, py: 0, pz: 1, g: 1 };
          }
          r.parent = n.parent != null && L.ids.has(n.parent) && n.parent !== id ? n.parent : null;
          r.kind = kind; r.label = n.label != null ? String(n.label) : String(id); r.d = L.depth.get(id);
          r.tc = L.cone.get(id); r.tf = flatPos(id);
          if (reduce) { r.c = r.tc.slice(); r.f = r.tf.slice(); }
          next.set(id, r); nl.push(r);
        }
        recs = next; list = nl; rings = L.rings;
        scene.minScale = nl.some((r) => r.label.trim()) ? 26 : 3;   // unlabeled trees (the size of a search) may shrink to dots to show it whole
        const f = s.focus != null && recs.has(s.focus) ? s.focus : null;
        if (f !== focusId) { focusId = f; pendingFocus = f != null; }
        if (!scene.view.floored && scene.view.cur.zoom <= 1) scene.view.recenter();
        scene.step(0, now);
        scene.view.invalidate();
      },
      step(dt, now) {
        const k = scene.view.reduce ? 1 : 1 - Math.exp(-dt * 7), fl = smooth(scene.view.cur.flat);
        const sz0 = scene.view.size();
        if (list.length && sz0.W && Math.round(((sz0.W - 28 * sz0.dpr) / Math.max(40 * sz0.dpr, sz0.H - 84 * sz0.dpr)) * 8) !== aspectKey) {
          chooseFlat();   // the box changed shape: lay the flat diagram out again
          for (const r of list) r.tf = flatPos(r.id);
        }
        let anim = false, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        fitPts.length = 0;
        for (const r of list) {
          for (const [a, t] of [[r.c, r.tc], [r.f, r.tf]]) for (let q = 0; q < 3; q++) {
            const d = t[q] - a[q];
            if (d === 0) continue;
            a[q] = Math.abs(d) < 1e-3 ? t[q] : a[q] + d * k;
            anim = true;
          }
          r.g = smooth((now - r.born) / GROW);
          if (r.g < 1) anim = true;
          r.x = r.c[0] + (r.f[0] - r.c[0]) * fl; r.y = r.c[1] + (r.f[1] - r.c[1]) * fl; r.z = r.c[2] + (r.f[2] - r.c[2]) * fl;
          if (r.x < x0) x0 = r.x; if (r.x > x1) x1 = r.x; if (r.y < y0) y0 = r.y; if (r.y > y1) y1 = r.y; if (r.z < z0) z0 = r.z; if (r.z > z1) z1 = r.z;
          fitPts.push(r.x, r.y + 0.4, r.z, r.x, r.y - 0.9, r.z);
        }
        bounds = list.length ? [x0 - 0.7, x1 + 0.7, y0 - 0.9, y1 + 0.5, z0 - 0.7, z1 + 0.7] : [-1, 1, -1, 1, -1, 1];
        return anim;
      },
      render(cx) {
        const p = getPal(), W = cx.canvas.width, H = cx.canvas.height, V = scene.view, fl = V.fl;
        cx.fillStyle = p.bg; cx.fillRect(0, 0, W, H);
        for (const r of list) { P(r.x, r.y, r.z); r.px = sx; r.py = sy; r.pz = sz; }
        /* one faint ring per level of each cone */
        if (fl < 0.98 && rings.length) {
          C.beginPath(); for (const g of rings) ring(g.x, g.z, g.y, g.r, 48);
          C.globalAlpha = 0.9 * (1 - fl); C.lineWidth = DPR; C.strokeStyle = p.line; C.stroke(); C.globalAlpha = 1;
        }
        /* edges, then the solution path edges on top */
        const onPath = (r) => r.kind === "path" || r.kind === "goal";
        C.lineCap = "round"; C.lineJoin = "round";
        C.beginPath();
        for (const r of list) { const q = r.parent != null ? recs.get(r.parent) : null; if (q && !(onPath(r) && (onPath(q) || q.kind === "start"))) { C.moveTo(q.px, q.py); C.lineTo(r.px, r.py); } }
        C.lineWidth = 1.4 * DPR; C.strokeStyle = p.edge; C.stroke();
        C.beginPath();
        for (const r of list) { const q = r.parent != null ? recs.get(r.parent) : null; if (q && onPath(r) && (onPath(q) || q.kind === "start")) { C.moveTo(q.px, q.py); C.lineTo(r.px, r.py); } }
        C.lineWidth = 3.2 * DPR; C.strokeStyle = p.path; C.stroke();
        /* nodes far to near; far nodes fade a little so the cone reads in depth */
        const byDepth = list.slice().sort((a, b) => b.pz - a.pz);
        const fogR = Math.max(1, V.R);
        for (const r of byDepth) {
          const rad = clamp(NODE_R * (FZ / r.pz) * (r.kind === "start" || r.kind === "current" ? 1.25 : 1), 4 * DPR, 18 * DPR) * Math.max(0.05, r.g);
          C.globalAlpha = 1 - 0.5 * clamp((r.pz - V.D) / fogR, 0, 1) * (1 - fl);
          const col = p[r.kind];
          C.beginPath(); C.arc(r.px, r.py, rad, 0, TAU);
          if (r.kind === "cutoff") {
            C.fillStyle = p.bg; C.fill(); C.lineWidth = 1.6 * DPR; C.strokeStyle = col; C.stroke();
            const d = rad * 0.5; C.beginPath(); C.moveTo(r.px - d, r.py - d); C.lineTo(r.px + d, r.py + d); C.moveTo(r.px + d, r.py - d); C.lineTo(r.px - d, r.py + d); C.stroke();
          } else {
            C.fillStyle = col; C.fill();
            C.lineWidth = Math.max(1, 1.2 * DPR); C.strokeStyle = shade(parseColor(col), 0.72); C.stroke();
            if (rad > 4 * DPR) { C.beginPath(); C.arc(r.px - rad * 0.3, r.py - rad * 0.32, rad * 0.36, 0, TAU); C.fillStyle = "rgba(255,255,255,0.38)"; C.fill(); }
          }
          if (r.kind === "current" || r.kind === "goal" || r.kind === "start") { C.beginPath(); C.arc(r.px, r.py, rad + 3.5 * DPR, 0, TAU); C.lineWidth = 2 * DPR; C.strokeStyle = col; C.stroke(); }
          if (r.id === focusId) { C.beginPath(); C.arc(r.px, r.py, rad + 7 * DPR, 0, TAU); C.lineWidth = 1.6 * DPR; C.strokeStyle = p.ink; C.stroke(); }
        }
        C.globalAlpha = 1;
        /* labels under the nodes, most important first, skipping any that would overlap one already placed */
        const lh = 15 * DPR, placed = [];
        C.font = `600 ${13 * DPR}px ${FONT}`; C.textAlign = "center"; C.textBaseline = "top"; C.lineJoin = "round";
        const cand = list.filter((r) => r.g > 0.6 && r.px > -50 && r.px < W + 50 && r.py > -50 && r.py < H + 50)
          .sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : 0) || LABEL_RANK[a.kind] - LABEL_RANK[b.kind] || a.pz - b.pz);
        for (const r of cand) {
          const lines = r.label.split("\n"), rad = clamp(NODE_R * (FZ / r.pz), 4 * DPR, 18 * DPR);
          let w = 0;
          for (const t of lines) w = Math.max(w, C.measureText(t).width);
          const bx0 = r.px - w / 2 - 2 * DPR, by0 = r.py + rad + 2 * DPR, bx1 = r.px + w / 2 + 2 * DPR, by1 = by0 + lines.length * lh;
          let hit = false;
          for (const b of placed) if (bx0 < b[2] && bx1 > b[0] && by0 < b[3] && by1 > b[1]) { hit = true; break; }
          if (hit) continue;
          placed.push([bx0, by0, bx1, by1]);
          lines.forEach((t, k) => haloText(t, r.px, by0 + k * lh, r.kind === "expanded" || r.kind === "cutoff" ? p.muted : p.ink, p.bg));
        }
        /* keep the focus in view: when it gets near an edge (or off screen), glide the camera to it */
        if (pendingFocus) {
          const f = recs.get(focusId);
          pendingFocus = false;
          if (f) {
            const tx = f.tc[0] + (f.tf[0] - f.tc[0]) * fl, ty = f.tc[1] + (f.tf[1] - f.tc[1]) * fl, tz = f.tc[2] + (f.tf[2] - f.tc[2]) * fl;
            P(tx, ty, tz);
            const mx = 0.12 * W, my = 0.1 * (H - V.mt - V.mb);
            if (sx < mx || sx > W - mx || sy < V.mt + my || sy > H - V.mb - my) V.panTo(tx, ty, tz);
          }
        }
      },
      overlay: () => false,
    };
    paintLegend();
    return scene;
  }

  function api(scene, opts) {
    const v = makeView(opts || {}, scene);
    v.update = (s) => scene.update(s);
    return v;
  }
  window.Lab3D = {
    grid(o) { o = o || {}; return api(gridScene(o), o); },
    tree(o) { o = o || {}; return api(treeScene(o), { ...o, view: o.view || "flat" }); },
    palette() { const p = getPal(); const out = {}; for (const k in p) if (k !== "dark") out[k] = p[k]; out.dark = p.dark; return out; },
  };
})();
