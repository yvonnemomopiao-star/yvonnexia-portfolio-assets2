/*!
 * text-ripple.js — 首屏「文字水面」：铺满的淡色等宽文字，鼠标划过会荡出波纹
 *
 * 水面物理、取样、折射、乱码、配色、四边渐隐、雨滴和静止判定，逐行对照参考组件 AsciiRipple（React 版）移植，
 * 参数用的是参考里选定的那组：textColor #e7e5e4 / rippleColor #7dd3fc / troughColor #f472b6，
 * speed 0.7、damping 0.01、viscosity 0.2、edges absorb、rain 1.5、refraction 2。
 * 网站自己加的只有：背景文字（简历文案）、机器人周围的圆形留空、手机端不接管触摸（保证能正常滚动）。
 *
 * 用法：在 </body> 前加一行  <script src="text-ripple.js" defer></script>，默认挂在 #home 上。
 *
 * 行为：
 *   - 鼠标移动拖出尾迹，点击落下一滴水；鼠标不在首屏时会自动下雨（每秒约 1.5 滴），首屏在动但不吵
 *   - 首屏滚出视口时暂停；系统开了「减少动态效果」时只显示静态文字
 *   - 手机端（宽度 < 768px）只有雨滴，不监听触摸
 *
 * 层级：画布默认 z-index 32，在首屏薰衣草叠色层(z-30)之上、标题(z-50)和导航(z-100)之下。画布不接收鼠标事件。
 *
 * 可选属性（写在 <section id="home"> 上，名字和参考组件的 props 对应）：
 *   data-ripple-text        背景文字
 *   data-ripple-size="26"   字号(px)，按 2560 宽调校，窄屏等比缩小；手机端最多 12      data-ripple-line-height="1.2"
 *   data-ripple-color / -crest / -trough                 静止文字色 / 波峰色 / 波谷色
 *   data-ripple-opacity="0.35" 静止文字不透明度：压低一些，白色波峰（不透明）才和底字拉开差距
 *   data-ripple-hot-weight="700" 被波纹点亮的字用粗体，浅色底上白色波峰更显眼
 *   data-ripple-outline="0"     可选：给亮起的字描深色边（默认关）
 *   data-ripple-speed="0.7" data-ripple-damping="0.01"  data-ripple-viscosity="0.2"  data-ripple-edges="absorb|reflect"
 *   data-ripple-rain="1.5"  每秒雨滴数（0 = 不下雨）    data-ripple-refraction="2"
 *   data-ripple-vignette="0.6"  四边渐隐长度（1 = 短边的一半）
 *   data-ripple-hole="0.3"  data-ripple-feather="0.3"   机器人周围留空半径（× 首屏高度）/ 边缘柔和度
 *   data-ripple-z="32"
 *
 * 接口：window.textRipple.set({...}) / get() / drop(x, y, strength) / calm() / refresh()
 */
