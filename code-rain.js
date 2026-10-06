/*!
 * code-rain.js — 首屏小机器人身后的「字符雨」点缀
 *
 * 用法：在 </body> 前加一行  <script src="code-rain.js" defer></script>
 *       默认挂在 #home 上，不需要改任何 HTML / CSS。
 *
 * 效果：等宽网格上的片假名 / 字母 / 数字一列列往下落，头部稍深、尾巴渐隐，字符偶尔变化。
 *       颜色用品牌紫，整体很淡；机器人和标题周围留空，不会压到主体。
 *
 * 层级：画布放在 Spline(z-10) 之上、阴影(z-20) 之下，用 multiply 混合，
 *       所以即使 Spline 场景自带不透明背景也能看见，鼠标事件照常穿透给机器人。
 *
 * 可选属性（写在 <section id="home"> 上）：
 *   data-rain-color="#6733ea"   字符颜色
 *   data-rain-opacity="0.3"     整体最深的不透明度（头部），尾巴按比例更淡
 *   data-rain-size="16"         网格边长(px)，默认桌面 16 / 手机 13
 *   data-rain-density="0.5"     0~1，同时在下落的列占比
 *   data-rain-glyphs="kana"     kana = 片假名+字母+数字（默认）；ascii = 只有字母数字符号
 *   data-rain-font="..."        字体，默认等宽；想要点阵感可填 Bitcount（只对字母数字生效）
 *   data-rain-mirror="off"      关闭左右镜像（默认镜像，和参考一致）
 *   data-rain-z="15"            层级
 *
 * 省电：首屏滚出视口、标签页切到后台时自动暂停；系统开了「减少动态效果」时只画一帧静止的。
 * 接口：window.codeRain.pause() / resume() / refresh()
 */
