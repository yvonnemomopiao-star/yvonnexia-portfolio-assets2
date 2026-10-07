/*!
 * pixel-rise.js — 首屏 → 作品章节目录 的「像素入侵」滚动衔接
 *
 * 用法：在 </body> 前加一行  <script src="pixel-rise.js" defer></script>
 *       默认把 #work-chapters 当作目标板块，把它前面的那个板块（#home）当作首屏。
 *
 * 效果：往下滚时首屏被钉在原地（机器人不动），一层黑色像素块从屏幕底部往上入侵：
 *       方块大小不一，有的列蹿得快，前沿在闪烁，夹着少量紫色坏点和横向撕裂条。
 *       盖满之后首屏放行，下面的章节目录接上来，颜色完全一致。往回滚会原样退回去。
 *       黑色层在首屏内容（机器人、标题、文字水面）之上，固定导航(z-100)之下。
 *
 * 可选属性（写在目标板块 #work-chapters 上）：
 *   data-pixel-pin="0.8"      首屏钉住多久 = 多少个视口高度的滚动距离
 *   data-pixel-size="56"      基础方块边长(px)，实际会细分成 1/2、1/4
 *   data-pixel-glitch="1"     闪烁 / 坏点 / 撕裂条的强度，0 = 只有干净的方块
 *   data-pixel-color="..."    方块颜色，默认读取目标板块的背景色
 *   data-pixel-z="60"         黑色层在首屏内部的层级（要高于首屏里最高的标题 z-50）
 *
 * 前置条件：钉住首屏靠 position: sticky，<body> 不能是 overflow-x: hidden（要用 clip）。
 *           如果 sticky 没生效，脚本会自动撤销自己，页面回到普通滚动，并在控制台提示。
 *
 * 接口：window.pixelRise.progress()  0~1
 *       window.pixelRise.covering()  true = 黑色已经盖到导航所在的顶部（导航应切成深色）
 *       window.pixelRise.set({pin, size, glitch}) / refresh()
 *       状态变化时会调用 window.syncNavigationTheme()（如果存在）
 *
 * 系统开了「减少动态效果」时不启用，首屏和章节目录保持直线衔接。
 */
