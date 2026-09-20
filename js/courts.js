// ============================================================
// COURTS - street-court backdrop registry.
//
// Every hand-painted court lives in courts/ and is registered HERE
// (the ONLY place court ids/files/names are listed).  The arena and
// the menu both read from LG.Courts so the disk, the picker and the
// pitch can never disagree.
//
// Each court also declares VISUAL metadata used by the arena:
//
//   paintedGoal:true   the artwork ALREADY paints the goal (posts,
//                      crossbar, net) onto the slab.  The arena then
//                      hides the game's cosmetic 3D goal frame so we
//                      never see a DOUBLE NET / DOUBLE GOAL.  The
//                      functional goal geometry (post collision, goal
//                      detection, keeper, net pocket) stays exactly in
//                      place, invisibly aligned with the painted goal.
//   paintedGoal:false  the game draws its own visible goal (procedural
//                      "CLASSIC" pitch - default).
//
//   fit:"cover"    (default) NOTHING is distorted.  A horizontal strip
//                  of the artwork fills the slab; the sides are cropped
//                  off evenly.  Image top/bottom stay glued to the goal
//                  lines (z = +/- 22), so painted goals hug the goal
//                  lines even when the art is wider than the pitch.
//   fit:"stretch"  fill the full slab width (mild horizontal pull) for
//                  narrow/tall artwork whose painted goals would be
//                  cropped off the sides by "cover".
//
// The actual UV math lives in LG.Courts.fitCalc - a pure function (no
// THREE) shared by the arena and the headless boot harness, so the two
// can never drift.
// ============================================================
window.LG = window.LG || {};

LG.Courts = (function () {
  var KEY = 'blockout.court.v1';
  var hasStorage = false;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('__bo_test__', '1');
      localStorage.removeItem('__bo_test__');
      hasStorage = true;
    }
  } catch (e) { /* ignore */ }

  // ------------------------------------------------------------
  // THE REGISTRY - every court, explicitly.  Keep sorted by name.
  // ------------------------------------------------------------
  var DEFS = [
    { id: 'angel',      file: 'ANGEL GROUNDS.png', name: 'ANGEL GROUNDS' },
    { id: 'ballgads',   file: 'BALLGADS\'.png',   name: 'BALLGADS\'' },
    { id: 'cardi',      file: 'CARDI.png',         name: 'CARDI' },
    { id: 'crow-d',     file: 'CROW-D.png',        name: 'CROW-D' },
    { id: 'crow-w',     file: 'CROW-W.png',        name: 'CROW-W' },
    { id: 'daems',      file: 'DAEMS LOUNGE.png',  name: 'DAEMS LOUNGE' },
    { id: 'galaktikos', file: 'GALAKTIKOS.png',    name: 'GALAKTIKOS' },
    { id: 'heartstyle', file: 'HEARTSTYLE.png',    name: 'HEARTSTYLE' },
    { id: 'lyte',       file: 'LYTE ARENA.png',    name: 'LYTE ARENA' },
    { id: 'manzies',    file: 'MANZIES.png',       name: 'MANZIES' },
    { id: 'marilyne',   file: 'MARILYNE.png',      name: 'MARILYNE' },
    { id: 'motherland', file: 'MOTHERLAND.png',    name: 'MOTHERLAND' },
    { id: 'rizier',     file: 'THE RIZIER.png',    name: 'THE RIZIER' },
    { id: 'turf',       file: 'TURF.png',          name: 'TURF' },
    { id: 'yonald',     file: 'YONALD.png',        name: 'YONALD' },
  ];

  // ------------------------------------------------------------
  // PER-COURT VISUAL metadata - the ONE place to tweak alignment /
  // painted-goal behaviour per court.  Anything not listed here:
  //   paintedGoal:true (all customs paint their own goal),
  //   fit:"cover"      (no distortion, crop sides evenly).
  // NARROW/TALL paintings get fit:"stretch" so their painted goals
  // are not cropped off the sides.
  // ------------------------------------------------------------
  var META = {
    DEFAULT: { paintedGoal: true, fit: 'cover' },
    _table: {
      ballgads:   { fit: 'stretch' },
      daems:      { fit: 'stretch' },
      galaktikos: { fit: 'stretch' },
      lyte:       { fit: 'stretch' },
    },
  };

  // merge DEFAULT with the per-court override
  function metaFor(id) {
    var out = {}, k, m = META._table[id] || {};
    for (k in META.DEFAULT) out[k] = META.DEFAULT[k];
    for (k in m) out[k] = m[k];
    return out;
  }
  // public accessor.  '' = procedural pitch (game draws its own goal) =
  // paintedGoal:false.
  function meta(id) {
    if (!id) return { paintedGoal: false, fit: 'stretch' };
    return metaFor(id);
  }

  // ------------------------------------------------------------
  // fitCalc - PURE math (no THREE) so the arena AND the headless
  // boot harness agree on how an artwork sits on the 26 x 44 slab.
  //   id   court id
  //   iw,ih  artwork pixel size
  //   sx,sz  slab world size (x = width, z = length)
  // returns { mode, strip, offsetX }:
  //   mode "cover"    no distortion; a centered horizontal strip of the
  //                   art fills the slab (strip fraction shows, sides
  //                   cropped evenly: offsetX = (1-strip)/2).
  //        "stretch"  fill the full slab width (mild horizontal pull).
  // ------------------------------------------------------------
  function fitCalc(id, iw, ih, sx, sz) {
    var m = meta(id);
    var pitchA = sx / sz;     // 26/44
    var imageA = iw / ih;
    var strip = pitchA / imageA; // fraction of the art width shown
    var out = { mode: 'stretch', strip: 1, offsetX: 0 };
    if (m.fit === 'cover' && strip < 1) {
      out.mode = 'cover';
      out.strip = strip;
      out.offsetX = (1 - strip) / 2;
    }
    return out;
  }

  var byId = {};
  for (var i = 0; i < DEFS.length; i++) byId[DEFS[i].id] = DEFS[i];

  var loaded = {};   // id -> def once the file is confirmed to exist
  var selected = null; // chosen id ('' = procedural)

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

  function get(id) { return byId[id] || null; }

  // Asynchronous existence probe using a real Image (browser only;
  // headless environments are no-ops - they fall back to procedural).
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
    var pending = DEFS.length, done = function () {
      if (--pending <= 0 && cb) cb();
    };
    DEFS.forEach(function (d) { probe(d, done); });
    if (!pending && cb) cb();
  }

  function list() {
    var out = [];
    for (var i = 0; i < DEFS.length; i++) {
      var d = DEFS[i];
      if (loaded[d.id]) out.push({ id: d.id, name: d.name, file: d.file, w: d.w, h: d.h });
    }
    return out;
  }

  function texture(id, onLoad) {
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
  }

  return {
    KEY: KEY,
    DEFS: DEFS,
    meta: meta,
    fitCalc: fitCalc,
    list: list,
    probeAll: probeAll,
    texture: texture,
    get: get,
    selected: function () { return selected; },
    set: function (id) {
      selected = (id && typeof id === 'string') ? id : '';
      save();
      return selected;
    },
    active: function () {
      if (!selected) return null;
      var d = get(selected);
      if (d && loaded[selected]) return d;
      return null;
    },
    isCustom: function () { return !!this.active(); },
    ensureSelected: function (cb) {
      var d = this.active();
      if (!d) { if (cb) cb(null); return null; }
      return this.texture(d.id, cb);
    },
  };
})();
