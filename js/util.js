// ============================================================
// UTILS
// ============================================================
var LG = window.LG = window.LG || {};
LG.Util = (function () {
  var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  // guarded debug logger: silent unless BLOCKOUT_DEBUG is set before load
  LG.DBG = {
    on: !!(window && window.BLOCKOUT_DEBUG),
    log: function (m) { if (LG.DBG.on && window.console) window.console.log(m); },
  };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var lerpClamp = function (a, b, t) { t = clamp(t, 0, 1); return a + (b - a) * t; };
  var rand = function () { return Math.random(); };
  var randRange = function (a, b) { return a + Math.random() * (b - a); };
  var randInt = function (a, b) { return Math.floor(randRange(a, b + 1)); };
  var choose = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  var dist2 = function (ax, az, bx, bz) { var dx = bx - ax, dz = bz - az; return dx * dx + dz * dz; };
  var dist = function (ax, az, bx, bz) { return Math.sqrt(dist2(ax, az, bx, bz)); };
  var angleLerp = function (a, b, t) {
    var d = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    return a + d * clamp(t, 0, 1);
  };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  var easeInOut = function (t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
  var now = function () { return performance.now() / 1000; };
  var sign = function (v) { return v < 0 ? -1 : 1; };
  var fmtTime = function (s) {
    s = Math.max(0, Math.ceil(s));
    var m = Math.floor(s / 60), sec = s % 60;
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  };
  var fmtMoney = function (n) { return (Math.round(n)).toLocaleString(); };
  return {
    clamp: clamp, lerp: lerp, lerpClamp: lerpClamp,
    rand: rand, randRange: randRange, randInt: randInt, choose: choose,
    dist2: dist2, dist: dist, angleLerp: angleLerp,
    easeOut: easeOut, easeInOut: easeInOut, now: now, sign: sign,
    fmtTime: fmtTime, fmtMoney: fmtMoney,
  };
})();

// ------------------------------------------------------------------
// tiny event emitter
// ------------------------------------------------------------------
LG.Events = function () {
  this._m = {};
};
LG.Events.prototype.on = function (ev, fn) {
  (this._m[ev] = this._m[ev] || []).push(fn);
  return this;
};
LG.Events.prototype.off = function (ev, fn) {
  var l = this._m[ev];
  if (!l) return this;
  var i = l.indexOf(fn);
  if (i >= 0) l.splice(i, 1);
  return this;
};
LG.Events.prototype.emit = function (ev, data) {
  var l = this._m[ev];
  if (l) for (var i = 0; i < l.length; i++) l[i](data);
  return this;
};

LG.eventBus = new LG.Events();

// ------------------------------------------------------------------
// canvas textures
// ------------------------------------------------------------------
LG.Util.makeCanvasTexture = function (draw, w, h) {
  w = w || 256; h = h || 256;
  var c = document.createElement('canvas');
  c.width = w; c.height = h;
  var g = c.getContext('2d');
  draw(g, w, h);
  var t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
};