(function () {
  'use strict';

  var off = { refresh: function () {}, set: function () {}, progress: function () { return 0; }, covering: function () { return false; } };
  window.pixelRise = off;

  var target = document.querySelector('[data-pixel-rise]') || document.getElementById('work-chapters');
  if (!target) return;
  var ds = target.dataset;
  var hero = ds.pixelHero ? document.querySelector(ds.pixelHero) : target.previousElementSibling;
  if (!hero || !hero.parentNode) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!(window.CSS && CSS.supports && CSS.supports('position', 'sticky'))) return;

  function num(v, d) { v = parseFloat(v); return isNaN(v) ? d : v; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  var cfg = { pin: num(ds.pixelPin, 0.8), size: num(ds.pixelSize, 56), glitch: num(ds.pixelGlitch, 1) };
  var PURPLE = '#6733ea', LAVENDER = '#b2b8f8';
  var FULL = 0.9;    // 钉住行程走到这个比例时已经全黑，剩下的当缓冲
  var COVER = 0.82;  // 进度超过它，顶部（导航所在）基本被盖住

  // ---------- DOM：钉住容器 + 首屏内部的画布 ----------
  var heroCss = hero.style.cssText;
  var wrap = document.createElement('div');
  wrap.setAttribute('data-pixel-pin-wrap', '');
  hero.parentNode.insertBefore(wrap, hero);
  wrap.appendChild(hero);
  hero.style.position = 'sticky';
  hero.style.top = '0';

  var canvas = document.createElement('canvas');
  canvas.className = 'pixel-rise';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:' + (ds.pixelZ || '60') + ';';
  hero.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  // 一般跟随整页滚动；目标板块写了 data-pixel-scroller="选择器" 时改为跟随那个滚动容器（用于内嵌的演示）
  var scroller = ds.pixelScroller ? document.querySelector(ds.pixelScroller) : null;
  function base() { return scroller ? scroller.getBoundingClientRect().top : 0; }

  var dead = false, covering = false;
  function teardown(reason) {
    if (dead) return;
    dead = true;
    if (wrap.parentNode) { wrap.parentNode.insertBefore(hero, wrap); wrap.parentNode.removeChild(wrap); }
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    hero.style.cssText = heroCss;
    window.pixelRise = off;
    if (covering) { covering = false; if (window.syncNavigationTheme) window.syncNavigationTheme(); }
    if (window.console) console.warn('[pixel-rise] 已撤销：' + reason);
  }

  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(a, b, c) {
    var h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // 目标板块如果用 ::before 叠了颗粒纹理，会把整体亮度抬高几个色阶；把同一张纹理叠到方块上，衔接处才没有色阶
  var grain = null;
  function loadGrain() {
    var cs = getComputedStyle(target, '::before');
    var m = /url\((["']?)([\s\S]+?)\1\)/.exec(cs.backgroundImage || '');
    if (!m) return;
    var img = new Image();
    img.onload = function () {
      var a = parseFloat(cs.opacity);
      grain = { img: img, alpha: isNaN(a) ? 1 : a, pattern: null };
      dirty = true; request();
    };
    img.src = m[2];
  }

  // ---------- 方块 ----------
  // 每个方块有一个 0~1 的"到达时刻" t：主要由纵向位置决定（底部先到），
  // 再加上每一列的快慢偏移和一点随机，所以前沿是参差的，有的列明显蹿在前面。
  var W = 0, H = 0, dpr = 1, B = 56, pinLen = 0, color = '#000';
  var N = 0, RX, RY, RS, RT, NB = 0, BX, BY, BW, BH, BT;

  function build() {
    W = hero.clientWidth; H = hero.clientHeight;
    if (!W || !H) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    pinLen = Math.round(H * cfg.pin * (W < 768 ? 0.75 : 1));
    wrap.style.height = (H + pinLen) + 'px';
    B = clamp(cfg.size * clamp(W / 1920, 0.6, 1.3), 24, 96);
    var cols = Math.ceil(W / B), rowsN = Math.ceil(H / B), rand = rng(20261007);
    var shift = new Float32Array(cols);
    for (var c = 0; c < cols; c++) shift[c] = rand() < 0.16 ? -(0.05 + 0.2 * rand()) : 0.1 * rand();
    var x = [], y = [], s = [], t = [];
    for (var r = 0; r < rowsN; r++) for (var cc = 0; cc < cols; cc++) {
      var u = rand(), L = u < 0.42 ? 0 : (u < 0.8 ? 1 : 2), n = 1 << L, sz = B / n;   // 整块 / 四分 / 十六分
      for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
        var px = cc * B + i * sz, py = r * B + j * sz;
        if (px >= W || py >= H) continue;
        var d = 1 - (py + sz / 2) / H;                     // 0 = 底部，1 = 顶部
        x.push(px); y.push(py); s.push(sz);
        t.push(clamp(d * 0.7 + shift[cc] + (rand() - 0.5) * 0.14 + 0.1, 0.02, 0.98));
      }
    }
    N = x.length;
    RX = Float32Array.from(x); RY = Float32Array.from(y); RS = Float32Array.from(s); RT = Float32Array.from(t);
    NB = 14;
    BX = new Float32Array(NB); BY = new Float32Array(NB); BW = new Float32Array(NB); BH = new Float32Array(NB); BT = new Float32Array(NB);
    for (var k = 0; k < NB; k++) {
      var yn = 0.05 + rand() * 0.9;
      BH[k] = Math.round(3 + rand() * 12); BY[k] = Math.round(yn * H);
      BW[k] = W * (0.15 + rand() * 0.5); BX[k] = rand() * (W - BW[k]);
      BT[k] = (1 - yn) * 0.7 + 0.1;
    }
    var c2 = ds.pixelColor || getComputedStyle(target).backgroundColor;
    color = (!c2 || c2 === 'transparent' || /,\s*0\)$/.test(c2)) ? '#000' : c2;
    if (grain) grain.pattern = null;
    return true;
  }

  function draw(a, tick) {
    var Wp = canvas.width, Hp = canvas.height, g = cfg.glitch;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, Wp, Hp);
    if (a <= 0) return;
    ctx.fillStyle = color;
    if (a >= 1) {                                          // 全黑：一整块，避免方块间出现细缝
      ctx.fillRect(0, 0, Wp, Hp);
    } else {
      var gp = [], gl = [];
      for (var i = 0; i < N; i++) {
        var t = RT[i], on = t <= a, ghost = 0;
        if (g > 0) {
          var f = t - a;
          if (!on) {
            if (f < 0.05 * g && hash(i, tick, 7) > 0.55) on = true;                       // 前沿：提前闪现
          } else if (RS[i] <= B * 0.5) {
            var q = hash(i, tick, 17);
            if (f > -0.03) ghost = q < 0.14 * g ? 1 : q < 0.2 * g ? 2 : 0;                // 刚接通的小块：紫色坏点
            else if (f > -0.1 && q < 0.04 * g) on = false;                                // 前沿后面偶尔掉一格
          }
        }
        if (!on) continue;
        var x0 = Math.round(RX[i] * dpr), x1 = Math.round((RX[i] + RS[i]) * dpr);
        var y0 = Math.round(RY[i] * dpr), y1 = Math.round((RY[i] + RS[i]) * dpr);
        if (ghost) { (ghost === 1 ? gp : gl).push(x0, y0, x1 - x0, y1 - y0); continue; }
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      if (gp.length) { ctx.fillStyle = PURPLE; for (var m = 0; m < gp.length; m += 4) ctx.fillRect(gp[m], gp[m + 1], gp[m + 2], gp[m + 3]); }
      if (gl.length) { ctx.fillStyle = LAVENDER; for (var n = 0; n < gl.length; n += 4) ctx.fillRect(gl[n], gl[n + 1], gl[n + 2], gl[n + 3]); }
      if (g > 0) {                                         // 横向撕裂条：出现在前沿上方一点
        for (var k = 0; k < NB; k++) {
          var fb = BT[k] - a;
          if (fb < 0 || fb > 0.12 * g || hash(k, tick, 3) < 0.3) continue;
          ctx.fillStyle = hash(k, tick, 5) < 0.12 ? PURPLE : color;
          ctx.fillRect(Math.round(BX[k] * dpr), Math.round(BY[k] * dpr), Math.round(BW[k] * dpr), Math.round(BH[k] * dpr));
        }
      }
    }
    if (grain) {                                           // 颗粒只叠在已经画了方块的像素上
      if (!grain.pattern) {
        grain.pattern = ctx.createPattern(grain.img, 'repeat');
        try { grain.pattern.setTransform(new DOMMatrix().scale(dpr)); } catch (e) {}
      }
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = grain.alpha;
      ctx.fillStyle = grain.pattern;
      ctx.fillRect(0, 0, Wp, Hp);
      ctx.restore();
    }
  }

  // ---------- 进度：由滚动位置决定 ----------
  var ready = false, queued = false, dirty = true, lastKey = '', lastP = 0, badSticky = 0;

  function frame() {
    queued = false;
    if (dead) return;
    if (!ready) { ready = build(); if (!ready) return; }
    var scrolled = base() - wrap.getBoundingClientRect().top;
    var p = clamp(scrolled / (pinLen * FULL || 1), 0, 1);
    lastP = p;

    // sticky 自检：钉住区间内首屏顶边应当贴着视口顶部，否则说明被祖先的 overflow 破坏了
    if (scrolled > 8 && scrolled < pinLen * 0.9) {
      if (Math.abs(hero.getBoundingClientRect().top - base()) > 2) {
        if (++badSticky >= 3) { teardown('position: sticky 没有生效，请检查 body 的 overflow-x 是否为 clip'); return; }
      } else badSticky = 0;
    }

    var isCov = p >= COVER;
    if (isCov !== covering) { covering = isCov; if (window.syncNavigationTheme) window.syncNavigationTheme(); }

    var a = p * 1.06;                                      // 略微过冲，保证最后一格也到达
    var animating = cfg.glitch > 0 && p > 0 && p < 1;
    var tick = animating ? Math.floor(performance.now() / 70) : 0;
    var key = p.toFixed(3) + ':' + tick;
    if (dirty || key !== lastKey) { lastKey = key; dirty = false; draw(a, tick); }
    if (animating) request();                              // 停在半路时前沿继续闪烁
  }
  function request() { if (!queued && !dead) { queued = true; requestAnimationFrame(frame); } }
  function refresh() { ready = false; dirty = true; request(); }

  (scroller || window).addEventListener('scroll', request, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(hero);
  else window.addEventListener('resize', refresh, { passive: true });

  window.pixelRise = {
    refresh: refresh,
    progress: function () { return lastP; },
    covering: function () { return covering; },
    set: function (o) { for (var k in o) if (k in cfg) cfg[k] = o[k]; refresh(); }
  };
  loadGrain();
  request();
})();
