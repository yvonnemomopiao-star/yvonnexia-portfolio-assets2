/*!
 * text-ripple.js — 首屏「文字水面」：铺满的淡色等宽文字，鼠标划过会荡出波纹
 *
 * 用法：在 </body> 前加一行  <script src="text-ripple.js" defer></script>
 *       默认挂在 #home 上，不需要改任何 HTML / CSS。
 *
 * 行为：
 *   - 静止时是一页不动的文字，不占用动画循环
 *   - 鼠标移动 / 点击会在水面上压出波纹：波纹经过的地方，文字被"折射"错位，
 *     强的地方换成更重的符号，波峰偏白、波谷偏紫；波纹散尽后循环自动停止
 *   - 手机端（宽度 < 768px）只显示静态文字，不监听触摸
 *   - 系统开了「减少动态效果」时只显示静态文字
 *
 * 层级：画布默认 z-index 32，在首屏的薰衣草叠色层(z-30/31)之上、标题(z-50)和导航(z-100)之下。
 *       画布不接收鼠标事件（事件在 #home 上监听），不影响机器人跟随鼠标。
 *
 * 可选属性（写在 <section id="home"> 上）：
 *   data-ripple-text="..."        要铺的文字（英文 / 数字；中文是双倍宽度，会破坏等宽网格）
 *   data-ripple-opacity="0.42"    静止文字的不透明度
 *   data-ripple-vignette="0.5"    四边渐隐的宽度 0~1（1 = 渐隐带宽到屏幕短边的一半）
 *   data-ripple-hole="0.3"        机器人周围的圆形留空半径 = 首屏高度 × 该值（0 = 不留空）
 *   data-ripple-color="#ffffff"   静止文字颜色
 *   data-ripple-crest="#ffffff"   波峰颜色
 *   data-ripple-trough="#6733ea"  波谷颜色
 *   data-ripple-size="28"         字号(px)，按 2560 宽调校，窄屏等比缩小
 *   data-ripple-strength="2"      鼠标划动的力度倍数
 *   data-ripple-speed="0.8"       波传播速度 0~1
 *   data-ripple-damping="0.035"   衰减，越大波纹消失越快
 *   data-ripple-z="32"            层级
 *
 * 接口：window.textRipple.set({opacity, vignette, hole, strength, speed, damping, size}) / drop(x, y) / refresh()
 */
