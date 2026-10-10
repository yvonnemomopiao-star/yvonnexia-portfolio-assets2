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
 *   data-ripple-opacity="0.38"    静止文字的不透明度
 *   data-ripple-vignette="0.8"    四边渐隐带的长度 0~2（1 = 屏幕短边的一半；过渡曲线是 smoothstep）
 *   data-ripple-feather="0.38"    机器人留空边缘的柔和度 0~1
 *   data-ripple-hole="0.3"        机器人周围的圆形留空半径 = 首屏高度 × 该值（0 = 不留空）
 *   data-ripple-color="#ffffff"   静止文字颜色
 *   data-ripple-crest="#ffffff"   波峰颜色
 *   data-ripple-trough="#6733ea"  波谷颜色
 *   data-ripple-size="30"         字号(px)，按 2560 宽调校，窄屏等比缩小
 *   data-ripple-strength="2.9"    鼠标划动的力度倍数
 *   data-ripple-speed="0.8"       波传播速度 0~1（按屏幕像素算，大屏和预览里一致）
 *   data-ripple-damping="0.035"   衰减，越大波纹消失越快
 *   data-ripple-z="32"            层级
 *
 * 接口：window.textRipple.set({opacity, vignette, hole, feather, strength, speed, damping, size, color, crest, trough}) / drop(x, y) / refresh()
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
    opacity: num(ds.rippleOpacity, 0.38),
    hole: num(ds.rippleHole, 0.3),
    vignette: num(ds.rippleVignette, 0.8),
    strength: num(ds.rippleStrength, 2.9),
    speed: clamp(num(ds.rippleSpeed, 0.8), 0, 1),
    damping: clamp(num(ds.rippleDamping, 0.035), 0, 0.5),
    size: num(ds.rippleSize, 30),
    feather: num(ds.rippleFeather, 0.38),
    color: ds.rippleColor || '#ffffff',
    crest: ds.rippleCrest || '#ffffff',
    trough: ds.rippleTrough || '#6733ea'
  };
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
    // 渐隐带的长度按像素算（屏幕短边 × vignette，最长到画面一半）；用 smoothstep 曲线铺 9 个过渡点，过渡更柔和
    var band = clamp(cfg.vignette, 0, 2) * Math.min(W, H) / 2;
    var bx = Math.min(Math.round(band), W / 2), by = Math.min(Math.round(band * 0.75), H / 2);
    function edge(dir, size, b) {
      var stops = ['transparent 0'], tail = [], n = 8;
      for (var i = 1; i <= n; i++) {
        var u = i / n, a = (u * u * (3 - 2 * u)).toFixed(3), d = Math.round(b * u);
        stops.push('rgba(0,0,0,' + a + ') ' + d + 'px');
        tail.unshift('rgba(0,0,0,' + a + ') ' + Math.round(size - d) + 'px');
      }
      return 'linear-gradient(' + dir + ', ' + stops.concat(tail).join(', ') + ', transparent 100%)';
    }
    var m = edge('to bottom', H, by) + ', ' + edge('to right', W, bx);
    if (cfg.hole > 0) {
      // feather：机器人留空边缘的柔和程度，0 = 硬边，1 = 从中心一路渐变到半径
      var f = clamp(cfg.feather, 0, 1), inner = Math.round((1 - f) * 100), mid = Math.round(inner + (100 - inner) * 0.5);
      m += ', radial-gradient(circle ' + Math.round(H * cfg.hole) + 'px at 50% 49%, transparent 0, transparent ' + inner + '%, rgba(0,0,0,.5) ' + mid + '%, #000 100%)';
    }
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
    var b = rgb(cfg.color), c = rgb(cfg.crest), t = rgb(cfg.trough);
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
  // 水波的物理量按「屏幕像素」计算：REF_CELL 是调参预览里水面格子在屏幕上的大小（约 8.6px）。
  // 大屏上格子更大（30px 字号时约 19.5px），如果水波按格子走，它会跑得比鼠标快一倍多，划过去只剩一圈圈「按」出来的同心圆；
  // 按屏幕像素换算后，鼠标速度和水波速度的比例与预览一致，才会顺着鼠标拖出尾迹。
  var REF_CELL = 8.6, kScr = 1;   // kScr：首屏内部 1px 对应屏幕上几 px 的倒数（被 CSS 缩放显示时 ≠ 1）
  function measureScale() { var b = host.getBoundingClientRect(); kScr = b.width ? W / b.width : 1; }

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
    measureScale();
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
    // f = 预览里的格子 / 现在屏幕上的格子：格子越大，每一步走的格数越少、每一步的衰减也越小，
    // 这样水波在屏幕上的速度（像素/秒）和能荡开多少格字，都和预览里一样
    var f = REF_CELL / Math.max(1, cell / kScr);
    var cs = Math.min(0.67, Math.sqrt(0.03 + cfg.speed * 0.4) * f), c2 = cs * cs;
    var keep = 1 - cfg.damping * f, base = 1 - 0.004 * f, e = 0;
    for (var y = 1; y < gh - 1; y++) {
      var row = y * gw;
      for (var x = 1; x < gw - 1; x++) {
        var i = row + x, c = hCur[i];
        var v = c * base + (c - hPrev[i]) * keep + c2 * (hCur[i - 1] + hCur[i + 1] + hCur[i - gw] + hCur[i + gw] - 4 * c);
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
    // rAF 给的时间戳是这一帧开始的时刻，可能早于 wake() 里记下的时间，所以第一帧按 0 算，避免出现负数
    var dt = lastT < 0 ? 0 : clamp((now - lastT) / 1000, 0, 0.1); lastT = now;
    // 这一帧鼠标划过的路径：按「划过了几格」放能量（快慢一致），并把落点分摊到这一帧的每个模拟步里，
    // 掉帧时（比如机器人占用了显卡）尾迹也是连续的，不会变成一个个按下去的点
    var pts = [], amt = 0;
    if (ptr.moved) {
      var dx = ptr.x - ptr.lx, dy = ptr.y - ptr.ly, d = Math.sqrt(dx * dx + dy * dy), dc = d / cell;
      if (d > 0.5) {
        var n = Math.min(8, Math.max(1, Math.ceil(dc * 1.22)));
        amt = 0.244 * cfg.strength * Math.min(dc, 1.23 * Math.max(1, dt * 60)) / n;
        for (var s = 1; s <= n; s++) pts.push(ptr.lx + dx * s / n, ptr.ly + dy * s / n);
      }
      ptr.lx = ptr.x; ptr.ly = ptr.y; ptr.moved = false;
    }
    var R = Math.max(16, cell * 1.6);
    acc += dt;
    var steps = clamp(Math.floor(acc * 90), 0, 8), np = pts.length / 2, done = 0;
    if (steps === 0) { for (var q = 0; q < np; q++) press(pts[q * 2], pts[q * 2 + 1], R, amt); }
    for (var st = 0; st < steps; st++) {
      var upto = Math.round(np * (st + 1) / steps);
      for (; done < upto; done++) press(pts[done * 2], pts[done * 2 + 1], R, amt);
      simulate();
    }
    acc -= steps / 90;
    if (steps === 8) acc = 0;   // 掉帧太多时不追帧
    if (energy < IDLE || !visible) {            // 水面平了：清零、画一帧静止的、停掉循环
      hCur.fill(0); hPrev.fill(0); hNext.fill(0); energy = 0;
      draw(now); running = false; return;
    }
    draw(now);
    requestAnimationFrame(frame);
  }
  function wake() {
    if (running || reduced) return;
    running = true; lastT = -1; acc = 0; measureScale();
    requestAnimationFrame(frame);
  }
  function refresh() {
    ready = build();
    if (ready) draw(performance.now());
  }

  // 把页面坐标换成首屏内部坐标（首屏被 CSS 缩放时也正确）
  function local(e) {
    var b = host.getBoundingClientRect();
    ptr.k = W / (b.width || 1);
    return { x: (e.clientX - b.left) * ptr.k, y: (e.clientY - b.top) * (H / (b.height || 1)) };
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
    press(p.x, p.y, Math.max(26, cell * 2.6), 1.2 * cfg.strength);
    ptr.x = ptr.lx = p.x; ptr.y = ptr.ly = p.y; ptr.inside = true;
    wake();
  }, { passive: true });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { visible = e[e.length - 1].isIntersecting; }).observe(host);
  }
  if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(host);
  else window.addEventListener('resize', refresh, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);

  window.textRipple = {
    refresh: refresh,
    get: function () { var o = {}; for (var k in cfg) o[k] = cfg[k]; return o; },
    drop: function (x, y, strength) { if (!interactive()) return; press(x, y, 26, (strength || 1.2) * cfg.strength); wake(); },
    set: function (o) {
      var rebuild = false;
      for (var k in o) if (k in cfg && cfg[k] !== o[k]) { cfg[k] = o[k]; if (k === 'size') rebuild = true; if ((k === 'hole' || k === 'vignette' || k === 'feather') && ready) applyMask(); }
      if (rebuild) refresh(); else { buildRamps(); if (ready && !running) draw(performance.now()); }
    }
  };
  refresh();
})();
