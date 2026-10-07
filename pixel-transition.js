/*!
 * pixel-transition.js — 首页 ⇄ 作品集 的「像素入侵」转场
 *
 * 用法：在 </body> 前加一行  <script src="pixel-transition.js" defer></script>
 *       不需要改 HTML。脚本会接管页面里的 switchPage()：只有在「首页视图」和「作品集视图」
 *       之间切换时才播放转场；同一个视图内的跳转（关于我、核心技能…）照常直接滚动。
 *
 * 过程：
 *   1. 入侵：黑色像素块从屏幕一侧蔓延，大小不一，有的列蹿得快，前沿在闪烁，夹着少量紫色坏点和横向撕裂条
 *   2. 整屏变黑的那一刻，真正执行页面切换（原来的 switchPage）
 *   3. 退场：像素块沿同一方向继续扫过去，露出新页面
 *   去作品集：从下往上；回首页：从上往下
 *
 * 层级：固定在视口上的画布，默认 z-index 90，在导航(z-100)之下、其余所有内容之上。
 *       转场期间拦截点击；不播放时画布是隐藏的，没有任何开销。
 *
 * 可选属性（写在 <body> 上）：
 *   data-pixel-duration="560"   入侵和退场各自的时长(ms)
 *   data-pixel-size="56"        基础方块边长(px)，实际会细分成 1/2、1/4
 *   data-pixel-color="#000"     方块颜色（应当和作品集背景一致）
 *   data-pixel-glitch="1"       闪烁 / 坏点 / 撕裂条的强度，0 = 只有干净的方块
 *   data-pixel-z="90"           层级
 *
 * 系统开了「减少动态效果」时不播放，直接切换。
 * 接口：window.pixelTransition.play(callback, upward) / set({duration, size, glitch})
 */