(function () {
  'use strict';

  var noop = function () {};
  window.textRipple = { set: noop, drop: noop, refresh: noop };

  var host = document.querySelector('[data-text-ripple]') || document.getElementById('home');
  if (!host) return;
  var ds = host.dataset;
  function num(v, d) { v = parseFloat(v); return isNaN(v) ? d : v; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // 默认文字：取自这个作品集自己的项目名和关键词
  var TEXT = ds.rippleText ||
    'XIA YIJING portfolio 2026. AIGC visual architect. Concept design for the music video If the police arrive: ' +
    'volumetric moonlight, cyber-noir, human in the loop. Dark Angel, a cinematic fashion study: high-fashion K-pop aesthetic, ' +
    'dark moonlight, ethereal realism. The Stoic Series: emotional resilience in AIGC storytelling. Cyber-ethereal stage visual ' +
    'and android concept: liquid-chrome fluidity, iridescent porcelain, anisotropic metal, inorganic texture, futuristic digital life. ' +
    'ADAM music festival poster design. K-pop Q-version figurines, BOSS series: IP design, character consistency, commercial standard. ' +
    'Custom LoRA model training and style replication: model generalization, style consistency. Interactive visual experiment, ' +
    'creative coding, generative UI. It is not a fairy tale: dark fairy tale, mobile game, scene design. Otome romance and dress-up games: ' +
    'romantic fantasy, 2D illustration. Bakemonogatari and Nisemonogatari: Japanese anime, background art, 2D layout. ' +
    'Stable Diffusion, Midjourney, ComfyUI, LoRA, 3D blockout, paint-over, from prompt to pipeline.';
  var HEAVY = '·.,:;-~=+*%#@';   // 波纹越强，换成越靠后的符号

  var cfg = {
    opacity: num(ds.rippleOpacity, 0.42),
    hole: num(ds.rippleHole, 0.3),
    vignette: num(ds.rippleVignette, 0.5),
    strength: num(ds.rippleStrength, 2),
    speed: clamp(num(ds.rippleSpeed, 0.8), 0, 1),
    damping: clamp(num(ds.rippleDamping, 0.035), 0, 0.5),
    size: num(ds.rippleSize, 28)
  };
  var BASE = ds.rippleColor || '#ffffff';
  var CREST = ds.rippleCrest || '#ffffff';
  var TROUGH = ds.rippleTrough || '#6733ea';
  var FONT = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, "Courier New", monospace';
  var Z = ds.rippleZ || '32';
  var MIN_WIDTH = 768, STEPS = 20, IDLE = 0.002;
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- 画布 ----------
  var canvas = document.createElement('canvas');
  canvas.className = 'text-ripple';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:' + Z + ';';
  // 四边渐隐 + 机器人周围的圆形留空（画布在机器人上方，不留空的话文字会盖在它脸上）
  function applyMask() {
    // 渐隐带的宽度按像素算（和屏幕短边成比例），大屏上才不会显得太窄；中间加两个过渡点，像镜头暗角一样缓出
    var band = clamp(cfg.vignette, 0, 1) * Math.min(W, H) / 2, bx = Math.round(band), by = Math.round(band * 0.62);
    function edge(dir, size, b) {
      var a = 'rgba(0,0,0,', px = function (v) { return Math.round(v) + 'px'; }, far = function (v) { return px(size - v); };
      return 'linear-gradient(' + dir + ', transparent 0, ' + a + '.12) ' + px(b * 0.3) + ', ' + a + '.55) ' + px(b * 0.7) + ', #000 ' + px(b) +
             ', #000 ' + far(b) + ', ' + a + '.55) ' + far(b * 0.7) + ', ' + a + '.12) ' + far(b * 0.3) + ', transparent 100%)';
    }
    var m = edge('to bottom', H, by) + ', ' + edge('to right', W, bx);
    if (cfg.hole > 0) m += ', radial-gradient(circle ' + Math.round(H * cfg.hole) + 'px at 50% 49%, transparent 0, transparent 62%, #000 100%)';
    canvas.style.webkitMaskImage = m; canvas.style.maskImage = m;
    canvas.style.webkitMaskComposite = 'source-in'; canvas.style.maskComposite = 'intersect';
  }
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  // ---------- 颜色渐变表 ----------
  function rgb(c) {
    var p = document.createElement('canvas'); p.width = p.height = 1;
    var g = p.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 1, 1);
    var d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
  }
  var up = [], down = [];
  function buildRamps() {
    var b = rgb(BASE), c = rgb(CREST), t = rgb(TROUGH);
    up = []; down = [];
    for (var i = 0; i <= STEPS; i++) {
      var k = i / STEPS, a = (cfg.opacity + (1 - cfg.opacity) * k).toFixed(3);
      up.push('rgba(' + Math.round(b[0] + (c[0] - b[0]) * k) + ',' + Math.round(b[1] + (c[1] - b[1]) * k) + ',' + Math.round(b[2] + (c[2] - b[2]) * k) + ',' + a + ')');
      down.push('rgba(' + Math.round(b[0] + (t[0] - b[0]) * k) + ',' + Math.round(b[1] + (t[1] - b[1]) * k) + ',' + Math.round(b[2] + (t[2] - b[2]) * k) + ',' + a + ')');
    }
  }

  // ---------- 文字网格 + 水面 ----------
  var W = 0, H = 0, dpr = 1, cols = 0, rows = 0, cw = 0, lh = 0, lines = [];
  var gw = 0, gh = 0, cell = 1, hPrev, hCur, hNext, energy = 0;   // 水面高度场（三帧缓冲）

  function build() {
    W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    // 字号是按 2560 宽的大屏调的；屏幕更窄时等比缩小（最小到 0.68 倍，1440 宽时约 19px），手机端不超过 12px
    var fs = W < MIN_WIDTH ? Math.min(cfg.size, 12) : Math.round(cfg.size * clamp(W / 2560, 0.68, 1));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '400 ' + fs + 'px ' + FONT;
    cw = ctx.measureText('M').width || fs * 0.6;
    lh = fs * 1.3;
    cols = Math.ceil(W / cw); rows = Math.ceil(H / lh);
    // 把文字按单词循环铺满每一行
    var words = TEXT.split(/\s+/).filter(Boolean), wi = 0;
    lines = [];
    for (var r = 0; r < rows; r++) {
      var line = '';
      while (line.length < cols) { line += (line ? ' ' : '') + words[wi % words.length]; wi++; }
      lines.push(line.slice(0, cols));
    }
    cell = lh / 2;                                // 水面网格比文字网格细一倍
    gw = Math.ceil(W / cell) + 3; gh = Math.ceil(H / cell) + 3;
    hPrev = new Float32Array(gw * gh); hCur = new Float32Array(gw * gh); hNext = new Float32Array(gw * gh);
    energy = 0;
    canvas._font = '400 ' + fs + 'px ' + FONT;
    buildRamps();
    applyMask();
    return true;
  }

  // 在 (px, py) 处把水面往下压一个圆滑的坑
  function press(px, py, radius, amount) {
    var cx = px / cell + 1, cy = py / cell + 1, r = Math.max(1, radius / cell);
    var x0 = Math.max(1, Math.floor(cx - r)), x1 = Math.min(gw - 2, Math.ceil(cx + r));
    var y0 = Math.max(1, Math.floor(cy - r)), y1 = Math.min(gh - 2, Math.ceil(cy + r));
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var dx = x - cx, dy = y - cy, q = 1 - (dx * dx + dy * dy) / (r * r);
      if (q > 0) hCur[y * gw + x] -= amount * q * q;
    }
    if (energy < amount) energy = amount;
  }

  // 离散波动方程：下一帧 = 当前 + 惯性 + 邻居拉力，再乘衰减
  function simulate() {
    var c2 = 0.03 + cfg.speed * 0.4, keep = 1 - cfg.damping, e = 0;
    for (var y = 1; y < gh - 1; y++) {
      var row = y * gw;
      for (var x = 1; x < gw - 1; x++) {
        var i = row + x, c = hCur[i];
        var v = c * 0.996 + (c - hPrev[i]) * keep + c2 * (hCur[i - 1] + hCur[i + 1] + hCur[i - gw] + hCur[i + gw] - 4 * c);
        hNext[i] = v;
        var a = v < 0 ? -v : v; if (a > e) e = a;
      }
    }
    var t = hPrev; hPrev = hCur; hCur = hNext; hNext = t;
    energy = e;
  }

  function hash(a, b, c) {
    var n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function draw(now) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.font = canvas._font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    var active = energy > IDLE, seed = Math.floor(now / 90), hot = [];
    ctx.fillStyle = up[0];
    for (var r = 0; r < rows; r++) {
      var y = r * lh + lh / 2, src = lines[r];
      if (!active) { ctx.fillText(src, 0, y); continue; }
      var out = '';
      var gy = Math.min(gh - 2, Math.max(1, Math.round(y / cell) + 1));
      for (var c = 0; c < cols; c++) {
        var gx = Math.min(gw - 2, Math.max(1, Math.round((c * cw + cw / 2) / cell) + 1)), i = gy * gw + gx;
        var h = hCur[i], sx = (hCur[i + 1] - hCur[i - 1]) * 1.5, sy = (hCur[i + gw] - hCur[i - gw]) * 1.5;
        var k = clamp((Math.abs(h) * 2.2 + Math.sqrt(sx * sx + sy * sy) - 0.1) * 1.2, 0, 1);
        if (k < 0.03) { out += src[c]; continue; }
        // 折射：从旁边的格子取字
        var sc = clamp(Math.round(c + sx * 8), 0, cols - 1), sr = clamp(Math.round(r + sy * 4), 0, rows - 1);
        var ch = lines[sr][sc];
        if (k > 0.5 + (hash(c, r, 0) - 0.5) * 0.5) {
          ch = HEAVY[clamp(Math.round(k * (HEAVY.length - 1) + (hash(c, r, seed) - 0.5) * 4), 0, HEAVY.length - 1)];
        }
        out += ' ';
        if (ch !== ' ') hot.push(c * cw, y, ch, (h >= 0 ? up : down)[Math.round(k * STEPS)]);
      }
      ctx.fillText(out, 0, y);
    }
    var last = '';
    for (var n = 0; n < hot.length; n += 4) {
      if (hot[n + 3] !== last) { last = hot[n + 3]; ctx.fillStyle = last; }
      ctx.fillText(hot[n + 2], hot[n], hot[n + 1]);
    }
  }

  // ---------- 循环：只有水面在动时才跑 ----------
  var ready = false, running = false, visible = true, lastT = 0, acc = 0;
  var ptr = { x: 0, y: 0, lx: 0, ly: 0, inside: false, moved: false };

  function frame(now) {
    if (!ready) { ready = build(); if (!ready) { running = false; return; } }
    var dt = Math.min(0.1, (now - lastT) / 1000 || 0); lastT = now;
    if (ptr.moved) {
      var dx = ptr.x - ptr.lx, dy = ptr.y - ptr.ly, d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.5) {
        var n = Math.min(6, Math.max(1, Math.ceil(d / 16))), amt = 0.3 * cfg.strength * Math.min(1, d / 24) / n;
        for (var s = 1; s <= n; s++) press(ptr.lx + dx * s / n, ptr.ly + dy * s / n, 16, amt);
      }
      ptr.lx = ptr.x; ptr.ly = ptr.y; ptr.moved = false;
    }
    acc += dt;
    var steps = 0;
    while (acc >= 1 / 90 && steps < 4) { simulate(); acc -= 1 / 90; steps++; }
    if (steps === 4) acc = 0;
    if (energy < IDLE || !visible) {            // 水面平了：清零、画一帧静止的、停掉循环
      hCur.fill(0); hPrev.fill(0); hNext.fill(0); energy = 0;
      draw(now); running = false; return;
    }
    draw(now);
    requestAnimationFrame(frame);
  }
  function wake() {
    if (running || reduced) return;
    running = true; lastT = performance.now(); acc = 0;
    requestAnimationFrame(frame);
  }
  function refresh() {
    ready = build();
    if (ready) draw(performance.now());
  }

  // 把页面坐标换成首屏内部坐标（首屏被 CSS 缩放时也正确）
  function local(e) {
    var b = host.getBoundingClientRect();
    return { x: (e.clientX - b.left) * (W / (b.width || 1)), y: (e.clientY - b.top) * (H / (b.height || 1)) };
  }
  function interactive() { return ready && !reduced && W >= MIN_WIDTH; }

  host.addEventListener('pointermove', function (e) {
    if (!interactive() || e.pointerType === 'touch') return;
    var p = local(e);
    if (!ptr.inside) { ptr.lx = p.x; ptr.ly = p.y; ptr.inside = true; }
    ptr.x = p.x; ptr.y = p.y; ptr.moved = true;
    wake();
  }, { passive: true });
  host.addEventListener('pointerleave', function () { ptr.inside = false; ptr.moved = false; }, { passive: true });
  host.addEventListener('pointerdown', function (e) {
    if (!interactive() || e.pointerType === 'touch') return;
    var p = local(e);
    press(p.x, p.y, 26, 1.2 * cfg.strength);
    ptr.x = ptr.lx = p.x; ptr.y = ptr.ly = p.y; ptr.inside = true;
    wake();
  }, { passive: true });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(host);
  }
  if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(host);
  else window.addEventListener('resize', refresh, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);

  window.textRipple = {
    refresh: refresh,
    drop: function (x, y, strength) { if (!interactive()) return; press(x, y, 26, (strength || 1.2) * cfg.strength); wake(); },
    set: function (o) {
      var rebuild = false;
      for (var k in o) if (k in cfg && cfg[k] !== o[k]) { cfg[k] = o[k]; if (k === 'size') rebuild = true; if ((k === 'hole' || k === 'vignette') && ready) applyMask(); }
      if (rebuild) refresh(); else { buildRamps(); if (ready && !running) draw(performance.now()); }
    }
  };
  refresh();
})();