(function () {
  'use strict';

  window.codeRain = { pause: function () {}, resume: function () {}, refresh: function () {} };

  var host = document.querySelector('[data-code-rain]') || document.getElementById('home');
  if (!host) return;
  var ds = host.dataset;

  var COLOR = ds.rainColor || '#6733ea';
  var PEAK = parseFloat(ds.rainOpacity || '0.3');
  var DENSITY = Math.max(0, Math.min(1, parseFloat(ds.rainDensity || '0.5')));
  var FONT = ds.rainFont || 'ui-monospace, "SF Mono", Menlo, Consolas, "MS Gothic", "Hiragino Kaku Gothic ProN", "Microsoft YaHei", monospace';
  var MIRROR = ds.rainMirror !== 'off';
  var Z = ds.rainZ || '15';
  var KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
  var ASCII = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789+*:.=<>';
  var GLYPHS = (ds.rainGlyphs === 'ascii' ? ASCII : KANA + ASCII + '0123456789').split('');
  var TICK = 80;      // 每 80ms 走一步（约 12fps，字符雨不需要更高）
  var LEVELS = 10;    // 亮度分 10 档批量绘制
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- 画布 ----------
  var canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'code-rain';
  // 留空区：机器人 + 标题所在的中间竖条不出字；顶部（导航下）和底部渐隐
  var hole = 'radial-gradient(ellipse 30% 46% at 50% 50%, transparent 0 62%, #000 100%)';
  var holeMobile = 'radial-gradient(ellipse 52% 40% at 50% 50%, transparent 0 62%, #000 100%)';
  var fade = 'linear-gradient(to bottom, transparent 0, #000 16%, #000 78%, transparent 100%)';
  function applyMask() {
    var m = (host.clientWidth < 768 ? holeMobile : hole) + ', ' + fade;
    canvas.style.webkitMaskImage = m; canvas.style.maskImage = m;
    canvas.style.webkitMaskComposite = 'source-in'; canvas.style.maskComposite = 'intersect';
  }
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;' +
    'mix-blend-mode:multiply;z-index:' + Z + ';' + (MIRROR ? 'transform:scaleX(-1);' : '');
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.insertBefore(canvas, host.firstChild);
  var ctx = canvas.getContext('2d');

  // ---------- 网格 ----------
  var cols = 0, rows = 0, cell = 16, dpr = 1;
  var glyph, bright;                 // 每格：字符编号、亮度 0~1
  var head, speed, tail, wait;       // 每列：头部行号(小数)、速度、尾巴衰减、等待步数

  function rnd(n) { return Math.random() * n; }

  function spawn(c, anywhere) {
    head[c] = anywhere ? rnd(rows) : -rnd(6);
    speed[c] = 0.35 + rnd(0.55);            // 每步走多少行
    tail[c] = 0.86 + rnd(0.09);             // 越大尾巴越长
    wait[c] = 0;
  }

  function build() {
    var w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cell = parseFloat(ds.rainSize) || (w < 768 ? 13 : 16);
    cols = Math.ceil(w / cell); rows = Math.ceil(h / cell);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    glyph = new Uint8Array(cols * rows); bright = new Float32Array(cols * rows);
    head = new Float32Array(cols); speed = new Float32Array(cols); tail = new Float32Array(cols); wait = new Int16Array(cols);
    for (var i = 0; i < glyph.length; i++) glyph[i] = rnd(GLYPHS.length) | 0;
    for (var c = 0; c < cols; c++) {
      if (Math.random() < DENSITY) spawn(c, true);
      else { head[c] = rows + 1; wait[c] = (rnd(120) | 0) + 1; tail[c] = 0.9; }
    }
    applyMask();
    // 预热：先空跑一段，打开页面时已经是"下了一会儿"的状态
    for (var k = 0; k < 60; k++) step();
    return true;
  }

  function step() {
    for (var c = 0; c < cols; c++) {
      var base = c, t = tail[c];
      for (var r = 0; r < rows; r++) {          // 整列衰减
        var i = r * cols + base, b = bright[i];
        if (b > 0) {
          b *= t; bright[i] = b < 0.03 ? 0 : b;
          if (Math.random() < 0.012) glyph[i] = rnd(GLYPHS.length) | 0;   // 尾巴里的字偶尔变
        }
      }
      if (wait[c] > 0) { if (--wait[c] === 0) spawn(c, false); continue; }
      var before = Math.floor(head[c]);
      head[c] += speed[c];
      var now = Math.floor(head[c]);
      for (var rr = Math.max(0, before + 1); rr <= now && rr < rows; rr++) {
        var j = rr * cols + base;
        bright[j] = 1; glyph[j] = rnd(GLYPHS.length) | 0;
      }
      if (head[c] > rows + 2) {                  // 落到底：休息一会儿再来，DENSITY 越低休息越久
        head[c] = rows + 3;
        wait[c] = 1 + (rnd(20 + 160 * (1 - DENSITY)) | 0);
      }
    }
  }

  function draw() {
    var W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = COLOR;
    ctx.font = Math.round(cell * 0.78 * dpr) + 'px ' + FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var half = cell * dpr / 2, cw = cell * dpr;
    for (var lv = 1; lv <= LEVELS; lv++) {      // 按亮度档位批量画，少切换状态
      var lo = (lv - 1) / LEVELS, hi = lv / LEVELS;
      // 尾巴很淡，只有最后一档（头部）达到 PEAK
      ctx.globalAlpha = lv === LEVELS ? PEAK : PEAK * 0.62 * hi * hi + 0.004;
      for (var r = 0; r < rows; r++) {
        var y = r * cw + half, off = r * cols;
        for (var c = 0; c < cols; c++) {
          var b = bright[off + c];
          if (b > lo && b <= hi) ctx.fillText(GLYPHS[glyph[off + c]], c * cw + half, y);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 循环 ----------
  var ready = false, visible = true, manual = false, raf = 0, last = 0;

  function loop(ts) {
    raf = 0;
    if (!ready) { ready = build(); if (ready) draw(); }
    if (!ready || reduced) return;                 // 减少动态效果：只保留那一帧
    if (!visible || manual || document.hidden) return;
    if (ts - last >= TICK) { last = ts; step(); draw(); }
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

  window.codeRain = {
    pause: function () { manual = true; },
    resume: function () { manual = false; kick(); },
    refresh: refresh
  };
  kick();
})();