(function () {
  'use strict';

  var ds = document.body.dataset;
  function num(v, d) { v = parseFloat(v); return isNaN(v) ? d : v; }
  var cfg = {
    duration: num(ds.pixelDuration, 560),
    size: num(ds.pixelSize, 56),
    glitch: num(ds.pixelGlitch, 1)
  };
  var COLOR = ds.pixelColor || '#000';
  var PURPLE = '#6733ea', LAVENDER = '#b2b8f8';
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  var canvas = document.createElement('canvas');
  canvas.className = 'pixel-transition';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  // 一般盖住整个视口；页面里有 [data-pixel-host] 元素时改为只盖住那个元素（用于内嵌的演示）
  var host = document.querySelector('[data-pixel-host]');
  canvas.style.cssText = 'position:' + (host ? 'absolute' : 'fixed') + ';inset:0;width:100%;height:100%;display:block;z-index:' + (ds.pixelZ || '90') + ';';
  (host || document.body).appendChild(canvas);
  var ctx = canvas.getContext('2d');

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
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

  // ---------- 方块 ----------
  // 每个方块有一个 0~1 的"到达时刻" t：前沿扫到它时出现。t 主要由纵向位置决定，
  // 再加上每一列的快慢偏移和一点随机，所以前沿是参差的，有的列明显蹿在前面。
  var W = 0, H = 0, dpr = 1, B = 56, N = 0, RX, RY, RS, RT, NB = 0, BX, BY, BW, BH, BT;

  function build() {
    W = host ? host.clientWidth : window.innerWidth; H = host ? host.clientHeight : window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    B = clamp(cfg.size * clamp(W / 1920, 0.6, 1.3), 24, 96);
    var cols = Math.ceil(W / B), rowsN = Math.ceil(H / B), rand = rng(20261007);
    var shift = new Float32Array(cols);
    for (var c = 0; c < cols; c++) shift[c] = rand() < 0.16 ? -(0.05 + 0.2 * rand()) : 0.1 * rand();
    var x = [], y = [], s = [], t = [];
    for (var r = 0; r < rowsN; r++) {
      for (var cc = 0; cc < cols; cc++) {
        var u = rand(), L = u < 0.42 ? 0 : (u < 0.8 ? 1 : 2), n = 1 << L, sz = B / n;   // 整块 / 四分 / 十六分
        for (var j = 0; j < n; j++) for (var i = 0; i < n; i++) {
          var px = cc * B + i * sz, py = r * B + j * sz;
          if (px >= W || py >= H) continue;
          var d = 1 - (py + sz / 2) / H;                     // 0 = 底部，1 = 顶部
          x.push(px); y.push(py); s.push(sz);
          t.push(clamp(d * 0.7 + shift[cc] + (rand() - 0.5) * 0.14 + 0.1, 0.02, 0.98));
        }
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
  }

  // a = 入侵前沿走到哪了，b = 退场前沿走到哪了；方块在 (b, a] 这段里是黑的
  function draw(a, b, upward, tick) {
    var Wp = canvas.width, Hp = canvas.height, g = cfg.glitch;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, Wp, Hp);
    if (a >= 1 && b <= 0) { ctx.fillStyle = COLOR; ctx.fillRect(0, 0, Wp, Hp); return; }   // 全黑：一整块，避免方块间出现细缝
    ctx.fillStyle = COLOR;
    var gp = [], gl = [];
    for (var i = 0; i < N; i++) {
      var t = RT[i], on = t <= a && t > b, ghost = 0;
      if (g > 0) {
        var fa = t - a, fb = t - b;                          // 离两条前沿的距离
        if (!on) {
          if (fa > 0 && fa < 0.05 * g && hash(i, tick, 7) > 0.55) on = true;             // 入侵前沿：提前闪现
          else if (fb <= 0 && fb > -0.05 * g && hash(i, tick, 11) > 0.6) on = true;      // 退场前沿：残留闪烁
        } else if (RS[i] <= B * 0.5) {
          var q = hash(i, tick, 17);
          if (fa > -0.03) ghost = q < 0.14 * g ? 1 : q < 0.2 * g ? 2 : 0;                // 刚接通的小块：紫色坏点
          else if (fa > -0.1 && q < 0.04 * g) on = false;                                // 前沿后面偶尔掉一格
        }
      }
      if (!on) continue;
      var x0 = Math.round(RX[i] * dpr), x1 = Math.round((RX[i] + RS[i]) * dpr);
      var y0 = Math.round(RY[i] * dpr), y1 = Math.round((RY[i] + RS[i]) * dpr);
      if (!upward) { var ty = Hp - y1; y1 = Hp - y0; y0 = ty; }                           // 回首页：上下翻转
      if (ghost) { (ghost === 1 ? gp : gl).push(x0, y0, x1 - x0, y1 - y0); continue; }
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    if (gp.length) { ctx.fillStyle = PURPLE; for (var m = 0; m < gp.length; m += 4) ctx.fillRect(gp[m], gp[m + 1], gp[m + 2], gp[m + 3]); }
    if (gl.length) { ctx.fillStyle = LAVENDER; for (var n = 0; n < gl.length; n += 4) ctx.fillRect(gl[n], gl[n + 1], gl[n + 2], gl[n + 3]); }
    if (g > 0) {                                             // 横向撕裂条：出现在入侵前沿前面一点
      for (var k = 0; k < NB; k++) {
        var f = BT[k] - a;
        if (f < 0 || f > 0.12 * g || hash(k, tick, 3) < 0.3) continue;
        ctx.fillStyle = hash(k, tick, 5) < 0.12 ? PURPLE : COLOR;
        var by = Math.round(BY[k] * dpr), bh = Math.round(BH[k] * dpr);
        ctx.fillRect(Math.round(BX[k] * dpr), upward ? by : Hp - by - bh, Math.round(BW[k] * dpr), bh);
      }
    }
  }

  // ---------- 播放 ----------
  var playing = false;
  function ease(v) { return v < 0.5 ? 2 * v * v : 1 - Math.pow(-2 * v + 2, 2) / 2; }

  // hold：切换后保持全黑多少毫秒再退场（给页面留出跳到目标位置的时间）
  function play(swap, upward, hold) {
    if (reduced || playing) { if (swap) swap(); return; }
    playing = true;
    build();
    canvas.hidden = false;
    var start = performance.now(), swapped = false, dur = Math.max(120, cfg.duration);
    (function frame(now) {
      var e = now - start, tick = Math.floor(now / 60);
      if (e < dur) {
        draw(ease(e / dur) * 1.06, -1, upward, tick);                    // 入侵（略微过冲，保证最后一格也到达）
      } else {
        if (!swapped) {
          swapped = true;
          draw(1, 0, upward, tick);                                      // 全黑的一帧里切换页面
          try { if (swap) swap(); } catch (err) { setTimeout(function () { throw err; }); }
          start = performance.now() - dur + (hold || 0);                 // 切换本身的耗时和停留时间不计入退场
        }
        e = performance.now() - start;
        var r = (e - dur) / dur;
        if (r < 0) { requestAnimationFrame(frame); return; }               // 停留：保持全黑
        if (r >= 1) { ctx.clearRect(0, 0, canvas.width, canvas.height); canvas.hidden = true; playing = false; return; }
        draw(2, ease(r) * 1.06 - 0.03, upward, tick);                    // 退场
      }
      requestAnimationFrame(frame);
    })(start);
  }

  // ---------- 接管 switchPage ----------
  function isPortfolioShown() {
    var v = document.getElementById('view-portfolio');
    return !!v && !v.classList.contains('view-hidden');
  }
  var original = window.switchPage;
  if (typeof original === 'function') {
    window.switchPage = function (pageId, targetId) {
      var toPortfolio = pageId === 'portfolio';
      if (toPortfolio === isPortfolioShown()) return original.apply(this, arguments);   // 同一视图内：不播转场
      var self = this, args = arguments;
      play(function () {
        // 黑屏期间直接跳到目标位置，而不是在退场时还在平滑滚动
        var scrollTo = window.scrollTo;
        window.scrollTo = function (o) {
          if (o && typeof o === 'object') o = Object.assign({}, o, { behavior: 'instant' });
          return scrollTo.apply(window, o === undefined ? arguments : [o]);
        };
        setTimeout(function () { window.scrollTo = scrollTo; }, 100);
        original.apply(self, args);
      }, toPortfolio, 130);
    };
  }

  window.pixelTransition = {
    play: play,
    set: function (o) { for (var k in o) if (k in cfg) cfg[k] = o[k]; }
  };
})();
