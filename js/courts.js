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

  // ------------------------------------------------------------------
  // per-court metadata — ONE central table, keyed by court id, so goal
  // alignment / net visuals never scatter across gameplay code.
  //   paintedGoals : the court ART already paints its own goal mouth +
  //                  net (best + 1..5 all do).  When true the arena hides
  //                  the game's cosmetic goal frame (no double net) and
  //                  keeps ONLY the invisible functional geometry
  //                  (detection, post collision, keeper, net-pocket).
  //   (future: per-court goalWidth/goalDepth/goalZ/orient overrides)
  // ------------------------------------------------------------------
  var META = {
    default: { paintedGoals: true },
    overrides: {},
  };

  // ------------------------------------------------------------------
  // PER-COURT METADATA (centralized — the ONLY place court geometry /
  // alignment knobs live).  The courts/ art is hand-painted street-court
  // scenes and every one of them ALREADY paints its own complete goal:
  // posts, crossbar, and a net.  So when such a court is on the pitch we
  // must NOT render the game's own goal frame/nets on top of it (that is
  // the "double net").  The game's *functional* goal (posts for collision,
  // goal detection, keeper stance, net-pocket pocket for the ball) stays
  // exactly where it is — it simply becomes invisible.
  //
  //   id            court id ('' = procedural street)
  //   paintedGoal   true  -> the artwork draws its own goal: the arena
  //                          hides the cosmetic 3D frame, keeps functional.
  //
  // Extra per-court tuning (goal width/depth, image cropping to isolate
  // the playable pitch, logo offset ...) would slot in here per court when
  // individual images need it.  Keeping it all in this one table means no
  // scattered hardcoded values anywhere else.
  // ------------------------------------------------------------------
  var META = {
    // courts numbering 1.png .. 24.png (portrait street-court paintings)
    // + the handful of "courtN.png" + best.png — all art shows its goal.
    // (Defaults are applied for any id not listed, so probing a brand-new
    //  courtN.png automatically gets the safe paintedGoal behaviour.)
    DEFAULT: { paintedGoal: true },
    _table: {},
  };

  // courts 1..24 (numeric files)
  (function () {
    for (var i = 1; i <= 24; i++) {
      META._table['court' + i] = { paintedGoal: true };
    }
    // named secondary courts
    for (var j = 1; j <= 8; j++) {
      META._table['court' + j] = { paintedGoal: true };
    }
    META._table['best'] = { paintedGoal: true };
  })();

  // resolve metadata for a court id (merges the DEFAULT fallback)
  function metaFor(id) {
    var m = META._table[id];
    return m ? m : { paintedGoal: META.DEFAULT.paintedGoal };
  }
  function meta(id) {
    if (!id) {
      // '' => procedural pitch, always shows the game's own goal frame
      return { paintedGoal: false };
    }
    return metaFor(id);
  }

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

    // central per-court metadata (the ONLY per-court geometry/alignment
    // knobs — see the META table at the top of this file).  arena.js +
    // anything else that needs to know "does this court's art already
    // paint its own goal?" reads it through THIS one accessor so the
    // painted-goal / double-net rule never gets scattered over gameplay
    // code.  ('' = procedural pitch -> paintedGoal false.)
    meta: meta,
  };
})();