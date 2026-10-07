/*!
 * pixel-rise.js — 首屏 → 作品章节目录 的「像素入侵」滚动衔接
 *
 * 用法：在 </body> 前加一行  <script src="pixel-rise.js" defer></script>
 *       默认把 #work-chapters 当作目标板块，把它前面的那个板块（#home）当作首屏。
 *
 * 效果：往下滚时首屏被钉在原地（机器人不动），一片黑色像素场从屏幕底部往上入侵：
 *       轮廓是山峰一样的天际线，会自己流动、涌动；外沿是一条忽明忽暗的抖动带，山前有零星飞起的黑点。
 *       只有一种颜色：所有碎点都是镂空，直接露出下面的首屏。停在半路时它也一直在动。
 *       整屏变黑后，章节目录的三行标题在画面正中逐行"解码"出现（乱码逐个定格成文字），
 *       全部出现后才放行，页面继续正常滚动。往回滚会原样退回去。
 *       黑色层在首屏内容（机器人、标题、文字水面）之上，固定导航(z-100)之下。
 *
 * 可选属性（写在目标板块 #work-chapters 上）：
 *   data-pixel-pin="0.6"      首屏钉住多久 = 多少个视口高度的滚动距离
 *   data-pixel-size="16"      格子边长(px)，按 1920 宽调校，随屏幕宽度缩放
 *   data-pixel-shape="columns" 造型：columns 沿山形排列、宽窄高矮不一的像素柱（默认）/ peaks 尖峰 / ridge 连绵山脊
 *   data-pixel-reveal="0.35"  文字逐行出现占多少个视口高度的滚动距离，0 = 变黑后一次全部出现
 *   data-pixel-glitch="2.5"   抖动带、镂空和飞点的强度，0 = 只有干净的山形
 *   data-pixel-flow="1"       山峰自己流动的速度倍数，0 = 只随滚动变化
 *   data-pixel-color="..."    方块颜色，默认读取目标板块的背景色
 *   data-pixel-z="60"         黑色层在首屏内部的层级（要高于首屏里最高的标题 z-50）
 *
 * 前置条件：钉住首屏靠 position: sticky，<body> 不能是 overflow-x: hidden（要用 clip）。
 *           如果 sticky 没生效，脚本会自动撤销自己，页面回到普通滚动，并在控制台提示。
 *
 * 接口：window.pixelRise.progress()  0~1
 *       window.pixelRise.covering()  true = 黑色已经盖到导航所在的顶部（导航应切成深色）
 *       window.pixelRise.set({pin, reveal, size, glitch, flow, shape}) / refresh()
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
  var cfg = { pin: num(ds.pixelPin, 0.6), size: num(ds.pixelSize, 16), glitch: num(ds.pixelGlitch, 2.5), flow: num(ds.pixelFlow, 1), shape: ds.pixelShape || 'columns', reveal: num(ds.pixelReveal, 0.35) };
  var FPS = 14;      // 像素场每秒步进多少次
  var FULL = 0.9;    // 钉住行程走到这个比例时已经全黑，剩下的当缓冲
  var COVER = 0.86;  // 进度超过它，顶部（导航所在）基本被盖住

  // ---------- DOM ----------
  // 钉住的"舞台"里叠着两层：首屏（下）和章节目录（上，透明底）。
  // 黑色画布在首屏里；目录的文字等整屏变黑后才在画面正中逐行出现。放行时整个舞台一起滚走。
  var targetColor = ds.pixelColor || getComputedStyle(target).backgroundColor;
  if (!targetColor || targetColor === 'transparent' || /,\s*0\)$/.test(targetColor)) targetColor = '#000';
  var heroCss = hero.style.cssText, targetCss = target.style.cssText;
  var wrap = document.createElement('div'), stage = document.createElement('div');
  wrap.setAttribute('data-pixel-pin-wrap', '');
  stage.style.cssText = 'position:sticky;top:0;overflow:hidden;';
  hero.parentNode.insertBefore(wrap, hero);
  wrap.appendChild(stage);
  stage.appendChild(hero);

  var css = document.createElement('style');
  css.textContent =
    '.pixel-rise-overlay{position:absolute!important;inset:0;z-index:70;display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'background:transparent!important;padding-top:0!important;padding-bottom:0!important;margin:0!important;visibility:hidden;pointer-events:none}' +
    '.pixel-rise-overlay::before{display:none!important}' +
    '.pixel-rise-overlay>*{width:100%}' +
    '.pixel-rise-overlay.is-open{visibility:visible;pointer-events:auto}' +
    '.pixel-rise-overlay [data-pixel-line-off]{visibility:hidden}';
  document.head.appendChild(css);

  var canvas = document.createElement('canvas');
  canvas.className = 'pixel-rise';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:' + (ds.pixelZ || '60') + ';';
  hero.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  // 逐行出现的文字：默认取目录里的大标题
  var lines = [].slice.call(target.querySelectorAll('[data-pixel-line], .chapter-directory__title'));
  var lineText = lines.map(function (el) { return el.textContent; });
  var lineRow = lines.map(function (el) { return el.closest('a') || el; });   // 整行（含说明和按钮）一起显隐
  lines.forEach(function (el, i) { if (!el.hasAttribute('aria-label')) { el.setAttribute('aria-label', lineText[i]); el.setAttribute('data-pixel-aria', ''); } });
  var SCRAMBLE = 'ABCDEFGHKLMNPRSTUVWXYZ0123456789#%&/+=<>';

  // 一般跟随整页滚动；目标板块写了 data-pixel-scroller="选择器" 时改为跟随那个滚动容器（用于内嵌的演示）
  var scroller = ds.pixelScroller ? document.querySelector(ds.pixelScroller) : null;
  function base() { return scroller ? scroller.getBoundingClientRect().top : 0; }

  var dead = false, covering = false, overlayOn = false;
  function setOverlay(on) {            // 目录叠进舞台 / 还原成普通板块
    if (on === overlayOn) return;
    overlayOn = on;
    if (on) { stage.appendChild(target); target.classList.add('pixel-rise-overlay'); }
    else {
      target.classList.remove('pixel-rise-overlay', 'is-open');
      wrap.parentNode.insertBefore(target, wrap.nextSibling);
      lines.forEach(function (el, i) { el.textContent = lineText[i]; lineRow[i].removeAttribute('data-pixel-line-off'); });
    }
  }
  function teardown(reason) {
    if (dead) return;
    dead = true;
    setOverlay(false);
    if (wrap.parentNode) { wrap.parentNode.insertBefore(hero, wrap); wrap.parentNode.removeChild(wrap); }
    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    if (css.parentNode) css.parentNode.removeChild(css);
    hero.style.cssText = heroCss; target.style.cssText = targetCss;
    lines.forEach(function (el) { if (el.hasAttribute('data-pixel-aria')) { el.removeAttribute('aria-label'); el.removeAttribute('data-pixel-aria'); } });
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
  var W = 0, H = 0, dpr = 1, cell = 16, cols = 0, rows = 0, pinLen = 0, revealLen = 0, color = '#000';
  var bandOf = null, bandX = null, bandW = null;   // 像素柱：每一列属于哪根柱子、柱子的起点和宽度

  function build() {
    W = hero.clientWidth; H = hero.clientHeight;
    if (!W || !H) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    pinLen = Math.round(H * cfg.pin * (W < 768 ? 0.75 : 1));
    revealLen = lines.length ? Math.round(H * cfg.reveal * (W < 768 ? 0.75 : 1)) : 0;
    stage.style.height = H + 'px';
    wrap.style.height = (H + pinLen + revealLen) + 'px';
    cell = Math.max(6, Math.round(cfg.size * clamp(W / 1920, 0.55, 1.4)));
    cols = Math.ceil(W / cell); rows = Math.ceil(H / cell);
    color = targetColor;
    // 把列分成宽窄不一的柱子：多数很细（1~2 格），少数很粗（到 7 格）
    bandOf = new Int32Array(cols); bandX = []; bandW = [];
    for (var c = 0, band = 0; c < cols; band++) {
      var u = h2(band, 91), bw = u < 0.14 ? 1 : u < 0.36 ? 2 : u < 0.62 ? 3 : 4 + ((h2(band, 17) * 6) | 0);
      bandX.push(c); bandW.push(bw);
      for (var k = 0; k < bw && c < cols; k++, c++) bandOf[c] = band;
    }
    if (grain) grain.pattern = null;
    setOverlay(true);
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
    if (cfg.shape === 'columns') {                         // 像素柱：柱子的高度沿着一条尖峰天际线排，再各自参差、升降
      var band = bandOf[c], bw = bandW[band], xm = (bandX[band] + bw / 2) / rows;
      var env = ridged(xm * 0.95 + t * 0.03, t * 0.1) * 0.5 + vnoise(xm * 0.5 + 9, t * 0.05) * 0.16;   // 山形包络
      // 大部分柱子贴着山形走，连成一片；少数窄柱是蹿出去的尖刺，少数整根矮下去形成豁口，高度差拉开
      var k = h2(band, 7), own = (h2(band, 23) - 0.5) * 0.1 + vnoise(band * 0.41 + 3, t * 0.6) * 0.1;
      if (bw <= 2 && k < 0.3) own += 0.14 + h2(band, 31) * 0.46 + vnoise(band * 1.7, t * 1.3) * 0.1;
      else if (k > 0.86) own -= 0.1 + h2(band, 37) * 0.2;
      var top = Math.round((-1.0 + p * 2.1 + env + own) * rows) / rows;                               // 柱顶对齐格子，边缘是平的
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
  var ready = false, queued = false, dirty = true, lastKey = '', lastText = '', lastP = 0, badSticky = 0;

  function frame() {
    queued = false;
    if (dead) return;
    if (!ready) { ready = build(); if (!ready) return; }
    var scrolled = base() - wrap.getBoundingClientRect().top;
    var p = clamp(scrolled / (pinLen * FULL || 1), 0, 1);
    var p2 = revealLen ? clamp((scrolled - pinLen) / (revealLen * 0.85), 0, 1) : 1;   // 文字逐行出现的进度
    lastP = p;

    // sticky 自检：钉住时舞台在容器里的位移应当等于已经滚过的距离；一直贴在容器顶部说明 sticky 被祖先的 overflow 破坏了
    // （比较的是舞台和容器的相对位置，所以页面切换动画里的整体位移不会造成误判）
    if (scrolled > 40 && scrolled < (pinLen + revealLen) * 0.9) {
      var offset = stage.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
      if (Math.abs(offset - scrolled) > 20) {
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

    // 整屏变黑之后：目录在画面正中逐行"解码"出现
    var open = p >= 1 && lines.length > 0;
    if (open !== target.classList.contains('is-open')) target.classList.toggle('is-open', open);
    if (open) {
      var decoding = p2 > 0 && p2 < 1, tick = decoding ? Math.floor(performance.now() / 55) : 0;
      var tkey = p2.toFixed(3) + ':' + tick;
      if (tkey !== lastText) {
        lastText = tkey;
        for (var i = 0; i < lines.length; i++) {
          var li = clamp(p2 * (lines.length + 0.6) - i, 0, 1), txt = lineText[i], out = txt;
          lineRow[i].toggleAttribute('data-pixel-line-off', li <= 0);
          if (li > 0 && li < 1) {                          // 左边已经定格，右边还是乱码
            var done = Math.floor(li * txt.length); out = txt.slice(0, done);
            for (var j = done; j < txt.length; j++) out += txt[j] === ' ' ? ' ' : SCRAMBLE[(h2(j + i * 31, tick) * SCRAMBLE.length) | 0];
          }
          if (lines[i].textContent !== out) lines[i].textContent = out;
        }
      }
      if (decoding) request();                             // 停在半路时乱码继续跳
    }
  }
  function request() { if (!queued && !dead) { queued = true; requestAnimationFrame(frame); } }
  function refresh() { ready = false; dirty = true; request(); }

  (scroller || window).addEventListener('scroll', request, { passive: true });

  // 指向目录的锚点链接（比如首屏的 SCROLL TO EXPLORE）：目录现在叠在舞台里，直接滚到"文字全部出现"的位置
  if (target.id) document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href="#' + target.id + '"]');
    if (!a || dead || !ready) return;
    e.preventDefault();
    var top = wrap.getBoundingClientRect().top - base() + pinLen + revealLen * 0.9;
    if (scroller) scroller.scrollTo({ top: scroller.scrollTop + top, behavior: 'smooth' });
    else window.scrollTo({ top: window.scrollY + top, behavior: 'smooth' });
  });
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
