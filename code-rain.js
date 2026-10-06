/*!
 * code-rain.js — 首屏小机器人周围的「字符雨」点缀（v2：三层景深 + 白色字符 + 连续下落）
 *
 * 用法：在 </body> 前加一行  <script src="code-rain.js" defer></script>
 *       默认挂在 #home 上，不需要改任何 HTML / CSS。
 *
 * 效果：字母和数字一列列连续往下落，分远 / 中 / 近三层：
 *         远层 小、虚、慢、淡      中层 清晰、中速      近层 大、快、深
 *       每列里深色、浅紫、白色字符混在一起，另有少量竖向拖影线条。
 *       中间一整条（标题、机器人、阴影）留空，字符只落在两侧，是点缀不是主角。
 *
 * 层级：画布默认 z-index 32，在首屏的薰衣草叠色层(z-30/31)之上、标题(z-50)和导航(z-100)之下。
 *       必须在叠色层之上：那一层是 multiply 混合，白色字符放在它下面会被染成背景色而看不见。
 *
 * 可选属性（写在 <section id="home"> 上）：
 *   data-rain-opacity="1"      整体浓度倍数（0.5 更淡，1.5 更浓）
 *   data-rain-speed="1"        速度倍数（1 ≈ 近层 2 秒多落完一屏）
 *   data-rain-density="1"      列数倍数
 *   data-rain-white="0.16"     白色字符占比 0~1
 *   data-rain-ink="#3b3470"    深色字符
 *   data-rain-tint="#9d95e6"   浅紫字符
 *   data-rain-font="..."       字体，默认 Inter / 系统无衬线
 *   data-rain-glyphs="..."     自定义字符集（直接写字符）
 *   data-rain-z="32"           层级
 *
 * 省电：首屏滚出视口、标签页切到后台时自动暂停；系统开了「减少动态效果」时只画一帧静止的。
 * 接口：window.codeRain.set({opacity, speed, density, white}) / pause() / resume() / refresh()
 */
