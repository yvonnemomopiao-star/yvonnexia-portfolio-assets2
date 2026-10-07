/*!
 * pixel-rise.js — 首屏 → 作品章节目录 的「像素入侵」滚动衔接
 *
 * 用法：在 </body> 前加一行  <script src="pixel-rise.js" defer></script>
 *       默认把 #work-chapters 当作目标板块，把它前面的那个板块（#home）当作首屏。
 *
 * 效果：往下滚时首屏被钉在原地（机器人不动），一片黑色像素场从屏幕底部往上入侵：
 *       轮廓是山峰一样的天际线，会自己流动、涌动；外沿是一条忽明忽暗的抖动带，山前有零星飞起的黑点。
 *       只有一种颜色：所有碎点都是镂空，直接露出下面的首屏。停在半路时它也一直在动。
 *       盖满之后首屏放行，下面的章节目录接上来，颜色完全一致。往回滚会原样退回去。
 *       黑色层在首屏内容（机器人、标题、文字水面）之上，固定导航(z-100)之下。
 *
 * 可选属性（写在目标板块 #work-chapters 上）：
 *   data-pixel-pin="0.8"      首屏钉住多久 = 多少个视口高度的滚动距离
 *   data-pixel-size="16"      格子边长(px)，按 1920 宽调校，随屏幕宽度缩放
 *   data-pixel-shape="peaks"  造型：peaks 尖峰（默认）/ ridge 连绵山脊 / columns 像素柱
 *   data-pixel-glitch="1"     抖动带、镂空和飞点的强度，0 = 只有干净的山形
 *   data-pixel-flow="1"       山峰自己流动的速度倍数，0 = 只随滚动变化
 *   data-pixel-color="..."    方块颜色，默认读取目标板块的背景色
 *   data-pixel-z="60"         黑色层在首屏内部的层级（要高于首屏里最高的标题 z-50）
 *
 * 前置条件：钉住首屏靠 position: sticky，<body> 不能是 overflow-x: hidden（要用 clip）。
 *           如果 sticky 没生效，脚本会自动撤销自己，页面回到普通滚动，并在控制台提示。
 *
 * 接口：window.pixelRise.progress()  0~1
 *       window.pixelRise.covering()  true = 黑色已经盖到导航所在的顶部（导航应切成深色）
 *       window.pixelRise.set({pin, size, glitch, flow, shape}) / refresh()
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
  var cfg = { pin: num(ds.pixelPin, 0.8), size: num(ds.pixelSize, 16), glitch: num(ds.pixelGlitch, 1), flow: num(ds.pixelFlow, 1), shape: ds.pixelShape || 'peaks' };
  var FPS = 14;      // 像素场每秒步进多少次
  var FULL = 0.9;    // 钉住行程走到这个比例时已经全黑，剩下的当缓冲
  var COVER = 0.86;  // 进度超过它，顶部（导航所在）基本被盖住

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

  // ---------- 像素场 ----------
  // 不再是"固定方块按位置依次点亮"。每一格的明暗由一张会流动的噪声场决定：
  //   每一格算出它离山体表面的距离（见 field），表面以内变黑；滚动只负责把山整体往上抬，
  //   山的形状自己会随时间流动、起伏。表面外沿有一条抖动带，山前还有零星飞起的黑点。
  var W = 0, H = 0, dpr = 1, cell = 16, cols = 0, rows = 0, pinLen = 0, color = '#000';

  function build() {
    W = hero.clientWidth; H = hero.clientHeight;
    if (!W || !H) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    pinLen = Math.round(H * cfg.pin * (W < 768 ? 0.75 : 1));
    wrap.style.height = (H + pinLen) + 'px';
    cell = Math.max(6, Math.round(cfg.size * clamp(W / 1920, 0.55, 1.4)));
    cols = Math.ceil(W / cell); rows = Math.ceil(H / cell);
    var c2 = ds.pixelColor || getComputedStyle(target).backgroundColor;
    color = (!c2 || c2 === 'transparent' || /,\s*0\)$/.test(c2)) ? '#000' : c2;
    if (grain) grain.pattern = null;
    return true;
  }

  // 整数格点哈希 → 0~1
  function h2(x, y) {
    var n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y) {                                  // 平滑的值噪声
    var xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var a = h2(xi, yi), b = h2(xi + 1, yi), c = h2(xi, yi + 1), d = h2(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function fbm(x, y, oct) {                                // 分形叠加：大山形 + 小碎石
    var amp = 0.5, sum = 0;
    for (var i = 0; i < oct; i++) { sum += amp * vnoise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 9.2; amp *= 0.5; }
    return sum;
  }

  // 尖峰用：把噪声折成"山脊"——值越接近中线越高，再平方，得到尖顶和陡坡
  function ridged(x, y) {
    var amp = 0.55, sum = 0, w = 1;
    for (var i = 0; i < 4; i++) {
      var n = 1 - Math.abs(2 * vnoise(x, y) - 1); n = n * n * w;
      sum += n * amp; w = clamp(n * 1.6, 0, 1);            // 高处才长细节，山谷保持干净
      x = x * 2.1 + 31.7; y = y * 1.3 + 4.1; amp *= 0.5;
    }
    return sum;                                            // 约 0 ~ 1
  }

  // 每一格离"山体表面"有多远：>0 在山体里，<0 在山外。三种造型只是这个函数不同。
  function field(c, r, yb, p, t) {
    if (cfg.shape === 'peaks') {                           // 尖峰：一条有主峰、有山谷的天际线
      var x = c / rows;
      var hgt = ridged(x * 0.95 + t * 0.035, t * 0.11) * 0.62 + vnoise(x * 0.5 + 9, t * 0.05) * 0.2;
      return (-0.86 + p * 1.92 + hgt - yb) * 1.25;
    }
    if (cfg.shape === 'columns') {                         // 像素柱：宽窄不一的柱子各自升降
      var band = 0, x0 = 0, cc = c;
      while (true) { var bw = 2 + ((h2(band, 91) * 4) | 0); if (cc < x0 + bw) break; x0 += bw; band++; }
      var hh = h2(band, 7) * 0.38 + vnoise(band * 0.41 + 3, t * 0.55) * 0.34 + vnoise(band * 0.13, t * 0.2) * 0.2;
      var top = -0.98 + p * 2.04 + hh;
      top = Math.round(top * rows) / rows;                 // 柱顶对齐格子，边缘是平的
      return (top - yb) * 1.25 + 0.16;
    }
    // 山脊：被扭曲过的分形噪声，轮廓柔和、连绵
    var sc = 1.25 / rows, qx = c * sc + t * 0.07, qy = (rows - r) * sc;
    var wx = fbm(qx, qy + t * 0.05, 3), wy = fbm(qx + 5.2, qy - t * 0.04, 3);
    return fbm(qx + wx * 1.7, qy + wy * 1.7, 4) * 1.35 + (0.5 - yb) * 1.15 - (1.62 - p * 2.3);
  }

  function draw(p, t, stepN) {
    var Wp = canvas.width, Hp = canvas.height, g = cfg.glitch, cp = cell * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, Wp, Hp);
    if (p <= 0) return;
    ctx.fillStyle = color;                                 // 只有一种颜色；所有"碎点"都是镂空，直接露出下面的首屏
    if (p >= 1) {                                          // 盖满：一整块，和下面的板块无缝衔接
      ctx.fillRect(0, 0, Wp, Hp);
    } else {
      var edge = cfg.shape === 'columns' ? 0.05 : 0.1 + 0.05 * g;
      for (var r = 0; r < rows; r++) {
        var yb = 1 - (r + 0.5) / rows;                     // 0 = 屏幕底部，1 = 顶部
        var y0 = Math.round(r * cp), hh = Math.round((r + 1) * cp) - y0, run = -1;
        for (var c = 0; c <= cols; c++) {
          var solid = false;
          if (c < cols) {
            var d = field(c, r, yb, p, t);
            if (d >= edge) {
              // 山体里靠近表面的地方偶尔镂空一格
              solid = !(g > 0 && d < edge + 0.16 && h2(c * 3 + stepN, r * 7) > 1 - 0.035 * g);
            } else if (d >= 0) {                           // 抖动带：越靠外越稀，每一步都在变
              solid = h2(c + stepN * 131, r - stepN * 71) < 0.3 + 0.6 * (d / edge);
            } else if (g > 0 && d > -0.26) {               // 山前零星飞起的黑点
              var near = 1 + d / 0.26;
              solid = h2(c - stepN * 53, r + stepN * 97) < near * near * 0.11 * g;
            }
          }
          if (solid) { if (run < 0) run = c; }
          else if (run >= 0) {                             // 把一行里连续的黑格合并成一个矩形画
            var x0 = Math.round(run * cp); ctx.fillRect(x0, y0, Math.round(c * cp) - x0, hh); run = -1;
          }
        }
      }
    }
    if (grain) {                                           // 颗粒只叠在已经画了的像素上
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

    // 场按固定帧率步进（像逐帧动画），滚动本身也会推着它往前流
    var animating = p > 0 && p < 1 && cfg.flow > 0;
    var stepN = animating ? Math.floor(performance.now() / 1000 * FPS) : 0;
    var t = stepN / FPS * cfg.flow + p * 2.4;
    var key = p.toFixed(3) + ':' + stepN;
    if (dirty || key !== lastKey) { lastKey = key; dirty = false; draw(p, t, stepN); }
    if (animating) request();                              // 停在半路时山峰继续涌动
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
