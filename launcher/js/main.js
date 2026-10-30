/* Dock - home screen for Samsung Tizen TVs (ES5 for the Tizen 4.0 web engine). */
(function () {
  'use strict';

  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, BACKSPACE: 8, ESC: 27 };
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var settings = window.DOCK_SETTINGS || {};
  var appsConfig = window.DOCK_APPS || [];
  var inputsConfig = window.DOCK_INPUTS || {};
  var weatherConfig = window.DOCK_WEATHER || {};
  var dayPhotos = window.WALLPAPERS || [];
  var nightPhotos = window.NIGHT_WALLPAPERS || [];   // photos in launcher\wallpapers-night, used at night
  var photos = dayPhotos;
  var photoDir = 'wallpapers/';
  var nightConfig = window.DOCK_NIGHT || {};
  var busConfig = window.DOCK_BUS || {};
  var prayerConfig = window.DOCK_PRAYER || {};
  var spotifyConfig = window.DOCK_SPOTIFY || {};
  var spotifyAuth = window.SPOTIFY_AUTH || {};
  var hasTizen = typeof window.tizen !== 'undefined' && window.tizen.application;

  var body = document.body;
  var fadeMs = settings.fadeMs || 2000;
  // The weather card is independent of the Spotify/Wi-Fi switcher below it.
  var weatherOn = store('dock.weatherCard') !== 'off';

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // "2026-10-22T19:00" as local time (older engines read it as UTC).
  function parseLocal(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(s || '');
    if (!m) return new Date(NaN);
    return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  }
  function hasClass(el, c) { return (' ' + el.className + ' ').indexOf(' ' + c + ' ') >= 0; }
  function addClass(el, c) { if (!hasClass(el, c)) el.className = (el.className + ' ' + c).replace(/^\s+/, ''); }
  function removeClass(el, c) { el.className = (' ' + el.className + ' ').replace(' ' + c + ' ', ' ').replace(/^\s+|\s+$/g, ''); }
  function toggleClass(el, c, on) { if (on) addClass(el, c); else removeClass(el, c); }
  function setTransform(el, value) { el.style.webkitTransform = value; el.style.transform = value; }

  function store(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (e) { /* storage can be unavailable; nothing depends on it */ }
    return null;
  }
  function unstore(key) {
    try { window.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }
  function loadJson(key, fallback) {
    try { var v = store(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function saveJson(key, value) { store(key, JSON.stringify(value)); }

  function duration(ms) {
    var s = Math.max(1, Math.round(ms / 1000));
    if (s < 60) return s + ' s';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60);
    return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  }

  function getJson(url, timeoutMs, ok, fail) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = timeoutMs;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { ok(JSON.parse(xhr.responseText)); } catch (e) { fail('bad data'); }
      } else { fail('HTTP ' + xhr.status); }
    };
    xhr.onerror = function () { fail('network error'); };
    xhr.ontimeout = function () { fail('timed out'); };
    xhr.send();
  }

  // "#E50914" -> "rgba(229,9,20,a)"
  function rgba(hex, a) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
    if (!m) return 'rgba(127,140,150,' + a + ')';
    return 'rgba(' + parseInt(m[1], 16) + ',' + parseInt(m[2], 16) + ',' + parseInt(m[3], 16) + ',' + a + ')';
  }

  // ---------- glass: a tiny, soft copy of the photo behind each card ----------
  // The TV's browser has no backdrop blur, so each .glass element gets a layer showing a
  // 1/GLASS-size copy of the photo behind it; scaling it back up softens it.
  // Every layer is exactly the size of its box with the same rounded corners, so nothing
  // relies on overflow clipping (which the TV's engine skips for some layers).
  var GLASS = 12;
  var SRC_W = 160;   // 1920 / GLASS
  var SRC_H = 90;    // 1080 / GLASS
  var glassOn = settings.glass !== false && !!document.createElement('canvas').getContext;
  var glassSrc = null;
  var glassUrl = null;  // the soft copy as an image, when the engine lets a canvas be read back
  var shelfShift = 0;   // how far the shelf is scrolled (px, 0 or negative)

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // The same full-width shade as .scrim in style.css, so the glass matches what is around it.
  function shadeOver(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(8,12,16,0.5)');
    g.addColorStop(0.3, 'rgba(8,12,16,0.22)');
    g.addColorStop(0.52, 'rgba(8,12,16,0.1)');
    g.addColorStop(0.78, 'rgba(8,12,16,0.5)');
    g.addColorStop(1, 'rgba(8,12,16,0.72)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function fallbackFill(ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1f3a44');
    g.addColorStop(0.58, '#6b8f8a');
    g.addColorStop(1, '#d9c7a3');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function smooth(ctx) {
    ctx.imageSmoothingEnabled = true;
    try { ctx.imageSmoothingQuality = 'high'; } catch (e) { /* older engine */ }
  }

  // Draws the photo the way background-size: cover shows it, halving in steps so it stays smooth.
  function buildGlassSource(img) {
    if (!glassOn) return;
    var src = makeCanvas(SRC_W, SRC_H);
    var ctx = src.getContext('2d');
    smooth(ctx);
    var drawn = false;
    if (img && img.naturalWidth) {
      try {
        var iw = img.naturalWidth;
        var ih = img.naturalHeight;
        var s = Math.max(1920 / iw, 1080 / ih);
        var sw = 1920 / s;
        var sh = 1080 / s;
        var step = makeCanvas(960, 540);
        var sctx = step.getContext('2d');
        smooth(sctx);
        sctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, 960, 540);
        var w = 960;
        var h = 540;
        while (w / 2 >= SRC_W * 1.5) {
          sctx.drawImage(step, 0, 0, w, h, 0, 0, w / 2, h / 2);
          w = w / 2;
          h = h / 2;
        }
        try { ctx.filter = 'saturate(1.45)'; } catch (e) { /* older engine: plain colours */ }
        ctx.drawImage(step, 0, 0, w, h, 0, 0, SRC_W, SRC_H);
        try { ctx.filter = 'none'; } catch (e) { /* ignore */ }
        drawn = true;
      } catch (e) { drawn = false; }
    }
    if (!drawn) fallbackFill(ctx, SRC_W, SRC_H);
    sampleAccent(src);
    shadeOver(ctx, SRC_W, SRC_H);
    glassSrc = src;
    try { glassUrl = src.toDataURL('image/png'); } catch (e) { glassUrl = null; }
    if (glassUrl && glassUrl.indexOf('data:image/png') !== 0) glassUrl = null;
  }

  // The vertical offset a CSS transform currently applies (the ambient card slide).
  function translateY(el) {
    try {
      var cs = window.getComputedStyle(el);
      var t = (cs.transform && cs.transform !== 'none') ? cs.transform : cs.webkitTransform;
      var m = /matrix3d\(([^)]+)\)/.exec(t || '');
      if (m) return parseFloat(m[1].split(',')[13]) || 0;
      m = /matrix\(([^)]+)\)/.exec(t || '');
      if (m) return parseFloat(m[1].split(',')[5]) || 0;
    } catch (e) { /* older engine */ }
    return 0;
  }

  // Where an element sits on screen, ignoring the small focus lift and scale.
  function glassRect(el) {
    var x = 0;
    var y = 0;
    var n = el;
    while (n && n !== body) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    if (el.id === 'toast') x -= el.offsetWidth / 2;          // centred with translate(-50%)
    if (hasClass(el, 'tile')) x += shelfShift;
    if (el.id === 'bus' || el.id === 'prayer' || el.id === 'spotify' || el.id === 'net') {
      y += translateY(el);   // the ambient slide
    }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }

  // Copies the source region (sx, sy, sw, sh) onto the whole cw x ch canvas.
  function drawRegion(ctx, sx, sy, sw, sh, cw, ch) {
    var kx = cw / sw;
    var ky = ch / sh;
    var x0 = Math.max(0, sx);
    var y0 = Math.max(0, sy);
    var x1 = Math.min(SRC_W, sx + sw);
    var y1 = Math.min(SRC_H, sy + sh);
    if (x1 <= x0 || y1 <= y0) return;
    ctx.drawImage(glassSrc, x0, y0, x1 - x0, y1 - y0,
      (x0 - sx) * kx, (y0 - sy) * ky, (x1 - x0) * kx, (y1 - y0) * ky);
  }

  // fade: cross-fade from the old photo (used when the wallpaper changes).
  // onlyIfChanged: skip the work when the element has not moved or changed size.
  function paintGlass(el, fade, onlyIfChanged) {
    if (!glassOn || !glassSrc || !el) return;
    var r = glassRect(el);
    if (!r.w || !r.h) return;
    var stamp = r.x + ',' + r.y + ',' + r.w + ',' + r.h;
    if (onlyIfChanged && el.glassStamp === stamp && el.glassSrc === glassSrc) return;
    el.glassStamp = stamp;
    el.glassSrc = glassSrc;

    var tag = glassUrl ? 'DIV' : 'CANVAS';
    var old = [];
    for (var k = 0; k < el.childNodes.length; k++) {
      var node = el.childNodes[k];
      if (node.nodeType === 1 && hasClass(node, 'glass-bg')) old.push(node);
    }
    var layer = (!fade && old.length && old[old.length - 1].nodeName === tag) ? old.pop() : null;
    var fresh = !layer;
    if (fresh) {
      layer = document.createElement(tag.toLowerCase());
      layer.className = 'glass-bg';
    }

    if (glassUrl) {
      // A background image is always clipped to its own rounded box.
      if (layer.glassUrl !== glassUrl) {
        layer.style.backgroundImage = 'url("' + glassUrl + '")';
        layer.glassUrl = glassUrl;
      }
      layer.style.backgroundPosition = (-Math.round(r.x)) + 'px ' + (-Math.round(r.y)) + 'px';
    } else {
      var cw = Math.max(1, Math.ceil(r.w / GLASS));
      var ch = Math.max(1, Math.ceil(r.h / GLASS));
      if (layer.width !== cw) layer.width = cw;
      if (layer.height !== ch) layer.height = ch;
      var ctx = layer.getContext('2d');
      smooth(ctx);
      ctx.clearRect(0, 0, cw, ch);
      drawRegion(ctx, r.x / GLASS, r.y / GLASS, r.w / GLASS, r.h / GLASS, cw, ch);
    }

    if (fresh) {
      el.insertBefore(layer, old.length ? old[old.length - 1].nextSibling : el.firstChild);
      if (fade && old.length) {
        layer.style.opacity = '0';
        layer.style.transition = 'opacity ' + fadeMs + 'ms ease-in-out';
        void layer.offsetWidth;
        layer.style.opacity = '1';
        setTimeout(function () {
          for (var i = 0; i < old.length; i++) if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
        }, fadeMs + 120);
        return;
      }
    }
    for (var j = 0; j < old.length; j++) el.removeChild(old[j]);
  }

  function paintAll(fade) {
    var list = document.querySelectorAll('.glass');
    for (var i = 0; i < list.length; i++) paintGlass(list[i], fade, false);
  }

  function paintShelf() {
    for (var i = 0; i < shelfItems.length; i++) paintGlass(shelfItems[i].tile, false, false);
  }

  // ---------- accent: a light colour taken from each photo ----------
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b);
    var min = Math.min(r, g, b);
    var h = 0;
    var s = 0;
    var l = (max + min) / 2;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    var hue = function (p, q, t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    if (s === 0) return [l * 255, l * 255, l * 255];
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
  }

  function sampleAccent(c) {
    try {
      var d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      var r = 0;
      var g = 0;
      var b = 0;
      var wsum = 0;
      for (var i = 0; i < d.length; i += 16) {          // every 4th pixel is plenty
        var mx = Math.max(d[i], d[i + 1], d[i + 2]);
        var mn = Math.min(d[i], d[i + 1], d[i + 2]);
        var w = (mx - mn) * (mx - mn) + 40;               // favour the colourful parts
        r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; wsum += w;
      }
      if (!wsum) return;
      var hsl = rgbToHsl(r / wsum, g / wsum, b / wsum);
      var sat = Math.max(0.32, Math.min(0.72, hsl[1] * 1.4));
      var rgb = hslToRgb(hsl[0], sat, 0.8);
      document.documentElement.style.setProperty('--accent',
        'rgb(' + Math.round(rgb[0]) + ',' + Math.round(rgb[1]) + ',' + Math.round(rgb[2]) + ')');
    } catch (e) { /* the photo could not be read back; the default accent stays */ }
  }

  var toastTimer = null;
  function toast(text) {
    var el = $('toast');
    $('toastText').textContent = text;
    el.className = 'toast glass show';
    paintGlass(el, false, false);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast glass'; }, 4500);
  }

  // ---------- clock ----------
  var clockTimer = null;
  function tickClock() {
    var d = new Date();
    $('time').textContent = hhmm(d);
    $('date').textContent = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    clearTimeout(clockTimer);
    clockTimer = setTimeout(tickClock, (60 - d.getSeconds()) * 1000 + 50);
    checkNight();
    renderBus();
  }

  // ---------- weather (Open-Meteo, no account needed) ----------
  var WX_KEY = 'dock.weather';
  var wxTimer = null;

  // Simple line icons, drawn here so nothing is downloaded.
  function wxIcon(kind, day) {
    var sun = '<circle cx="24" cy="24" r="8"/><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11.3 11.3l3.5 3.5M33.2 33.2l3.5 3.5M11.3 36.7l3.5-3.5M33.2 14.8l3.5-3.5"/>';
    var moon = '<path d="M31 9a15 15 0 1 0 8 23A13 13 0 0 1 31 9z"/>';
    var cloud = '<path d="M14 36h20a8 8 0 0 0 0-16 11 11 0 0 0-21-2 9 9 0 0 0 1 18z"/>';
    var smallSun = day ? '<circle cx="16" cy="16" r="6"/><path d="M16 4v3M4 16h3M7.5 7.5l2 2M24.5 7.5l-2 2"/>'
      : '<path d="M19 6a9 9 0 1 0 5 14A8 8 0 0 1 19 6z"/>';
    var cloudLow = '<path d="M14 32h20a7 7 0 0 0 0-14 10 10 0 0 0-19-2 8 8 0 0 0-1 16z"/>';
    var inner;
    switch (kind) {
      case 'clear': inner = day ? sun : moon; break;
      case 'partly': inner = smallSun + '<path d="M18 38h17a7 7 0 0 0 0-14 10 10 0 0 0-19-1 7.5 7.5 0 0 0 2 15z"/>'; break;
      case 'cloudy': inner = cloud; break;
      case 'fog': inner = '<path d="M8 18h32M6 26h36M10 34h28"/>'; break;
      case 'drizzle': inner = cloudLow + '<path d="M18 37v3M26 37v3M34 37v3"/>'; break;
      case 'rain': inner = cloudLow + '<path d="M17 36l-2 6M25 36l-2 6M33 36l-2 6"/>'; break;
      case 'snow': inner = cloudLow + '<path d="M17 38h.01M25 41h.01M33 38h.01M21 44h.01M29 44h.01"/>'; break;
      case 'storm': inner = cloudLow + '<path d="M25 34l-5 8h6l-3 6"/>'; break;
      default: inner = cloud;
    }
    return '<svg viewBox="0 0 48 48" aria-hidden="true">' + inner + '</svg>';
  }

  function wxInfo(code) {
    if (code === 0) return { kind: 'clear', text: 'Clear' };
    if (code === 1) return { kind: 'clear', text: 'Mostly clear' };
    if (code === 2) return { kind: 'partly', text: 'Partly cloudy' };
    if (code === 3) return { kind: 'cloudy', text: 'Cloudy' };
    if (code === 45 || code === 48) return { kind: 'fog', text: 'Fog' };
    if (code >= 51 && code <= 57) return { kind: 'drizzle', text: 'Drizzle' };
    if (code === 61) return { kind: 'rain', text: 'Light rain' };
    if (code === 63) return { kind: 'rain', text: 'Rain' };
    if (code === 65) return { kind: 'rain', text: 'Heavy rain' };
    if (code === 66 || code === 67) return { kind: 'rain', text: 'Freezing rain' };
    if (code >= 71 && code <= 77) return { kind: 'snow', text: 'Snow' };
    if (code >= 80 && code <= 82) return { kind: 'rain', text: 'Showers' };
    if (code === 85 || code === 86) return { kind: 'snow', text: 'Snow showers' };
    if (code >= 95) return { kind: 'storm', text: 'Thunderstorms' };
    return { kind: 'cloudy', text: '' };
  }

  function renderWeather(w) {
    var el = $('weather');
    if (!w || !w.current || !weatherOn || weatherConfig.enabled === false) { el.style.display = 'none'; return; }
    el.style.display = '';
    var cur = wxInfo(w.current.weather_code);
    var isDay = w.current.is_day === 1;
    $('wxIcon').innerHTML = wxIcon(cur.kind, isDay);
    $('wxTemp').textContent = Math.round(w.current.temperature_2m) + '\u00b0';
    $('wxText').textContent = cur.text;

    var today = dayKey(new Date());
    var di = 0;
    if (w.daily && w.daily.time) {
      for (var i = 0; i < w.daily.time.length; i++) { if (w.daily.time[i] === today) di = i; }
      var hi = Math.round(w.daily.temperature_2m_max[di]);
      var lo = Math.round(w.daily.temperature_2m_min[di]);
      var rain = w.daily.precipitation_probability_max ? w.daily.precipitation_probability_max[di] : null;
      $('wxRange').textContent = 'H ' + hi + '\u00b0  L ' + lo + '\u00b0' +
        (rain !== null && rain !== undefined ? '  \u00b7  ' + rain + '% rain' : '');
    }

    // Next hours, every 3 hours from the next full hour.
    var strip = $('wxHours');
    strip.innerHTML = '';
    if (w.hourly && w.hourly.time) {
      var now = new Date();
      var start = -1;
      for (var h = 0; h < w.hourly.time.length; h++) {
        if (parseLocal(w.hourly.time[h]) > now) { start = h; break; }
      }
      if (start >= 0) {
        for (var k = 0; k < 4; k++) {
          var idx = start + k * 3;
          if (idx >= w.hourly.time.length) break;
          var t = parseLocal(w.hourly.time[idx]);
          var info = wxInfo(w.hourly.weather_code[idx]);
          var hourDay = t.getHours() >= 7 && t.getHours() < 19;
          var cell = document.createElement('div');
          cell.className = 'wx-hour';
          cell.innerHTML = '<div class="wx-h-time">' + pad(t.getHours()) + ':00</div>' +
            '<div class="wx-h-icon">' + wxIcon(info.kind, hourDay) + '</div>' +
            '<div class="wx-h-temp">' + Math.round(w.hourly.temperature_2m[idx]) + '\u00b0</div>';
          strip.appendChild(cell);
        }
      }
    }
    var age = Date.now() - (w.fetchedAt || 0);
    $('wxPlace').textContent = (weatherConfig.place || 'London') + (age > 3 * 3600000 ? ', updated ' + hhmm(new Date(w.fetchedAt)) : '');
    paintGlass(el, false, true);
  }

  function fetchWeather() {
    if (weatherConfig.enabled === false || !weatherOn) { $('weather').style.display = 'none'; return; }
    var lat = weatherConfig.latitude || 51.5072;
    var lon = weatherConfig.longitude || -0.1276;
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&current=temperature_2m,weather_code,is_day' +
      '&hourly=temperature_2m,weather_code' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=' + encodeURIComponent(weatherConfig.timezone || 'Europe/London') + '&forecast_days=2';
    getJson(url, 15000, function (data) {
      data.fetchedAt = Date.now();
      saveJson(WX_KEY, data);
      renderWeather(data);
    }, function () {
      renderWeather(loadJson(WX_KEY, null));   // keep showing the last forecast
    });
  }

  function startWeather() {
    renderWeather(loadJson(WX_KEY, null));
    fetchWeather();
    clearInterval(wxTimer);
    wxTimer = setInterval(fetchWeather, 20 * 60000);
  }

  // ---------- Spotify ----------
  // The card is a Spotify Connect remote. It reads what is playing on the account, so it
  // follows a phone, speaker or the TV's own Spotify app, and can pause, skip and start a
  // playlist. Audio is played by Spotify, not by Dock. The one-time login is done on the PC
  // by scripts\spotify-login.ps1; this app only keeps the refresh token.
  var spotifyEl = $('spotify');
  var spotifyPlaylistUri = spotifyUri(spotifyConfig.playlistUri || spotifyAuth.playlistUri || '');
  var spotifyPlaylistName = spotifyConfig.playlistName || spotifyAuth.playlistName || 'your playlist';
  var spotifyReady = !!(spotifyConfig.enabled !== false && spotifyAuth.clientId && spotifyAuth.refreshToken);
  var spotifyToken = loadJson('dock.spotify.token', null);
  var spotifyBase = store('dock.spotify.refreshBase');
  if (spotifyBase && spotifyBase !== (spotifyAuth.refreshToken || '')) {
    // A new login was built into the app; drop the previous login's cached tokens.
    spotifyToken = null;
    unstore('dock.spotify.token');
    unstore('dock.spotify.refresh');
    unstore('dock.spotify.refreshBase');
  }
  var spotifyNow = null;
  var spotifySeenAt = 0;
  var spotifyTimer = null;
  var spotifyBarTimer = null;
  var spotifyBusy = false;
  var spotifyProblem = false;

  function spotifyUri(value) {
    var v = (value || '').replace(/^\s+|\s+$/g, '');
    var m = /^spotify:(playlist|album|artist|track):([A-Za-z0-9]+)/.exec(v);
    if (m) return m[0];
    m = /open\.spotify\.com\/(?:(?:[a-z]{2}(?:-[a-z]{2})?|intl-[a-z]{2})\/)?(playlist|album|artist|track)\/([A-Za-z0-9]+)/.exec(v);
    if (m) return 'spotify:' + m[1] + ':' + m[2];
    return v;
  }

  function spotifyXhr(method, url, body, headers, ok, fail) {
    var x = new XMLHttpRequest();
    x.open(method, url, true);
    x.timeout = 15000;
    for (var h in headers) {
      if (headers.hasOwnProperty(h)) x.setRequestHeader(h, headers[h]);
    }
    x.onload = function () {
      var data = null;
      if (x.responseText) {
        try { data = JSON.parse(x.responseText); } catch (e) { data = x.responseText; }
      }
      if (x.status >= 200 && x.status < 300) ok(data, x.status);
      else fail(x.status, data);
    };
    x.onerror = function () { fail(0, null); };
    x.ontimeout = function () { fail(0, null); };
    x.send(body || null);
  }

  function spotifyRefreshValue() {
    var configToken = spotifyAuth.refreshToken || '';
    var rotated = store('dock.spotify.refresh');
    var base = store('dock.spotify.refreshBase');
    // Use a rotated token only while it belongs to the login that was built into the app.
    // A new login (or a reinstall with a new config) starts from the new config token.
    return (rotated && base && base === configToken) ? rotated : configToken;
  }

  function spotifyGetToken(ok, fail) {
    if (spotifyToken && spotifyToken.accessToken && spotifyToken.expiresAt - 60000 > Date.now()) {
      ok(spotifyToken.accessToken);
      return;
    }
    var refresh = spotifyRefreshValue();
    if (!refresh) { fail('no refresh token'); return; }
    var body = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refresh) +
      '&client_id=' + encodeURIComponent(spotifyAuth.clientId);
    spotifyXhr('POST', 'https://accounts.spotify.com/api/token', body,
      { 'Content-Type': 'application/x-www-form-urlencoded' }, function (data) {
        if (!data || !data.access_token) { fail('empty token'); return; }
        spotifyToken = {
          accessToken: data.access_token,
          expiresAt: Date.now() + (parseInt(data.expires_in, 10) || 3600) * 1000
        };
        saveJson('dock.spotify.token', spotifyToken);
        if (data.refresh_token) {
          store('dock.spotify.refresh', data.refresh_token);
          store('dock.spotify.refreshBase', spotifyAuth.refreshToken || '');
        }
        ok(data.access_token);
      }, function () {
        spotifyToken = null;
        unstore('dock.spotify.token');
        fail('refresh failed');
      });
  }

  // ---------- Spotify Web Playback SDK iframe ----------
  // The SDK needs an HTTPS origin. This iframe stays loaded at 1x1 so the phone can
  // always pick "Dock TV"; remote key 9 expands the same page as a status screen.
  var spotifyPlayerEl = $('spotifyPlayer');
  var spotifyPlayerFrame = $('spotifyPlayerFrame');
  var spotifyPlayerUrl = spotifyConfig.sdkPlayerUrl || '';
  var spotifyPlayerOpen = false;
  var spotifyPlayerLoaded = false;
  var spotifyPlayerOrigin = '';
  try {
    var playerUrl = new URL(spotifyPlayerUrl);
    spotifyPlayerOrigin = playerUrl.protocol + '//' + playerUrl.host;
  } catch (e) { spotifyPlayerOrigin = ''; }

  function spotifyPlayerSend(data) {
    if (!spotifyPlayerLoaded || !spotifyPlayerFrame.contentWindow) return;
    try { spotifyPlayerFrame.contentWindow.postMessage(data, spotifyPlayerOrigin || '*'); } catch (e) { /* ignore */ }
  }

  function spotifyPlayerToken() {
    if (!spotifyPlayerLoaded) return;
    spotifyGetToken(function (token) {
      spotifyPlayerSend({ type: 'token', token: token });
    }, function () {
      spotifyPlayerSend({ type: 'token-error' });
    });
  }

  function startSpotifyPlayer() {
    if (!spotifyPlayerUrl || spotifyPlayerLoaded) return;
    spotifyPlayerLoaded = true;
    spotifyPlayerFrame.src = spotifyPlayerUrl;
  }

  function openSpotifyPlayer() {
    if (!spotifyPlayerUrl) { toast('Spotify player URL is not set'); return; }
    startSpotifyPlayer();
    spotifyPlayerOpen = true;
    addClass(spotifyPlayerEl, 'on');
    spotifyPlayerSend({ type: 'show' });
    setTimeout(function () {
      try { spotifyPlayerFrame.focus(); } catch (e) { }
      try { spotifyPlayerFrame.contentWindow.focus(); } catch (e) { }
    }, 300);
    toast('Spotify player status - Back closes it');
  }

  function closeSpotifyPlayer() {
    if (!spotifyPlayerOpen) return;
    spotifyPlayerOpen = false;
    removeClass(spotifyPlayerEl, 'on');
    spotifyPlayerSend({ type: 'hide' });
    try { spotifyPlayerFrame.blur(); } catch (e) { }
    try { window.focus(); } catch (e) { }
    toast('Spotify player status closed');
  }

  window.addEventListener('message', function (e) {
    if (!spotifyPlayerLoaded) return;
    if (spotifyPlayerOrigin && e.origin !== spotifyPlayerOrigin) return;
    var data = e.data || {};
    if (data.type === 'hello' || data.type === 'sdk-ready' || data.type === 'need-token') {
      if (spotifyPlayerOpen) spotifyPlayerSend({ type: 'show' });
      spotifyPlayerToken();
    } else if (data.type === 'ready') {
      if (spotifyPlayerOpen) toast('Spotify player ready' + (data.deviceId ? ': ' + data.deviceId : ''));
    } else if (data.type === 'close') {
      closeSpotifyPlayer();
    }
  });

  function spotifyRequest(method, path, body, ok, fail, retried) {
    spotifyGetToken(function (token) {
      var headers = { Authorization: 'Bearer ' + token };
      var payload = null;
      if (body !== null && body !== undefined) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      spotifyXhr(method, 'https://api.spotify.com/v1' + path, payload, headers, function (data, status) {
        ok(data, status);
      }, function (status, data) {
        if (status === 401 && !retried) {
          spotifyToken = null;
          unstore('dock.spotify.token');
          spotifyRequest(method, path, body, ok, fail, true);
          return;
        }
        fail(status, data);
      });
    }, function () {
      fail(401, null);
    });
  }

  function spotifyArt(images) {
    if (!images || !images.length) return '';
    var best = images[0];
    for (var i = 0; i < images.length; i++) {
      var im = images[i];
      if ((im.width || 0) >= 300 && ((best.width || 0) < 300 || im.width < best.width)) best = im;
    }
    return best.url || '';
  }

  function setSpotifyArt(url) {
    var art = $('spArt');
    if (url) {
      art.style.backgroundImage = 'url("' + url + '")';
      addClass(art, 'has-art');
    } else {
      art.style.backgroundImage = '';
      removeClass(art, 'has-art');
    }
  }

  function updateSpotifyBar() {
    if (!spotifyNow || !spotifyNow.item) return;
    var progress = parseInt(spotifyNow.progress_ms, 10) || 0;
    var total = parseInt(spotifyNow.item.duration_ms, 10) || 0;
    if (spotifyNow.is_playing && spotifySeenAt) progress += Date.now() - spotifySeenAt;
    if (progress > total) progress = total;
    $('spBar').style.width = total ? (progress / total * 100) + '%' : '0%';
  }

  function renderSpotify(data) {
    spotifyProblem = false;
    spotifyNow = (data && data.item) ? data : null;
    spotifySeenAt = Date.now();
    if (!spotifyNow) {
      setSpotifyArt('');
      $('spKicker').textContent = 'Spotify';
      $('spTitle').textContent = spotifyPlaylistUri ? spotifyPlaylistName : 'Nothing playing';
      $('spArtist').textContent = spotifyPlaylistUri ? 'Press OK to play this playlist' : 'Open Spotify on your phone';
      $('spChip').textContent = '';
      $('spBar').style.width = '0%';
      $('spHint').textContent = spotifyPlaylistUri ? 'OK plays ' + spotifyPlaylistName : 'Open Spotify on your phone to start';
      toggleClass(spotifyEl, 'paused', true);
      if (widgetMode === 'spotify') layoutIdleCard(spotifyEl);
      return;
    }
    var item = spotifyNow.item;
    var artist = '';
    if (item.artists && item.artists.length) {
      var names = [];
      for (var a = 0; a < item.artists.length; a++) names.push(item.artists[a].name);
      artist = names.join(', ');
    } else if (item.show) {
      artist = item.show.name || '';
    }
    var images = (item.album && item.album.images) || item.images || [];
    setSpotifyArt(spotifyArt(images));
    var device = spotifyNow.device && spotifyNow.device.name ? spotifyNow.device.name : '';
    $('spKicker').textContent = 'Spotify' + (device ? ' \u00b7 ' + device : '');
    $('spTitle').textContent = item.name || 'Spotify';
    $('spArtist').textContent = artist;
    $('spChip').textContent = spotifyNow.is_playing ? 'Playing' : 'Paused';
    var hint = (spotifyNow.is_playing ? 'OK pause' : 'OK play') + ' \u00b7 \u2190 \u2192 track';
    if (spotifyPlaylistUri) hint += ' \u00b7 \u2191 playlist';
    $('spHint').textContent = hint;
    toggleClass(spotifyEl, 'paused', !spotifyNow.is_playing);
    updateSpotifyBar();
    if (widgetMode === 'spotify') layoutIdleCard(spotifyEl);
  }

  function spotifyProblemState(title, message, hint) {
    spotifyNow = null;
    setSpotifyArt('');
    $('spKicker').textContent = 'Spotify';
    $('spTitle').textContent = title;
    $('spArtist').textContent = message;
    $('spChip').textContent = '';
    $('spBar').style.width = '0%';
    $('spHint').textContent = hint || 'Reconnect Spotify from Start.cmd';
    toggleClass(spotifyEl, 'paused', true);
    if (widgetMode === 'spotify') layoutIdleCard(spotifyEl);
    if (!spotifyProblem) {
      toast(message);
      spotifyProblem = true;
    }
  }

  function spotifyPoll() {
    if (!spotifyReady || spotifyBusy || document.hidden) return;
    spotifyBusy = true;
    spotifyRequest('GET', '/me/player', null, function (data) {
      spotifyBusy = false;
      renderSpotify(data);
    }, function (status, data) {
      spotifyBusy = false;
      var message = data && data.error && data.error.message ? data.error.message : '';
      if (status === 401 || status === 400) spotifyProblemState('Spotify login expired', 'Reconnect it from Start.cmd.', 'Reconnect Spotify from Start.cmd');
      else if (status === 403) spotifyProblemState('Spotify Premium needed', 'Playback control needs a Premium account.', 'Spotify Premium is needed for controls');
      else if (status === 429) spotifyProblemState('Spotify is busy', 'It will try again in a moment.', 'It will try again in a moment');
      else if (status === 0) spotifyProblemState('Spotify offline', 'The TV could not reach Spotify.', 'Check the TV\'s internet connection');
      else spotifyProblemState('Spotify error', message || ('HTTP ' + status), 'It will try again in a moment');
    }, false);
  }

  function spotifyControl(method, path, body) {
    spotifyRequest(method, path, body, function () {
      setTimeout(spotifyPoll, 400);
    }, function (status) {
      if (status === 403) toast('Spotify Premium is required to control playback.');
      else if (status === 0) toast('Can\'t reach Spotify.');
      else toast('Spotify didn\'t respond. Try again.');
    }, false);
  }

  function spotifyChooseDevice(devices) {
    var want = (spotifyConfig.preferDevice || '').toLowerCase();
    var i;
    if (want) {
      for (i = 0; i < devices.length; i++) {
        if (devices[i].id && !devices[i].is_restricted &&
            (devices[i].name || '').toLowerCase().indexOf(want) >= 0) return devices[i];
      }
    }
    for (i = 0; i < devices.length; i++) {
      if (devices[i].id && !devices[i].is_restricted && devices[i].is_active) return devices[i];
    }
    for (i = 0; i < devices.length; i++) {
      if (devices[i].id && !devices[i].is_restricted) return devices[i];
    }
    return null;
  }

  function spotifyPlayPlaylist() {
    if (!spotifyPlaylistUri) {
      toast('Set DOCK_SPOTIFY.playlistUri in dock-config.js, or run Connect Spotify again.');
      return;
    }
    spotifyRequest('GET', '/me/player/devices', null, function (data) {
      var devices = (data && data.devices) || [];
      var device = spotifyChooseDevice(devices);
      if (!device) {
        toast('Open Spotify on the TV or phone, then press OK again.');
        return;
      }
      var path = '/me/player/play?device_id=' + encodeURIComponent(device.id);
      var playBody = spotifyPlaylistUri.indexOf('spotify:track:') === 0 ?
        { uris: [spotifyPlaylistUri] } : { context_uri: spotifyPlaylistUri };
      spotifyRequest('PUT', path, playBody, function () {
        toast('Playing ' + spotifyPlaylistName);
        setTimeout(spotifyPoll, 800);
      }, function (status) {
        if (status === 403) toast('Spotify Premium is required to play a playlist.');
        else toast('Spotify couldn\'t start the playlist.');
      }, false);
    }, function (status) {
      toast(status === 0 ? 'Can\'t reach Spotify.' : 'Spotify couldn\'t list your devices.');
    }, false);
  }

  function spotifyToggle() {
    if (!spotifyNow) { spotifyPlayPlaylist(); return; }
    if (spotifyNow.is_playing) spotifyControl('PUT', '/me/player/pause', null);
    else spotifyControl('PUT', '/me/player/play', null);
  }

  function spotifyNext() { spotifyControl('POST', '/me/player/next', null); }
  function spotifyPrevious() { spotifyControl('POST', '/me/player/previous', null); }

  function startSpotify() {
    if (!spotifyReady) return;
    if (!spotifyTimer) {
      spotifyTimer = setInterval(spotifyPoll, Math.max(3, parseInt(spotifyConfig.pollSeconds, 10) || 5) * 1000);
    }
    if (!spotifyBarTimer) spotifyBarTimer = setInterval(updateSpotifyBar, 1000);
    spotifyPoll();
  }

  function stopSpotify() {
    if (spotifyTimer) clearInterval(spotifyTimer);
    if (spotifyBarTimer) clearInterval(spotifyBarTimer);
    spotifyTimer = null;
    spotifyBarTimer = null;
    spotifyBusy = false;   // a request may have been abandoned while the TV was away
  }

  // ---------- apps ----------
  var apps = [];

  // The colour that glows through each app's glass tile.
  var BRAND_GLOW = { netflix: '#E50914', youtube: '#FF0033', spotify: '#1ED760' };

  function glowOf(app) {
    if (app.glow) return app.glow;
    var key = (app.match || app.name || '').toLowerCase();
    return BRAND_GLOW[key] || app.color || '#7f8c96';
  }

  function packageOf(id) { return (id || '').split('.')[0]; }

  // Icon paths that belong to the app itself; a generic Tizen placeholder is skipped.
  function ownIcon(path, appId, pkgId) {
    if (!path || !appId) return null;
    if (path.indexOf(appId) >= 0) return path;
    return pkgId && pkgId.length >= 8 && path.indexOf(pkgId) >= 0 ? path : null;
  }

  function resolveApps(done) {
    var plain = function (a) {
      return { name: a.name, id: a.ids[0], icons: [], installed: true, match: a.match, glow: a.glow, color: a.color, text: a.text };
    };
    if (!hasTizen) { done(appsConfig.map(plain)); return; }
    try {
      window.tizen.application.getAppsInfo(function (list) {
        var byId = {};
        var i;
        for (i = 0; i < list.length; i++) byId[list[i].id] = list[i];
        done(appsConfig.map(function (a) {
          var found = null;
          var j;
          for (j = 0; j < a.ids.length && !found; j++) found = byId[a.ids[j]] || null;
          if (!found && a.match) {
            var want = a.match.toLowerCase();
            for (j = 0; j < list.length && !found; j++) {
              if ((list[j].name || '').toLowerCase() === want) found = list[j];
            }
            for (j = 0; j < list.length && !found; j++) {
              if ((list[j].name || '').toLowerCase().indexOf(want) >= 0) found = list[j];
            }
          }
          var app = plain(a);
          app.installed = !!found;
          if (found) {
            app.id = found.id;
            var icon = ownIcon(found.iconPath, found.id, found.packageId);
            if (icon) app.icons.push(icon);
            try {
              var pk = window.tizen.package && window.tizen.package.getPackageInfo(found.packageId || packageOf(found.id));
              var pIcon = pk && ownIcon(pk.iconPath, found.id, found.packageId);
              if (pIcon && pIcon !== icon) app.icons.push(pIcon);
            } catch (e) { /* package info is optional */ }
          }
          return app;
        }));
      }, function () { done(appsConfig.map(plain)); });
    } catch (e) { done(appsConfig.map(plain)); }
  }

  function iconUrl(path) {
    if (/^(file|https?):/.test(path)) return path;
    return 'file://' + path;
  }

  // Shows the first icon that is at least tile-sized; otherwise the glass name tile stays.
  var MIN_ICON_W = 380;
  var MIN_ICON_H = 228;
  function tryIcons(tile, paths, k) {
    if (settings.appIcons === 'never' || k >= paths.length) return;
    var img = document.createElement('img');
    img.alt = '';
    img.className = 'app-icon';
    img.onload = function () {
      if (img.naturalWidth >= MIN_ICON_W && img.naturalHeight >= MIN_ICON_H) {
        tile.insertBefore(img, tile.querySelector('.sheen'));
        addClass(tile, 'has-icon');
      } else {
        tryIcons(tile, paths, k + 1);
      }
    };
    img.onerror = function () { tryIcons(tile, paths, k + 1); };
    img.src = iconUrl(paths[k]);
  }

  function launchApp(app, tile) {
    if (!app) return;
    press(tile);
    if (!app.installed) {
      toast(app.name + ' isn\'t installed. Get it from Apps, then try again.');
      return;
    }
    if (!hasTizen) { toast('Opening ' + app.name); return; }
    try {
      window.tizen.application.launch(app.id, function () { /* app is opening */ }, function (err) {
        if (err && err.name === 'NotFoundError') {
          toast(app.name + ' isn\'t installed. Get it from Apps, then try again.');
        } else {
          toast(app.name + ' didn\'t open (' + (err && err.name ? err.name : 'unknown error') + '). Press OK to try again.');
        }
      });
    } catch (e) {
      toast(app.name + ' didn\'t open (' + e.name + '). Press OK to try again.');
    }
  }

  // ---------- inputs (HDMI and Live TV) ----------
  var inputs = [];

  function inputLabel(type, number) {
    var key = type + number;
    var labels = inputsConfig.labels || {};
    if (labels[key]) return labels[key];
    if (type === 'TV') return 'Live TV';
    if (type === 'HDMI') return 'HDMI ' + number;
    return type + ' ' + number;
  }

  function resolveInputs(done) {
    if (inputsConfig.enabled === false) { done([]); return; }
    var fallback = function () {
      var list = [];
      if (inputsConfig.liveTv !== false) list.push({ type: 'TV', number: 1 });
      for (var n = 1; n <= (inputsConfig.hdmiPorts || 2); n++) list.push({ type: 'HDMI', number: n });
      done(list);
    };
    if (!window.tizen || !window.tizen.systeminfo) { fallback(); return; }
    try {
      window.tizen.systeminfo.getPropertyValue('VIDEOSOURCE', function (vs) {
        var list = [];
        if (inputsConfig.liveTv !== false) list.push({ type: 'TV', number: 1 });
        var con = (vs && vs.connected) || [];
        var hidden = inputsConfig.hide || [];
        for (var i = 0; i < con.length; i++) {
          if (con[i].type === 'HDMI' && hidden.indexOf('HDMI' + con[i].number) < 0) {
            list.push({ type: 'HDMI', number: con[i].number, source: con[i] });
          }
        }
        list.sort(function (a, b) { return a.type === b.type ? a.number - b.number : (a.type === 'TV' ? -1 : 1); });
        done(list);
      }, function () { fallback(); });
    } catch (e) { fallback(); }
  }

  function switchInput(inp, tile) {
    if (!inp) return;
    press(tile);
    var label = inputLabel(inp.type, inp.number);
    var openViewer = function () {
      try {
        window.tizen.application.launch('org.tizen.tv-viewer', function () { /* now watching */ }, function () {
          toast('Switched to ' + label + '. Press Back to return to Dock.');
          try { window.tizen.application.getCurrentApplication().hide(); } catch (e) { /* ignore */ }
        });
      } catch (e) { toast(label + ' didn\'t open (' + e.name + ').'); }
    };
    if (!window.tizen || !window.tizen.tvwindow) { toast('Opening ' + label); return; }
    try {
      var source = inp.source || { type: inp.type, number: inp.number };
      window.tizen.tvwindow.setSource(source, openViewer, function (err) {
        toast(label + ' didn\'t open (' + (err && err.name ? err.name : 'error') + '). Is the device switched on?');
      });
    } catch (e) {
      toast(label + ' didn\'t open (' + e.name + ').');
    }
  }

  // ---------- the shelf: apps, a divider, then inputs ----------
  var shelfEl = $('shelf');
  var captionEl = null;
  var shelfItems = [];   // { kind: 'app' | 'input', item, tile, key }
  var focusIdx = 0;
  var SHELF_VIEW = 1712; // visible width from the left margin to the right margin

  var TV_ICON = '<rect x="5" y="10" width="38" height="25" rx="4"/><path d="M17 41h14"/>';
  var HDMI_ICON = '<path d="M6 17h36v9l-5 6H11l-5-6z"/><path d="M13 23h22"/>';

  function press(tile) {
    if (!tile) return;
    addClass(tile, 'pressed');
    setTimeout(function () { removeClass(tile, 'pressed'); }, 170);
  }

  function makeTile(cls, label) {
    var tile = document.createElement('div');
    tile.className = 'tile glass' + (cls ? ' ' + cls : '');
    tile.setAttribute('role', 'menuitem');
    var name = document.createElement('div');
    name.className = 'name';
    name.textContent = label;
    tile.appendChild(name);
    var sheen = document.createElement('div');
    sheen.className = 'sheen';
    tile.appendChild(sheen);
    return tile;
  }

  function buildShelf() {
    var keep = store('dock.focusKey');
    shelfEl.innerHTML = '';
    shelfItems = [];

    apps.forEach(function (app) {
      var tile = makeTile(app.installed ? '' : 'missing', app.name);
      var glow = glowOf(app);
      var wash = document.createElement('div');
      wash.className = 'wash';
      wash.style.background = 'radial-gradient(130% 150% at 0% 100%, ' + rgba(glow, 0.95) + ' 0%, ' +
        rgba(glow, 0.45) + ' 38%, ' + rgba(glow, 0) + ' 72%)';
      tile.insertBefore(wash, tile.firstChild);
      tryIcons(tile, app.icons || [], 0);
      shelfEl.appendChild(tile);
      shelfItems.push({ kind: 'app', item: app, tile: tile, key: 'app:' + app.name });
    });

    if (apps.length && inputs.length) {
      var divider = document.createElement('div');
      divider.className = 'divider';
      shelfEl.appendChild(divider);
    }

    inputs.forEach(function (inp) {
      var tile = makeTile('input', inputLabel(inp.type, inp.number));
      var icon = document.createElement('div');
      icon.className = 'input-icon';
      icon.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true">' + (inp.type === 'TV' ? TV_ICON : HDMI_ICON) + '</svg>';
      tile.insertBefore(icon, tile.firstChild);
      shelfEl.appendChild(tile);
      shelfItems.push({ kind: 'input', item: inp, tile: tile, key: 'input:' + inp.type + inp.number });
    });

    if (!captionEl) {
      captionEl = document.createElement('div');
      captionEl.className = 'shelf-caption';
      captionEl.innerHTML = '<b></b><span class="hint"></span>';
      shelfEl.parentNode.appendChild(captionEl);
    }

    focusIdx = 0;
    for (var i = 0; i < shelfItems.length; i++) if (shelfItems[i].key === keep) focusIdx = i;
    shelfShift = 0;
    setTransform(shelfEl, 'translateX(0px)');
    renderFocus();
    paintShelf();
  }

  // Keeps the selected tile between the side margins, sliding the shelf like Apple TV's.
  function scrollShelf() {
    var it = shelfItems[focusIdx];
    if (!it) return;
    var left = it.tile.offsetLeft;
    var width = it.tile.offsetWidth;
    var s = shelfShift;
    if (left + width + s > SHELF_VIEW) s = SHELF_VIEW - left - width;
    if (left + s < 0) s = -left;
    if (s > 0) s = 0;
    if (s !== shelfShift) {
      shelfShift = s;
      setTransform(shelfEl, 'translateX(' + s + 'px)');
      paintShelf();
    }
  }

  function renderCaption() {
    if (!captionEl) return;
    var it = shelfItems[focusIdx];
    toggleClass(captionEl, 'hide', zone !== 'shelf' || !it);
    if (!it) return;
    var title;
    var hint;
    if (it.kind === 'app') {
      title = it.item.name;
      hint = it.item.installed ? 'Press OK to open' : 'Not installed on this TV';
    } else {
      title = inputLabel(it.item.type, it.item.number);
      hint = it.item.type === 'TV' ? 'Press OK to watch' : 'Press OK to switch input';
    }
    captionEl.firstChild.textContent = title;
    captionEl.lastChild.textContent = hint;
  }

  function activate() {
    var it = shelfItems[focusIdx];
    if (!it) return;
    if (it.kind === 'app') launchApp(it.item, it.tile);
    else switchInput(it.item, it.tile);
  }

  // ---------- wallpapers ----------
  var layers = [$('wpA'), $('wpB')];
  var front = -1;
  var order = [];
  var pos = 0;
  var wpTimer = null;

  function shuffle(n) {
    var a = [];
    for (var i = 0; i < n; i++) a.push(i);
    for (var k = n - 1; k > 0; k--) {
      var r = Math.floor(Math.random() * (k + 1));
      var t = a[k]; a[k] = a[r]; a[r] = t;
    }
    return a;
  }

  function showPhoto(tries) {
    if (!photos.length) return;
    if (tries > photos.length) return;
    if (pos >= order.length) { order = shuffle(photos.length); pos = 0; }
    var p = photos[order[pos]];
    pos++;
    store('dock.photo', String(order[pos - 1]));

    var url = photoDir + p.file;
    var img = new Image();
    img.onload = function () {
      var next = front === 0 ? 1 : 0;
      layers[next].style.backgroundImage = 'url("' + url + '")';
      layers[next].className = 'wp on';
      if (front >= 0) layers[front].className = 'wp';
      var first = front < 0;
      front = next;
      buildGlassSource(img);
      paintAll(!first);
    };
    img.onerror = function () { showPhoto((tries || 0) + 1); };
    img.src = url;
  }

  function startWallpapers() {
    stopWallpapers();
    if (!photos.length) return;
    wpTimer = setInterval(function () { showPhoto(0); }, Math.max(10, settings.wallpaperSeconds || 45) * 1000);
  }
  function stopWallpapers() { if (wpTimer) clearInterval(wpTimer); wpTimer = null; }

  // ---------- network status and drop log ----------
  // Samsung Product API (webapis.network); quietly hidden when it is unavailable.
  var net = window.webapis && window.webapis.network;
  var netEl = $('net');
  var internetDown = false;
  var NETLOG_KEY = 'dock.netlog';
  var NETWATCH_KEY = 'dock.netwatch';
  var SPEED_KEY = 'dock.speed';
  var netLog = loadJson(NETLOG_KEY, []);          // [{start, end, kind, cut}]
  var netWatch = loadJson(NETWATCH_KEY, {});      // { 'YYYY-MM-DD': ms watched }
  var outage = loadJson('dock.outage', null);     // the outage in progress, if any
  var lastTick = Date.now();
  var netTimer = null;
  var KIND_TEXT = { down: 'Disconnected', router: 'Couldn\'t reach the router', internet: 'No internet' };

  function setArcs(lit) {
    for (var n = 1; n <= 4; n++) {
      var el = netEl.querySelector('.a' + n);
      if (el) el.setAttribute('class', 'arc a' + n + (n <= lit ? ' on' : ''));
    }
  }

  function netCall(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  function pruneLog() {
    var cutoff = Date.now() - 30 * 86400000;
    netLog = netLog.filter(function (e) { return e.end > cutoff; });
    if (netLog.length > 500) netLog = netLog.slice(netLog.length - 500);
    var keys = Object.keys(netWatch);
    for (var i = 0; i < keys.length; i++) {
      if (parseLocal(keys[i] + 'T23:59').getTime() < cutoff) delete netWatch[keys[i]];
    }
  }

  function endOutage(endTime, cut) {
    if (!outage) return;
    if (endTime - outage.start >= 3000) {     // ignore blips under 3 seconds
      netLog.push({ start: outage.start, end: endTime, kind: outage.kind, cut: !!cut });
      pruneLog();
      saveJson(NETLOG_KEY, netLog);
    }
    outage = null;
    saveJson('dock.outage', null);
  }

  function recordState(kind) {   // kind: null when fine, else 'down' | 'router' | 'internet'
    var now = Date.now();
    // Time watched today (only while Dock is on screen).
    var gap = now - lastTick;
    if (gap > 0 && gap < 120000) {
      var k = dayKey(new Date());
      netWatch[k] = (netWatch[k] || 0) + gap;
      saveJson(NETWATCH_KEY, netWatch);
    }
    lastTick = now;

    if (kind && !outage) {
      outage = { start: now, kind: kind };
      saveJson('dock.outage', outage);
    } else if (kind && outage && outage.kind !== kind && kind === 'down') {
      outage.kind = 'down';                     // escalate to the worse state
      saveJson('dock.outage', outage);
    } else if (!kind && outage) {
      endOutage(now, false);
    }
    renderNetSummary();
  }

  function todaysDrops() {
    var today = dayKey(new Date());
    var list = netLog.filter(function (e) { return dayKey(new Date(e.start)) === today; });
    if (outage && dayKey(new Date(outage.start)) === today) {
      list = list.concat([{ start: outage.start, end: Date.now(), kind: outage.kind, ongoing: true }]);
    }
    return list;
  }

  function renderNetSummary() {
    var el = $('netLog');
    if (settings.dropLog === false) { el.textContent = ''; return; }
    var list = todaysDrops();
    if (!list.length) { el.textContent = 'No drops today'; return; }
    var longest = 0;
    for (var i = 0; i < list.length; i++) longest = Math.max(longest, list[i].end - list[i].start);
    el.textContent = 'Dropped ' + list.length + (list.length === 1 ? ' time' : ' times') +
      ' today, longest ' + duration(longest);
  }

  function refreshNet() {
    if (!net) { netEl.style.display = 'none'; return; }
    var type = netCall(function () { return net.getActiveConnectionType(); }, -1);
    var name = $('netName');
    var state = $('netState');
    var cls = 'card glass net';
    var kind = null;
    if (type === 0) {
      setArcs(0);
      name.textContent = 'Wi-Fi';
      state.textContent = 'Disconnected';
      cls += ' down';
      kind = 'down';
    } else if (type === 3) {
      setArcs(4);
      name.textContent = 'Wired network';
      state.textContent = internetDown ? 'No internet' : 'Connected';
      if (internetDown) { cls += ' limited'; kind = 'internet'; }
    } else {
      var ssid = netCall(function () { return net.getWiFiSsid(); }, '');
      var level = netCall(function () { return net.getWiFiSignalStrengthLevel(); }, 3);
      var gateway = netCall(function () { return net.isConnectedToGateway(); }, true);
      setArcs(Math.max(1, Math.min(4, Math.ceil(level * 4 / 5))));
      name.textContent = ssid || 'Wi-Fi';
      if (!gateway) {
        state.textContent = 'No router';
        cls += ' limited';
        kind = 'router';
      } else if (internetDown) {
        state.textContent = 'No internet';
        cls += ' limited';
        kind = 'internet';
      } else {
        state.textContent = 'Connected';
      }
    }
    if (zone === 'net') cls += ' focused';
    netEl.className = cls;
    recordState(kind);
    if (widgetMode === 'net') layoutIdleCard(netEl);
    paintGlass(netEl, false, true);
    // Check every 3 seconds while there is a problem, every 10 seconds otherwise.
    clearTimeout(netTimer);
    netTimer = setTimeout(refreshNet, kind ? 3000 : 10000);
  }

  function startNet() {
    if (!net) { netEl.style.display = 'none'; return; }
    // An outage left open when Dock was closed: close it at the last time Dock saw it.
    if (outage && Date.now() - outage.start > 0) {
      var lastSeen = loadJson('dock.lastseen', outage.start);
      endOutage(Math.max(outage.start, lastSeen), true);
    }
    try {
      net.addNetworkStateChangeListener(function (s) {
        if (s === 9) internetDown = true;    // INTERNET_DISCONNECTED
        if (s === 0) internetDown = false;   // INTERNET_CONNECTED
        refreshNet();
      });
    } catch (e) { /* polling still works */ }
    lastTick = Date.now();
    refreshNet();
  }

  setInterval(function () { saveJson('dock.lastseen', Date.now()); }, 15000);

  // ---------- network panel: drop history + speed check ----------
  var speeds = loadJson(SPEED_KEY, []);   // [{t, mbps, ping}]
  var speedRunning = false;
  var panelScroll = 0;

  function renderPanel() {
    var list = $('panelList');
    list.innerHTML = '';
    var events = netLog.slice();
    if (outage) events.push({ start: outage.start, end: Date.now(), kind: outage.kind, ongoing: true });
    events.sort(function (a, b) { return b.start - a.start; });
    var weekAgo = Date.now() - 7 * 86400000;
    events = events.filter(function (e) { return e.start > weekAgo; });

    var today = dayKey(new Date());
    $('panelWatched').textContent = 'Dock has been watching the connection for ' +
      duration(netWatch[today] || 0) + ' today. Drops while another app is open aren\'t seen.';

    if (!events.length) {
      var empty = document.createElement('div');
      empty.className = 'p-empty';
      empty.textContent = 'No drops in the last 7 days.';
      list.appendChild(empty);
    }
    var lastDay = '';
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      var d = new Date(e.start);
      var dk = dayKey(d);
      if (dk !== lastDay) {
        var head = document.createElement('div');
        head.className = 'p-day';
        head.textContent = (dk === today ? 'Today' : DAYS_SHORT[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()]);
        list.appendChild(head);
        lastDay = dk;
      }
      var row = document.createElement('div');
      row.className = 'p-row';
      row.innerHTML = '<span class="p-when"></span><span class="p-kind"></span><span class="p-len"></span>';
      row.querySelector('.p-when').textContent = hhmm(d) + ' to ' + (e.ongoing ? 'now' : hhmm(new Date(e.end)));
      row.querySelector('.p-kind').textContent = KIND_TEXT[e.kind] || 'Disconnected';
      row.querySelector('.p-len').textContent = duration(e.end - e.start) + (e.cut ? '+' : '');
      list.appendChild(row);
    }
    list.style.marginTop = -panelScroll + 'px';
    renderSpeeds();
  }

  function renderSpeeds() {
    var el = $('speedList');
    el.innerHTML = '';
    var recent = speeds.slice(-4).reverse();
    if (!recent.length) {
      el.textContent = 'No speed checks yet.';
      return;
    }
    for (var i = 0; i < recent.length; i++) {
      var s = recent[i];
      var d = new Date(s.t);
      var row = document.createElement('div');
      row.className = 's-row';
      var when = document.createElement('span');
      when.className = 's-when';
      when.textContent = dayKey(d) === dayKey(new Date()) ? hhmm(d) : DAYS_SHORT[d.getDay()] + ' ' + hhmm(d);
      var what = document.createElement('span');
      what.className = 's-what';
      if (s.error) {
        what.textContent = s.error;
      } else {
        what.innerHTML = '<b></b> Mbps<i></i>';
        what.firstChild.textContent = s.mbps >= 100 ? Math.round(s.mbps) : s.mbps.toFixed(1);
        what.lastChild.textContent = s.ping + ' ms';
      }
      row.appendChild(when);
      row.appendChild(what);
      el.appendChild(row);
    }
  }

  // Measures the TV's own download speed against Cloudflare's speed test server.
  function runSpeedTest() {
    if (speedRunning) return;
    speedRunning = true;
    var btn = $('speedBtn');
    addClass(btn, 'busy');
    btn.textContent = 'Checking ping\u2026';
    var pings = [];
    var base = 'https://speed.cloudflare.com/__down?bytes=';

    var finish = function (result) {
      speedRunning = false;
      removeClass(btn, 'busy');
      btn.textContent = 'Check speed again';
      result.t = Date.now();
      speeds.push(result);
      if (speeds.length > 50) speeds = speeds.slice(-50);
      saveJson(SPEED_KEY, speeds);
      renderSpeeds();
    };

    var ping = function (n) {
      if (n === 0) {
        pings.sort(function (a, b) { return a - b; });
        download(pings.length ? Math.round(pings[Math.floor(pings.length / 2)]) : null);
        return;
      }
      var t0 = Date.now();
      var x = new XMLHttpRequest();
      x.open('GET', base + '0&r=' + Math.random(), true);
      x.timeout = 5000;
      x.onload = function () { pings.push(Date.now() - t0); ping(n - 1); };
      x.onerror = x.ontimeout = function () { ping(n - 1); };
      x.send();
    };

    var download = function (pingMs) {
      if (pingMs === null) { finish({ error: 'Couldn\'t reach the test server' }); return; }
      btn.textContent = 'Checking download speed\u2026';
      var bytes = 15000000;
      var x = new XMLHttpRequest();
      x.open('GET', base + bytes + '&r=' + Math.random(), true);
      x.responseType = 'arraybuffer';
      x.timeout = 40000;
      var t0 = 0;
      var got = 0;
      x.onprogress = function (ev) { if (!t0) t0 = Date.now(); got = ev.loaded; };
      x.onload = function () {
        var secs = Math.max(0.2, (Date.now() - (t0 || Date.now())) / 1000);
        var size = (x.response && x.response.byteLength) || got || bytes;
        finish({ mbps: size * 8 / secs / 1e6, ping: pingMs });
      };
      x.ontimeout = function () {
        var secs = (Date.now() - t0) / 1000;
        if (t0 && got > 1000000) finish({ mbps: got * 8 / secs / 1e6, ping: pingMs });
        else finish({ error: 'Too slow to measure' });
      };
      x.onerror = function () { finish({ error: 'Download failed' }); };
      x.send();
    };

    ping(5);
  }

  function openPanel() {
    panelScroll = 0;
    renderPanel();
    addClass(body, 'panel-open');
    paintGlass($('sheet'), false, false);
    zone = 'panel';
    renderFocus();
  }
  function closePanel() {
    removeClass(body, 'panel-open');
    zone = widgetMode === 'net' ? 'net' : 'shelf';
    renderFocus();
  }

  // ---------- Spotify / Wi-Fi switcher and weather toggle ----------
  // Weather has its own key (8). Key 6 cycles the one card below it: Spotify, Wi-Fi, off.
  var widgetSwitchEl = $('widgetSwitch');

  function widgetOrder() {
    var order = [];
    if (spotifyReady) order.push('spotify');
    if (net) order.push('net');
    order.push('off');
    return order;
  }

  function normalizeWidgetMode(mode) {
    var order = widgetOrder();
    if (order.indexOf(mode) < 0) mode = spotifyReady ? 'spotify' : (net ? 'net' : 'off');
    return mode;
  }

  var widgetMode = normalizeWidgetMode(store('dock.widgetMode'));

  function activeWidgetEl() {
    if (widgetMode === 'spotify') return spotifyEl;
    if (widgetMode === 'net') return netEl;
    return null;
  }

  function setWidgetMode(mode, say) {
    mode = normalizeWidgetMode(mode);
    setTransform(spotifyEl, '');
    setTransform(netEl, '');
    widgetMode = mode;
    store('dock.widgetMode', mode);

    var showSpotify = mode === 'spotify';
    var showNet = mode === 'net';
    widgetSwitchEl.style.display = showSpotify || showNet ? '' : 'none';
    toggleClass(widgetSwitchEl, 'off', !showSpotify && !showNet);
    spotifyEl.style.display = showSpotify ? '' : 'none';
    netEl.style.display = showNet ? '' : 'none';

    if (zone === 'spotify' || zone === 'net') {
      zone = showSpotify ? 'spotify' : (showNet ? 'net' : 'shelf');
    }
    if (showSpotify) paintGlass(spotifyEl, false, true);
    if (showNet) refreshNet();
    renderFocus();

    if (hasClass(body, 'idle')) {
      var el = activeWidgetEl();
      if (el) layoutIdleCard(el);
      scheduleCardPaint();
    }
    if (say) {
      toast(showSpotify ? 'Spotify card' : (showNet ? 'Wi-Fi card' : 'Spotify and Wi-Fi hidden'));
    }
  }

  function setWeather(show, say) {
    if (weatherConfig.enabled === false) {
      if (say) toast('Weather is disabled in settings');
      return;
    }
    weatherOn = !!show;
    store('dock.weatherCard', weatherOn ? 'on' : 'off');
    if (weatherOn) {
      renderWeather(loadJson(WX_KEY, null));
      fetchWeather();
    } else {
      $('weather').style.display = 'none';
    }
    if (say) toast(weatherOn ? 'Weather card shown' : 'Weather card hidden');
  }

  // ---------- focus across the screen ----------
  // Zones: 'shelf' (apps and inputs), 'net' (the Wi-Fi card), 'spotify' (music card),
  // 'panel' (connection history).
  var zone = 'shelf';

  function renderFocus() {
    for (var i = 0; i < shelfItems.length; i++) {
      toggleClass(shelfItems[i].tile, 'focused', zone === 'shelf' && i === focusIdx);
    }
    var netFocused = zone === 'net' && widgetMode === 'net';
    if (hasClass(netEl, 'focused') !== netFocused) {
      toggleClass(netEl, 'focused', netFocused);
      paintGlass(netEl, false, true);
    }
    var spFocused = zone === 'spotify' && widgetMode === 'spotify';
    if (hasClass(spotifyEl, 'focused') !== spFocused) {
      toggleClass(spotifyEl, 'focused', spFocused);
      paintGlass(spotifyEl, false, true);
      if (netEl) paintGlass(netEl, false, true);   // the card below moves when the hint opens
    }
    scrollShelf();
    renderCaption();
  }

  // ---------- idle: the ambient screen ----------
  var idleTimer = null;
  var cardPaintTimer = null;

  // The element's layout position, before any ambient slide transform.
  function baseTop(el) {
    return el.getBoundingClientRect().top - translateY(el);
  }

  // Ambient placement: the card's bottom edge sits at the bottom margin (40px)
  // but stays at its own horizontal margin.
  function layoutIdleCard(el) {
    if (!el || !el.offsetHeight) return;
    var h = el.getBoundingClientRect().height || el.offsetHeight;
    var shift = Math.max(0, (1080 - 40 - h) - baseTop(el));
    var changed = el.idleShift !== shift;
    el.idleShift = shift;
    if (!hasClass(body, 'idle')) return;
    setTransform(el, 'translateY(' + shift + 'px)');
    if (changed) scheduleCardPaint();
  }

  // Once a slide finishes, redraw the glass against the photo at its new place.
  function scheduleCardPaint() {
    clearTimeout(cardPaintTimer);
    cardPaintTimer = setTimeout(function () {
      paintGlass(busEl, false, false);
      paintGlass(prayerEl, false, false);
      var el = activeWidgetEl();
      if (el) paintGlass(el, false, false);
    }, 680);
  }

  function goIdle() {
    clearTimeout(idleTimer);
    idleTimer = null;
    if (zone === 'panel') closePanel();
    zone = 'shelf';
    renderFocus();
    addClass(body, 'idle');
    layoutIdleCard(busEl);
    layoutIdleCard(prayerEl);
    var el = activeWidgetEl();
    if (el) layoutIdleCard(el);
    scheduleCardPaint();
  }

  function wake() {
    var wasIdle = hasClass(body, 'idle');
    removeClass(body, 'idle');
    if (wasIdle) {
      setTransform(busEl, '');
      setTransform(prayerEl, '');
      setTransform(spotifyEl, '');
      setTransform(netEl, '');
      scheduleCardPaint();
    }
    clearTimeout(idleTimer);
    if (settings.idleMinutes > 0) {
      idleTimer = setTimeout(goIdle, settings.idleMinutes * 60000);
    }
    return wasIdle;
  }

  // Keep the TV's own screensaver away while Dock is showing.
  function keepScreenOn(on) {
    try {
      var ac = window.webapis && window.webapis.appcommon;
      if (ac && ac.setScreenSaver) {
        ac.setScreenSaver(on ? ac.AppCommonScreenSaverState.SCREEN_SAVER_OFF : ac.AppCommonScreenSaverState.SCREEN_SAVER_ON);
      }
    } catch (e) { /* not available on this TV */ }
  }

  // ---------- keys ----------
  document.addEventListener('keydown', function (e) {
    if (wake()) { e.preventDefault(); return; } // first press only wakes the screen
    var k = e.keyCode;
    if (settings.keyDebug) toast('Key code ' + k);
    if (spotifyPlayerOpen) {
      // The player page handles its own keys when it has focus; this covers Back if the
      // parent still receives it, and stops the dock behind the overlay from reacting.
      if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) {
        e.preventDefault();
        closeSpotifyPlayer();
      }
      return;
    }
    if ((k >= 48 && k <= 57) || (k >= 96 && k <= 105)) {
      e.preventDefault();
      numberKey(k >= 96 ? k - 96 : k - 48);
      return;
    }
    if (k === KEY.BACK || k === KEY.ESC || k === KEY.BACKSPACE) {
      e.preventDefault();
      if (zone === 'panel') { closePanel(); return; }
      if (zone !== 'shelf') { zone = 'shelf'; renderFocus(); return; }
      if (hasTizen) {
        try { window.tizen.application.getCurrentApplication().exit(); } catch (err) { /* stay open */ }
      }
      return;
    }
    if ([KEY.LEFT, KEY.RIGHT, KEY.UP, KEY.DOWN, KEY.ENTER].indexOf(k) >= 0) e.preventDefault();

    if (zone === 'panel') {
      if (k === KEY.ENTER) runSpeedTest();
      if (k === KEY.DOWN) { panelScroll = Math.min(panelScroll + 120, Math.max(0, $('panelList').scrollHeight - 480)); renderPanel(); }
      if (k === KEY.UP) { panelScroll = Math.max(0, panelScroll - 120); renderPanel(); }
      return;
    }
    if (zone === 'spotify') {
      if (k === KEY.ENTER) spotifyToggle();
      else if (k === KEY.LEFT) spotifyPrevious();
      else if (k === KEY.RIGHT) spotifyNext();
      else if (k === KEY.UP) spotifyPlayPlaylist();
      else if (k === KEY.DOWN) { zone = 'shelf'; renderFocus(); }
      return;
    }
    if (zone === 'net') {
      if (k === KEY.ENTER) openPanel();
      if (k === KEY.UP || k === KEY.DOWN) { zone = 'shelf'; renderFocus(); }
      return;
    }
    // shelf
    if (k === KEY.ENTER) { activate(); return; }
    if (k === KEY.LEFT && focusIdx > 0) focusIdx--;
    else if (k === KEY.RIGHT && focusIdx < shelfItems.length - 1) focusIdx++;
    else if (k === KEY.UP && widgetMode !== 'off') zone = widgetMode;
    else return;
    if (shelfItems[focusIdx]) store('dock.focusKey', shelfItems[focusIdx].key);
    renderFocus();
  });

  // Coming back from Netflix and friends: refresh straight away.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stopWallpapers();
      stopSpotify();
      clearTimeout(idleTimer);
      clearTimeout(netTimer);
      if (outage) endOutage(Date.now(), true);
      keepScreenOn(false);
    } else {
      lastTick = Date.now();
      tickClock();
      refreshNet();
      fetchWeather();
      wake();
      checkNight();
      busTick();
      prayerTick();
      showPhoto(0);
      startWallpapers();
      startSpotify();
      if (spotifyReady) { startSpotifyPlayer(); spotifyPlayerToken(); }
      keepScreenOn(true);
    }
  });

  // ---------- night mode: dimmer screen and calmer photos ----------
  // The TV's backlight can't be changed from an app, so Dock lays a black veil over the whole
  // screen. Level 1 is the darkest, level 4 the lightest.
  var NIGHT_ALPHA = { 1: 0.72, 2: 0.58, 3: 0.44, 4: 0.3 };
  var isNight = false;
  var started = false;
  var lastSched = null;     // whether the schedule said "night" last time we looked
  var manualDim = null;     // null = follow the schedule; true/false = chosen with the remote
  var lvl = parseInt(store('dock.level'), 10);
  var dimLevel = Math.max(1, Math.min(4, Math.round(lvl || +nightConfig.level || 2)));

  function minutesOf(s, fallback) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
    return m ? (+m[1]) * 60 + (+m[2]) : fallback;
  }
  // True when "now" is between from and to (minutes after midnight); works across midnight.
  function inWindow(from, to, d) {
    var now = d.getHours() * 60 + d.getMinutes();
    if (from === to) return false;
    return from < to ? (now >= from && now < to) : (now >= from || now < to);
  }

  function checkNight() {
    var sched = !!nightConfig.enabled &&
      inWindow(minutesOf(nightConfig.from, 1320), minutesOf(nightConfig.to, 420), new Date());
    if (sched !== lastSched) { manualDim = null; lastSched = sched; }   // a remote choice lasts until the schedule changes
    var on = manualDim === null ? sched : manualDim;
    $('dim').style.opacity = on ? String(NIGHT_ALPHA[dimLevel]) : '0';
    if (on === isNight) return;
    isNight = on;
    toggleClass(body, 'night', on);
    var useNight = on && nightPhotos.length > 0;
    var want = useNight ? nightPhotos : dayPhotos;
    var dir = useNight ? 'wallpapers-night/' : 'wallpapers/';
    if (want === photos && dir === photoDir) return;
    photos = want;
    photoDir = dir;
    if (started) { order = shuffle(photos.length); pos = 0; showPhoto(0); }
  }

  // ---------- morning bus times (TfL, no account needed) ----------
  var busEl = $('bus');
  var busData = null;       // { t: when fetched, list: [{ dest, secs }] }
  var busFailed = false;

  // The card under the clock: bus times, prayer times, or nothing. Key 5 steps through them
  // (bus, prayer, off); in the morning window the bus card shows by itself.
  var cardMode = null;      // null = follow the schedule; 'bus' | 'prayer' | 'off' = chosen with the remote
  var lastBusSched = null;

  function busCan() { return !!busConfig.enabled && !!busConfig.stopId; }
  function prayerCan() { return !!prayerConfig.enabled; }

  function activeCard() {
    var sched = busCan() && inWindow(minutesOf(busConfig.from, 300), minutesOf(busConfig.to, 600), new Date());
    if (sched !== lastBusSched) { cardMode = null; lastBusSched = sched; }   // a remote choice lasts until the schedule changes
    var mode = cardMode === null ? (sched ? 'bus' : 'off') : cardMode;
    if (mode === 'bus' && !busCan()) mode = 'off';
    if (mode === 'prayer' && !prayerCan()) mode = 'off';
    return mode;
  }
  function busActive() { return activeCard() === 'bus'; }
  function prayerActive() { return activeCard() === 'prayer'; }

  function renderBus() {
    if (!busActive()) { busEl.style.display = 'none'; return; }
    var line = String(busConfig.line || '');
    busEl.style.display = '';
    $('busLine').textContent = line;
    $('busStop').textContent = (busConfig.stopName || '') + (busConfig.stop ? ', ' + busConfig.stop : '');
    var list = $('busList');
    list.innerHTML = '';

    var rows = [];
    if (busData) {
      for (var i = 0; i < busData.list.length; i++) {
        var left = (busData.list[i].at - Date.now()) / 1000;    // seconds until it is expected
        if (left > -45) rows.push({ dest: busData.list[i].dest, left: left });
      }
      rows.sort(function (a, b) { return a.left - b.left; });
      rows = rows.slice(0, 2);
    }
    for (var k = 0; k < rows.length; k++) {
      var row = document.createElement('div');
      row.className = 'bus-row';
      row.innerHTML = '<span class="bus-dest"></span><span class="bus-eta"></span>';
      row.firstChild.textContent = rows[k].dest;
      row.lastChild.innerHTML = rows[k].left < 60 ? 'Due' : '<b></b><small>min</small>';
      if (rows[k].left >= 60) row.lastChild.firstChild.textContent = String(Math.floor(rows[k].left / 60));
      list.appendChild(row);
    }
    if (!rows.length) {
      var msg = document.createElement('div');
      msg.className = 'bus-msg';
      msg.textContent = busData ? 'No ' + line + ' due soon' :
        (busFailed ? 'Can\'t reach TfL right now' : 'Checking buses\u2026');
      list.appendChild(msg);
    }
    if (busData && busFailed) {
      var note = document.createElement('div');
      note.className = 'bus-note';
      note.textContent = 'Last updated ' + hhmm(new Date(busData.t));
      list.appendChild(note);
    }
    layoutIdleCard(busEl);
    paintGlass(busEl, false, true);
  }

  // Always asks TfL for fresh data: a unique address each time, so neither the TV's own cache
  // nor TfL's 30-second cache can hand back an old answer. Times come from the bus's expected
  // arrival moment, so they stay right between updates.
  function fetchBus(plain) {
    var url = 'https://api.tfl.gov.uk/StopPoint/' + encodeURIComponent(busConfig.stopId) + '/Arrivals' +
      (plain ? '' : '?_=' + Date.now());
    getJson(url, 8000, function (data) {
      var out = [];
      var now = Date.now();
      for (var i = 0; i < (data || []).length; i++) {
        var a = data[i];
        if (String(a.lineName) === String(busConfig.line)) {
          var at = Date.parse(a.expectedArrival);
          if (isNaN(at)) at = now + (a.timeToStation || 0) * 1000;
          out.push({ dest: a.destinationName || a.towards || '', at: at });
        }
      }
      busData = { t: now, list: out };
      busFailed = false;
      renderBus();
    }, function () {
      if (!plain) { fetchBus(true); return; }     // in case TfL refuses the extra bit on the address
      busFailed = true;
      renderBus();
    });
  }

  function busTick() {
    if (document.hidden || !busActive()) { renderBus(); return; }
    fetchBus();
    renderBus();
  }
  setInterval(busTick, 10000);                        // ask TfL every 10 seconds
  setInterval(function () { if (!document.hidden) renderBus(); }, 5000);   // and keep the countdown moving

  // ---------- prayer times (Aladhan, asked once a day) ----------
  // Times come from the Aladhan API for the place and method chosen in the app.
  var PRAYERS = [
    { id: 'Fajr', short: 'FAJR', full: 'Fajr' },
    { id: 'Dhuhr', short: 'DHUHR', full: 'Dhuhr' },
    { id: 'Asr', short: 'ASR', full: 'Asr' },
    { id: 'Maghrib', short: 'MAGH', full: 'Maghrib' },
    { id: 'Isha', short: 'ISHA', full: 'Isha' }
  ];
  var PRAYER_KEY = 'dock.prayer';
  var prayerEl = $('prayer');
  var prayerData = loadJson(PRAYER_KEY, null);    // { day, today: {Fajr: '06:01', ...}, tomorrow: {...} }
  var prayerTry = 0;                               // when we last asked, so a failure retries gently
  var prayerBusy = false;

  function prayerUrl(d) {
    return 'https://api.aladhan.com/v1/timings/' + pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear() +
      '?latitude=' + (prayerConfig.latitude || 51.4023) + '&longitude=' + (prayerConfig.longitude || -0.1948) +
      '&method=' + (prayerConfig.method === undefined ? 15 : prayerConfig.method) + '&school=' + (prayerConfig.school === undefined ? 1 : prayerConfig.school) +
      (prayerConfig.tune ? '&tune=' + encodeURIComponent(prayerConfig.tune) : '') +
      '&timezonestring=' + encodeURIComponent(prayerConfig.timezone || 'Europe/London');
  }

  function pickTimes(json) {
    var t = json && json.data && json.data.timings;
    if (!t) return null;
    var out = {};
    for (var i = 0; i < PRAYERS.length; i++) {
      var m = /(\d{1,2}):(\d{2})/.exec(t[PRAYERS[i].id] || '');
      if (!m) return null;
      out[PRAYERS[i].id] = pad(+m[1]) + ':' + m[2];
    }
    return out;
  }

  // Today's and tomorrow's times, two requests, at most once per day (retried every 30 minutes if it fails).
  function fetchPrayer() {
    if (!prayerCan() || prayerBusy) return;
    var now = new Date();
    var today = dayKey(now);
    if (prayerData && prayerData.day === today) return;
    if (Date.now() - prayerTry < 30 * 60000) return;
    prayerTry = Date.now();
    prayerBusy = true;
    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var got = {};
    var done = function () {
      if (got.today && got.tomorrow) {
        prayerData = { day: today, today: got.today, tomorrow: got.tomorrow };
        saveJson(PRAYER_KEY, prayerData);
      }
      prayerBusy = false;
      renderPrayer();
    };
    var pending = 2;
    var finish = function () { pending--; if (pending === 0) done(); };
    getJson(prayerUrl(now), 10000, function (j) { got.today = pickTimes(j); finish(); }, finish);
    getJson(prayerUrl(tomorrow), 10000, function (j) { got.tomorrow = pickTimes(j); finish(); }, finish);
  }

  // The times for today, or yesterday's "tomorrow" if today's could not be fetched yet.
  function prayerToday() {
    if (!prayerData) return null;
    var now = new Date();
    if (prayerData.day === dayKey(now)) return { today: prayerData.today, tomorrow: prayerData.tomorrow };
    var yest = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (prayerData.day === dayKey(yest)) return { today: prayerData.tomorrow, tomorrow: null };
    return null;
  }

  function atTime(base, hhmmText, addDays) {
    var m = /(\d{2}):(\d{2})/.exec(hhmmText);
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + (addDays || 0), +m[1], +m[2], 0).getTime();
  }

  function renderPrayer() {
    if (!prayerActive()) { prayerEl.style.display = 'none'; return; }
    prayerEl.style.display = '';
    var data = prayerToday();
    var count = $('prCount');
    var row = $('prRow');
    row.innerHTML = '';
    if (!data) {
      count.innerHTML = '';
      count.textContent = prayerBusy || !prayerTry ? 'Getting prayer times\u2026' : 'Can\'t reach the prayer times service';
      layoutIdleCard(prayerEl);
      paintGlass(prayerEl, false, true);
      return;
    }
    var now = new Date();
    var nowMs = now.getTime();
    var next = -1;
    for (var i = 0; i < PRAYERS.length; i++) {
      if (atTime(now, data.today[PRAYERS[i].id]) > nowMs) { next = i; break; }
    }
    var target = null;
    if (next >= 0) target = atTime(now, data.today[PRAYERS[next].id]);
    else if (data.tomorrow) { next = 0; target = atTime(now, data.tomorrow.Fajr, 1); }

    if (target !== null) {
      var mins = Math.max(1, Math.ceil((target - nowMs) / 60000));
      var h = Math.floor(mins / 60);
      var m = mins % 60;
      count.innerHTML = '<b></b> <span></span>';
      count.firstChild.textContent = h > 0 ? h + 'h ' + pad(m) + 'm' : m + ' min';
      count.lastChild.textContent = 'to ' + PRAYERS[next].full;
    } else {
      count.textContent = 'Prayer times';
    }
    for (var k = 0; k < PRAYERS.length; k++) {
      var cell = document.createElement('div');
      cell.className = 'pr-cell' + (k === next ? ' next' : '');
      cell.innerHTML = '<div class="pr-name"></div><div class="pr-time"></div>';
      cell.firstChild.textContent = PRAYERS[k].short;
      var useTomorrow = next === 0 && target !== null && atTime(now, data.today.Fajr) <= nowMs && k === 0 && data.tomorrow;
      cell.lastChild.textContent = useTomorrow ? data.tomorrow.Fajr : data.today[PRAYERS[k].id];
      row.appendChild(cell);
    }
    $('prPlace').textContent = (prayerConfig.place || '');
    layoutIdleCard(prayerEl);
    paintGlass(prayerEl, false, true);
  }

  function prayerTick() {
    if (prayerActive() || prayerData === null || prayerData.day !== dayKey(new Date())) fetchPrayer();
    renderPrayer();
  }
  setInterval(function () { if (!document.hidden) prayerTick(); }, 10000);

  // ---------- number keys on the remote ----------
  // 1-4 night brightness (1 darkest), 0 full brightness, 5 bus/prayer/off card,
  // 6 Spotify/Wi-Fi/off card, 7 the ambient screen, 8 the weather card,
  // 9 the Spotify player status screen.
  function numberKey(n) {
    if (n >= 1 && n <= 4) {
      dimLevel = n;
      store('dock.level', String(n));
      manualDim = true;
      checkNight();
      toast('Brightness ' + n + ' of 4');
    } else if (n === 0) {
      manualDim = false;
      checkNight();
      toast('Full brightness');
    } else if (n === 7) {
      if (zone !== 'panel') goIdle();
    } else if (n === 6) {
      if (zone !== 'panel') {
        var order = widgetOrder();
        setWidgetMode(order[(order.indexOf(widgetMode) + 1) % order.length], true);
      }
    } else if (n === 8) {
      if (zone !== 'panel') setWeather(!weatherOn, true);
    } else if (n === 5) {
      // bus -> prayer times -> off -> bus ...
      var cur = activeCard();
      var cardOrder = [];
      if (busCan()) cardOrder.push('bus');
      if (prayerCan()) cardOrder.push('prayer');
      cardOrder.push('off');
      var nxt = cardOrder[(cardOrder.indexOf(cur) + 1) % cardOrder.length];
      cardMode = nxt;
      toast(nxt === 'bus' ? 'Bus times' : nxt === 'prayer' ? 'Prayer times' : 'Card hidden');
      renderBus();
      if (nxt === 'bus') busTick();
      prayerTick();
    } else if (n === 9) {
      openSpotifyPlayer();
    }
  }

  // ---------- start ----------
  checkNight();
  document.documentElement.style.setProperty('--fade', fadeMs + 'ms');
  if (!photos.length) addClass(body, 'no-photos');
  if (!glassOn) addClass(body, 'no-glass');

  tickClock();
  if (!photos.length) { buildGlassSource(null); }
  order = shuffle(photos.length);
  var last = parseInt(store('dock.photo'), 10);
  if (!isNaN(last) && photos.length > 1 && order[0] === last) { order.push(order.shift()); }
  showPhoto(0);
  startWallpapers();
  startWeather();
  startNet();
  if (spotifyReady) startSpotify();
  setWidgetMode(widgetMode, false);
  if (spotifyReady) startSpotifyPlayer();
  busTick();
  prayerTick();
  keepScreenOn(true);
  wake();
  started = true;
  // Ask the TV to pass the number keys to Dock.
  // (needs the tv.inputdevice privilege in config.xml, otherwise every call is refused)
  var keyProblems = [];
  for (var nk = 0; nk <= 9; nk++) {
    try { window.tizen.tvinputdevice.registerKey(String(nk)); } catch (e) { keyProblems.push(nk + ':' + (e && e.name)); }
  }
  if (settings.keyDebug && keyProblems.length) toast('Number keys refused: ' + keyProblems.join(' '));

  // Build the shelf once apps and inputs are known (inputs get 1.5 s, then join later).
  var appsDone = false;
  var inputsDone = false;
  var waited = false;
  var inputsWait = setTimeout(function () {
    waited = true;
    if (appsDone && !inputsDone) buildShelf();
  }, 1500);
  resolveApps(function (resolved) {
    apps = resolved;
    appsDone = true;
    if (inputsDone || waited) buildShelf();
  });
  resolveInputs(function (list) {
    inputs = list;
    inputsDone = true;
    clearTimeout(inputsWait);
    if (appsDone) buildShelf();
  });
})();