(function () {
  'use strict';

  var noop = function () {};
  window.codeRain = { pause: noop, resume: noop, refresh: noop, set: noop };

  var host = document.querySelector('[data-code-rain]') || document.getElementById('home');
  if (!host) return;
  var ds = host.dataset;
  function num(v, d) { v = parseFloat(v); return isNaN(v) ? d : v; }

  var cfg = {
    opacity: num(ds.rainOpacity, 1),
    speed: num(ds.rainSpeed, 1),
    density: num(ds.rainDensity, 1),
    white: Math.max(0, Math.min(1, num(ds.rainWhite, 0.16)))
  };
  var INK = ds.rainInk || '#3b3470';
  var TINT = ds.rainTint || '#9d95e6';
  var FONT = ds.rainFont || 'Inter, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  var GLYPHS = (ds.rainGlyphs || 'ABDEGHKLRTWXZbdhklqrtwxz0123456789').split('');
  var Z = ds.rainZ || '32';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // 三层景深。speed 的单位是「每秒落下多少个首屏高度」
  var LAYERS = [
    { share: 0.46, size: [11, 15], blur: 1.6, alpha: 0.22, speed: [0.07, 0.13] },  // 远
    { share: 0.36, size: [16, 21], blur: 0,   alpha: 0.30, speed: [0.17, 0.27] },  // 中
    { share: 0.18, size: [25, 34], blur: 0.5, alpha: 0.40, speed: [0.33, 0.48] }   // 近
  ];

  // ---------- 画布 ----------
  var canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'code-rain';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:' + Z + ';';
  // 留空区盖住中间一整条（标题、机器人、阴影、滚动提示），字符只落在两侧；顶部和底部渐隐
  function applyMask() {
    var hole = host.clientWidth < 768
      ? 'radial-gradient(ellipse 62% 46% at 50% 44%, transparent 0 64%, #000 100%)'
      : 'radial-gradient(ellipse 36% 78% at 50% 46%, transparent 0 60%, #000 100%)';
    var m = hole + ', linear-gradient(to bottom, transparent 0, #000 14%, #000 80%, transparent 100%)';
    canvas.style.webkitMaskImage = m; canvas.style.maskImage = m;
    canvas.style.webkitMaskComposite = 'source-in'; canvas.style.maskComposite = 'intersect';
  }
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  // ---------- 列 ----------
  var cols = [], W = 0, H = 0, dpr = 1;
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }

  // 把一整列字符预先画到离屏画布上，之后每帧只需要平移贴图
  function makeStrip(layer, small) {
    var size = rnd(layer.size[0], layer.size[1]) * (small ? 0.82 : 1);
    var lh = size * 1.22, pad = Math.ceil(layer.blur * 3 + 8);
    var streak = Math.random() < 0.1;                       // 少量竖向拖影线条
    var count = Math.ceil(H / lh) + 2 + ((Math.random() * 6) | 0);
    var len = count * lh;
    var c = document.createElement('canvas');
    c.width = Math.ceil((size * 0.95 + pad * 2) * dpr);
    c.height = Math.ceil(len * dpr);
    var g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '400 ' + size + 'px ' + FONT;
    if (layer.blur) g.filter = 'blur(' + layer.blur + 'px)';
    var cx = size * 0.475 + pad;
    for (var i = 0; i < count; i++) {
      if (Math.random() < (streak ? 0.45 : 0.22)) continue;  // 留一些空位，列才不会像一根实线
      var r = Math.random(), y = i * lh + lh / 2;
      g.shadowColor = 'transparent'; g.shadowBlur = 0;
      if (r < cfg.white) {                                   // 白色：加一圈很淡的紫晕，在浅底上才分得出来
        g.fillStyle = '#fff'; g.globalAlpha = Math.min(1, layer.alpha * 1.9);
        g.shadowColor = 'rgba(103,51,234,.38)'; g.shadowBlur = size * 0.28;
      } else if (r < cfg.white + 0.24) {
        g.fillStyle = TINT; g.globalAlpha = layer.alpha * 0.9;
      } else {
        g.fillStyle = INK; g.globalAlpha = layer.alpha * rnd(0.55, 1);
      }
      if (streak) {
        var w = Math.max(1.2, size * 0.09), h = lh * rnd(0.5, 1.5);
        g.fillRect(cx - w / 2, y - h / 2, w, h);
      } else {
        g.fillText(pick(GLYPHS), cx, y);
      }
    }
    return { img: c, w: c.width / dpr, len: len };
  }

  function build() {
    W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    var small = W < 768;
    var total = Math.round((W / (small ? 26 : 40)) * cfg.density);
    cols = [];
    LAYERS.forEach(function (layer) {
      var n = Math.round(total * layer.share);
      for (var i = 0; i < n; i++) {
        var s = makeStrip(layer, small);
        cols.push({
          img: s.img, w: s.w, len: s.len,
          x: rnd(-s.w * 0.3, W - s.w * 0.7),
          y: rnd(0, s.len),
          v: rnd(layer.speed[0], layer.speed[1])
        });
      }
    });
    applyMask();
    return true;
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = Math.max(0, Math.min(1, cfg.opacity));
    // opacity > 1 时再叠画一遍，实现"更浓"
    var passes = cfg.opacity > 1 ? 2 : 1;
    for (var p = 0; p < passes; p++) {
      if (p === 1) ctx.globalAlpha = Math.min(1, cfg.opacity - 1);
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        for (var y = c.y - c.len; y < H; y += c.len) ctx.drawImage(c.img, c.x, y, c.w, c.len);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 循环 ----------
  var ready = false, visible = true, manual = false, raf = 0, last = 0;

  function loop(ts) {
    raf = 0;
    if (!ready) { ready = build(); last = ts; if (ready) draw(); }
    if (!ready || reduced) return;                 // 减少动态效果：只保留那一帧
    if (!visible || manual || document.hidden) { last = 0; return; }
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i];
      c.y += c.v * H * cfg.speed * dt;
      if (c.y >= c.len) c.y -= c.len;
    }
    draw();
    raf = requestAnimationFrame(loop);
  }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }
  function refresh() { ready = false; kick(); }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) kick(); }).observe(host);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });
  if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(host);
  else window.addEventListener('resize', refresh, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);   // 字体到位后重画一次

  window.codeRain = {
    pause: function () { manual = true; },
    resume: function () { manual = false; kick(); },
    refresh: refresh,
    set: function (o) {
      var rebuild = false;
      for (var k in o) if (k in cfg && cfg[k] !== o[k]) { cfg[k] = o[k]; if (k === 'density' || k === 'white') rebuild = true; }
      if (rebuild) refresh(); else if (reduced || manual) { if (ready) draw(); } else kick();
    }
  };
  kick();
})();
