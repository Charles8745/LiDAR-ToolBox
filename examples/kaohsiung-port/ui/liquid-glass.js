/*!
 * Liquid Glass Kit v0.1 — 液態玻璃 UI 工具包(零依賴)
 * 透明玻璃 / 液態折射 / 發光背景 / 拖曳 / 儀表板元件(stat·meter·gauge·chart·toast)
 *
 * 折射原理:以 Snell 定律 (n=1.5) 對「凸超橢圓 (convex squircle)」斷面做
 * 光線追蹤,產生 SVG 位移貼圖 (feDisplacementMap),再以 backdrop-filter
 * 即時折射元件背後的內容。非 Chromium 瀏覽器自動降級為磨砂玻璃。
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 0. 能力偵測
   *    backdrop-filter: url(#svg) 目前僅 Chromium 引擎支援
   *    (iOS 上所有瀏覽器皆為 WebKit,UA 不含 "Chrome/",會正確降級)
   * ------------------------------------------------------------------ */
  var FULL = (function () {
    try {
      if (typeof CSS === 'undefined' || !CSS.supports('backdrop-filter', 'blur(1px)')) return false;
      if (navigator.userAgentData && navigator.userAgentData.brands) {
        return navigator.userAgentData.brands.some(function (b) { return /Chromium/i.test(b.brand); });
      }
      return /Chrome\/\d+/.test(navigator.userAgent);
    } catch (e) { return false; }
  })();

  var REDUCED_MOTION = false;
  try { REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ------------------------------------------------------------------ *
   * 0.5 彈簧 — 液態物理核心(質量-阻尼-剛度,半隱式歐拉積分)
   * ------------------------------------------------------------------ */
  function Spring(value, opts) {
    opts = opts || {};
    this.v = value; this.t = value; this.vel = 0;
    this.k = opts.stiffness || 340;
    this.c = opts.damping || 14;
    this.onUpdate = opts.onUpdate || null;
    this.onRest = opts.onRest || null;
    this._raf = 0; this._last = 0;
  }
  Spring.prototype.set = function (target) {
    this.t = target;
    if (this._raf) return;
    var self = this;
    self._last = performance.now();
    self._raf = requestAnimationFrame(function step(now) {
      var dt = Math.min((now - self._last) / 1000, 0.04) || 0.016;
      self._last = now;
      for (var i = 0; i < 2; i++) {           // 兩段子步,高剛度下仍穩定
        var h = dt / 2;
        self.vel += (-self.k * (self.v - self.t) - self.c * self.vel) * h;
        self.v += self.vel * h;
      }
      if (Math.abs(self.v - self.t) < 0.0006 && Math.abs(self.vel) < 0.0006) {
        self.v = self.t; self.vel = 0; self._raf = 0;
        self.onUpdate && self.onUpdate(self.v);
        self.onRest && self.onRest();
        return;
      }
      self.onUpdate && self.onUpdate(self.v);
      self._raf = requestAnimationFrame(step);
    });
  };
  Spring.prototype.snap = function (v) {
    this.v = v; this.t = v; this.vel = 0;
    this.onUpdate && this.onUpdate(v);
  };

  /* ------------------------------------------------------------------ *
   * 1. 全域設定(可由 LiquidGlass.config 或 data-lg-* 屬性覆寫)
   * ------------------------------------------------------------------ */
  var config = {
    refraction: 1.25,   // 折射強度倍率(1 = 物理值,>1 更強的視覺張力)
    chromatic: 0.55,    // 色散強度 0–1(RGB 三通道位移差)
    blur: 1.6,          // 玻璃內霧化 (px)
    saturate: 1.55,     // 透過玻璃的色彩飽和度
    bezel: 0.16,        // 邊框斜面寬,佔短邊比例(0–0.5)
    bezelMin: 10,       // 斜面最小 px
    bezelMax: 42,       // 斜面最大 px
    thickness: 28,      // 玻璃厚度 px(影響位移量)
    profile: 'squircle',// 斷面:squircle | circle | lip
    ior: 1.5,           // 玻璃折射率
    maxWidth: 900       // 超過此寬度自動減弱折射,避免 GPU 卡頓
  };

  // 材質變體(B6):現狀 = Clear;Regular 較霧較不透,內容上可讀(數值可實機微調)
  var MATERIALS = {
    clear:   { blur: 1.6, saturate: 1.55, refraction: 1.25 },
    regular: { blur: 7.0, saturate: 1.20, refraction: 0.90 }
  };

  /* ------------------------------------------------------------------ *
   * 2. 斷面函數 — 距邊緣 t∈[0,1] 處的玻璃相對高度
   *    Apple 偏好 squircle:平面到曲面的過渡最柔和
   * ------------------------------------------------------------------ */
  var PROFILES = {
    squircle: function (t) { return Math.pow(1 - Math.pow(1 - t, 4), 0.25); },
    circle:   function (t) { return Math.sqrt(1 - (1 - t) * (1 - t)); },
    lip: function (t) {
      var cv = Math.sqrt(1 - (1 - t) * (1 - t));
      var cc = 1 - cv;
      var s = t * t * t * (t * (t * 6 - 15) + 10); // smootherstep
      return cv * (1 - s) + cc * s;
    }
  };

  /* ------------------------------------------------------------------ *
   * 3. 折射表 — 對斷面做 2D 光線追蹤 (Snell 定律)
   *    回傳每個 t 的橫向位移(px,正值=指向元件內部)
   *    凸面斷面會讓光線位移留在玻璃內,邊緣取樣不會越界
   * ------------------------------------------------------------------ */
  var SAMPLES = 128;
  var tableCache = {};

  function rayTable(bezelPx, thicknessPx, profileName, ior) {
    var key = [bezelPx | 0, thicknessPx | 0, profileName, ior].join(':');
    if (tableCache[key]) return tableCache[key];

    var f = PROFILES[profileName] || PROFILES.squircle;
    var eta = 1 / ior;                       // 空氣 -> 玻璃
    var table = new Float64Array(SAMPLES);
    var maxMag = 0;
    var clampMax = bezelPx * 2.2;            // 防止近邊緣斜率趨近垂直時位移爆炸

    for (var i = 0; i < SAMPLES; i++) {
      var t = (i + 0.5) / SAMPLES;
      // 數值微分取得表面斜率(對實際 px 座標)
      var dt = 1 / SAMPLES;
      var t0 = Math.max(t - dt, 1e-4), t1 = Math.min(t + dt, 1);
      var slope = (f(t1) - f(t0)) * thicknessPx / ((t1 - t0) * bezelPx);

      var m = Math.sqrt(1 + slope * slope);
      var cosI = 1 / m;                      // 入射光垂直向下
      var sinI = slope / m;
      var sinT = eta * sinI;
      if (sinT > 0.9999) sinT = 0.9999;      // 接近全反射時夾住
      var cosT = Math.sqrt(1 - sinT * sinT);

      // 折射向量 T = eta*I + (eta*cosI - cosT)*N,I=(0,-1),N=(-slope,1)/m
      var k = eta * cosI - cosT;
      var Tx = -k * slope / m;               // > 0:折向內部
      var Ty = -eta + k / m;                 // < 0:持續向下
      var height = f(t) * thicknessPx;       // 該點玻璃高度
      var d = Tx * (height / -Ty);           // 抵達背景平面時的橫向位移
      if (d > clampMax) d = clampMax;
      table[i] = d;
      if (d > maxMag) maxMag = d;
    }
    var out = { table: table, maxMag: Math.max(maxMag, 1e-6) };
    tableCache[key] = out;
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 4. 位移貼圖 — 將折射表沿圓角矩形 SDF 旋掃成 RGBA 影像
   *    R 通道 = X 位移,G 通道 = Y 位移,128 為中性值
   * ------------------------------------------------------------------ */
  var mapCache = {};
  var mapCacheKeys = [];

  function buildMap(w, h, radius, bezelPx, thicknessPx, profileName, ior) {
    var key = [w, h, radius | 0, bezelPx | 0, thicknessPx | 0, profileName, ior].join(':');
    if (mapCache[key]) return mapCache[key];

    var rt = rayTable(bezelPx, thicknessPx, profileName, ior);
    var table = rt.table, maxMag = rt.maxMag;

    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    var img = ctx.createImageData(w, h);
    var data = img.data;

    var hw = w / 2, hh = h / 2;
    var r = Math.min(radius, hw, hh);
    var ix = hw - r, iy = hh - r;            // 圓角矩形內芯半徑

    for (var y = 0; y < h; y++) {
      var py = y + 0.5 - hh;
      var ay = Math.abs(py) - iy;
      for (var x = 0; x < w; x++) {
        var px = x + 0.5 - hw;
        var ax = Math.abs(px) - ix;

        // 圓角矩形 SDF 與外向法線
        var dist, nx, ny;
        if (ax > 0 && ay > 0) {              // 角落區
          var len = Math.sqrt(ax * ax + ay * ay) || 1e-6;
          dist = len - r;
          nx = ax / len; ny = ay / len;
        } else if (ax > ay) {                // 左右邊
          dist = ax - r; nx = 1; ny = 0;
        } else {                             // 上下邊
          dist = ay - r; nx = 0; ny = 1;
        }
        nx *= (px < 0 ? -1 : 1);
        ny *= (py < 0 ? -1 : 1);

        var inside = -dist;                  // 距邊緣的內部距離
        var o = (y * w + x) * 4;
        if (inside <= 0 || inside >= bezelPx) {
          data[o] = 128; data[o + 1] = 128; data[o + 2] = 128; data[o + 3] = 255;
          continue;
        }
        var t = inside / bezelPx;
        var mag = table[Math.min(SAMPLES - 1, (t * SAMPLES) | 0)] / maxMag;
        // 位移方向 = 內向法線(-nx, -ny)
        data[o]     = Math.round(128 - nx * mag * 127);
        data[o + 1] = Math.round(128 - ny * mag * 127);
        data[o + 2] = 128;
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    var url = canvas.toDataURL('image/png');
    var out = { url: url, maxMag: maxMag };

    mapCache[key] = out;
    mapCacheKeys.push(key);
    if (mapCacheKeys.length > 48) delete mapCache[mapCacheKeys.shift()];
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 5. SVG 濾鏡 DOM 管理
   *    注意:承載 <svg> 不可 display:none,否則濾鏡失效
   * ------------------------------------------------------------------ */
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var svgRoot = null, svgDefs = null, uid = 0;

  function ensureSvgRoot() {
    if (svgRoot) return;
    svgRoot = document.createElementNS(SVG_NS, 'svg');
    svgRoot.setAttribute('aria-hidden', 'true');
    svgRoot.setAttribute('focusable', 'false');
    svgRoot.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;';
    svgDefs = document.createElementNS(SVG_NS, 'defs');
    svgRoot.appendChild(svgDefs);
    (document.body || document.documentElement).appendChild(svgRoot);
  }

  function el(name, attrs) {
    var n = document.createElementNS(SVG_NS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // 黏滯融合濾鏡(blur + alpha 對比):供 dock 光斑與開關表面張力使用
  function ensureGooFilter() {
    ensureSvgRoot();
    if (document.getElementById('lg-goo')) return;
    var f = el('filter', { id: 'lg-goo' });
    f.appendChild(el('feGaussianBlur', { 'in': 'SourceGraphic', stdDeviation: 5, result: 'b' }));
    f.appendChild(el('feColorMatrix', { 'in': 'b', type: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9' }));
    svgDefs.appendChild(f);
  }

  // 三通道色散:R / G / B 各用略微不同的位移倍率,再加總合成
  function buildFilter(id) {
    var filter = el('filter', {
      id: id, x: '0%', y: '0%', width: '100%', height: '100%',
      'color-interpolation-filters': 'sRGB'
    });
    var image = el('feImage', { x: 0, y: 0, width: 1, height: 1, result: 'lgMap', preserveAspectRatio: 'none' });
    filter.appendChild(image);

    var keep = {
      R: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
      G: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
      B: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'
    };
    ['R', 'G', 'B'].forEach(function (ch) {
      filter.appendChild(el('feDisplacementMap', {
        'in': 'SourceGraphic', in2: 'lgMap', scale: 0,
        xChannelSelector: 'R', yChannelSelector: 'G', result: 'd' + ch
      }));
      filter.appendChild(el('feColorMatrix', { 'in': 'd' + ch, type: 'matrix', values: keep[ch], result: 'c' + ch }));
    });
    filter.appendChild(el('feComposite', { 'in': 'cR', in2: 'cG', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'sRG' }));
    filter.appendChild(el('feComposite', { 'in': 'sRG', in2: 'cB', operator: 'arithmetic', k1: 0, k2: 1, k3: 1, k4: 0, result: 'sRGB2' }));
    filter.appendChild(el('feGaussianBlur', { 'in': 'sRGB2', stdDeviation: 0, result: 'soft' }));
    filter.appendChild(el('feColorMatrix', { 'in': 'soft', type: 'saturate', values: 1, result: 'out' }));
    svgDefs.appendChild(filter);
    return filter;
  }

  /* ------------------------------------------------------------------ *
   * 6. Glass 實例 — attach(el, opts)
   * ------------------------------------------------------------------ */
  var instances = [];

  function numAttr(elm, name, fallback) {
    var v = elm.getAttribute(name);
    if (v === null || v === '') return fallback;
    var n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  function readRadius(elm, w, h) {
    var br = getComputedStyle(elm).borderTopLeftRadius || '0px';
    var v = parseFloat(br) || 0;
    if (br.indexOf('%') > -1) v = Math.min(w, h) * v / 100;
    return Math.min(v, Math.min(w, h) / 2);
  }

  function applyConcentric(el) {
    var parent = el.parentElement;
    while (parent && !parent.classList.contains('lg')) parent = parent.parentElement;
    if (!parent) return;                       // 找不到 lg 父層 → no-op
    function r(v) { return parseFloat(v) || 0; }
    var pcs = getComputedStyle(parent);
    var ptl = r(pcs.borderTopLeftRadius), ptr = r(pcs.borderTopRightRadius),
        pbr = r(pcs.borderBottomRightRadius), pbl = r(pcs.borderBottomLeftRadius);
    if (!(ptl || ptr || pbr || pbl)) return;   // 父無圓角 → no-op
    var prc = parent.getBoundingClientRect(), crc = el.getBoundingClientRect();
    var gapL = crc.left - prc.left - r(pcs.borderLeftWidth);
    var gapT = crc.top - prc.top - r(pcs.borderTopWidth);
    var gapR = prc.right - crc.right - r(pcs.borderRightWidth);
    var gapB = prc.bottom - crc.bottom - r(pcs.borderBottomWidth);
    var MIN = 4;
    function corner(prad, ga, gb) { return Math.max(prad - Math.max(ga, gb), MIN); } // 角由相鄰兩邊定義,取大者
    el.style.borderTopLeftRadius     = corner(ptl, gapL, gapT) + 'px';
    el.style.borderTopRightRadius    = corner(ptr, gapR, gapT) + 'px';
    el.style.borderBottomRightRadius = corner(pbr, gapR, gapB) + 'px';
    el.style.borderBottomLeftRadius  = corner(pbl, gapL, gapB) + 'px';
  }

  function Glass(elm, opts) {
    opts = opts || {};
    this.el = elm;
    this.id = 'lg-f-' + (++uid);
    this.opts = {
      refraction: opts.refraction != null ? opts.refraction : numAttr(elm, 'data-lg-refraction', NaN),
      chromatic:  opts.chromatic  != null ? opts.chromatic  : numAttr(elm, 'data-lg-chromatic', NaN),
      blur:       opts.blur       != null ? opts.blur       : numAttr(elm, 'data-lg-blur', NaN),
      saturate:   opts.saturate   != null ? opts.saturate   : numAttr(elm, 'data-lg-saturate', NaN),
      bezel:      opts.bezel      != null ? opts.bezel      : numAttr(elm, 'data-lg-bezel', NaN),
      thickness:  opts.thickness  != null ? opts.thickness  : numAttr(elm, 'data-lg-thickness', NaN),
      profile:    opts.profile || elm.getAttribute('data-lg-profile') || ''
    };
    ensureSvgRoot();
    this.filter = buildFilter(this.id);
    this.nodes = {
      image: this.filter.querySelector('feImage'),
      disp: this.filter.querySelectorAll('feDisplacementMap'),
      blur: this.filter.querySelector('feGaussianBlur'),
      sat: this.filter.querySelector('feColorMatrix[type="saturate"]')
    };
    var self = this;
    this._pending = false;
    this.ro = new ResizeObserver(function () { self.schedule(); });
    this.ro.observe(elm);
    instances.push(this);
    this.update();
  }

  Glass.prototype.schedule = function () {
    if (this._pending) return;
    this._pending = true;
    var self = this;
    requestAnimationFrame(function () { self._pending = false; self.update(); });
  };

  Glass.prototype.update = function () {
    var elm = this.el;
    var w = Math.round(elm.offsetWidth), h = Math.round(elm.offsetHeight);
    if (w < 2 || h < 2) return;

    var o = this.opts;
    var mat = elm.classList.contains('lg--regular') ? MATERIALS.regular
            : elm.classList.contains('lg--clear')   ? MATERIALS.clear : null;
    var profile = o.profile || config.profile;
    var thickness = isNaN(o.thickness) ? config.thickness : o.thickness;
    var bezel = isNaN(o.bezel)
      ? Math.max(config.bezelMin, Math.min(config.bezelMax, Math.min(w, h) * config.bezel))
      : o.bezel;
    bezel = Math.min(bezel, Math.min(w, h) / 2);
    var radius = readRadius(elm, w, h);

    var map = buildMap(w, h, radius, bezel, thickness, profile, config.ior);

    // 折射倍率(大面積自動減弱)
    var refraction = !isNaN(o.refraction) ? o.refraction : (mat ? mat.refraction : config.refraction);
    if (w > config.maxWidth) refraction *= config.maxWidth / w;
    // 貼圖編碼為 (C-0.5) ∈ ±0.5,故 scale 乘 2 才等於 maxMag 像素的實際位移
    var scale = map.maxMag * refraction * 2;

    // 色散:三通道位移差
    var ca = (isNaN(o.chromatic) ? config.chromatic : o.chromatic) * 0.12;
    var blur = !isNaN(o.blur) ? o.blur : (mat ? mat.blur : config.blur);
    var sat = !isNaN(o.saturate) ? o.saturate : (mat ? mat.saturate : config.saturate);

    // filter 區域維持 0%–100%(objectBoundingBox),feImage 用元素像素尺寸
    var img = this.nodes.image;
    img.setAttribute('width', w);
    img.setAttribute('height', h);
    img.setAttribute('href', map.url);

    var disp = this.nodes.disp;
    disp[0].setAttribute('scale', (scale * (1 + ca)).toFixed(2)); // R
    disp[1].setAttribute('scale', scale.toFixed(2));              // G
    disp[2].setAttribute('scale', (scale * (1 - ca)).toFixed(2)); // B
    this._baseScales = [scale * (1 + ca), scale, scale * (1 - ca)];
    this.nodes.blur.setAttribute('stdDeviation', blur);
    this.nodes.sat.setAttribute('values', sat);

    if (FULL) elm.style.backdropFilter = 'url(#' + this.id + ')';
  };

  Glass.prototype.setOptions = function (opts) {
    for (var k in opts) this.opts[k] = opts[k];
    this.update();
  };

  // 按壓鼓起:把三通道位移同乘 k,折射即時變強,無需重算貼圖
  Glass.prototype.setBulge = function (k) {
    if (!this._baseScales) return;
    var d = this.nodes.disp;
    d[0].setAttribute('scale', (this._baseScales[0] * k).toFixed(2));
    d[1].setAttribute('scale', (this._baseScales[1] * k).toFixed(2));
    d[2].setAttribute('scale', (this._baseScales[2] * k).toFixed(2));
  };

  Glass.prototype.destroy = function () {
    this.ro.disconnect();
    if (this.filter.parentNode) this.filter.parentNode.removeChild(this.filter);
    this.el.style.backdropFilter = '';
    var i = instances.indexOf(this);
    if (i > -1) instances.splice(i, 1);
  };

  function attach(elm, opts) {
    if (!FULL) return { el: elm, update: function(){}, setOptions: function(){}, setBulge: function(){}, destroy: function(){}, fallback: true };
    if (elm._lgGlass) return elm._lgGlass;
    elm._lgGlass = new Glass(elm, opts);
    return elm._lgGlass;
  }

  /* ------------------------------------------------------------------ *
   * 7. 動態光澤 — 指標位置寫入 CSS 變數,供 .lg 高光層使用
   * ------------------------------------------------------------------ */
  var sheenRaf = 0;
  function initSheen() {
    document.addEventListener('pointermove', function (e) {
      if (sheenRaf) return;
      sheenRaf = requestAnimationFrame(function () {
        sheenRaf = 0;
        var t = e.target && e.target.closest ? e.target.closest('.lg') : null;
        if (!t) return;
        var r = t.getBoundingClientRect();
        t.style.setProperty('--lg-px', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        t.style.setProperty('--lg-py', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    }, { passive: true });
  }

  /* ------------------------------------------------------------------ *
   * 8. 拖曳 — pointer events + 慣性 + 邊界
   *    draggable(el, { handle, bounds: 'viewport'|'parent', inertia })
   * ------------------------------------------------------------------ */
  function draggable(elm, opts) {
    opts = opts || {};
    var handle = opts.handle ? (typeof opts.handle === 'string' ? elm.querySelector(opts.handle) : opts.handle) : elm;
    var bounds = opts.bounds || 'viewport';
    var inertia = opts.inertia !== false && !REDUCED_MOTION;
    var x = 0, y = 0, vx = 0, vy = 0, lastX = 0, lastY = 0, lastT = 0;
    var dragging = false, raf = 0, pid = null;
    var stretch = 1, ang = 0, wobV = 0;

    function apply() {
      var t = 'translate3d(' + x + 'px,' + y + 'px,0)';
      if (Math.abs(stretch - 1) > 0.002) {
        var s2 = 1 / Math.sqrt(stretch);
        t += ' rotate(' + ang.toFixed(4) + 'rad) scale(' + stretch.toFixed(4) + ',' + s2.toFixed(4) + ') rotate(' + (-ang).toFixed(4) + 'rad)';
      }
      elm.style.transform = t;
    }

    function clampBounds() {
      var r = elm.getBoundingClientRect();
      var bw, bh, bl, bt;
      if (bounds === 'parent' && elm.parentElement) {
        var p = elm.parentElement.getBoundingClientRect();
        bl = p.left; bt = p.top; bw = p.width; bh = p.height;
      } else {
        bl = 0; bt = 0; bw = innerWidth; bh = innerHeight;
      }
      var dx = 0, dy = 0;
      if (r.left < bl) dx = bl - r.left;
      if (r.right > bl + bw) dx = bl + bw - r.right;
      if (r.top < bt) dy = bt - r.top;
      if (r.bottom > bt + bh) dy = bt + bh - r.bottom;
      x += dx; y += dy;
      if (dx) vx = 0;
      if (dy) vy = 0;
    }

    function onDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      dragging = true; pid = e.pointerId;
      handle.setPointerCapture && handle.setPointerCapture(pid);
      lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
      vx = vy = 0;
      cancelAnimationFrame(raf);
      elm.classList.add('lg-dragging');
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging || e.pointerId !== pid) return;
      var now = performance.now(), dt = Math.max(now - lastT, 1);
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      x += dx; y += dy;
      vx = vx * 0.4 + (dx / dt * 16) * 0.6;
      vy = vy * 0.4 + (dy / dt * 16) * 0.6;
      lastX = e.clientX; lastY = e.clientY; lastT = now;
      if (!REDUCED_MOTION) {
        // 液態拉伸:速度越快,沿運動方向越長(體積守恆,垂直向壓縮)
        var sp = Math.sqrt(vx * vx + vy * vy);
        if (sp > 0.5) ang = Math.atan2(vy, vx);
        stretch += (1 + Math.min(sp * 0.013, 0.22) - stretch) * 0.3;
        var g = elm._lgGlass;
        if (g && g.setBulge) g.setBulge(1 + (stretch - 1) * 1.6);
      }
      clampBounds(); apply();
    }
    function onUp(e) {
      if (!dragging || e.pointerId !== pid) return;
      dragging = false;
      elm.classList.remove('lg-dragging');
      if (REDUCED_MOTION) { stretch = 1; apply(); return; }
      // 釋放:慣性滑行 + 欠阻尼彈簧讓拉伸抖動收斂(果凍回彈)
      wobV = 0;
      (function settle() {
        var sliding = inertia && (Math.abs(vx) > 0.1 || Math.abs(vy) > 0.1);
        if (sliding) {
          vx *= 0.92; vy *= 0.92;
          x += vx; y += vy;
          clampBounds();
        }
        wobV += (-(stretch - 1) * 340 - wobV * 9) / 60;
        stretch += wobV / 60;
        apply();
        var g = elm._lgGlass;
        if (g && g.setBulge) g.setBulge(1 + Math.abs(stretch - 1) * 1.6);
        if (!sliding && Math.abs(stretch - 1) < 0.003 && Math.abs(wobV) < 0.02) {
          stretch = 1; apply();
          if (g && g.setBulge) g.setBulge(1);
          return;
        }
        raf = requestAnimationFrame(settle);
      })();
    }

    handle.style.touchAction = 'none';
    handle.style.cursor = 'grab';
    handle.addEventListener('pointerdown', onDown);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);

    return {
      destroy: function () {
        cancelAnimationFrame(raf);
        handle.removeEventListener('pointerdown', onDown);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * 9. 共用 scroll util(B1 建立,B5 沿用)
   * ------------------------------------------------------------------ */
  /* makeScrollWatcher(target) → { subscribe(cb) }  cb 收 { y, dy, atTop, atBottom } */
  function makeScrollWatcher(target) {
    var t = target || window, subs = [], raf = 0;
    function getY() { return t === window ? (window.scrollY || window.pageYOffset || 0) : t.scrollTop; }
    function maxY() {
      return t === window
        ? (document.documentElement.scrollHeight - window.innerHeight)
        : (t.scrollHeight - t.clientHeight);
    }
    var lastY = getY();
    function tick() {
      raf = 0;
      var y = getY(), m = maxY();
      var s = { y: y, dy: y - lastY, atTop: y <= 1, atBottom: y >= m - 1 };
      lastY = y;
      subs.forEach(function (cb) { cb(s); });
    }
    function onScroll() { if (!raf) raf = requestAnimationFrame(tick); }
    t.addEventListener('scroll', onScroll, { passive: true });
    return {
      subscribe: function (cb) { subs.push(cb); var y0 = getY(); cb({ y: y0, dy: 0, atTop: y0 <= 1, atBottom: y0 >= maxY() - 1 }); },
      destroy: function () { t.removeEventListener('scroll', onScroll); subs = []; }
    };
  }
  var _winScroll = null;
  function getWindowScroll() { return _winScroll || (_winScroll = makeScrollWatcher(window)); }

  /* ------------------------------------------------------------------ *
   * 9b. initScrollShrink(B1):navbar / tabs data-lg-shrink 下捲縮小
   * ------------------------------------------------------------------ */
  function initScrollShrink() {
    var bars = [].slice.call(document.querySelectorAll('[data-lg-shrink]'));
    if (!bars.length || REDUCED_MOTION) return;   // reduced-motion:定在展開、不隱藏
    var THRESH = 6, CONDENSE_AT = 24, HIDE_AT = 90;
    function setCondensed(bar, want) {
      if (bar.classList.contains('is-condensed') === want) return;
      bar.classList.toggle('is-condensed', want);
      // tabs:padding transition 結束後重定位藥丸(只認 bar 自身的 padding 過渡,防子 tab 冒泡與堆疊)
      if (bar.classList.contains('lg-tabs') && bar._lgRepositionPill && !bar._lgPillPending) {
        bar._lgPillPending = true;
        bar.addEventListener('transitionend', function te(e) {
          if (e.target !== bar || e.propertyName.indexOf('padding') !== 0) return;
          bar._lgPillPending = false;
          bar.removeEventListener('transitionend', te);
          bar._lgRepositionPill();
        });
      }
    }
    getWindowScroll().subscribe(function (s) {
      bars.forEach(function (bar) {
        setCondensed(bar, s.y >= CONDENSE_AT);     // 第一段:縮小(位置驅動)
        var hide;                                   // 第二段:隱藏(方向驅動)
        if (s.y < CONDENSE_AT) hide = false;        // 近頂一律現身
        else if (s.dy > THRESH && s.y > HIDE_AT) hide = true;   // 往下且夠深 → 隱藏
        else if (s.dy < -THRESH) hide = false;      // 往上 → 現身
        else hide = bar.classList.contains('is-hidden');       // 維持
        bar.classList.toggle('is-hidden', hide);
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 9c. initScrollEdge(B5):data-lg-scroll-edge 容器邊緣漸隱 mask
   * ------------------------------------------------------------------ */
  function initScrollEdge() {
    [].slice.call(document.querySelectorAll('[data-lg-scroll-edge]')).forEach(function (el) {
      var mode = el.getAttribute('data-lg-scroll-edge') || 'both';
      var useTop = mode === 'top' || mode === 'both';
      var useBot = mode === 'bottom' || mode === 'both';
      var FADE = 36;
      makeScrollWatcher(el).subscribe(function (s) {
        var max = el.scrollHeight - el.clientHeight;
        var t = useTop ? Math.max(0, Math.min(s.y, FADE)) : 0;         // 距頂越遠,頂緣漸隱帶越長(平滑淡入)
        var b = useBot ? Math.max(0, Math.min(max - s.y, FADE)) : 0;   // 距底越遠,底緣漸隱帶越長
        if (!t && !b) { el.style.webkitMaskImage = ''; el.style.maskImage = ''; return; }
        var m = 'linear-gradient(to bottom, transparent 0, #000 ' + t.toFixed(1) + 'px, #000 calc(100% - ' + b.toFixed(1) + 'px), transparent 100%)';
        el.style.webkitMaskImage = m;
        el.style.maskImage = m;
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 10. 元件行為:tabs / slider / modal / tooltip / dock
   * ------------------------------------------------------------------ */
  function initTabs(root) {
    var pill = root.querySelector('.lg-tabs__pill');
    var tabs = [].slice.call(root.querySelectorAll('.lg-tabs__tab'));
    function move(tab) {
      tabs.forEach(function (t) {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      if (pill) {
        var fromLeft = parseFloat(pill.style.left) || 0;
        var d = tab.offsetLeft - fromLeft;
        pill.style.width = tab.offsetWidth + 'px';
        pill.style.left = tab.offsetLeft + 'px';
        // 液滴遷移:途中被拉長,抵達時擠壓回彈
        if (!REDUCED_MOTION && Math.abs(d) > 6 && pill.animate) {
          var st = 1 + Math.min(Math.abs(d) / 140, 0.5);
          pill.animate([
            { transform: 'scaleX(1)' },
            { transform: 'scaleX(' + st.toFixed(3) + ')', offset: 0.45 },
            { transform: 'scaleX(0.96)', offset: 0.8 },
            { transform: 'scaleX(1)' }
          ], { duration: 400, easing: 'ease-out' });
        }
      }
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { move(t); });
      t.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        var n = tabs[(i + d + tabs.length) % tabs.length];
        n.focus(); move(n);
        e.preventDefault();
      });
    });
    root._lgRepositionPill = function () {
      var act = root.querySelector('.lg-tabs__tab.is-active') || tabs[0];
      if (act && pill) { pill.style.width = act.offsetWidth + 'px'; pill.style.left = act.offsetLeft + 'px'; }
    };
    var active = root.querySelector('.lg-tabs__tab.is-active') || tabs[0];
    if (active) requestAnimationFrame(function () { move(active); });
  }

  function initSlider(input) {
    function paint() {
      var min = parseFloat(input.min) || 0, max = parseFloat(input.max) || 100;
      var p = ((input.value - min) / (max - min)) * 100;
      input.style.setProperty('--lg-fill', p + '%');
    }
    input.addEventListener('input', paint);
    paint();
  }

  function morphFrom(origin, panel) {
    // 量測前先中性化 transform:is-open 的 transition 在 t=0 尚未推進,面板仍是 base 的
    // scale(0.86) translateY(18px),直接量會量到縮放盒 → FLIP 的 sx/sy/dx/dy 全偏(實測差約 14%/33px)。
    var savedTrans = panel.style.transition;
    panel.style.transition = 'none';
    panel.style.transform = 'none';
    var o = origin.getBoundingClientRect(), p = panel.getBoundingClientRect(); // 強制 reflow → 真正靜止盒
    panel.style.transform = '';            // 交回 CSS(is-open = transform:none)
    panel.style.transition = savedTrans;
    if (!p.width || !p.height) return false;
    var dx = (o.left + o.width / 2) - (p.left + p.width / 2);
    var dy = (o.top + o.height / 2) - (p.top + p.height / 2);
    var sx = Math.max(o.width / p.width, 0.05), sy = Math.max(o.height / p.height, 0.05);
    panel.animate([
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx.toFixed(3) + ',' + sy.toFixed(3) + ')', opacity: 0.4 },
      { transform: 'none', opacity: 1 }
    ], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    return true;  // 全程保留折射(不關 backdrop-filter)
  }

  function initModals() {
    var lastFocus = null;
    function open(modal, origin) {
      if (modal.classList.contains('is-open')) return;   // 已開啟則不重入(避免雙重 morph)
      lastFocus = document.activeElement;
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      var panel = modal.querySelector('.lg-modal__panel');
      if (FULL) instances.forEach(function (g) { if (modal.contains(g.el)) g.update(); });
      var morphed = false;
      if (panel && origin && !REDUCED_MOTION && panel.animate) {
        panel.classList.add('is-morphing');                   // 抑制 keyframe,WAAPI 獨佔
        morphed = morphFrom(origin, panel);
        if (!morphed) panel.classList.remove('is-morphing');  // 量不到盒 → 回退既有預設 keyframe
      }
      if (panel) panel._lgOrigin = morphed ? origin : null;
      var f = modal.querySelector('button, [href], input, [tabindex]');
      if (f) f.focus();
    }
    function finishClose(modal) {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      var panel = modal.querySelector('.lg-modal__panel');
      if (panel) panel.classList.remove('is-morphing');   // 清乾淨,下次開啟才正常
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function close(modal) {
      var panel = modal.querySelector('.lg-modal__panel');
      if (panel && panel._lgOrigin && !REDUCED_MOTION && panel.animate) {
        var o = panel._lgOrigin.getBoundingClientRect(), p = panel.getBoundingClientRect();
        var dx = (o.left + o.width / 2) - (p.left + p.width / 2);
        var dy = (o.top + o.height / 2) - (p.top + p.height / 2);
        var sx = Math.max(o.width / p.width, 0.05), sy = Math.max(o.height / p.height, 0.05);
        var anim = panel.animate([
          { transform: 'none', opacity: 1 },
          { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx.toFixed(3) + ',' + sy.toFixed(3) + ')', opacity: 0.3 }
        ], { duration: 300, easing: 'cubic-bezier(.4,0,.7,.2)' });
        anim.onfinish = function () { finishClose(modal); };
      } else {
        finishClose(modal);
      }
    }
    document.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('[data-lg-open]') : null;
      if (t) {
        var m = document.querySelector(t.getAttribute('data-lg-open'));
        if (m) open(m, t);     // t = 觸發按鈕,作為 morph origin
        return;
      }
      var c = e.target.closest ? e.target.closest('[data-lg-close]') : null;
      if (c) {
        var mm = c.closest('.lg-modal');
        if (mm) close(mm);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var openModal = document.querySelector('.lg-modal.is-open');
      if (openModal) close(openModal);
    });
  }

  function initClearFields() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-lg-clear]') : null;
      if (!btn) return;
      var box = btn.closest('.lg-field__box');
      var input = box ? box.querySelector('.lg-field__input') : null;
      if (!input) return;
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.focus();
    });
  }

  function initSteppers() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-lg-step]') : null;
      if (!btn) return;
      var box = btn.closest('.lg-stepper');
      var input = box ? box.querySelector('.lg-stepper__input') : null;
      if (!input || input.disabled) return;
      var n = parseInt(btn.getAttribute('data-lg-step'), 10) || 0;
      if (n > 0) input.stepUp(n);
      else if (n < 0) input.stepDown(-n);
      else return;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function initOtp(otp) {
    var cells = [].slice.call(otp.querySelectorAll('.lg-otp__cell'));
    cells.forEach(function (cell, i) {
      cell.addEventListener('input', function () {
        if (cell.value.length > 1) cell.value = cell.value.slice(-1);
        if (cell.value && cells[i + 1]) cells[i + 1].focus();
      });
      cell.addEventListener('keydown', function (e) {
        if (e.key === 'Backspace' && !cell.value && cells[i - 1]) {
          cells[i - 1].focus();
          cells[i - 1].value = '';
          e.preventDefault();
        }
      });
      cell.addEventListener('paste', function (e) {
        e.preventDefault();
        var data = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\s/g, '');
        var j = 0;
        while (j < data.length && j < cells.length) { cells[j].value = data.charAt(j); j++; }
        (cells[j] || cells[cells.length - 1]).focus();
      });
    });
  }

  function initUpload(panel) {
    var input = panel.querySelector('.lg-upload__input');
    var list = panel.querySelector('.lg-upload__list');
    if (!input || !list) return;
    var store = new DataTransfer();
    function fmt(b) {
      if (b < 1024) return b + ' B';
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
      return (b / 1048576).toFixed(1) + ' MB';
    }
    function render() {
      list.innerHTML = '';
      [].forEach.call(store.files, function (file, i) {
        var li = document.createElement('li');
        li.className = 'lg-upload__file';
        li.innerHTML = '<svg class="lg-upload__fileicon" viewBox="0 0 256 256"><use href="#ph-file-text"/></svg>'
          + '<span class="lg-upload__name"></span>'
          + '<span class="lg-upload__size"></span>'
          + '<button type="button" class="lg-upload__remove" aria-label="移除"><svg viewBox="0 0 256 256"><use href="#ph-x"/></svg></button>';
        li.querySelector('.lg-upload__name').textContent = file.name;
        li.querySelector('.lg-upload__size').textContent = fmt(file.size);
        li.querySelector('.lg-upload__remove').addEventListener('click', function (e) {
          e.stopPropagation();
          store.items.remove(i);
          input.files = store.files;
          render();
        });
        list.appendChild(li);
      });
    }
    function add(files) {
      [].forEach.call(files, function (f) {
        var dup = [].some.call(store.files, function (g) { return g.name === f.name && g.size === f.size; });
        if (!dup) store.items.add(f);
      });
      input.files = store.files;
      render();
    }
    panel.addEventListener('click', function (e) {
      if (e.target.closest('.lg-upload__list')) return;
      input.click();
    });
    input.addEventListener('change', function () { add(input.files); });
    ['dragenter', 'dragover'].forEach(function (ev) {
      panel.addEventListener(ev, function (e) { e.preventDefault(); panel.classList.add('is-dragover'); });
    });
    panel.addEventListener('dragleave', function (e) {
      e.preventDefault();
      if (!panel.contains(e.relatedTarget)) panel.classList.remove('is-dragover');
    });
    panel.addEventListener('drop', function (e) {
      e.preventDefault();
      panel.classList.remove('is-dragover');
      if (e.dataTransfer) add(e.dataTransfer.files);
    });
  }

  function initTooltips() {
    var tip = null;
    function ensure() {
      if (tip) return tip;
      tip = document.createElement('div');
      tip.className = 'lg-tooltip';
      tip.setAttribute('role', 'tooltip');
      document.body.appendChild(tip);
      return tip;
    }
    function show(target) {
      var t = ensure();
      t.textContent = target.getAttribute('data-lg-tip');
      t.classList.add('is-visible');
      var r = target.getBoundingClientRect();
      var tr = t.getBoundingClientRect();
      var top = r.top - tr.height - 10;
      if (top < 8) top = r.bottom + 10;
      var left = Math.min(Math.max(8, r.left + r.width / 2 - tr.width / 2), innerWidth - tr.width - 8);
      t.style.top = top + 'px';
      t.style.left = left + 'px';
    }
    function hide() { if (tip) tip.classList.remove('is-visible'); }
    document.addEventListener('pointerenter', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-lg-tip]') : null;
      if (t) show(t);
    }, true);
    document.addEventListener('pointerleave', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-lg-tip]')) hide();
    }, true);
    document.addEventListener('focusin', function (e) {
      var t = e.target.closest ? e.target.closest('[data-lg-tip]') : null;
      if (t) show(t); else hide();
    });
  }

  function initDock(dock) {
    var items = [].slice.call(dock.querySelectorAll('.lg-dock__item'));
    // 黏滯光斑層:每個圖示下方一顆定置液滴,游標液滴滑過時與其融合、分離
    var goo = document.createElement('div');
    goo.className = 'lg-dock__goo';
    goo.setAttribute('aria-hidden', 'true');
    var blob = document.createElement('i');
    blob.className = 'blob';
    goo.appendChild(blob);
    dock.insertBefore(goo, dock.firstChild);
    requestAnimationFrame(function () {
      items.forEach(function (it) {
        var b = document.createElement('i');
        b.style.left = (it.offsetLeft + it.offsetWidth / 2) + 'px';
        goo.appendChild(b);
      });
    });
    if (REDUCED_MOTION) return; // 降級為 CSS hover
    var raf = 0, blobRaf = 0, targetX = null, curX = null, lastBX = 0;
    function blobLoop() {
      if (targetX === null) { blobRaf = 0; return; }
      curX += (targetX - curX) * 0.22;
      var sp = Math.abs(curX - lastBX);
      lastBX = curX;
      blob.style.left = curX.toFixed(1) + 'px';
      blob.style.transform = 'scale(' + Math.min(1 + sp * 0.02, 1.5).toFixed(3) + ',' + Math.max(1 - sp * 0.008, 0.8).toFixed(3) + ')';
      blobRaf = requestAnimationFrame(blobLoop);
    }
    dock.addEventListener('pointermove', function (e) {
      var dr = dock.getBoundingClientRect();
      targetX = e.clientX - dr.left;
      if (curX === null) { curX = targetX; lastBX = targetX; }
      if (!blobRaf) blobRaf = requestAnimationFrame(blobLoop);
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        items.forEach(function (it) {
          var r = it.getBoundingClientRect();
          var d = Math.abs(e.clientX - (r.left + r.width / 2));
          var s = 1 + 0.55 * Math.exp(-(d * d) / (2 * 70 * 70));
          it.style.transform = 'scale(' + s.toFixed(3) + ') translateY(' + (-(s - 1) * 14).toFixed(1) + 'px)';
        });
      });
    });
    dock.addEventListener('pointerleave', function () {
      items.forEach(function (it) { it.style.transform = ''; });
      targetX = null;
      blob.style.transform = 'scale(0)';
    });
  }

  /* ------------------------------------------------------------------ *
   * 7.5 按壓擠壓 — 液滴被壓:彈簧驅動 scale,放開後過衝回彈
   *     有折射實例者同步鼓起(位移貼圖 scale 即時放大,零重算)
   * ------------------------------------------------------------------ */
  var PRESS_SEL = '.lg-btn,.lg-chip,.lg-tabs__tab,.lg-dock__item,[data-lg-press]';
  function pressSpringFor(t, springs) {
    var s = springs.get(t);
    if (s) return s;
    s = new Spring(1, {
      onUpdate: function (v) {
        t.style.scale = v.toFixed(4);
        var g = t._lgGlass;
        if (g && g.setBulge) g.setBulge(1 + (1 - v) * 4);
      }
    });
    springs.set(t, s);
    return s;
  }
  function initPress() {
    if (REDUCED_MOTION) return;
    var springs = new WeakMap();
    document.addEventListener('pointerdown', function (e) {
      var t = e.target.closest ? e.target.closest(PRESS_SEL) : null;
      if (!t) return;
      var s = pressSpringFor(t, springs);
      var r = t.getBoundingClientRect();
      var diag = Math.sqrt(r.width * r.width + r.height * r.height) || 60;
      s.k = 760; s.c = 32;                       // 壓下:快速且不震
      s.set(Math.max(0.9, Math.min(0.97, 1 - 22 / diag)));
      function up() {
        s.k = 380; s.c = 9.5;                    // 放開:欠阻尼,回彈兩三下
        s.set(1);
        removeEventListener('pointerup', up, true);
        removeEventListener('pointercancel', up, true);
      }
      addEventListener('pointerup', up, true);
      addEventListener('pointercancel', up, true);
    }, true);
  }

  /* ------------------------------------------------------------------ *
   * 9.5 開關表面張力 — goo 層的錨點液滴被拉斷,thumb 拉伸後回彈
   * ------------------------------------------------------------------ */
  function initSwitchTension(label) {
    var track = label.querySelector('.lg-switch__track');
    var input = label.querySelector('input[type="checkbox"]');
    var thumb = label.querySelector('.lg-switch__thumb');
    if (!track || !input || track._lgGoo) return;
    track._lgGoo = true;
    var goo = document.createElement('span');
    goo.className = 'lg-switch__goo';
    goo.setAttribute('aria-hidden', 'true');
    var A = document.createElement('i'), B = document.createElement('i');
    goo.appendChild(A); goo.appendChild(B);
    track.insertBefore(goo, track.firstChild);
    function sync() {
      A.classList.toggle('on', input.checked);
      B.classList.toggle('on', input.checked);
      A.classList.remove('fade');
    }
    sync();
    if (REDUCED_MOTION) { input.addEventListener('change', sync); return; }
    var st = new Spring(1, {
      onUpdate: function (v) {
        if (!thumb) return;
        thumb.style.setProperty('--lg-thx', v.toFixed(3));
        thumb.style.setProperty('--lg-thy', (1 / Math.sqrt(v)).toFixed(3));
      }
    });
    input.addEventListener('change', function () {
      B.classList.toggle('on', input.checked);   // 移動液滴跟著 thumb 出發
      A.classList.add('fade');                   // 錨點液滴被拉斷、縮回
      setTimeout(function () {
        A.classList.toggle('on', input.checked); // 抵達後在新端點重新聚成錨點
        A.classList.remove('fade');
      }, 430);
      st.snap(1.5); st.k = 300; st.c = 8; st.set(1);
    });
  }


  /* ------------------------------------------------------------------ *
   * 10. 初始化
   * ------------------------------------------------------------------ */
  var inited = false;
  /* ------------------------------------------------------------------ *
   * 13.5 儀表板元件 (v0.1) — .lg-stat / .lg-meter / .lg-gauge / .lg-chart
   *      原則:玻璃只做容器,數字、sparkline、圖表本身是實心內容層
   *      (內容套玻璃會看不見,這是技術上必要的邊界)。
   *      數值一律「屬性驅動」:改 data-lg-value / data-lg-spark /
   *      data-lg-points 即觸發彈簧動畫——單一 MutationObserver 監聽全
   *      部實例,對 AI 生成的程式碼最友善,不必學新的 JS API。
   * ------------------------------------------------------------------ */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var statRegistry = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  var statObserver = null;
  var chartRO = null;
  var sparkSeq = 0;

  function svgNode(name, attrs, parent) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  // 千分位格式化(實心數字層)
  function fmtNumber(v, decimals) {
    var neg = v < 0; v = Math.abs(v);
    var parts = v.toFixed(decimals).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + parts.join('.');
  }

  // Catmull-Rom → 三次貝茲,折線變平滑曲線
  function smoothPath(p) {
    if (p.length < 3) {
      return 'M' + p.map(function (q) { return q[0].toFixed(2) + ' ' + q[1].toFixed(2); }).join(' L');
    }
    var d = 'M' + p[0][0].toFixed(2) + ' ' + p[0][1].toFixed(2);
    for (var i = 0; i < p.length - 1; i++) {
      var p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      d += 'C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(2) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(2)
         + ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(2) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(2)
         + ' ' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2);
    }
    return d;
  }

  // 進入視口才把彈簧放向目標(REDUCED_MOTION 直接落定)
  function springOnVisible(elm, fire) {
    if (REDUCED_MOTION || typeof IntersectionObserver === 'undefined') { fire(); return; }
    var io = new IntersectionObserver(function (es) {
      for (var i = 0; i < es.length; i++) {
        if (es[i].isIntersecting) { fire(); io.disconnect(); return; }
      }
    }, { threshold: 0.35 });
    io.observe(elm);
  }

  function clamp01k(v) { return Math.max(0, Math.min(100, v)); }

  /* ---- Stat:數字滾動 ---- */
  function initStatValue(span) {
    if (!statRegistry || statRegistry.get(span)) return;
    var prefix = span.getAttribute('data-lg-prefix') || '';
    var suffix = span.getAttribute('data-lg-suffix') || '';
    function target() { return parseFloat(span.getAttribute('data-lg-value')) || 0; }
    function decimals() {
      var a = span.getAttribute('data-lg-decimals');
      if (a !== null) return Math.max(0, Math.min(4, +a || 0));
      var raw = span.getAttribute('data-lg-value') || '';
      var dot = raw.indexOf('.');
      return dot < 0 ? 0 : Math.min(raw.length - dot - 1, 4);
    }
    function write(v) { span.textContent = prefix + fmtNumber(v, decimals()) + suffix; }
    var sp = new Spring(0, { stiffness: 120, damping: 22, onUpdate: write });
    statRegistry.set(span, {
      update: function () { REDUCED_MOTION ? sp.snap(target()) : sp.set(target()); }
    });
    write(REDUCED_MOTION ? target() : 0);
    if (REDUCED_MOTION) sp.snap(target());
    else springOnVisible(span, function () { sp.set(target()); });
  }

  /* ---- Stat:sparkline(實心內容層,顏色繼承 currentColor) ---- */
  function renderSpark(svg) {
    var raw = (svg.getAttribute('data-lg-spark') || '').split(',').map(parseFloat).filter(isFinite);
    if (raw.length < 2) return;
    var W = 100, H = 32, P = 3;
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var min = Math.min.apply(null, raw), max = Math.max.apply(null, raw);
    var span = (max - min) || 1;
    var pts = raw.map(function (v, i) {
      return [P + (W - 2 * P) * i / (raw.length - 1), H - P - (H - 2 * P) * (v - min) / span];
    });
    var gid = 'lg-spark-g' + (++sparkSeq);
    var grad = svgNode('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, svgNode('defs', {}, svg));
    svgNode('stop', { offset: '0%', 'stop-color': 'currentColor', 'stop-opacity': 0.26 }, grad);
    svgNode('stop', { offset: '100%', 'stop-color': 'currentColor', 'stop-opacity': 0 }, grad);
    var d = smoothPath(pts);
    svgNode('path', {
      d: d + 'L' + pts[pts.length - 1][0].toFixed(2) + ' ' + H + 'L' + pts[0][0].toFixed(2) + ' ' + H + 'Z',
      fill: 'url(#' + gid + ')'
    }, svg);
    svgNode('path', {
      d: d, fill: 'none', stroke: 'currentColor', 'stroke-width': 2,
      'vector-effect': 'non-scaling-stroke', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    }, svg);
  }
  function initSpark(svg) {
    if (!statRegistry || statRegistry.get(svg)) return;
    statRegistry.set(svg, { update: function () { renderSpark(svg); } });
    renderSpark(svg);
  }

  /* ---- Meter:液體進度。前緣彎月面鼓頭隨彈簧速度拉伸 ---- */
  function initMeter(elm) {
    if (!statRegistry || statRegistry.get(elm)) return;
    var fill = elm.querySelector('.lg-meter__fill');
    if (!fill) {
      fill = document.createElement('span'); fill.className = 'lg-meter__fill';
      var hd = document.createElement('span'); hd.className = 'lg-meter__head';
      fill.appendChild(hd);
      elm.appendChild(fill);
    }
    var head = fill.querySelector('.lg-meter__head');
    if (!elm.getAttribute('role')) {
      elm.setAttribute('role', 'progressbar');
      elm.setAttribute('aria-valuemin', '0');
      elm.setAttribute('aria-valuemax', '100');
    }
    function target() { return clamp01k(parseFloat(elm.getAttribute('data-lg-value')) || 0); }
    var sp = new Spring(0, {
      stiffness: 210, damping: REDUCED_MOTION ? 30 : 11,   // 低阻尼=液體晃動
      onUpdate: function (v) {
        fill.style.width = clamp01k(v) + '%';
        if (head && !REDUCED_MOTION) {
          var st = 1 + Math.min(Math.abs(sp.vel) * 0.0045, 0.55);
          head.style.transform = 'scale(' + st.toFixed(3) + ',' + (1 / Math.sqrt(st)).toFixed(3) + ')';
        }
      },
      onRest: function () { if (head) head.style.transform = ''; }
    });
    statRegistry.set(elm, {
      update: function () {
        elm.setAttribute('aria-valuenow', String(Math.round(target())));
        REDUCED_MOTION ? sp.snap(target()) : sp.set(target());
      }
    });
    elm.setAttribute('aria-valuenow', String(Math.round(target())));
    if (REDUCED_MOTION) sp.snap(target());
    else springOnVisible(elm, function () { sp.set(target()); });
  }

  /* ---- Gauge:環形儀表(SVG 弧 + 中心數值;結構由 JS 注入) ---- */
  function initGauge(elm) {
    if (!statRegistry || statRegistry.get(elm)) return;
    var SIZE = 120, SW = 9, R = (SIZE - SW) / 2, CIRC = 2 * Math.PI * R;
    var arc = elm.querySelector('.lg-gauge__arc');
    var valEl = elm.querySelector('.lg-gauge__value');
    if (!arc) {
      var svg = svgNode('svg', {
        'class': 'lg-gauge__svg', viewBox: '0 0 ' + SIZE + ' ' + SIZE, 'aria-hidden': 'true'
      });
      svgNode('circle', { 'class': 'lg-gauge__track', cx: SIZE / 2, cy: SIZE / 2, r: R }, svg);
      arc = svgNode('circle', {
        'class': 'lg-gauge__arc', cx: SIZE / 2, cy: SIZE / 2, r: R,
        'stroke-dasharray': CIRC.toFixed(2), 'stroke-dashoffset': CIRC.toFixed(2)
      }, svg);
      elm.appendChild(svg);
      var center = document.createElement('div'); center.className = 'lg-gauge__center';
      valEl = document.createElement('span'); valEl.className = 'lg-gauge__value'; valEl.textContent = '0';
      var unit = document.createElement('span'); unit.className = 'lg-gauge__unit';
      unit.textContent = elm.getAttribute('data-lg-unit') || '%';
      center.appendChild(valEl); center.appendChild(unit);
      var labelText = elm.getAttribute('data-lg-label');
      if (labelText) {
        var lb = document.createElement('span'); lb.className = 'lg-gauge__label';
        lb.textContent = labelText;
        center.appendChild(lb);
      }
      elm.appendChild(center);
    }
    if (!elm.getAttribute('role')) {
      elm.setAttribute('role', 'meter');
      elm.setAttribute('aria-valuemin', '0');
      elm.setAttribute('aria-valuemax', '100');
      if (elm.getAttribute('data-lg-label')) elm.setAttribute('aria-label', elm.getAttribute('data-lg-label'));
    }
    function target() { return clamp01k(parseFloat(elm.getAttribute('data-lg-value')) || 0); }
    var sp = new Spring(0, {
      stiffness: 170, damping: REDUCED_MOTION ? 26 : 13,
      onUpdate: function (v) {
        var c = clamp01k(v);   // 弧與數字夾住 0–100,中段過衝仍看得見
        arc.setAttribute('stroke-dashoffset', (CIRC * (1 - c / 100)).toFixed(2));
        valEl.textContent = String(Math.round(c));
      }
    });
    statRegistry.set(elm, {
      update: function () {
        elm.setAttribute('aria-valuenow', String(Math.round(target())));
        REDUCED_MOTION ? sp.snap(target()) : sp.set(target());
      }
    });
    elm.setAttribute('aria-valuenow', String(Math.round(target())));
    if (REDUCED_MOTION) sp.snap(target());
    else springOnVisible(elm, function () { sp.set(target()); });
  }

  /* ---- Chart:手刻 SVG 折線/長條(零依賴),hover 十字線 + 數值提示 ---- */
  function initChart(svg) {
    if (!statRegistry || statRegistry.get(svg)) return;
    var panel = (svg.closest && svg.closest('.lg-chart')) || svg.parentNode;
    var tip = panel.querySelector('.lg-chart__tip');
    if (!tip) {
      tip = document.createElement('div'); tip.className = 'lg-chart__tip';
      panel.appendChild(tip);
    }
    var state = { pts: [], data: [], labels: [], plotX0: 0, plotX1: 0, drawn: REDUCED_MOTION };

    function render() {
      var type = svg.getAttribute('data-lg-chart') || 'line';
      var data = (svg.getAttribute('data-lg-points') || '').split(',').map(parseFloat).filter(isFinite);
      var labels = (svg.getAttribute('data-lg-labels') || '').split(',').map(function (s) { return s.trim(); });
      var rect = svg.getBoundingClientRect();
      if (data.length < 2 || rect.width < 40 || rect.height < 40) return;   // 視圖隱藏時跳過,RO 顯示後補繪
      var W = Math.round(rect.width), H = Math.round(rect.height);
      var PL = 8, PR = 8, PT = 10, PB = labels[0] ? 20 : 8;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      var min = Math.min.apply(null, data), max = Math.max.apply(null, data);
      var pad = (max - min || Math.abs(max) || 1) * 0.1;
      min -= pad; max += pad;
      if (type === 'bar' && min > 0) min = 0;
      var px = type === 'bar'
        ? function (i) { return PL + (W - PL - PR) / data.length * (i + 0.5); }   // 長條置中於等寬帶,首尾不被裁切
        : function (i) { return PL + (W - PL - PR) * (data.length === 1 ? 0.5 : i / (data.length - 1)); };
      var py = function (v) { return PT + (H - PT - PB) * (1 - (v - min) / (max - min)); };

      for (var g = 1; g <= 3; g++) {
        var gy = PT + (H - PT - PB) * g / 4;
        svgNode('line', { 'class': 'lg-chart__grid', x1: PL, x2: W - PR, y1: gy.toFixed(1), y2: gy.toFixed(1) }, svg);
      }

      var pts = data.map(function (v, i) { return [px(i), py(v)]; });
      state.pts = pts; state.data = data; state.labels = labels;
      state.plotX0 = PL; state.plotX1 = W - PR;

      if (type === 'bar') {
        var bw = (W - PL - PR) / data.length * 0.56;
        var y0 = py(Math.max(min, 0));
        data.forEach(function (v, i) {
          var y = py(v);
          svgNode('rect', {
            'class': 'lg-chart__bar', x: (px(i) - bw / 2).toFixed(1), width: bw.toFixed(1),
            y: Math.min(y, y0).toFixed(1), height: Math.max(2, Math.abs(y0 - y)).toFixed(1), rx: Math.min(5, bw / 2)
          }, svg);
        });
      } else {
        var d = smoothPath(pts);
        var gid = 'lg-chart-g' + (++sparkSeq);
        var grad = svgNode('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, svgNode('defs', {}, svg));
        svgNode('stop', { offset: '0%', 'stop-color': 'currentColor', 'stop-opacity': 0.22 }, grad);
        svgNode('stop', { offset: '100%', 'stop-color': 'currentColor', 'stop-opacity': 0 }, grad);
        svgNode('path', {
          'class': 'lg-chart__area',
          d: d + 'L' + pts[pts.length - 1][0].toFixed(2) + ' ' + (H - PB) + 'L' + pts[0][0].toFixed(2) + ' ' + (H - PB) + 'Z',
          fill: 'url(#' + gid + ')'
        }, svg);
        var line = svgNode('path', { 'class': 'lg-chart__line', d: d }, svg);
        pts.forEach(function (p) {
          svgNode('circle', { 'class': 'lg-chart__dot', cx: p[0].toFixed(2), cy: p[1].toFixed(2), r: 3 }, svg);
        });
        if (!state.drawn) {           // 首繪:線條描入(REDUCED_MOTION 略過)
          state.drawn = true;
          try {
            var len = line.getTotalLength();
            line.style.strokeDasharray = len + ' ' + len;
            line.style.strokeDashoffset = len;
            line.getBoundingClientRect();
            line.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.3, 0.8, 0.3, 1)';
            line.style.strokeDashoffset = '0';
          } catch (e) {}
        }
      }

      if (labels[0]) {
        var skip = Math.ceil(labels.length / Math.max(2, Math.floor((W - PL - PR) / 56)));
        labels.forEach(function (t, i) {
          if (!t || i % skip) return;
          svgNode('text', {
            'class': 'lg-chart__axis', x: px(i).toFixed(1), y: H - 5, 'text-anchor': 'middle'
          }, svg).textContent = t;
        });
      }
      state.cross = svgNode('line', { 'class': 'lg-chart__cross', y1: PT, y2: H - PB, x1: -9, x2: -9 }, svg);
    }

    svg.addEventListener('pointermove', function (e) {
      if (!state.pts.length || !state.cross) return;
      var r = svg.getBoundingClientRect();
      var best = 0, bd = Infinity;
      for (var i = 0; i < state.pts.length; i++) {
        var dd = Math.abs(state.pts[i][0] - (e.clientX - r.left));
        if (dd < bd) { bd = dd; best = i; }
      }
      var p = state.pts[best];
      state.cross.setAttribute('x1', p[0]); state.cross.setAttribute('x2', p[0]);
      state.cross.style.opacity = '1';
      var pr = panel.getBoundingClientRect();
      tip.textContent = (state.labels[best] ? state.labels[best] + ' · ' : '') + fmtNumber(state.data[best], state.data[best] % 1 ? 1 : 0);
      tip.style.left = (r.left - pr.left + p[0]) + 'px';
      tip.style.top = (r.top - pr.top + p[1]) + 'px';
      tip.classList.add('is-visible');
    });
    svg.addEventListener('pointerleave', function () {
      if (state.cross) state.cross.style.opacity = '0';
      tip.classList.remove('is-visible');
    });

    statRegistry.set(svg, { update: render, render: render });
    if (typeof ResizeObserver !== 'undefined') {
      if (!chartRO) chartRO = new ResizeObserver(function (es) {
        for (var i = 0; i < es.length; i++) {
          var en = statRegistry.get(es[i].target);
          if (en && en.render) en.render();
        }
      });
      chartRO.observe(svg);   // observe 即觸發首繪;視圖隱藏時尺寸為 0,顯示後自動補繪
    } else {
      render();
      window.addEventListener('resize', render);
    }
  }

  /* ---- 屬性驅動:單一 MutationObserver 監聽全部實例 ---- */
  function ensureStatObserver() {
    if (statObserver || !statRegistry || typeof MutationObserver === 'undefined') return;
    statObserver = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var entry = statRegistry.get(muts[i].target);
        if (entry) entry.update();
      }
    });
    statObserver.observe(document.documentElement, {
      attributes: true, subtree: true,
      attributeFilter: ['data-lg-value', 'data-lg-spark', 'data-lg-points']
    });
  }

  function initStats(root) {
    root = root || document;
    [].forEach.call(root.querySelectorAll('.lg-stat__value[data-lg-value]'), initStatValue);
    [].forEach.call(root.querySelectorAll('.lg-stat__spark[data-lg-spark]'), initSpark);
    [].forEach.call(root.querySelectorAll('.lg-meter'), initMeter);
    [].forEach.call(root.querySelectorAll('.lg-gauge'), initGauge);
    [].forEach.call(root.querySelectorAll('svg[data-lg-chart]'), initChart);
    ensureStatObserver();
  }

  /* ------------------------------------------------------------------ *
   * 13.6 Toast (v0.1) — LiquidGlass.toast({ title, message, icon, duration })
   *      入場複用對話框的液滴落地物理(lg-droplet),自動消退,
   *      懸停暫停;折射實例在移除時 destroy,不洩漏濾鏡節點。
   * ------------------------------------------------------------------ */
  var toastStack = null;
  function toast(opts) {
    opts = opts || {};
    if (!toastStack) {
      toastStack = document.createElement('div');
      toastStack.className = 'lg-toast-stack';
      toastStack.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastStack);
    }
    var t = document.createElement('div');
    t.className = 'lg lg-toast';
    t.setAttribute('role', 'status');
    if (opts.icon) {
      var ic = document.createElement('span'); ic.className = 'lg-toast__icon';
      var isv = svgNode('svg', { 'aria-hidden': 'true' });
      svgNode('use', { href: '#' + String(opts.icon).replace(/^#/, '') }, isv);
      ic.appendChild(isv); t.appendChild(ic);
    }
    var body = document.createElement('div'); body.className = 'lg-toast__body';
    if (opts.title) {
      var h = document.createElement('p'); h.className = 'lg-toast__title';
      h.textContent = opts.title; body.appendChild(h);
    }
    if (opts.message) {
      var m = document.createElement('p'); m.className = 'lg-toast__msg';
      m.textContent = opts.message; body.appendChild(m);
    }
    t.appendChild(body);
    var x = document.createElement('button');
    x.className = 'lg-toast__close'; x.type = 'button';
    x.setAttribute('aria-label', '關閉通知');
    var xs = svgNode('svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' });
    svgNode('path', { d: 'M2 2 12 12 M12 2 2 12', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none' }, xs);
    x.appendChild(xs); t.appendChild(x);

    // 最多同時 4 則,溢出時收掉最舊的
    var live = toastStack.querySelectorAll('.lg-toast:not(.is-leaving)');
    if (live.length >= 4) leaveToast(live[0]);

    toastStack.appendChild(t);
    var glass = attach(t);
    t._lgLeave = function () { leaveToast(t, glass); };
    x.addEventListener('click', t._lgLeave);

    var ttl = opts.duration === 0 ? 0 : (opts.duration || 4200);
    if (ttl) {
      var timer = setTimeout(t._lgLeave, ttl);
      t.addEventListener('pointerenter', function () { clearTimeout(timer); });
      t.addEventListener('pointerleave', function () { clearTimeout(timer); timer = setTimeout(t._lgLeave, 1600); });
    }
    return t;
  }
  function leaveToast(t, glass) {
    if (t._lgLeft) return;
    t._lgLeft = true;
    t.classList.add('is-leaving');
    setTimeout(function () {
      var g = glass || t._lgGlass;
      if (g && g.destroy) g.destroy();
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 300);
  }

  function init(userConfig) {
    if (userConfig) for (var k in userConfig) config[k] = userConfig[k];
    document.documentElement.classList.add(FULL ? 'lg-full' : 'lg-fallback');
    if (inited) return;
    inited = true;

    function boot() {
      [].forEach.call(document.querySelectorAll('[data-lg]'), function (n) { attach(n); });
      [].forEach.call(document.querySelectorAll('[data-lg-concentric]'), function (n) {
        applyConcentric(n);
        if (typeof ResizeObserver === 'undefined') return;
        var ro = new ResizeObserver(function () { applyConcentric(n); });
        ro.observe(n);
        var p = n.parentElement;
        while (p && !p.classList.contains('lg')) p = p.parentElement;
        if (p) ro.observe(p);   // 父層尺寸/內距變動也重算
      });
      [].forEach.call(document.querySelectorAll('.lg-tabs'), initTabs);
      [].forEach.call(document.querySelectorAll('.lg-otp'), initOtp);
      [].forEach.call(document.querySelectorAll('[data-lg-upload]'), initUpload);
      [].forEach.call(document.querySelectorAll('input.lg-slider__input'), initSlider);
      [].forEach.call(document.querySelectorAll('.lg-dock'), initDock);
      [].forEach.call(document.querySelectorAll('.lg-switch'), initSwitchTension);
      [].forEach.call(document.querySelectorAll('[data-lg-drag]'), function (n) {
        draggable(n, { handle: n.getAttribute('data-lg-drag-handle') || undefined, bounds: n.getAttribute('data-lg-drag') || 'viewport' });
      });
      initModals();
      initTooltips();
      initStats();
      initSheen();
      ensureGooFilter();
      initPress();
      initScrollShrink();
      initScrollEdge();
      initClearFields();
      initSteppers();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }

  function refresh() { instances.forEach(function (g) { g.update(); }); }

  global.LiquidGlass = {
    version: '0.1.0',
    supported: FULL,
    reducedMotion: REDUCED_MOTION,
    config: config,
    init: init,
    attach: attach,
    draggable: draggable,
    refresh: refresh,
    toast: toast,
    Spring: Spring,
    behaviors: { tabs: initTabs, slider: initSlider, dock: initDock, switchTension: initSwitchTension, stats: initStats }
  };
})(typeof window !== 'undefined' ? window : this);
