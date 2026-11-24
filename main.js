/* =========================================================
   1a. Background effect "web": soft cosmic web over the page, condensing at the cursor
   ========================================================= */
(function () {
  const canvas = document.getElementById("web");
  if (!canvas || document.body.dataset.effect !== "web") return;
  const ctx = canvas.getContext("2d");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.getElementById("hud").innerHTML =
    '<span class="k">cosmic web</span>' +
    '<span>local z ≈ <b id="ro-z">6.0</b></span>' +
    '<span>haloes <b id="ro-h">0</b></span>' +
    '<span>galaxies <b id="ro-g">0</b></span>';
  const note = document.getElementById("fx-note");
  if (note) note.textContent = "Background: a toy cosmic web. Move the cursor and matter drains along filaments into haloes, where galaxies form.";
  const roZ = document.getElementById("ro-z"), roH = document.getElementById("ro-h"), roG = document.getElementById("ro-g");

  let W, H, RI, nodes = [], parts = [], voids = [], fils = [];
  let off, octx, img, buf;   // offscreen particle layer at CSS-pixel resolution
  const CELL = 3;            // density field resolution (CSS px per cell)
  let GW, GH, dens, tmp, gcan, gctx, gimg, gbuf;
  const cursor = { x: -9999, y: -9999, on: false, str: 0 };
  const ghost = { x: 0, y: 0 };
  let t0 = performance.now(), running = false, lastW = 0, lastH = 0;

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2832 * v); }
  const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
  const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const smooth = x => x * x * (3 - 2 * x);

  function build() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight; lastW = W; lastH = H;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    RI = Math.max(120, Math.min(240, W * 0.17));
    off = document.createElement("canvas"); off.width = W; off.height = H;
    octx = off.getContext("2d");
    img = octx.createImageData(W, H); buf = new Uint32Array(img.data.buffer);
    GW = Math.ceil(W / CELL); GH = Math.ceil(H / CELL);
    dens = new Float32Array(GW * GH); tmp = new Float32Array(GW * GH);
    gcan = document.createElement("canvas"); gcan.width = GW; gcan.height = GH;
    gctx = gcan.getContext("2d");
    gimg = gctx.createImageData(GW, GH); gbuf = new Uint32Array(gimg.data.buffer);
    const wide = W > 820;
    const r = rng(42);

    // nodes = future haloes, with a skewed mass distribution
    nodes = [];
    const nN = Math.max(60, Math.round((W + 120) * (H + 120) / 6500));
    // clustered node positions: most nodes gather around a few "supercluster" seeds
    const seeds = Array.from({ length: Math.max(4, Math.round(W * H / 160000)) }, () => [r() * W, r() * H]);
    const sig = Math.max(W, H) * 0.11;
    for (let i = 0; i < nN; i++) {
      let x, y, m;
      if (r() < 0.6) {
        const s = seeds[Math.floor(r() * seeds.length)];
        x = s[0] + gauss(r) * sig; y = s[1] + gauss(r) * sig;
        m = 0.35 + Math.pow(r(), 2.5) * 3;
      } else {
        x = -60 + r() * (W + 120); y = -60 + r() * (H + 120);
        m = 0.25 + Math.pow(r(), 4) * 1.5;
      }
      nodes.push({ x, y, m, s: 0, k: 0.8 + r() * 0.5, rot: r() * Math.PI, kind: r() < 0.25 + 0.2 * m ? "ell" : "disk", tilt: 0.35 + r() * 0.5 });
    }

    // filaments: connect each node to its nearest neighbours
    const edges = new Set(), maxLen = Math.max(W, H) * 0.24;
    const key = (i, j) => i < j ? i + "-" + j : j + "-" + i;
    // 1) minimum spanning tree: every node is connected, no isolated islands
    const inTree = new Array(nodes.length).fill(false), best = new Array(nodes.length).fill(Infinity), from = new Array(nodes.length).fill(-1);
    best[0] = 0;
    for (let it = 0; it < nodes.length; it++) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
      inTree[u] = true;
      if (from[u] >= 0) edges.add(key(u, from[u]));
      for (let v = 0; v < nodes.length; v++) {
        if (inTree[v]) continue;
        const d = Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y);
        if (d < best[v]) { best[v] = d; from[v] = u; }
      }
    }
    // 2) plus each node's nearest neighbours, so the tree becomes a web with loops
    nodes.forEach((a, i) => {
      const k = a.m > 1.2 ? 5 : 4;            // massive nodes are hubs with more filaments
      nodes.map((b, j) => [j, Math.hypot(a.x - b.x, a.y - b.y)])
        .filter(([j]) => j !== i).sort((p, q) => p[1] - q[1]).slice(0, k)
        .forEach(([j, d]) => { if (d < maxLen) edges.add(key(i, j)); });
    });

    const dim = () => 1;
    parts = []; fils = [];
    edges.forEach(key => {
      const [i, j] = key.split("-").map(Number), a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
      const nx = -dy / L, ny = dx / L;
      const split = a.m / (a.m + b.m);          // heavier node captures more of the filament
      const mm = (a.m + b.m) / 2;                  // filaments between massive nodes are richer
      const n = Math.round(L / 1.3 * (0.45 + 0.55 * mm));
      const bend = gauss(r) * L * 0.08;          // filaments are gently curved…
      const wob = gauss(r) * L * 0.035, ph = r() * 6.2832, wf = 0.7 + r() * 0.6;   // …with a little irregularity
      fils.push({ a, b, cx: (a.x + b.x) / 2 + nx * bend * 2, cy: (a.y + b.y) / 2 + ny * bend * 2, mm, s: 0 });
      for (let k = 0; k < n; k++) {
        const t = r();
        const curve = Math.sin(Math.PI * t) * bend + Math.sin(2 * Math.PI * t * wf + ph) * Math.sin(Math.PI * t) * wob;
        const ax = a.x + dx * t + nx * curve, ay = a.y + dy * t + ny * curve;
        const width = (2.5 + 7 * Math.sin(Math.PI * t)) * (0.6 + 0.35 * mm) * (0.75 + 0.5 * Math.abs(Math.sin(5 * t + ph)));  // pinched at nodes, uneven along
        const o = gauss(r) * width;
        const home = t < split ? a : b;
        const hr = 3 + 5 * Math.sqrt(home.m);
        // matter close to a node falls into the halo; the rest settles onto the
        // filament spine, so the web gets thinner and sharper instead of vanishing
        const along = home === a ? t : 1 - t;
        const falls = along < 0.2 + 0.25 * r();
        const sj = gauss(r) * 1.3;
        parts.push({
          hx: ax + nx * o, hy: ay + ny * o, ax, ay,
          tx: falls ? home.x + gauss(r) * hr : ax + nx * sj,
          ty: falls ? home.y + gauss(r) * hr : ay + ny * sj,
          node: home, s: 0, sz: r() < 0.1 ? 2 : 1, d: dim(ax)
        });
      }
    });
    // knots already denser around nodes
    nodes.forEach(nd => {
      const n = Math.round(14 * nd.m), hr = 3 + 5 * Math.sqrt(nd.m);
      for (let k = 0; k < n; k++) {
        const rr = 10 + Math.abs(gauss(r)) * 14 * Math.sqrt(nd.m), a = r() * 6.2832;
        const x = nd.x + Math.cos(a) * rr, y = nd.y + Math.sin(a) * rr;
        parts.push({ hx: x, hy: y, ax: x, ay: y, tx: nd.x + gauss(r) * hr, ty: nd.y + gauss(r) * hr, node: nd, s: 0, sz: r() < 0.3 ? 2 : 1, d: dim(x) });
      }
    });
    // a sprinkle of void particles that never collapse
    voids = [];
    for (let i = 0, n = Math.round(W * H / 3800); i < n; i++) { const x = r() * W; voids.push([x, r() * H, dim(x)]); }

    if (reduce) { // static, half-collapsed picture
      const cx = wide ? W * 0.72 : W * 0.75, cy = wide ? H * 0.45 : H * 0.18;
      for (const p of parts) p.s = 0.9 * infl(p.hx, p.hy, cx, cy, 1);
      for (const n of nodes) n.s = 0.95 * infl(n.x, n.y, cx, cy, 1);
    }
  }

  // --- keep the web soft behind text: cache text boxes in page coordinates ---
  const TEXT_SEL = ".eyebrow, h1, .lede, .links, .sec-head, .prose, .tags, .pub-bar, .pubs li, " +
                   ".timeline li, .step, .col-title, .contact-grid, footer";
  let boxes = [];
  function measure() {
    const sy = window.scrollY;
    maskY = null;
    boxes = [...document.querySelectorAll(TEXT_SEL)].map(el => {
      const r = el.getBoundingClientRect();
      return r.width && r.height ? [r.left, r.top + sy, r.width, r.height] : null;
    }).filter(Boolean);
  }
  // the blurred mask is only re-rendered when the page scrolls or the layout changes
  let mask, mctx, maskY = null;
  function softenText() {
    const sy = Math.round(window.scrollY), pad = 14;
    if (!mask || mask.width !== W || mask.height !== H) {
      mask = document.createElement("canvas"); mask.width = W; mask.height = H;
      mctx = mask.getContext("2d"); maskY = null;
    }
    if (maskY !== sy) {
      maskY = sy;
      mctx.clearRect(0, 0, W, H);
      // draw the boxes off-canvas and keep only their blurred shadow (works in every browser)
      const OFF = 10000;
      mctx.save();
      mctx.shadowColor = "rgba(0,0,0,0.6)";
      mctx.shadowBlur = 40;
      mctx.shadowOffsetX = OFF;
      mctx.fillStyle = "#000";
      mctx.beginPath();
      for (const [x, y, w, h] of boxes) {
        const top = y - sy;
        if (top > H + 40 || top + h < -40) continue;
        mctx.rect(x - pad - OFF, top - pad, w + 2 * pad, h + 2 * pad);
      }
      mctx.fill();
      mctx.restore();
    }
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(mask, 0, 0, W, H);
    ctx.restore();
  }
  let mt;
  const remeasure = () => { clearTimeout(mt); mt = setTimeout(measure, 120); };
  window.addEventListener("resize", remeasure);
  document.addEventListener("click", remeasure);           // e.g. publication filters
  window.addEventListener("load", measure);
  document.fonts?.ready.then(measure);
  setTimeout(measure, 1500);                               // after reveal animations settle

  function infl(x, y, cx, cy, str) {
    const dx = x - cx, dy = y - cy, d2 = dx * dx + dy * dy;
    if (d2 >= RI * RI) return 0;                 // cheap early-out for everything far from the cursor
    const f = clamp01((RI - Math.sqrt(d2)) / (RI * 0.65));
    return f * f * (3 - 2 * f) * str;
  }

  function wander(now) {
    const t = (now - t0) / 1000;
    ghost.x = W * (0.55 + 0.32 * Math.sin(t * 0.09));
    ghost.y = H * (0.5 + 0.32 * Math.sin(t * 0.13 + 1));
  }

  // colour/alpha lookup by collapse state: cool grey-blue → bright warm white
  const LUT = 32, lutCol = new Uint32Array(LUT), lutA = new Uint8Array(LUT);
  for (let i = 0; i < LUT; i++) {
    const s = i / (LUT - 1);
    const rr = Math.round(150 + 105 * s), gg = Math.round(170 + 60 * s), bb = Math.round(205 - 15 * s);
    const al = Math.round(255 * (0.22 + 0.6 * s));
    lutA[i] = al; lutCol[i] = ((al << 24) | (bb << 16) | (gg << 8) | rr) >>> 0;
  }
  const VOID_A = Math.round(255 * 0.26), VOID_COL = ((VOID_A << 24) | (205 << 16) | (170 << 8) | 150) >>> 0;

  // separable box blur (running sums), radius r, in place via tmp
  function blur(a, t, w, h, r) {
    const k = 1 / (2 * r + 1);
    for (let y = 0; y < h; y++) {
      const row = y * w; let s = a[row] * (r + 1);
      for (let x = 1; x <= r; x++) s += a[row + Math.min(x, w - 1)];
      for (let x = 0; x < w; x++) {
        t[row + x] = s * k;
        const add = x + r + 1 < w ? a[row + x + r + 1] : a[row + w - 1];
        const sub = x - r >= 0 ? a[row + x - r] : a[row];
        s += add - sub;
      }
    }
    for (let x = 0; x < w; x++) {
      let s = t[x] * (r + 1);
      for (let y = 1; y <= r; y++) s += t[Math.min(y, h - 1) * w + x];
      const last = (h - 1) * w + x;
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s * k;
        const add = y + r + 1 < h ? t[(y + r + 1) * w + x] : t[last];
        const sub = y - r >= 0 ? t[(y - r) * w + x] : t[x];
        s += add - sub;
      }
    }
  }
  // density → colour lookup (log-scaled), built once
  const CM = 1024, DQ = 40, cmap = new Uint32Array(CM);
  (function () {
    const stops = [ // t, r, g, b, alpha
      [0.00,  30,  45,  90, 0.00],
      [0.18,  45,  70, 140, 0.12],
      [0.40,  85, 130, 205, 0.32],
      [0.62, 150, 200, 245, 0.62],
      [0.80, 225, 238, 255, 0.88],
      [0.92, 255, 214, 170, 0.95],
      [1.00, 255, 246, 232, 1.00]];
    const dmax = CM / DQ;
    for (let i = 0; i < CM; i++) {
      const d = i / DQ, t = Math.log1p(d * 3) / Math.log1p(dmax * 3);
      let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
      const A = stops[k], B = stops[k + 1], f = Math.min(1, Math.max(0, (t - A[0]) / (B[0] - A[0])));
      const c = A.slice(1).map((v, n) => v + (B[n + 1] - v) * f);
      const al = Math.round(255 * c[3]);
      cmap[i] = ((al << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0;
    }
  })();

  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    const usingGhost = !cursor.on && !reduce;
    const cx = cursor.on ? cursor.x : ghost.x, cy = cursor.on ? cursor.y : ghost.y;
    const str = cursor.on ? 1 : 0.8;

    // particles: written straight into a pixel buffer (much faster than drawing ~20k shapes)
    buf.fill(0); dens.fill(0);
    const plot = (x, y, sz, col, al) => {
      const x0 = x | 0, y0 = y | 0;
      for (let yy = y0; yy < y0 + sz; yy++) {
        if (yy < 0 || yy >= H) continue;
        const row = yy * W;
        for (let xx = x0; xx < x0 + sz; xx++) {
          if (xx < 0 || xx >= W) continue;
          const i = row + xx;
          if ((buf[i] >>> 24) < al) buf[i] = col;
        }
      }
    };
    for (let i = 0; i < voids.length; i++) plot(voids[i][0], voids[i][1], 1, VOID_COL, VOID_A);
    for (const p of parts) {
      if (!reduce) {
        const tgt = infl(p.hx, p.hy, cx, cy, str);
        const ds = (tgt - p.s) * (tgt > p.s ? 0.045 * p.node.k : 0.01);
        if (ds > 1e-4 || ds < -1e-4 || p.x === undefined) {
          p.s += ds;
          const u = 1 - Math.pow(1 - p.s, 1.6), v = 1 - u;   // quadratic Bézier through the filament spine
          p.x = v * v * p.hx + 2 * u * v * p.ax + u * u * p.tx;
          p.y = v * v * p.hy + 2 * u * v * p.ay + u * u * p.ty;
        }
      } else {
        const u = 1 - Math.pow(1 - p.s, 1.6), v = 1 - u;
        p.x = v * v * p.hx + 2 * u * v * p.ax + u * u * p.tx;
        p.y = v * v * p.hy + 2 * u * v * p.ay + u * u * p.ty;
      }
      const gx = (p.x / CELL) | 0, gy = (p.y / CELL) | 0;
      if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) dens[gy * GW + gx] += p.sz;
      const li = Math.min(LUT - 1, (p.s * LUT) | 0);
      plot(p.x, p.y, 1, lutCol[li], lutA[li]);
    }

    // smooth density field: blur, then colour-map (faint blue → cyan → white → warm in dense knots)
    blur(dens, tmp, GW, GH, 1); blur(dens, tmp, GW, GH, 1);
    for (let i = 0, n = GW * GH; i < n; i++) {
      const q = dens[i] * DQ;
      gbuf[i] = cmap[q >= CM ? CM - 1 : q | 0];
    }
    gctx.putImageData(gimg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(gcan, 0, 0, W, H);
    // sharp particles on top for texture
    octx.putImageData(img, 0, 0);
    ctx.drawImage(off, 0, 0, W, H);

    softenText();

    // haloes and galaxies
    let nh = 0, ng = 0, zs = 0, zw = 0;
    for (const n of nodes) {
      if (!reduce) {
        const tgt = infl(n.x, n.y, cx, cy, str);
        n.s += (tgt - n.s) * (tgt > n.s ? 0.036 * n.k : 0.008);
      }
      const near = infl(n.x, n.y, cx, cy, 1);
      if (near > 0.05) { zs += n.s * near; zw += near; }
      const h = smooth(clamp01((n.s - 0.35) / 0.35));
      if (h > 0) {
        nh++;
        const R = (14 + 16 * Math.sqrt(n.m)) * (0.6 + 0.4 * h);
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, R);
        g.addColorStop(0, `rgba(255,157,92,${0.42 * h})`);
        g.addColorStop(0.45, `rgba(255,157,92,${0.12 * h})`);
        g.addColorStop(1, "rgba(255,157,92,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(n.x, n.y, R, 0, 6.2832); ctx.fill();
      }
      const gal = smooth(clamp01((n.s - 0.55) / 0.3));
      if (gal > 0) {
        ng++;
        drawGalaxy(n, gal, now);
      }
    }
    const sbar = zw ? zs / zw : 0;
    if (roZ) roZ.textContent = Math.max(0, 6 * Math.pow(1 - sbar, 1.4)).toFixed(1);
    if (roH) roH.textContent = nh;
    if (roG) roG.textContent = ng;

    // cursor marker
    if (cursor.on || usingGhost) {
      ctx.lineWidth = 1; ctx.lineCap = "butt";
      ctx.strokeStyle = `rgba(255,157,92,${cursor.on ? 0.35 : 0.15})`;
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.arc(cx, cy, RI * 0.82, 0, 6.2832); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawGalaxy(n, a, now) {
    const size = (4.5 + 3.5 * Math.sqrt(n.m)) * (0.25 + 0.75 * (1 - Math.pow(1 - a, 3)));
    const spin = reduce ? 0 : (now / 1000) * 0.08 * (n.kind === "disk" ? 1 : 0);
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.rotate(n.rot + spin);
    if (n.kind === "disk") {
      // faint disk + two tiny arms
      ctx.scale(1, n.tilt);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 2.2);
      g.addColorStop(0, `rgba(200,230,255,${0.9 * a})`);
      g.addColorStop(0.25, `rgba(127,212,255,${0.45 * a})`);
      g.addColorStop(1, "rgba(127,212,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, size * 2.2, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = `rgba(170,225,255,${0.6 * a})`;
      ctx.lineWidth = 1.1;
      for (const sgn of [1, -1]) {
        ctx.beginPath();
        for (let th = 0; th < 3.4; th += 0.2) {
          const rr = size * (0.4 + th * 0.42);
          const x = sgn * rr * Math.cos(th), y = sgn * rr * Math.sin(th);
          th ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
    } else {
      // smooth, warm elliptical
      ctx.scale(1, 0.7);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 1.9);
      g.addColorStop(0, `rgba(255,236,214,${0.95 * a})`);
      g.addColorStop(0.3, `rgba(255,190,140,${0.45 * a})`);
      g.addColorStop(1, "rgba(255,157,92,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, size * 1.9, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }

  function frame(now) {
    if (document.hidden) { running = false; return; }
    if (!cursor.on) wander(now);
    draw(now);
    if (reduce) { running = false; return; }
    requestAnimationFrame(frame);
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }

  window.addEventListener("pointermove", e => {
    if (e.pointerType === "touch") return;
    cursor.x = e.clientX; cursor.y = e.clientY; cursor.on = true;
    if (reduce) { // still respond, just without continuous animation
      for (const p of parts) p.s = infl(p.hx, p.hy, cursor.x, cursor.y, 1);
      for (const n of nodes) n.s = infl(n.x, n.y, cursor.x, cursor.y, 1);
      draw(performance.now());
    } else kick();
  });
  document.documentElement.addEventListener("pointerleave", () => { cursor.on = false; t0 = performance.now(); kick(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); });
  let rt;
  window.addEventListener("resize", () => {
    // ignore small height changes (mobile address bar showing/hiding)
    if (window.innerWidth === lastW && Math.abs(window.innerHeight - lastH) < 140) return;
    clearTimeout(rt); rt = setTimeout(() => { build(); draw(performance.now()); kick(); }, 150);
  });

  build();
  measure();
  wander(performance.now());
  draw(performance.now());
  kick();
})();


/* =========================================================
   1b. Header effect "bao": toy galaxy field + BAO shell probe
   ========================================================= */
(function () {
  const canvas = document.getElementById("field");
  if (!canvas || document.body.dataset.effect !== "bao") return;
  const ctx = canvas.getContext("2d");
  const hero = canvas.parentElement;
  document.getElementById("readout").innerHTML =
    '<span class="k">ξ(r) probe</span><span>r = <b>105</b> h<sup>−1</sup>Mpc</span>' +
    '<span>pairs in shell <b id="ro-n">0</b></span><span class="hint">move the cursor over the field</span>';
  const note = document.getElementById("fx-note");
  if (note) note.innerHTML = "Header: a toy galaxy field with a weak excess of pairs at ~105 h<sup>−1</sup>Mpc, the BAO scale.";
  const roN = document.getElementById("ro-n");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const BAO = 105;            // h^-1 Mpc
  let W, H, R, pts = [], probe = { x: 0, y: 0 }, target = { x: 0, y: 0 };
  let userControlled = false, running = false, visible = true, t0 = performance.now();

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) {
    let u = 0, v = 0;
    while (!u) u = r(); while (!v) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function build() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight; lastW = W; lastH = H;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    R = Math.max(70, Math.min(135, W * 0.095));

    const r = rng(1729);
    pts = [];
    const area = W * H;
    const nC = Math.round(area / 15000);
    for (let i = 0; i < nC; i++) {
      const cx = r() * W, cy = r() * H;
      const rich = 3 + Math.floor(r() * r() * 22);
      for (let j = 0; j < rich; j++) pts.push(mk(cx + gauss(r) * 8, cy + gauss(r) * 8, 0.8 + r() * 1.1));
      const shell = Math.floor(r() * 6);
      for (let j = 0; j < shell; j++) {
        const a = r() * 6.2832, d = R + gauss(r) * 5;
        pts.push(mk(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.8 + r() * 0.7));
      }
    }
    const nF = Math.round(area / 1500);
    for (let i = 0; i < nF; i++) pts.push(mk(r() * W, r() * H, 0.4 + r() * 0.7));

    if (!userControlled) { idle(performance.now()); probe.x = target.x; probe.y = target.y; }
  }
  function mk(x, y, s) {
    // dim the field behind the text column on wide screens
    const wide = W > 820;
    const fx = wide ? Math.min(1, Math.max(0, (x / W - 0.3) / 0.4)) : 0.45;
    return { x, y, s, a: 0.1 + 0.42 * fx };
  }

  function idle(now) {
    const t = (now - t0) / 1000;
    if (W <= 820) { // phones: keep the probe beside the photo, away from the text
      target.x = W * 0.77 + Math.sin(t * 0.3) * 10;
      target.y = H * 0.17 + Math.sin(t * 0.4) * 14;
      return;
    }
    const cx = W > 820 ? W * 0.72 : W * 0.6;
    target.x = cx + Math.sin(t * 0.13) * W * 0.12;
    target.y = H * 0.45 + Math.sin(t * 0.21 + 1) * H * 0.18;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const band = 7;
    let n = 0;
    const hits = [];
    for (const p of pts) {
      const dx = p.x - probe.x, dy = p.y - probe.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (Math.abs(d - R) < band) { hits.push(p); n++; continue; }
      const near = d < R - band ? 0.55 : 1;
      ctx.fillStyle = `rgba(214,222,236,${(p.a * near).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, 6.2832); ctx.fill();
    }

    // pair lines
    ctx.strokeStyle = "rgba(127,212,255,0.09)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of hits) { ctx.moveTo(probe.x, probe.y); ctx.lineTo(p.x, p.y); }
    ctx.stroke();

    // shell
    ctx.fillStyle = "rgba(255,157,92,0.05)";
    ctx.beginPath();
    ctx.arc(probe.x, probe.y, R + band, 0, 6.2832);
    ctx.arc(probe.x, probe.y, R - band, 0, 6.2832, true);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,157,92,0.55)";
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.arc(probe.x, probe.y, R, 0, 6.2832); ctx.stroke();
    ctx.setLineDash([]);

    // galaxies in the shell
    for (const p of hits) {
      ctx.fillStyle = "rgba(127,212,255,0.95)";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s + 0.9, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "rgba(127,212,255,0.15)";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s + 4, 0, 6.2832); ctx.fill();
    }

    // centre crosshair + radius label
    ctx.strokeStyle = "rgba(255,157,92,0.9)";
    ctx.beginPath();
    ctx.moveTo(probe.x - 6, probe.y); ctx.lineTo(probe.x + 6, probe.y);
    ctx.moveTo(probe.x, probe.y - 6); ctx.lineTo(probe.x, probe.y + 6);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,157,92,0.35)";
    ctx.beginPath(); ctx.moveTo(probe.x + 8, probe.y); ctx.lineTo(probe.x + R - 2, probe.y); ctx.stroke();
    ctx.fillStyle = "rgba(255,157,92,0.85)";
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillText("r ≈ " + BAO + " h⁻¹Mpc", probe.x + 14, probe.y - 6);

    if (roN) roN.textContent = n;
  }

  function frame(now) {
    if (document.hidden) { running = false; return; }
    if (!userControlled && !reduce) idle(now);
    probe.x += (target.x - probe.x) * 0.12;
    probe.y += (target.y - probe.y) * 0.12;
    draw();
    const settled = Math.abs(target.x - probe.x) < 0.3 && Math.abs(target.y - probe.y) < 0.3;
    if (reduce && settled) { running = false; return; }
    requestAnimationFrame(frame);
  }
  function kick() { if (!running) { running = true; requestAnimationFrame(frame); } }

  hero.addEventListener("pointermove", e => {
    if (e.pointerType === "touch") return;
    const b = canvas.getBoundingClientRect();
    target.x = e.clientX - b.left; target.y = e.clientY - b.top;
    userControlled = true; kick();
  });
  hero.addEventListener("pointerleave", () => { userControlled = false; t0 = performance.now() - 0; kick(); });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick(); }).observe(hero);
  }
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => { build(); kick(); }, 150); });

  build();
  draw();
  kick();
})();

/* =========================================================
   2. Page chrome: progress bar, nav, filters, copy, reveal
   ========================================================= */
(function () {
  const bar = document.querySelector(".topbar");
  const prog = document.querySelector(".progress span");
  const onScroll = () => {
    bar.classList.toggle("scrolled", window.scrollY > 8);
    const h = document.documentElement.scrollHeight - innerHeight;
    prog.style.width = (h > 0 ? (scrollY / h) * 100 : 0) + "%";
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // active section in nav
  const links = [...document.querySelectorAll(".topbar nav a")];
  const map = new Map(links.map(a => [a.getAttribute("href").slice(1), a]));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) { links.forEach(l => l.classList.remove("active")); map.get(e.target.id)?.classList.add("active"); }
    }), { rootMargin: "-40% 0px -55% 0px" });
    map.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
  }

  // publication filters
  const btns = document.querySelectorAll(".filters button");
  const items = document.querySelectorAll(".pubs li");
  btns.forEach(b => b.addEventListener("click", () => {
    btns.forEach(x => x.classList.toggle("on", x === b));
    const f = b.dataset.f;
    items.forEach(li => li.classList.toggle("hide", f !== "all" && li.dataset.k !== f));
  }));

  // copy email
  document.querySelectorAll(".copy").forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "copied ✓"; b.classList.add("done"); }
    catch { b.textContent = "select & copy"; }
    setTimeout(() => { b.textContent = "copy"; b.classList.remove("done"); }, 1800);
  }));

  // reveal on scroll
  const rv = document.querySelectorAll(".sec-head, .about-grid, .tags, .projects, .pub-bar, .pubs, .timeline, .path, .toolbox, .contact-grid");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    rv.forEach(el => { el.classList.add("reveal"); io.observe(el); });
  }

  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
})();
