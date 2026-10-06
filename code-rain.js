/*!
 * code-rain.js — 首屏小机器人周围的「字符雨」点缀（v3）
 *
 * 用法：在 </body> 前加一行  <script src="code-rain.js" defer></script>
 *       默认挂在 #home 上，不需要改任何 HTML / CSS。
 *
 * 效果：
 *   - 只在桌面端显示（宽度 < 768px 不创建动画，手机端没有任何开销）
 *   - 两层：前层清晰，后层更小、更慢、带模糊
 *   - 字符一段一段连续下落；每段最下方的字符最深，往上逐渐变淡
 *   - 字符自己会跳动（随机换字），最下方那个跳得最勤
 *   - 深紫、浅紫、白色字符混排
 *   - 机器人周围是一个圆形留空区，圆外（包括机器人上方和下方）都有字符
 *
 * 层级：默认 z-index 32，在首屏的薰衣草叠色层(z-30/31)之上、标题(z-50)和导航(z-100)之下。
 *       必须在叠色层之上：那一层是 multiply 混合，白色字符放在它下面会被染成背景色而看不见。
 *
 * 可选属性（写在 <section id="home"> 上）：
 *   data-rain-opacity="1"      整体浓度倍数
 *   data-rain-speed="1"        下落速度倍数
 *   data-rain-density="1"      列数倍数
 *   data-rain-white="0.16"     白色字符占比 0~1
 *   data-rain-jump="1"         字符跳动频率倍数（0 = 不跳）
 *   data-rain-hole="0.34"      圆形留空区半径 = 首屏高度 × 该值
 *   data-rain-blur="1.6"       后层模糊(px)
 *   data-rain-ink="#2f2866"    深色字符
 *   data-rain-tint="#9d95e6"   浅紫字符
 *   data-rain-font="..."       字体
 *   data-rain-glyphs="..."     自定义字符集（直接写字符）
 *   data-rain-z="32"           层级
 *
 * 省电：首屏滚出视口、标签页切到后台时自动暂停；系统开了「减少动态效果」时只画一帧静止的。
 * 接口：window.codeRain.set({opacity, speed, density, white, jump, hole}) / pause() / resume() / refresh()
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
    white: Math.max(0, Math.min(1, num(ds.rainWhite, 0.16))),
    jump: num(ds.rainJump, 1),
    hole: num(ds.rainHole, 0.34)
  };
  var BLUR = num(ds.rainBlur, 1.6);
  var INK = ds.rainInk || '#2f2866';
  var TINT = ds.rainTint || '#9d95e6';
  var FONT = ds.rainFont || 'Inter, "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  var GLYPHS = (ds.rainGlyphs || 'ABDEGHKLRTWXZbdhklqrtwxz0123456789').split('');
  var Z = ds.rainZ || '32';
  var MIN_WIDTH = 768;
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // 两层。speed 的单位是「每秒落下多少个首屏高度」；alpha 是每段最下方那个字符的不透明度
  var LAYERS = [
    { back: true,  share: 0.5, size: 13, alpha: 0.42, speed: [0.07, 0.12], len: [6, 14] },
    { back: false, share: 0.5, size: 18, alpha: 0.62, speed: [0.14, 0.24], len: [5, 12] }
  ];

  // ---------- 两张画布：后层用 CSS 模糊（由显卡合成，比每帧在画布里做模糊便宜得多） ----------
  var wrap = document.createElement('div');
  wrap.className = 'code-rain';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:' + Z + ';';
  function mk(blur) {
    var c = document.createElement('canvas');
    c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;' + (blur ? 'filter:blur(' + blur + 'px);' : '');
    wrap.appendChild(c);
    return c;
  }
  var cvBack = mk(BLUR), cvFront = mk(0);
  var cx = [cvBack.getContext('2d'), cvFront.getContext('2d')];
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(wrap);

  var W = 0, H = 0, dpr = 1, cols = [];

  // 圆形留空区（机器人）+ 顶部（导航下）和底部渐隐
  function applyMask() {
    var r = Math.round(H * cfg.hole);
    var m = 'radial-gradient(circle ' + r + 'px at 50% 49%, transparent 0, transparent 74%, #000 100%), ' +
            'linear-gradient(to bottom, transparent 0, #000 13%, #000 84%, transparent 100%)';
    wrap.style.webkitMaskImage = m; wrap.style.maskImage = m;
    wrap.style.webkitMaskComposite = 'source-in'; wrap.style.maskComposite = 'intersect';
  }

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function glyph() { return GLYPHS[(Math.random() * GLYPHS.length) | 0]; }
  function tone() { var r = Math.random(); return r < cfg.white ? 2 : r < cfg.white + 0.2 ? 1 : 0; } // 0 深 1 浅紫 2 白

  function newSeg(layer, lh, startY) {
    var n = Math.round(rnd(layer.len[0], layer.len[1])), g = [], t = [];
    for (var i = 0; i < n; i++) { g.push(glyph()); t.push(i === 0 ? 0 : tone()); }  // 最下方永远是深色
    return { y: startY, n: n, g: g, t: t };
  }

  function build() {
    W = host.clientWidth; H = host.clientHeight;
    var on = W >= MIN_WIDTH && H > 0;
    wrap.hidden = !on;
    wrap.style.display = on ? '' : 'none';
    if (!on) { cols = []; return W > 0; }
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    [cvBack, cvFront].forEach(function (c) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); });
    cols = [];
    var total = Math.round((W / 44) * cfg.density);
    LAYERS.forEach(function (layer, li) {
      var n = Math.round(total * layer.share), lh = layer.size * 1.3;
      for (var i = 0; i < n; i++) {
        // 每列先均匀分布再加抖动，避免扎堆
        var x = (i + rnd(0.15, 0.85)) * (W / n);
        var col = { li: li, layer: layer, x: x, lh: lh, v: rnd(layer.speed[0], layer.speed[1]), segs: [] };
        // 每列 1~2 段，初始位置铺满全屏，打开页面时已经是"下了一会儿"的状态
        var y = rnd(0, H);
        for (var k = 0; k < 2; k++) {
          var s = newSeg(layer, lh, y);
          col.segs.push(s);
          y -= s.n * lh + rnd(0.25, 0.9) * H;
        }
        cols.push(col);
      }
    });
    applyMask();
    return true;
  }

  function step(dt) {
    var pJump = 0.5 * cfg.jump * dt;             // 普通字符：平均约 2 秒换一次
    var pHead = 7 * cfg.jump * dt;               // 最下方的字符：每秒约 7 次
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i], dy = c.v * H * cfg.speed * dt;
      for (var k = 0; k < c.segs.length; k++) {
        var s = c.segs[k];
        s.y += dy;
        if (Math.random() < pHead) s.g[0] = glyph();
        for (var j = 1; j < s.n; j++) if (Math.random() < pJump) s.g[j] = glyph();
        if (s.y - s.n * c.lh > H) {              // 整段落出屏幕：从上方重新进入
          var top = 0;
          for (var q = 0; q < c.segs.length; q++) top = Math.min(top, c.segs[q].y - c.segs[q].n * c.lh);
          c.segs[k] = newSeg(c.layer, c.lh, top - rnd(0.1, 0.7) * H);
        }
      }
    }
  }

  function draw() {
    for (var li = 0; li < 2; li++) {
      var g = cx[li], layer = LAYERS[li];
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '400 ' + layer.size + 'px ' + FONT;
      g.shadowColor = 'transparent'; g.shadowBlur = 0;
      var whites = [];
      for (var i = 0; i < cols.length; i++) {
        var c = cols[i];
        if (c.li !== li) continue;
        for (var k = 0; k < c.segs.length; k++) {
          var s = c.segs[k];
          for (var j = 0; j < s.n; j++) {
            var y = s.y - j * c.lh;
            if (y < -c.lh || y > H + c.lh) continue;
            // 最下方最深，往上按平方衰减
            var f = 1 - j / s.n, a = layer.alpha * cfg.opacity * (j === 0 ? 1 : 0.12 + 0.62 * f * f);
            if (s.t[j] === 2) { whites.push(s.g[j], c.x, y, Math.min(1, a * 2.2 + 0.25 * cfg.opacity)); continue; }
            g.globalAlpha = Math.min(1, a);
            g.fillStyle = s.t[j] === 1 ? TINT : INK;
            g.fillText(s.g[j], c.x, y);
          }
        }
      }
      // 白色字符最后统一画：带一圈很淡的紫晕，在浅底上才分得出来
      if (whites.length) {
        g.fillStyle = '#fff'; g.shadowColor = 'rgba(103,51,234,.4)'; g.shadowBlur = layer.size * 0.3 * dpr;
        for (var w = 0; w < whites.length; w += 4) { g.globalAlpha = whites[w + 3]; g.fillText(whites[w], whites[w + 1], whites[w + 2]); }
      }
      g.globalAlpha = 1;
    }
  }

  // ---------- 循环 ----------
  var ready = false, visible = true, manual = false, raf = 0, last = 0;

  function loop(ts) {
    raf = 0;
    if (!ready) { ready = build(); last = 0; if (ready && cols.length) draw(); }
    if (!ready || !cols.length || reduced) return;   // 手机端 / 减少动态效果：不进入循环
    if (!visible || manual || document.hidden) { last = 0; return; }
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
    last = ts;
    step(dt); draw();
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
      for (var k in o) if (k in cfg && cfg[k] !== o[k]) { cfg[k] = o[k]; if (k === 'density' || k === 'white') rebuild = true; if (k === 'hole' && ready) applyMask(); }
      if (rebuild) refresh(); else if ((reduced || manual) && ready && cols.length) draw(); else kick();
    }
  };
  kick();
})();
