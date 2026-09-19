// ============================================================
// COURTS — pitch backdrop selection.
// The courts/ folder holds street-court art (best.png, 1.png,
// 2.png ...). This module probes the folder at runtime, keeps the
// chosen court in localStorage, and hands the arena a THREE.js
// texture for the pitch slab whenever a custom court is active.
//   - robust: no localStorage / no Image / headless -> procedural
//   - future-proof: dropping court7.png into courts/ just works
// ============================================================
var LG = window.LG = window.LG || {};

LG.Courts = (function () {
  var KEY = 'blockout.court.v1';
  var hasStorage = false;

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('__bo_test__', '1');
      localStorage.removeItem('__bo_test__');
      hasStorage = true;
    }
  } catch (e) { /* no storage (private mode / headless) */ }

  // ------------------------------------------------------------
  // candidate courts.  Numeric files (1.png ...) + a few named
  // ones (best.png).  Probing handles any missing files.
  // ------------------------------------------------------------
  var defs = [];
  var i;
  for (i = 1; i <= 24; i++) {
    defs.push({ id: 'court' + i, file: i + '.png', name: 'COURT ' + i });
  }
  for (i = 1; i <= 8; i++) {
    defs.push({ id: 'court' + i, file: 'court' + i + '.png', name: 'COURT ' + i });
  }
  defs.push({ id: 'best', file: 'best.png', name: 'MAIN COURT' });

  // dedupe by id (1.png + court1.png both probe id court1)
  var seen = {};
  defs = defs.filter(function (d) { if (seen[d.id]) return false; seen[d.id] = 1; return true; });

  var loaded = {};        // id -> true  once the file is known to exist
  var selected = null;    // chosen id ('' = procedural)

  function load() {
    if (!hasStorage) return;
    try {
      var raw = localStorage.getItem(KEY);
      if (raw !== null && raw !== undefined) selected = raw;
    } catch (e) { /* ignore */ }
  }
  function save() {
    if (!hasStorage) return;
    try { localStorage.setItem(KEY, selected); } catch (e) { /* ignore */ }
  }

  load();

  function get(id) {
    for (var i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i];
    return null;
  }

  // Asynchronous existence probe.  Uses a real Image so the browser
  // tells us which files are actually present; every other env is a
  // no-op (the caller falls back to the procedural pitch).
  function probe(def, cb) {
    if (typeof Image === 'undefined') { if (cb) cb(false); return; }
    try {
      var img = new Image();
      img.onload = function () {
        if (img.naturalWidth > 0) {
          loaded[def.id] = def;
          def.w = img.naturalWidth;
          def.h = img.naturalHeight;
          if (cb) cb(true);
        } else if (cb) cb(false);
      };
      img.onerror = function () { if (cb) cb(false); };
      img.src = 'courts/' + def.file;
    } catch (e) { if (cb) cb(false); }
  }

  function probeAll(cb) {
    var pending = defs.length, done = function () { if (--pending <= 0 && cb) cb(); };
    defs.forEach(function (d) { probe(d, done); });
    if (!pending) cb && cb();
  }

  // ordered, actually-available courts (best first, then numeric)
  function list() {
    var out = [];
    var pick = function (d) { out.push({ id: d.id, name: d.name, file: d.file, w: d.w, h: d.h }); };
    var b = get('best');
    if (b && loaded['best']) {
      out.push({ id: b.id, name: b.name, file: b.file, w: b.w, h: b.h });
    }
    for (var i = 1; i <= 24; i++) {
      var d = get('court' + i);
      if (d && loaded[d.id]) pick(d);
    }
    return out;
  }

  return {
    KEY: KEY,

    list: list,
    probeAll: probeAll,

    // the id the player picked, or '' for the default procedural pitch
    get: get,
    selected: function () { return selected; },
    set: function (id) {
      selected = (id && typeof id === 'string') ? id : '';
      save();
      return selected;
    },

    // The court that is currently ACTIVE on the pitch ('' = procedural).
    // Falls back to procedural when the saved choice is unknown.
    active: function () {
      if (!selected) return null;
      var d = get(selected);
      if (d && loaded[selected]) return d;
      return null;
    },

    // A THREE.Texture for a court id; starts loading on first call.
    // Returns the texture immediately (three waits for the image) and
    // fires onLoad once the pixels are available.  Null when headless.
    texture: function (id, onLoad) {
      var d = get(id);
      if (!d) return null;
      if (d.tex) { if (onLoad) onLoad(d.tex); return d.tex; }
      if (typeof THREE === 'undefined' || !THREE.TextureLoader) return null;
      try {
        var loader = new THREE.TextureLoader();
        var t = loader.load('courts/' + d.file, function (tx) {
          d.tex = tx;
          if (onLoad) onLoad(tx);
        });
        t.anisotropy = 4;
        return t;
      } catch (e) { return null; }
    },

    // preload the currently selected court (fires a callback when done)
    ensureSelected: function (cb) {
      var d = this.active();
      if (!d) { if (cb) cb(null); return null; }
      return this.texture(d.id, cb);
    },

    // purely cosmetic: is a custom court texture in use right now?
    isCustom: function () { return !!this.active(); },
  };
})();