(function () {
  'use strict';

  var noop = function () {};
  window.textRipple = { set: noop, get: noop, drop: noop, calm: noop, refresh: noop };

  var host = document.querySelector('[data-text-ripple]') || document.getElementById('home');
  if (!host) return;
  var ds = host.dataset;
  function num(v, d) { v = parseFloat(v); return isNaN(v) ? d : v; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // 默认文字：取自这个作品集自己的项目名和关键词（简历文案，保持不变）
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
  var CHARS = '·.,:;-~=+*%#@';   // 波纹越强，换成越靠后的符号

  var cfg = {
    size: num(ds.rippleSize, 26),
    lineHeight: num(ds.rippleLineHeight, 1.2),
    color: ds.rippleColor || '#ffffff',
    crest: ds.rippleCrest || '#ffffff',
    trough: ds.rippleTrough || '#ad57ff',
    opacity: num(ds.rippleOpacity, 0.35),
    resolution: 3,
    speed: num(ds.rippleSpeed, 0.7),
    damping: num(ds.rippleDamping, 0.01),
    viscosity: num(ds.rippleViscosity, 0.2),
    edges: ds.rippleEdges === 'reflect' ? 'reflect' : 'absorb',
    dropStrength: 1.2, dropRadius: 26,
    dragStrength: 0.3, dragRadius: 16,
    rain: num(ds.rippleRain, 1.5), rainStrength: 0.6,
    sensitivity: 2.2, slopeGain: 1,
    refraction: num(ds.rippleRefraction, 2),
    scramble: 1, scrambleSpeed: 90, dither: 0.5,
    vignette: num(ds.rippleVignette, 0.6),
    hole: num(ds.rippleHole, 0.3),
    feather: num(ds.rippleFeather, 0.3),
    outline: num(ds.rippleOutline, 0),
    hotWeight: num(ds.rippleHotWeight, 700),
    outlineColor: ds.rippleOutlineColor || '#3c2896'
  };
  var FONT = 'ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace';
  var Z = ds.rippleZ || '32';
  // 以下常量与参考组件一致
  var MIN_WIDTH = 768, IDLE_THRESHOLD = 0.0015, STEP = 1 / 90, MAX_STEPS = 4, RAMP_STEPS = 24, RESTORE = 0.004;
  var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ---------- 画布 ----------
  var canvas = document.createElement('canvas');
  canvas.className = 'text-ripple';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:' + Z + ';';
  // 机器人周围的圆形留空（画布在机器人上方，不留空的话文字会盖在它脸上）。四边渐隐在画布里按参考的方式画。
  function applyMask() {
    var m = '';
    if (cfg.hole > 0) {
      var f = clamp01(cfg.feather), inner = Math.round((1 - f) * 100), mid = Math.round(inner + (100 - inner) * 0.5);
      m = 'radial-gradient(circle ' + Math.round(H * cfg.hole) + 'px at 50% 49%, transparent 0, transparent ' + inner + '%, rgba(0,0,0,.5) ' + mid + '%, #000 100%)';
    }
    canvas.style.webkitMaskImage = m; canvas.style.maskImage = m;
  }
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(canvas);
  var ctx = canvas.getContext('2d');

  // ---------- 颜色渐变表（参考：底色 → 波峰色 / 波谷色，共 25 级，带透明度插值） ----------
  function parseColor(c) {
    var p = document.createElement('canvas'); p.width = p.height = 1;
    var g = p.getContext('2d'); g.fillStyle = c; g.fillRect(0, 0, 1, 1);
    var d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
  }
  function mix(a, b, t) {
    return 'rgba(' + Math.round(a[0] + (b[0] - a[0]) * t) + ',' + Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * t) + ',' + (a[3] + (b[3] - a[3]) * t).toFixed(3) + ')';
  }
  var up = [], down = [], halo = [], buckets = [];
  for (var bi = 0; bi < (RAMP_STEPS + 1) * 2; bi++) buckets.push([]);
  function buildRamps() {
    var b = parseColor(cfg.color), c = parseColor(cfg.crest), t = parseColor(cfg.trough), o = parseColor(cfg.outlineColor);
    up = []; down = []; halo = [];
    for (var i = 0; i <= RAMP_STEPS; i++) {
      var k = i / RAMP_STEPS;
      up.push(mix(b, c, k)); down.push(mix(b, t, k));
      halo.push('rgba(' + o[0] + ',' + o[1] + ',' + o[2] + ',' + (0.38 * k).toFixed(3) + ')');
    }
  }

  // ---------- 文字网格 + 水面 ----------
  var kz = 1, W = 0, H = 0, dpr = 1, cols = 0, rows = 0, cw = 0, lh = 0, lines = [], font = '';
  var S = null;   // 水面：{ w, h, cell, prev, cur, next, mask, energy }

  function buildSurface(cell) {
    var w = Math.max(4, Math.ceil(W / cell) + 2), h = Math.max(4, Math.ceil(H / cell) + 2), size = w * h;
    var mask = new Float32Array(size);
    // absorb：靠边的一圈逐渐「吃掉」速度，波纹撞到边缘不会弹回来
    var band = cfg.edges === 'absorb' ? Math.max(3, Math.round(Math.min(w, h) * 0.08)) : 0;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var m = 1;
      if (band > 0) {
        var d = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (d < band) { var t = d / band; m = 1 - (1 - t) * (1 - t) * 0.22; }
      }
      mask[y * w + x] = m;
    }
    return { w: w, h: h, cell: cell, prev: new Float32Array(size), cur: new Float32Array(size), next: new Float32Array(size), mask: mask, energy: 0 };
  }

  function build() {
    W = host.clientWidth; H = host.clientHeight;
    if (!W || !H) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    // 字号沿用之前调好的：按 2560 宽的大屏调校，窄屏等比缩小（最小 0.68 倍），手机端不超过 12px
    var fs = W < MIN_WIDTH ? Math.min(cfg.size, 12) : Math.round(cfg.size * clamp(W / 2560, 0.68, 1));
    // 参考组件是 16px 字号；字号变大时，水滴 / 拖尾半径和描边一起等比放大，整体等于把参考效果放大，比例不变
    kz = fs / 16;
    font = '400 ' + fs + 'px ' + FONT;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = font;
    cw = ctx.measureText('M').width || fs * 0.6;
    lh = fs * cfg.lineHeight;
    cols = Math.max(1, Math.ceil(W / cw)); rows = Math.max(1, Math.ceil(H / lh));
    var words = TEXT.split(/\s+/).filter(Boolean), wi = 0;
    lines = [];
    for (var r = 0; r < rows; r++) {
      var line = '';
      while (line.length < cols && words.length) { if (line.length > 0) line += ' '; line += words[wi % words.length]; wi++; }
      lines.push((line + new Array(cols + 1).join(' ')).slice(0, cols));
    }
    S = buildSurface(lh / clamp(cfg.resolution, 1, 4));
    buildRamps();
    applyMask();
    return true;
  }

  // 在 (px, py) 处把水面往下压一个圆滑的坑（smoothstep 轮廓）
  function disturb(px, py, radiusPx, amount) {
    var cx = px / S.cell + 1, cy = py / S.cell + 1, r = Math.max(1, radiusPx / S.cell);
    var x0 = Math.max(1, Math.floor(cx - r)), x1 = Math.min(S.w - 2, Math.ceil(cx + r));
    var y0 = Math.max(1, Math.floor(cy - r)), y1 = Math.min(S.h - 2, Math.ceil(cy + r));
    var inv = 1 / (r * r);
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) {
      var dx = x - cx, dy = y - cy, q = 1 - (dx * dx + dy * dy) * inv;
      if (q <= 0) continue;
      S.cur[y * S.w + x] -= amount * q * q * (3 - 2 * q);
    }
    if (S.energy < amount) S.energy = amount;
  }

  // 离散波动方程 + 粘滞 + 回弹 + 边缘吸收（与参考 stepSurface 一致）
  function stepSurface(c2, visc, damping) {
    var w = S.w, h = S.h, prev = S.prev, cur = S.cur, next = S.next, mask = S.mask;
    var keep = 1 - damping, k = c2 + visc, restore = 1 - RESTORE, energy = 0;
    for (var y = 1; y < h - 1; y++) {
      var row = y * w;
      for (var x = 1; x < w - 1; x++) {
        var i = row + x, c = cur[i];
        var lap = cur[i - 1] + cur[i + 1] + cur[i - w] + cur[i + w] - 4 * c;
        var v = c * restore + (c - prev[i]) * keep * mask[i] + k * lap;
        next[i] = v;
        var a = v < 0 ? -v : v; if (a > energy) energy = a;
      }
    }
    if (cfg.edges === 'reflect') {
      for (var xx = 0; xx < w; xx++) { next[xx] = next[xx + w]; next[(h - 1) * w + xx] = next[(h - 2) * w + xx]; }
      for (var yy = 0; yy < h; yy++) { next[yy * w] = next[yy * w + 1]; next[yy * w + w - 1] = next[yy * w + w - 2]; }
    }
    S.prev = cur; S.cur = next; S.next = prev; S.energy = energy;
  }
  function flatten() { S.cur.fill(0); S.prev.fill(0); S.next.fill(0); S.energy = 0; }

  // 双线性取样：高度 + x/y 方向坡度
  var out = new Float32Array(3);
  function sample(px, py) {
    var fx = px / S.cell + 1, fy = py / S.cell + 1;
    var x = Math.min(S.w - 3, Math.max(1, Math.floor(fx))), y = Math.min(S.h - 3, Math.max(1, Math.floor(fy)));
    var tx = clamp01(fx - x), ty = clamp01(fy - y), w = S.w, cur = S.cur, i = y * w + x;
    var top = cur[i] + (cur[i + 1] - cur[i]) * tx, bottom = cur[i + w] + (cur[i + w + 1] - cur[i + w]) * tx;
    out[0] = top + (bottom - top) * ty;
    var gxT = cur[i + 1] - cur[i - 1], gxB = cur[i + w + 1] - cur[i + w - 1];
    out[1] = (gxT + (gxB - gxT) * ty) * 0.5;
    var gyL = cur[i + w] - cur[i - w], gyR = cur[i + w + 1] - cur[i - w + 1];
    out[2] = (gyL + (gyR - gyL) * tx) * 0.5;
  }

  function hash(a, b, c) {
    var n = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function draw(now) {
    if (!S) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, H);
    ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    var plen = CHARS.length, active = S.energy > IDLE_THRESHOLD;
    var seed = Math.floor(now / Math.max(16, cfg.scrambleSpeed)), slopeScale = cfg.resolution, hot = 0;
    for (var b = 0; b < buckets.length; b++) buckets[b].length = 0;
    ctx.globalAlpha = cfg.opacity;
    ctx.fillStyle = up[0];
    for (var r = 0; r < rows; r++) {
      var row = lines[r], cy = r * lh + lh / 2, line = '';
      if (!active) { ctx.fillText(row, 0, cy); continue; }
      for (var c = 0; c < cols; c++) {
        sample(c * cw + cw / 2, cy);
        var hgt = out[0], gx = out[1] * slopeScale, gy = out[2] * slopeScale;
        var slope = Math.sqrt(gx * gx + gy * gy);
        var intensity = clamp01((Math.abs(hgt) * cfg.sensitivity + slope * cfg.slopeGain - 0.12) * 1.14);
        if (intensity < 0.02) { line += row[c]; continue; }
        // 折射：从被水面推开的位置取字
        var sc = Math.min(cols - 1, Math.max(0, Math.round(c + gx * cfg.refraction * 2)));
        var sr = Math.min(rows - 1, Math.max(0, Math.round(r + gy * cfg.refraction)));
        var glyph = lines[sr][sc];
        if (intensity * cfg.scramble >= 0.5 + (hash(c, r, 0) - 0.5) * cfg.dither) {
          var jitter = (hash(c, r, seed) - 0.5) * plen * 0.3;
          glyph = CHARS[Math.max(0, Math.min(plen - 1, Math.round(intensity * (plen - 1) + jitter)))];
        }
        line += ' ';
        if (glyph === ' ') continue;
        // 按颜色分桶，画的时候每种颜色只切换一次 fillStyle（逐字切换颜色是最大的开销）
        buckets[(hgt >= 0 ? 0 : RAMP_STEPS + 1) + Math.round(intensity * RAMP_STEPS)].push(c * cw, cy, glyph);
        hot++;
      }
      ctx.fillText(line, 0, cy);
    }
    // 被波纹点亮的字：不透明，颜色按强度从底色过渡到波峰 / 波谷色
    ctx.globalAlpha = 1;
    if (hot) {
      if (cfg.hotWeight !== 400) ctx.font = font.replace(/^400 /, cfg.hotWeight + ' ');
      // 浅色底上白色看不出来：先给亮起来的字描一圈淡淡的深色边（越强越深），白色波峰才能「浮」出来
      if (cfg.outline > 0) {
        ctx.lineWidth = cfg.outline * kz; ctx.lineJoin = 'round';
        for (var bo = 0; bo < buckets.length; bo++) {
          var lo = buckets[bo]; if (!lo.length) continue;
          ctx.strokeStyle = halo[bo % (RAMP_STEPS + 1)];
          for (var m = 0; m < lo.length; m += 3) ctx.strokeText(lo[m + 2], lo[m], lo[m + 1]);
        }
      }
      for (var bf = 0; bf < buckets.length; bf++) {
        var lf = buckets[bf]; if (!lf.length) continue;
        ctx.fillStyle = bf <= RAMP_STEPS ? up[bf] : down[bf - RAMP_STEPS - 1];
        for (var n = 0; n < lf.length; n += 3) ctx.fillText(lf[n + 2], lf[n], lf[n + 1]);
      }
    }
    // 四边渐隐（参考的曲线：0 / 30% / 70% / 100% 处擦掉 100% / 60% / 15% / 0%）
    if (cfg.vignette > 0) {
      var band = clamp01(cfg.vignette) * (Math.min(W, H) / 2);
      // 手机竖屏上左右渐隐会吃掉大半屏文字，左右带宽缩到 35%
      var bandX = W < MIN_WIDTH ? band * 0.35 : band;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      var fade = function (x0, y0, x1, y1) {
        var g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.3, 'rgba(0,0,0,0.6)');
        g.addColorStop(0.7, 'rgba(0,0,0,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      };
      fade(0, 0, bandX, 0); fade(W, 0, W - bandX, 0);
      fade(0, 0, 0, band); fade(0, H, 0, H - band);
      ctx.restore();
    }
  }

  // ---------- 循环 ----------
  var ready = false, running = false, visible = true, lastT = 0, acc = 0, rainAcc = 0;
  var ptr = { x: 0, y: 0, lx: 0, ly: 0, inside: false, pending: false };
  function raining() { return cfg.rain > 0 && !(ptr.inside && interactive()); }

  function tick(now) {
    if (!ready || !S) { running = false; return; }
    var dt = Math.min(0.1, lastT < 0 ? 0 : (now - lastT) / 1000 || 0); lastT = now;
    if (ptr.pending && cfg.dragStrength > 0) {
      var dx = ptr.x - ptr.lx, dy = ptr.y - ptr.ly, moved = Math.sqrt(dx * dx + dy * dy);
      if (moved > 0.5) {
        var steps = Math.min(6, Math.max(1, Math.ceil(moved / (cfg.dragRadius * kz))));
        var amount = cfg.dragStrength * Math.min(1, moved / (cfg.dragRadius * kz * 1.5)) / steps;
        for (var i = 1; i <= steps; i++) disturb(ptr.lx + dx * i / steps, ptr.ly + dy * i / steps, cfg.dragRadius * kz, amount);
      }
      ptr.lx = ptr.x; ptr.ly = ptr.y; ptr.pending = false;
    }
    var rainy = raining();
    if (rainy) {
      rainAcc += dt * cfg.rain;
      while (rainAcc >= 1) {
        rainAcc -= 1;
        disturb(Math.random() * cols * cw, Math.random() * rows * lh,
          cfg.dropRadius * kz * (0.6 + Math.random() * 0.6), cfg.rainStrength * (0.6 + Math.random() * 0.8));
      }
    } else rainAcc = 0;
    var c2 = 0.02 + clamp01(cfg.speed) * 0.4;
    var visc = Math.min(0.49 - c2, clamp01(cfg.viscosity) * 0.12);
    var damping = Math.min(0.5, Math.max(0, cfg.damping));
    acc += dt;
    var n = 0;
    while (acc >= STEP && n < MAX_STEPS) { stepSurface(c2, visc, damping); acc -= STEP; n++; }
    if (n === MAX_STEPS) acc = 0;
    if ((S.energy < IDLE_THRESHOLD && !rainy) || !visible) {
      if (S.energy < IDLE_THRESHOLD) flatten();
      draw(now); running = false; return;
    }
    draw(now);
    requestAnimationFrame(tick);
  }
  function wake() {
    if (running || reduced || !ready || !visible) return;
    running = true; lastT = -1; acc = 0;
    requestAnimationFrame(tick);
  }
  function refresh() {
    ready = build();
    if (!ready) return;
    draw(performance.now());
    if (cfg.rain > 0) wake();
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
    ptr.x = p.x; ptr.y = p.y; ptr.pending = true;
    wake();
  }, { passive: true });
  host.addEventListener('pointerleave', function () {
    ptr.inside = false; ptr.pending = false;
    if (cfg.rain > 0) wake();
  }, { passive: true });
  host.addEventListener('pointerdown', function (e) {
    if (!interactive() || e.pointerType === 'touch') return;
    var p = local(e);
    disturb(p.x, p.y, cfg.dropRadius * kz, cfg.dropStrength);
    ptr.x = ptr.lx = p.x; ptr.y = ptr.ly = p.y; ptr.inside = true;
    wake();
  }, { passive: true });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (e) {
      visible = e[e.length - 1].isIntersecting;
      if (visible && !ready) refresh();
      else if (visible && cfg.rain > 0) wake();
    }).observe(host);
  }
  if ('ResizeObserver' in window) new ResizeObserver(refresh).observe(host);
  else window.addEventListener('resize', refresh, { passive: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);

  window.textRipple = {
    refresh: refresh,
    get: function () { var o = {}; for (var k in cfg) o[k] = cfg[k]; return o; },
    drop: function (x, y, strength) { if (!ready || reduced) return; disturb(x, y, cfg.dropRadius * kz, strength || cfg.dropStrength); wake(); },
    calm: function () { if (!S) return; flatten(); draw(performance.now()); },
    set: function (o) {
      var rebuild = false;
      for (var k in o) if (k in cfg && cfg[k] !== o[k]) {
        cfg[k] = o[k];
        if (k === 'size' || k === 'lineHeight' || k === 'edges' || k === 'resolution') rebuild = true;
        if ((k === 'hole' || k === 'feather') && ready) applyMask();
      }
      if (rebuild) refresh();
      else { buildRamps(); if (ready && !running) draw(performance.now()); if (cfg.rain > 0) wake(); }
    }
  };
  refresh();
})();
