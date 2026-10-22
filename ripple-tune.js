/*!
 * ripple-tune.js — 首屏文字水波的现场调参面板（只给自己用）
 *
 * 平时不会加载。在网址后面加上 ?tune 打开页面才会出现，例如：
 *   file:///.../index.html?tune   或   https://你的网站/?tune
 * 调好后点「复制参数」，把那串 data-ripple-* 发给 Claude 写成默认值。
 */
(function () {
  'use strict';
  var FIELDS = [
    ['opacity', '文字不透明度', 0.05, 1, 0.01],
    ['vignette', '边缘渐隐长度', 0, 2, 0.05],
    ['hole', '机器人留空半径', 0, 0.45, 0.01],
    ['feather', '留空边缘柔和度', 0, 1, 0.02],
    ['size', '字号', 10, 40, 1],
    ['strength', '波纹力度', 0.3, 5, 0.1],
    ['speed', '传播速度', 0.1, 1, 0.05],
    ['damping', '衰减', 0.005, 0.15, 0.005]
  ];
  var COLORS = [['crest', '划过 · 波峰颜色'], ['trough', '划过 · 波谷颜色']];

  function start() {
    var api = window.textRipple;
    if (!api || !api.get) return setTimeout(start, 200);
    var cur = api.get();
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:280px;max-height:calc(100vh - 32px);overflow:auto;' +
      'background:rgba(255,255,255,.94);color:#1b1740;border:1px solid #d8dcfe;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.12);' +
      'font:12px/1.5 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:12px 14px;backdrop-filter:blur(8px)';
    var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><b style="font-size:13px">水波调参</b>' +
      '<button data-x style="border:0;background:none;cursor:pointer;font-size:16px;color:#5a5478" title="收起">–</button></div><div data-body>';
    FIELDS.forEach(function (f) {
      html += '<label style="display:block;margin:6px 0 0">' + f[1] + ' <span data-o="' + f[0] + '" style="float:right;font-family:monospace"></span>' +
        '<input type="range" data-k="' + f[0] + '" min="' + f[2] + '" max="' + f[3] + '" step="' + f[4] + '" value="' + cur[f[0]] + '" style="width:100%;accent-color:#5824cd"></label>';
    });
    COLORS.forEach(function (c) {
      html += '<label style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 0">' + c[1] +
        '<input type="color" data-k="' + c[0] + '" value="' + cur[c[0]] + '" style="width:64px;height:24px;border:1px solid #d8dcfe;border-radius:4px;padding:0;background:none"></label>';
    });
    html += '<textarea data-out readonly style="width:100%;height:84px;margin-top:10px;font:11px/1.4 monospace;border:1px solid #d8dcfe;border-radius:6px;padding:6px;resize:vertical"></textarea>' +
      '<button data-copy style="width:100%;margin-top:6px;padding:6px;border:1px solid #d8dcfe;border-radius:6px;background:#f3f2fb;color:#5824cd;cursor:pointer;font:inherit">复制参数</button></div>';
    box.innerHTML = html;
    document.body.appendChild(box);

    var inputs = box.querySelectorAll('[data-k]'), out = box.querySelector('[data-out]');
    function sync() {
      var o = {}, parts = [];
      inputs.forEach(function (el) {
        var k = el.getAttribute('data-k'), v = el.type === 'color' ? el.value : parseFloat(el.value);
        o[k] = v; parts.push('data-ripple-' + k + '="' + v + '"');
        var lab = box.querySelector('[data-o="' + k + '"]'); if (lab) lab.textContent = v;
      });
      api.set(o); out.value = parts.join(' ');
    }
    inputs.forEach(function (el) { el.addEventListener('input', sync); });
    box.querySelector('[data-copy]').onclick = function () {
      var b = this; out.select();
      try { navigator.clipboard.writeText(out.value).then(function () { b.textContent = '已复制'; setTimeout(function () { b.textContent = '复制参数'; }, 1400); }); }
      catch (e) { document.execCommand('copy'); }
    };
    var body = box.querySelector('[data-body]');
    box.querySelector('[data-x]').onclick = function () { var h = body.style.display !== 'none'; body.style.display = h ? 'none' : ''; this.textContent = h ? '+' : '–'; };
    // 面板本身不触发水波
    ['pointermove', 'pointerdown'].forEach(function (t) { box.addEventListener(t, function (e) { e.stopPropagation(); }); });
    sync();
  }
  start();
})();
