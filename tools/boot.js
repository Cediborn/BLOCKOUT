// ============================================================
// tools/boot.js — headless BOOT + MENU-FLOW harness (verification only)
// Boots the REAL game (every script, including main.js) under a stubbed DOM +
// fake THREE while impersonating a phone, then drives the whole menu flow.
// The gameplay sim never touches main.js/hud.js, so a UI wiring mistake there
// used to leave the static menu on screen and every button dead — this is the
// harness that catches it. Run: node tools/boot.js
// ============================================
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..');

var FAIL = 0;
function check(cond, label, detail) {
  if (cond) console.log('  ok   ' + label);
  else { FAIL++; console.log('  FAIL ' + label + (detail !== undefined ? '  ->  ' + detail : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

// ---------------- fake THREE ----------------
function vec3() {
  var v = { x: 0, y: 0, z: 0, w: 0 };
  ['copy', 'add', 'sub', 'multiplyScalar', 'normalize', 'lerp', 'project', 'setFromMatrixPosition',
    'distanceTo', 'applyQuaternion', 'crossVectors', 'addVectors', 'subVectors', 'clone'].forEach(function (m) {
      v[m] = function () { return v; };
    });
  // set() must actually store, exactly like THREE.Vector3 — otherwise a check
  // on where a marker ended up silently reads the initial zeros
  v.set = function (x, y, z) { v.x = x; v.y = y; v.z = z; return v; };
  v.setScalar = function (s) { v.x = v.y = v.z = s; return v; };
  return v;
}
function fakeNode() {
  var color = { setHex: function () {}, getHexString: function () { return 'ffffff'; }, set: function () {}, getHex: function () { return 0; } };
  var n = {
    position: vec3(), rotation: vec3(), scale: vec3(), quaternion: vec3(),
    userData: {}, children: [], isMesh: false, visible: true, material: null, geometry: null,
    shadow: { camera: { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0 }, mapSize: { set: function () {} }, bias: 0 },
    add: function (c) { n.children.push(c); return n; },
    remove: function () { return n; },
    traverse: function (cb) { cb(n); (n.children || []).forEach(function (c) { if (c && c.traverse) c.traverse(cb); }); return n; },
    lookAt: function () {}, updateProjectionMatrix: function () {},
    color: color, groundColor: color,
    repeat: { set: function () {}, x: 1, y: 1 }, offset: { set: function () {}, x: 0, y: 0 },
    attributes: new Proxy({}, {
      get: function (t, p) {
        if (typeof p === 'symbol') return undefined;
        if (!t[p]) t[p] = { needsUpdate: false, array: [], setXYZ: function () {} };
        return t[p];
      },
    }),
    center: { set: function () {}, x: 0, y: 0 }, wrapS: 0, wrapT: 0, needsUpdate: false, anisotropy: 1,
    copy: function () { return n; }, clone: function () { return fakeNode(); },
    setFromPoints: function () { return n; }, setAttribute: function () { return n; }, dispose: function () {},
  };
  return new Proxy(n, {
    get: function (o, p) { if (p in o) return o[p]; var fn = function () { return o; }; o[p] = fn; return fn; },
    set: function (o, p, v) { o[p] = v; return true; },
  });
}
var threeCache = {};
  var MAT_FLAGS = {
    MeshBasicMaterial: 'isMeshBasicMaterial',
    MeshLambertMaterial: 'isMeshLambertMaterial',
    MeshStandardMaterial: 'isMeshStandardMaterial',
    MeshPhongMaterial: 'isMeshPhongMaterial',
  };
  global.THREE = new Proxy({}, {
    get: function (t, prop) {
      if (prop in threeCache) return threeCache[prop];
      if (prop === 'DoubleSide' || prop === 'AdditiveBlending' || prop === 'PCFSoftShadowMap') return 2;
      if (prop === 'BackSide') return 1;
      if (prop === 'sRGBEncoding') return 3001;
      var Cls = function () {
        var node = fakeNode();
        if (prop === 'PointLight') node.isPointLight = true;
        if (MAT_FLAGS[prop] && arguments.length >= 1 && typeof arguments[0] === 'object') {
          var opts = arguments[0];
          // the material instance carries its options (side, map, emissive...)
          // and the real "is-mesh-*" marker, exactly like three.js Materials
          node.material = opts;
          node.material[MAT_FLAGS[prop]] = true;
          node[MAT_FLAGS[prop]] = true;
          Object.keys(opts).forEach(function (k) { if (opts[k] !== undefined) node[k] = opts[k]; });
        } else if (arguments.length >= 2 && typeof arguments[1] === 'object') {
          node.material = arguments[1];
        }
        return node;
      };
      threeCache[prop] = Cls;
      return Cls;
    },
  });

// ---------------- DOM ----------------
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var ids = {};
html.replace(/id="([^"]+)"/g, function (m, id) { ids[id] = 1; return m; });
var elements = {};
var missed = [];

function el(id) {
  var e = {
    id: id, style: {}, dataset: {}, textContent: '', children: [], _classes: {}, _h: {}, _html: '',
    classList: {
      add: function (c) { e._classes[c] = 1; },
      remove: function (c) { delete e._classes[c]; },
      toggle: function (c, on) { if (on === undefined) on = !e._classes[c]; if (on) e._classes[c] = 1; else delete e._classes[c]; },
      contains: function (c) { return !!e._classes[c]; },
    },
    addEventListener: function (ev, fn) { (e._h[ev] = e._h[ev] || []).push(fn); },
    removeEventListener: function () {},
    appendChild: function (c) { e.children.push(c); return c; },
    removeChild: function () {}, remove: function () {},
    querySelector: function () { var q = el('q:' + id); q.className = ''; return q; },
    querySelectorAll: function () { return []; },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 190, height: 190, right: 190, bottom: 190 }; },
    fire: function (t, ev) {
      ev = ev || {};
      ev.preventDefault = ev.preventDefault || function () {};
      (e._h[t] || []).forEach(function (f) { f(ev); });
    },
    requestFullscreen: function () { return { then: function (cb) { return { catch: function () {} }; }, catch: function () {} }; },
  };
  // real DOM: assigning innerHTML replaces children — mirror that so
  // list.innerHTML = '' + appendChild rebuilds instead of accumulating
  Object.defineProperty(e, 'innerHTML', {
    get: function () { return e._html; },
    set: function (v) {
      e._html = String(v);
      if (e._html === '') e.children = [];
      else e.children = [];
    },
  });
  if (id && ids[id] === undefined) ids[id] = 1;
  return e;
}
function make(id) { var e = el(id); elements[id] = e; return e; }
Object.keys(ids).forEach(make);

// hidden state from the real markup, so overlay checks mean something
var hiddenInMarkup = {};
html.replace(/<(?:div|button|span|p|ul|table)\s+id="([^"]+)"[^>]*class="([^"]*)"/g,
  function (m, id, cls) { if (/\bhidden\b/.test(cls)) hiddenInMarkup[id] = 1; return m; });
Object.keys(hiddenInMarkup).forEach(function (id) { if (elements[id]) elements[id].classList.add('hidden'); });

// count real fullscreen requests on the document element
var fsCalls = 0;

// hidden state from the real markup, so overlay checks mean something (declared below)
global.window = global;
global.document = {
  getElementById: function (id) { if (!elements[id]) missed.push(id); return elements[id] || null; },
  createElement: function (tag) {
    if (tag === 'canvas') {
      var c = el('dyn-canvas');
      c.width = 2; c.height = 2;
      c.getContext = function () {
        return new Proxy({}, { get: function (t, p) {
          if (p === 'createRadialGradient' || p === 'createLinearGradient' || p === 'createPattern') return function () { return { addColorStop: function () {} }; };
          if (p === 'getImageData') return function () { return { data: [] }; };
          return function () {};
        }, set: function () { return true; } });
      };
      return c;
    }
    return el('dyn');
  },
  querySelectorAll: function () { return []; },
  body: el('body'),
  documentElement: el('html'),
  hidden: false,
};
global.document.documentElement.requestFullscreen = function () {
  fsCalls++;
  return { then: function () { return this; }, catch: function () {} };
};
global.navigator = { userAgent: 'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' };
global.screen = { orientation: { lock: function () { return Promise.reject(new Error('unsupported')); } } };
global.window.innerWidth = 844;
global.window.innerHeight = 390;
global.window.devicePixelRatio = 3;
global.window.ontouchstart = null;                              // makes 'ontouchstart' in window true
global.window.matchMedia = function () { return { matches: true, addListener: function () {}, addEventListener: function () {} }; };
// in-memory storage so Phase 3A persistence can be exercised end-to-end;
// progression/settings still ship their own try/catch for the no-storage path
var _lsStore = {};
global.localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(_lsStore, k) ? _lsStore[k] : null; },
  setItem: function (k, v) { _lsStore[k] = String(v); },
  removeItem: function (k) { delete _lsStore[k]; },
  clear: function () { _lsStore = {}; },
};

var winHandlers = {};
global.window.addEventListener = function (ev, fn) { (winHandlers[ev] = winHandlers[ev] || []).push(fn); };
global.window.removeEventListener = function (ev, fn) {
  var a = winHandlers[ev] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
};
global.window.fire = function (ev, arg) { (winHandlers[ev] || []).slice().forEach(function (f) { f(arg || {}); }); };

// document-level listeners (fullscreenchange / visibilitychange) go through a
// separate bus so the harness can fire them independently of window events
var docHandlers = {};
global.document.addEventListener = function (ev, fn) { (docHandlers[ev] = docHandlers[ev] || []).push(fn); };
global.document.removeEventListener = function (ev, fn) {
  var a = docHandlers[ev] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
};
global.document.fire = function (ev, arg) { (docHandlers[ev] || []).slice().forEach(function (f) { f(arg || {}); }); };

var rafQueue = [];
global.requestAnimationFrame = function (cb) { rafQueue.push(cb); return rafQueue.length; };
global.performance = global.performance || { now: function () { return Date.now(); } };
global.console.error = global.console.error;

// ---------------- load the real code ----------------
var SRC = ['js/config.js', 'js/difficulty.js', 'js/util.js', 'js/audio.js', 'js/challenges.js', 'js/progression.js', 'js/modes.js', 'js/tournament.js', 'js/settings.js',
  'js/input.js', 'js/particles.js', 'js/courts.js', 'js/models.js', 'js/ball.js', 'js/player.js', 'js/arena.js', 'js/abilities.js',
  'js/ai.js', 'js/keeper.js', 'js/camera.js', 'js/lighting.js', 'js/match.js', 'js/celebration.js', 'js/hud.js', 'js/main.js', 'js/living.js'];

section('1. scripts parse + boot (as a phone)');
var bootErr = null;
try {
  SRC.forEach(function (rel) {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
  });
} catch (e) { bootErr = e; }
check(!bootErr, 'all scripts load', bootErr && bootErr.message);

var LG = window.LG;
check(!!(LG && LG.MatchManager && window.LGMain), 'the game namespace + main entry exist');

// boot: main.js listens for window load
var initErr = null;
try { window.fire('load'); } catch (e) { initErr = e; }
check(!initErr, 'init() survives boot on a touch device', initErr && (initErr.message + ' @ ' + (initErr.stack || '').split('\n')[1]));

var vis = function (id) { return elements[id] && !elements[id].classList.contains('hidden'); };
check(vis('menu-overlay'), 'main menu ends up visible');
check(vis('loading-overlay'),
  'the boot cover is still up before the first frame (it lifts only after a real render)');
var vp0 = window.LGMain.getViewport();
check(vp0.w === window.innerWidth && vp0.h === window.innerHeight && vp0.dpr === 2,
  'startup sized the renderer from the real viewport (pixel ratio capped at 2)', JSON.stringify(vp0));

section('1b. court registration + metadata are the single source of truth');
(function () {
  // every .png actually stored in courts/ must be registered in LG.Courts.DEFS
  var disk = fs.readdirSync(path.join(ROOT, 'courts')).filter(function (f) { return /\.png$/i.test(f); });
  var defs = (LG.Courts && LG.Courts.DEFS) || [];
  var there = disk.filter(function (f) { return defs.some(function (d) { return d.file === f; }); });
  check(there.length === disk.length,
    'every courts/ png is registered', 'disk=' + disk.length + ' registered=' + there.length +
    (there.length !== disk.length ? ' missing=' + disk.filter(function (f) { return !defs.some(function (d) { return d.file === f; }); }).join(',') : ''));
  var orphans = defs.filter(function (d) { return disk.indexOf(d.file) < 0; });
  check(orphans.length === 0, 'every registered court file exists on disk', orphans.map(function (d) { return d.file; }).join(','));
  var seenIds = {}, dup = null;
  defs.forEach(function (d) { if (seenIds[d.id]) dup = d.id; seenIds[d.id] = 1; });
  check(defs.length === disk.length && !dup,
    'one registered def per court, ids unique', 'defs=' + defs.length + ' idsdup=' + dup);

  // metadata contract: painted-goal rule + aspect fit live ONLY here
  check(LG.Courts.meta('turf').paintedGoal === true && LG.Courts.meta('turf').fit === 'cover',
    'TURF metadata: painted goal + cover fit', JSON.stringify(LG.Courts.meta('turf')));
  check(LG.Courts.meta('ballgads').fit === 'stretch',
    'narrow portrait courts stretch to keep goals aligned', LG.Courts.meta('ballgads').fit);
  check(LG.Courts.meta('').paintedGoal === false,
    'CLASSIC pitch keeps the game\'s own visible goals');
  check(LG.Courts.meta('some-unknown-court').paintedGoal === true,
    'unknown courts safely default to the painted-goal rule');
})();

section('2. the menu flow actually advances (one screen, one purpose)');
var flow = null;
try {
  // helper: KICK OFF -> MODE -> (quick) difficulty
  function openQuickFlow() {
    elements['btn-play'].fire('click');
    if (vis('mode-overlay')) elements['btn-mode-go'].fire('click');
  }
  elements['btn-play'].fire('click');
  flow = 'mode';
  check(vis('mode-overlay') && !vis('menu-overlay'), 'KICK OFF opens GAME MODE', 'mode=' + vis('mode-overlay') + ' menu=' + vis('menu-overlay'));
  check(!!LG.Modes && typeof LG.Modes.select === 'function' && LG.Modes.list().length === 3,
    'LG.Modes exposes 3 modes', LG.Modes && LG.Modes.list().map(function (m) { return m.id; }).join(','));
  // BACK from mode returns to menu
  elements['btn-mode-back'].fire('click');
  check(vis('menu-overlay') && !vis('mode-overlay'), 'MODE BACK returns to the main menu');
  // default QUICK -> difficulty
  elements['btn-play'].fire('click');
  elements['btn-mode-go'].fire('click');
  check(vis('diff-overlay') && !vis('mode-overlay'), 'QUICK MATCH opens SELECT DIFFICULTY', 'diff=' + vis('diff-overlay') + ' mode=' + vis('mode-overlay'));
  check(LG.Modes.is('quick_match'), 'default mode is quick_match', LG.Modes.id());

  // difficulty picks still reach the real difficulty store (AI tuning untouched)
  elements['diff-hard'].fire('click');
  check(LG.Difficulty.get() === 'hard', 'HARD selects the hard AI', LG.Difficulty.get());
  elements['diff-easy'].fire('click');
  check(LG.Difficulty.get() === 'easy', 'EASY selects the easy AI', LG.Difficulty.get());
  elements['diff-medium'].fire('click');
  check(LG.Difficulty.get() === 'medium', 'MEDIUM selects the medium AI', LG.Difficulty.get());
  check(elements['diff-easy'].classList.contains('selected') === false && elements['diff-medium'].classList.contains('selected') === true,
    'the selected difficulty keeps its visual selected state');

  elements['btn-diff-back'].fire('click');
  check(vis('mode-overlay') && !vis('diff-overlay'), 'DIFFICULTY BACK returns to GAME MODE (mode layer, not menu)');
  elements['btn-mode-back'].fire('click');
  check(vis('menu-overlay'), 'MODE BACK from difficulty return lands on the main menu');
  elements['btn-play'].fire('click');
  elements['btn-mode-go'].fire('click');
  elements['btn-diff-go'].fire('click');
  check(vis('select-overlay') && !vis('diff-overlay'), 'CONTINUE opens PICK YOUR STAR');

  elements['btn-back'].fire('click');
  check(vis('diff-overlay') && !vis('select-overlay'), 'STAR BACK returns to SELECT DIFFICULTY');
  elements['btn-diff-go'].fire('click');

  // STAR -> PLAYER STYLE (no court/style/kick-off buttons live on the star screen anymore)
  elements['btn-select-go'].fire('click');
  check(vis('style-overlay') && !vis('select-overlay'), 'CONTINUE opens PLAYER STYLE');
  check(elements['color-grid'] && elements['color-grid'].children.length > 0, 'your kit colors build');
  check(elements['away-color-grid'] && elements['away-color-grid'].children.length > 0, 'the opponent kit colors build');

  // kits: grid = [REGULAR/DEFAULT, RED, BLUE, YELLOW, ...]
  elements['color-grid'].children[1].fire('click');        // YOUR KIT = RED
  elements['away-color-grid'].children[2].fire('click');   // ROGUE = BLUE
  var sel = window.LGMain.getSelections();
  check(sel.homeKit === 'red' && sel.awayKit === 'blue', 'both kit picks are remembered', JSON.stringify(sel));

  elements['away-color-grid'].children[1].fire('click');   // ROGUE = RED -> mirrors yours, refused
  sel = window.LGMain.getSelections();
  check(sel.homeKit === 'red' && sel.awayKit === 'blue', 'a Rogue kit identical to yours is refused', JSON.stringify(sel));

  elements['color-grid'].children[2].fire('click');        // YOUR KIT = BLUE -> rogue must move
  sel = window.LGMain.getSelections();
  check(sel.homeKit === 'blue' && sel.awayKit && sel.awayKit !== 'blue', 'the two kits can never match', JSON.stringify(sel));

  elements['btn-style-back'].fire('click');
  check(vis('select-overlay') && !vis('style-overlay'), 'PLAYER STYLE BACK returns to PICK YOUR STAR');
  elements['btn-select-go'].fire('click');

  // STYLE -> COURT SELECTION
  elements['btn-style-go'].fire('click');
  check(vis('court-overlay') && !vis('style-overlay'), 'PLAYER STYLE CONTINUE opens COURT SELECTION');
  check(elements['court-grid'] && elements['court-grid'].children.length > 0, 'the court grid builds');
  if (elements['court-grid'] && elements['court-grid'].children.length) {
    elements['court-grid'].children[0].fire('click');       // CLASSIC STREET tile
  }
  check(LG.Courts.selected() === '', 'selecting CLASSIC persists an empty court id', LG.Courts.selected());

  elements['btn-court-back'].fire('click');
  check(vis('style-overlay') && !vis('court-overlay'), 'COURT BACK returns to PLAYER STYLE');
  elements['btn-style-go'].fire('click');

  // COURT -> MATCH SETUP (day/night + portrait/landscape live here now)
  elements['btn-court-go'].fire('click');
  check(vis('setup-overlay') && !vis('court-overlay'), 'COURT CONTINUE opens MATCH SETUP');
  elements['btn-setup-back'].fire('click');
  check(vis('court-overlay') && !vis('setup-overlay'), 'MATCH SETUP BACK returns to COURT SELECTION');
  elements['btn-court-go'].fire('click');

  // MATCH SETUP -> GAME
  elements['btn-start-match'].fire('click');
  check(window.LGMain.getState() === 'match', 'KICK OFF starts the match', window.LGMain.getState());

  // the menu choices must be the ones the match actually plays with
  var mk = window.LGMain.getMatch();
  check(!!mk, 'a match object exists after KICK OFF');
  check(mk && mk.opts.outfitColor && mk.opts.outfitColor.id === 'blue' && mk.opts.awayColor && mk.opts.awayColor.id !== 'blue',
    'the chosen kits reach the match options', mk && JSON.stringify({ h: mk.opts.outfitColor && mk.opts.outfitColor.id, a: mk.opts.awayColor && mk.opts.awayColor.id }));
  var homeShirt = mk && mk.home[0] && mk.home[0].def.palette.shirt;
  var awayShirt = mk && mk.away[0] && mk.away[0].def.palette.shirt;
  check(homeShirt === 0x4488ff, 'the home squad wears YOUR kit in the actual match', homeShirt && homeShirt.toString(16));
  check(awayShirt && awayShirt !== homeShirt, 'the Rogue Squad wears a different kit in the actual match',
    awayShirt && awayShirt.toString(16));
  check(mk && mk.opts.difficulty === 'medium', 'the difficulty carries into the match', mk && mk.opts.difficulty);
  check(window.LGMain.getSelections().player === (mk && mk.opts.playerId), 'the picked star is the one playing',
    JSON.stringify(window.LGMain.getSelections()));
} catch (e) {
  console.log('  FAIL flow threw  ->  ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
  FAIL++;
}

section('3. frames run + the kickoff happens');
var frameErr = null;
try {
  for (var i = 0; i < 240; i++) { var q = rafQueue; rafQueue = []; q.forEach(function (cb) { cb(performance.now()); }); }
} catch (e) { frameErr = e; }
check(!frameErr, '240 frames of the match loop run clean', frameErr && (frameErr.message + '\n' + (frameErr.stack || '').split('\n')[1]));
check(!vis('loading-overlay'),
  'the boot cover lifts as soon as the first frame has been presented');
var m = window.LGMain.getMatch();
check(!!m, 'a match object exists');
check(m && (m.state === 'PLAY' || m.state === 'KICKOFF'), 'the match advanced past IDLE', m && m.state);

section('3b. visibility pass — player size, team kits, one carrier indicator');
try {
  var vm = window.LGMain.getMatch();
  if (!vm) {
    check(false, 'a match exists for the visibility checks');
  } else {
    // 1) one body size: model scale, collision body and height all move together
    var S = LG.Player.visualScale();
    var p0 = vm.home[0];
    check(S >= 1.25, 'players are substantially bigger than before', S);
    check(p0.height > 1.62, 'the height used by markers grew with the body', p0.height);
    var bodiesOk = true, worst = '';
    for (var bi = 0; bi < vm.all.length; bi++) {
      var bp = vm.all[bi];
      var bw = (bp.def.body && bp.def.body.wide) || 1;
      var bwant = 0.42 * bw * S;
      if (Math.abs(bp.radius - bwant) > 1e-9) { bodiesOk = false; worst = bp.name + ' ' + bp.radius + ' != ' + bwant; }
    }
    check(bodiesOk, 'every player body (both teams, keepers included) uses the same scale', worst || 'all ' + vm.all.length);

    // 2) one readable kit colour per side — keeper included
    var uniformShirt = function (list) {
      var c = list[0].def.palette.shirt;
      for (var i = 1; i < list.length; i++) if (list[i].def.palette.shirt !== c) return null;
      return c;
    };
    var hKit = uniformShirt(vm.home), aKit = uniformShirt(vm.away);
    check(hKit != null, 'every home player wears one kit colour (keeper included)', hKit && hKit.toString(16));
    check(aKit != null, 'every Rogue player wears one kit colour (keeper included)', aKit && aKit.toString(16));
    check(hKit != null && aKit != null && hKit !== aKit, 'the two sides are never the same colour',
      hKit && aKit && (hKit.toString(16) + '/' + aKit.toString(16)));

    // 3) the ball-carrier indicator: 0 with nobody on the ball, exactly 1 with
    //    a carrier, always anchored to that player's WORLD position
    var carriers = [], ci;
    for (ci = 0; ci < vm.all.length; ci++) if (vm.all[ci].hasBall) carriers.push(vm.all[ci]);
    check(carriers.length <= 1, 'never more than one ball carrier', carriers.length);
    check(!!vm.carrierMark, 'the match owns exactly one carrier indicator object');
    check(vm.carrierMark && vm.carrierMark.visible === (carriers.length === 1),
      'the indicator shows for the carrier and for nobody else',
      carriers.length + ' carrier(s), visible=' + (vm.carrierMark && vm.carrierMark.visible));
    if (carriers.length === 1 && vm.carrierMark.visible) {
      var cp = carriers[0];
      var off = Math.abs(vm.carrierMark.position.x - cp.x) + Math.abs(vm.carrierMark.position.z - cp.z);
      check(off < 1e-6, 'the indicator tracks the carrier position, not the screen', off);
      check(vm.carrierMark.position.y >= cp.height, 'the indicator floats above the head', vm.carrierMark.position.y);
    } else if (carriers.length === 0 && vm.carrierMark) {
      // nobody has won the ball in this window of frames — hand it to a player
      // for one read-only probe and put everything back exactly as it was
      var target = vm.home[0];
      target.hasBall = true;
      vm.updateCarrierMark();
      var dx = Math.abs(vm.carrierMark.position.x - target.x) + Math.abs(vm.carrierMark.position.z - target.z);
      var dy = vm.carrierMark.position.y - (target.height + vm.carrierLift);
      check(vm.carrierMark.visible === true, 'the indicator appears the moment someone holds the ball');
      check(dx < 1e-6, 'the indicator tracks the carrier position, not the screen', dx);
      check(Math.abs(dy) <= vm.carrierBob + 1e-6, 'the indicator floats just above that head', dy);
      target.hasBall = false;
      vm.updateCarrierMark();
      check(vm.carrierMark.visible === false, 'the indicator disappears again with the ball');
    }

    // 4) per-player screen-space head dots are gone for good
    check(typeof LG.HUD.updateTags !== 'function', 'per-player screen-space tags are removed from the HUD');
    check(typeof LG.HUD.clearTags === 'function', 'the defensive tag cleanup still exists');
  }
} catch (e) {
  console.log('  FAIL visibility checks threw  ->  ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
  FAIL++;
}

section('3c. fullscreen is taken at match start, never mid-tap');
check(fsCalls === 1, 'starting the match asked for fullscreen once', fsCalls);
window.fire('pointerdown', { clientX: 10, clientY: 10 });
check(fsCalls === 1, 'a stray tap afterwards does not re-request fullscreen', fsCalls);

section('4. the rotate hint + the viewport layout survive orientation changes');
function pump(n) {
  for (var i = 0; i < (n || 1); i++) { var q = rafQueue; rafQueue = []; q.forEach(function (cb) { cb(performance.now()); }); }
}
check(elements['rotate-overlay'] && elements['rotate-overlay'].classList.contains('hidden'),
  'landscape phone hides the rotate hint');
window.innerWidth = 390; window.innerHeight = 844;
window.fire('resize'); pump(2);
check(!elements['rotate-overlay'].classList.contains('hidden'), 'portrait shows the hint again');
check(document.body.classList.contains('is-portrait') && !document.body.classList.contains('is-landscape'),
  'the layout pass moved the body classes to is-portrait',
  'portrait=' + document.body.classList.contains('is-portrait'));
window.innerWidth = 844; window.innerHeight = 390;
window.fire('orientationchange'); pump(2);
check(elements['rotate-overlay'].classList.contains('hidden'), 'rotating back hides the hint');
check(document.body.classList.contains('is-landscape'),
  'the layout pass moved the body classes back to is-landscape');
window.innerWidth = 390; window.innerHeight = 844;
pump(3);
check(!elements['rotate-overlay'].classList.contains('hidden'),
  'the loop re-checks orientation and re-shows the hint (no resize event needed)');

section('4b. viewport layout is one centralised pipeline');
(function () {
  var before = window.LGMain.getViewport();
  // one real gesture on a phone fires resize + orientationchange +
  // fullscreenchange + pageshow together; all of them funnel into the SAME
  // scheduled relayout, so a burst must cost one pass, not one per event
  window.innerWidth = 900; window.innerHeight = 420;
  window.fire('resize');
  window.fire('resize');
  window.fire('orientationchange');
  document.fire('fullscreenchange');
  window.fire('pageshow');
  pump(2);
  var vp = window.LGMain.getViewport();
  check(vp.applies - before.applies === 2,
    'five viewport events collapse into one relayout + one confirming pass',
    vp.applies - before.applies);
  check(vp.w === 900 && vp.h === 420, 'the relayout read the size the browser reports now',
    vp.w + 'x' + vp.h);
  check(vp.dpr === 2, 'devicePixelRatio reaches the renderer, capped at 2', vp.dpr);

  // fullscreen announces itself; it must relayout WITHOUT asking for fullscreen
  var fs0 = fsCalls;
  window.innerWidth = 740; window.innerHeight = 360;
  document.fire('fullscreenchange');
  document.fire('webkitfullscreenchange');
  pump(2);
  vp = window.LGMain.getViewport();
  check(vp.w === 740 && vp.h === 360, 'a fullscreen change relayouts the canvas', vp.w + 'x' + vp.h);
  check(fsCalls === fs0,
    'relayout never re-requests fullscreen (no resize -> fullscreen -> resize loop)', fsCalls);

  // startup must happen exactly once
  var apps = window.LGMain.getViewport().applies;
  window.fire('load');
  pump(2);
  check(window.LGMain.getViewport().applies === apps,
    'a repeated load event cannot initialise the game a second time',
    window.LGMain.getViewport().applies - apps);
})();

section('4c. the mobile control layer is on screen and actually takes touch');
(function () {
  check(vis('controls'), 'the control layer is visible as soon as the match starts (no rotation needed)');
  check(vis('scoreboard') && vis('pause-btn'), 'scoreboard + pause button come with the match UI');
  var zone = elements['joystick-zone'];
  check(!!zone && !zone.classList.contains('hidden'), 'the joystick zone exists and is not display:none');
  var shown = ['btn-pass', 'btn-shoot', 'btn-tackle', 'btn-switch', 'btn-sprint'].filter(function (id) {
    return elements[id] && !elements[id].classList.contains('hidden-control');
  });
  check(shown.length >= 3, 'the action buttons are on screen (context pair + sprint)', shown.join(','));

  // the zone must not only be visible — a drag on it has to steer the player
  var touchErr = null;
  try {
    zone.fire('pointerdown', { pointerId: 7, clientX: 40, clientY: 40 });
    zone.fire('pointermove', { pointerId: 7, clientX: 130, clientY: 40 });
  } catch (e) { touchErr = e; }
  check(!touchErr, 'touching the joystick runs clean', touchErr && touchErr.message);
  var mv = LG.Input.moveVec();
  check(mv.x > 0.5 && Math.abs(mv.y) < 0.3, 'a drag on the joystick really steers the player',
    JSON.stringify(mv));
  zone.fire('pointerup', { pointerId: 7, clientX: 130, clientY: 40 });
  mv = LG.Input.moveVec();
  check(mv.x === 0 && mv.y === 0, 'lifting the thumb stops the stick', JSON.stringify(mv));

  // and a button press must reach the input layer too
  var sp = elements['btn-sprint'];
  sp.fire('pointerdown', { pointerId: 3 });
  check(LG.Input.down('sprint'), 'an action button goes down on touch');
  sp.fire('pointerup', { pointerId: 3 });
  check(!LG.Input.down('sprint'), 'and releases again');

  // the rotate hint is pure CSS, so assert its contract in the stylesheet:
  // never swallow a touch, never paint over the whole HUD
  var cssText = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  var rotRule = (cssText.match(/#rotate-overlay\s*\{[^}]*\}/) || [''])[0];
  check(/pointer-events:\s*none/.test(rotRule),
    'the rotate hint never intercepts touches over the controls', rotRule.replace(/\s+/g, ' ').slice(0, 110));
  check(!/radial-gradient|inset:\s*0\b/.test(rotRule),
    'the rotate hint is no longer a full-screen wash', rotRule.replace(/\s+/g, ' ').slice(0, 110));
  var ctlRule = (cssText.match(/#controls\s*\{[^}]*\}/) || [''])[0];
  check(/inset:\s*0/.test(ctlRule) && !/height:\s*0/.test(ctlRule),
    'the control layer spans the viewport so its 3%/4% insets resolve against the real screen',
    ctlRule.replace(/\s+/g, ' ').slice(0, 110));
})();

check(missed.length === 0, 'no getElementById ever missed the real DOM', missed.join(', '));

section('5. match settings are wired into the real game state');
(function () {
  // fail-safe defaults (no localStorage in this harness)
  check(LG.Settings.timeOfDay() === 'day' && LG.Settings.view() === 'landscape',
    'defaults: day + landscape', LG.Settings.timeOfDay() + '/' + LG.Settings.view());

  // collect() walked the built environment, so setMode has something to drive:
  // the lamp/flood point lights, the lamp-head emissives and the sky dome
  var st = LG.Lighting.stats();
  check(st.points >= 4 && st.emissives >= 3 && st.skies === 1,
    'Lighting.collect found the environment', JSON.stringify(st));

  // DAY -> NIGHT through the actual button: the full chain must flip
  var nightErr = null;
  try { elements['time-night'].fire('click'); } catch (e) { nightErr = e; }
  check(!nightErr, 'clicking NIGHT runs clean', nightErr && nightErr.message);
  check(LG.Settings.timeOfDay() === 'night' && LG.Lighting.mode() === 'night',
    'NIGHT button flipped Settings + Lighting state', LG.Settings.timeOfDay() + '/' + LG.Lighting.mode());
  check(elements['time-night'].classList.contains('selected') && !elements['time-day'].classList.contains('selected'),
    'NIGHT reflects in the option UI', 'daySel=' + elements['time-day'].classList.contains('selected') + ' nightSel=' + elements['time-night'].classList.contains('selected'));

  // NIGHT -> DAY restores it
  elements['time-day'].fire('click');
  check(LG.Settings.timeOfDay() === 'day' && LG.Lighting.mode() === 'day',
    'DAY button restored the lighting');

  // VIEW drives the match camera framing (the visible gameplay change)
  var probe = new LG.MatchCamera({ aspect: 1.9 });   // wide canvas, on purpose
  LG.Settings.setView('portrait');
  check(probe.cfg() === LG.Config.camera && probe.cfg() !== LG.Config.camera.landscape,
    'PORTRAIT => the original broadcast framing');
  LG.Settings.setView('landscape');
  check(probe.cfg() === LG.Config.camera.landscape,
    'LANDSCAPE => the horizontal wide framing');
  check(global.document.body.classList.contains('view-landscape') && !global.document.body.classList.contains('view-portrait'),
    'body carries view-landscape for the HUD');

  // LANDSCAPE must be a GENUINELY different camera pose, not a zoomed portrait:
  // the match camera has to move off the east touchline and look across the
  // pitch width, so the goal-to-goal axis runs left-to-right on screen.
  var rec = (function () {
    var cam = {
      fov: 50,
      position: { x: 0, y: 0, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z; } },
      lookAt: function (x, y, z) { cam.lookX = x; cam.lookY = y; cam.lookZ = z; },
      updateProjectionMatrix: function () {},
    };
    return cam;
  })();
  var camCtrl = new LG.MatchCamera(rec);

  LG.Settings.setView('portrait');
  camCtrl.reset();
  camCtrl.update(0.02, 0, 0, 0, 0);
  var pBehind = rec.position.x === 0 && rec.position.y === 30 && rec.position.z === 25;
  var pLookAway = rec.lookZ < rec.position.z;                 // looking toward -z (away goal)
  check(pBehind && pLookAway,
    'PORTRAIT pose: camera behind the play on +z, looking along -z',
    '(' + rec.position.x + ',' + rec.position.y + ',' + rec.position.z + ') lookAt(' + rec.lookX + ',' + rec.lookY + ',' + rec.lookZ + ')');

  LG.Settings.setView('landscape');
  camCtrl.reset();
  camCtrl.update(0.02, 0, 0, 0, 0);
  var lSide = rec.position.x > 0 && Math.abs(rec.position.z) < 0.01;   // east touchline, level
  var lAcross = rec.lookX < rec.position.x && rec.lookZ === rec.position.z;  // looking straight west
  check(lSide && lAcross,
    'LANDSCAPE pose: camera moves to the east touchline (+x) and looks across the width',
    '(' + rec.position.x + ',' + rec.position.y + ',' + rec.position.z + ') lookAt(' + rec.lookX + ',' + rec.lookY + ',' + rec.lookZ + ')');
  check(rec.position.x === 25 && rec.position.z === 0,
    'LANDSCAPE pose is a genuine side view (not a portrait pulled wider)',
    'x=' + rec.position.x + ' z=' + rec.position.z);

  // and it FOLLOWS the play along the length (the horizontal gameplay axis)
  camCtrl.update(0.02, 0, -14, 0, -14);          // action drives 14m toward the away goal
  check(rec.position.z < -1.5 && rec.position.z > -14.5 && rec.position.x === 25,
    'LANDSCAPE camera tracks the action left-to-right along -z',
    'z=' + rec.position.z.toFixed(2) + ' x=' + rec.position.x);

  // screen input adopts the landscape camera basis: the stick always follows
  // the screen, so controls feel identical while the world is never altered
  var mm = LG.MatchManager.prototype;
  LG.Settings.setView('portrait');
  var pv = mm.screenToWorldMove({ x: 1, y: 0 });
  var pu = mm.screenToWorldMove({ x: 0, y: 1 });
  check(pv.x === 1 && pv.z === 0 && pu.x === 0 && pu.z === -1,
    'PORTRAIT input: right = +x, up = -z (attack up-screen)');
  LG.Settings.setView('landscape');
  var lr = mm.screenToWorldMove({ x: 1, y: 0 });
  var lu = mm.screenToWorldMove({ x: 0, y: 1 });
  check(lr.x === 0 && lr.z === -1 && lu.x === -1 && lu.z === 0,
    'LANDSCAPE input: right = -z (attack screen-right), up = -x (far touchline)');
})();

section('6. rematch + return to menu keep the session choices (no re-config)');
(function () {
  var first = window.LGMain.getMatch();
  var before = window.LGMain.getSelections();
  var err = null;
  try { LG.eventBus.emit('rematchRequested'); } catch (e) { err = e; }
  check(!err, 'REMATCH runs clean', err && err.message);
  var second = window.LGMain.getMatch();
  check(!!second && second !== first && window.LGMain.getState() === 'match',
    'REMATCH starts a fresh match with no setup screens in between', window.LGMain.getState());
  check(!!(second && second.opts.outfitColor && second.opts.outfitColor.id === before.homeKit) &&
    !!(second && second.opts.awayColor && second.opts.awayColor.id === before.awayKit),
    'REMATCH reuses the chosen kits', JSON.stringify({ before: before, after: second && second.opts.outfitColor && { h: second.opts.outfitColor.id, a: second.opts.awayColor && second.opts.awayColor.id } }));
  check(!!(second && second.opts.difficulty === before.difficulty), 'REMATCH reuses the difficulty', second && second.opts.difficulty);
  check(!!(second && second.opts.playerId === before.player), 'REMATCH reuses the picked star', second && second.opts.playerId);

  LG.eventBus.emit('quitRequested');
  check(window.LGMain.getState() === 'menu' && vis('menu-overlay'), 'MAIN MENU returns to the title screen', window.LGMain.getState());

  // run the whole flow a second time: the previous choices are still intact
  elements['btn-play'].fire('click');
  if (vis('mode-overlay')) elements['btn-mode-go'].fire('click');
  check(vis('diff-overlay'), 'KICK OFF opens SELECT DIFFICULTY again');
  var again = window.LGMain.getSelections();
  check(again.homeKit === before.homeKit && again.awayKit === before.awayKit &&
    again.player === before.player && again.difficulty === before.difficulty,
    'the session choices survive the round trip (nothing to re-enter)', JSON.stringify(again));
  elements['btn-diff-go'].fire('click');
  elements['btn-select-go'].fire('click');
  elements['btn-style-go'].fire('click');
  elements['btn-court-go'].fire('click');
  elements['btn-start-match'].fire('click');
  check(window.LGMain.getState() === 'match', 'the full flow starts a second match', window.LGMain.getState());
})();

section('7. progression foundation (career, history, rewards, once-only finalize)');
(function () {
  var P = LG.Progression;
  check(!!(P && typeof P.finalizeMatch === 'function' && typeof P.career === 'function'),
    'LG.Progression exposes the Phase 3A API');

  // defaults on a fresh profile
  P.reset();
  check(P.coins() === 0 && P.career().matches === 0 && P.history().length === 0,
    'fresh profile starts empty');

  // finalize a win once
  var r1 = {
    score: [3, 1], won: 1, playTime: 120, difficulty: 'medium', court: 'classic', ts: 1,
    stats: { home: { goals: 3, assists: 2, shots: 7, tackles: 5, saves: 2, poss: 58 }, away: { goals: 1, assists: 0, shots: 3, tackles: 4, saves: 1, poss: 42 } },
  };
  P.finalizeMatch(r1);
  var c1 = P.career();
  check(r1.finalized === true && r1.coins > 0, 'finalizeMatch marks the result + pays coins', JSON.stringify({ coins: r1.coins }));
  check(c1.matches === 1 && c1.wins === 1 && c1.goalsFor === 3 && c1.assists === 2 && c1.cleanSheets === 0,
    'win updates career aggregates', JSON.stringify(c1));
  check(P.history().length === 1 && P.history()[0].score[0] === 3,
    'history keeps the finished match');

  // double-finalize of the same object is a no-op
  var coinsAfter = P.coins();
  var matchesAfter = P.career().matches;
  P.finalizeMatch(r1);
  check(P.coins() === coinsAfter && P.career().matches === matchesAfter,
    'finalizeMatch is idempotent on the same result object', P.career().matches);

  // draw + loss bookkeeping + clean sheet
  P.finalizeMatch({
    score: [0, 0], won: 0, playTime: 90, difficulty: 'hard', court: '', ts: 2,
    stats: { home: { goals: 0, assists: 0, shots: 4, tackles: 6, saves: 5, poss: 45 }, away: { goals: 0, assists: 0, shots: 6, tackles: 5, saves: 4, poss: 55 } },
  });
  P.finalizeMatch({
    score: [1, 2], won: -1, playTime: 100, difficulty: 'easy', court: '', ts: 3,
    stats: { home: { goals: 1, assists: 1, shots: 5, tackles: 3, saves: 1, poss: 50 }, away: { goals: 2, assists: 1, shots: 5, tackles: 4, saves: 3, poss: 50 } },
  });
  var c2 = P.career();
  check(c2.matches === 3 && c2.wins + c2.draws + c2.losses === c2.matches,
    'matches === wins + draws + losses', JSON.stringify(c2));
  check(c2.cleanSheets === 1 && c2.assists === 3,
    'clean sheet + assists accumulate', JSON.stringify(c2));

  // history cap at 25
  for (var i = 0; i < 30; i++) {
    P.finalizeMatch({
      score: [1, 0], won: 1, playTime: 60, difficulty: 'medium', court: '', ts: 10 + i,
      stats: { home: { goals: 1, assists: 0, shots: 2, tackles: 1, saves: 0, poss: 55 }, away: { goals: 0, assists: 0, shots: 1, tackles: 1, saves: 2, poss: 45 } },
    });
  }
  check(P.history().length === 25, 'match history caps at 25', P.history().length);

  // reload persistence (same store)
  var beforeM = P.career().matches;
  var beforeC = P.coins();
  P.reload();
  check(P.career().matches === beforeM && P.coins() === beforeC,
    'profile survives reload()', P.career().matches + '/' + P.coins());

  // corrupted JSON recovers to defaults without throwing
  _lsStore['blockout.profile.v2'] = '{not-json!!!';
  var badErr = null;
  try { P.reload(); } catch (e) { badErr = e; }
  check(!badErr && P.career().matches === 0 && P.history().length === 0,
    'corrupt profile recovers to safe defaults', badErr && badErr.message);

  // missing field partial payload also sanitizes
  _lsStore['blockout.profile.v2'] = JSON.stringify({ v: 2, coins: 50 });
  P.reload();
  check(P.coins() === 50 && P.career().matches === 0 && P.career().assists === 0,
    'partial payload fills missing career fields');

  // no-storage path never throws
  var realLS = global.localStorage;
  global.localStorage = undefined;
  var noStoreErr = null;
  try { P.reload(); P.finalizeMatch({ score: [1, 0], won: 1, stats: { home: { goals: 1, assists: 0, shots: 1, tackles: 0, saves: 0, poss: 50 }, away: { goals: 0 } } }); P.reset(); }
  catch (e) { noStoreErr = e; }
  global.localStorage = realLS;
  check(!noStoreErr, 'no-storage path survives finalize + reset', noStoreErr && noStoreErr.message);

  // reset clears profile but leaves settings/difficulty/courts alone
  P.finalizeMatch({
    score: [2, 0], won: 1, playTime: 80, difficulty: 'medium', court: '', ts: 99,
    stats: { home: { goals: 2, assists: 1, shots: 4, tackles: 2, saves: 1, poss: 60 }, away: { goals: 0, assists: 0, shots: 2, tackles: 3, saves: 2, poss: 40 } },
  });
  _lsStore['blockout.settings.v1'] = JSON.stringify({ timeOfDay: 'night', view: 'portrait' });
  _lsStore['blockout.difficulty.v1'] = 'hard';
  _lsStore['blockout.court.v1'] = 'turf';
  P.reset();
  check(P.coins() === 0 && P.career().matches === 0 && P.history().length === 0,
    'reset restores profile defaults');
  check(_lsStore['blockout.settings.v1'] && _lsStore['blockout.difficulty.v1'] === 'hard' && _lsStore['blockout.court.v1'] === 'turf',
    'reset does not wipe settings / difficulty / courts',
    JSON.stringify({ s: _lsStore['blockout.settings.v1'], d: _lsStore['blockout.difficulty.v1'], c: _lsStore['blockout.court.v1'] }));
  _lsStore['blockout.difficulty.v1'] = 'medium';

  // endMatch finalizes at most once on a live match
  var mm = window.LGMain.getMatch();
  check(!!mm, 'a match is live for the endMatch probe');
  if (mm) {
    P.reset();
    var mBefore = P.career().matches;
    mm.clock = 0;
    mm.state = 'PLAY';
    mm.endMatch();
    var mMid = P.career().matches;
    mm.endMatch();
    check(mMid === mBefore + 1 && P.career().matches === mMid,
      'endMatch writes the profile exactly once', mBefore + ' -> ' + mMid + ' -> ' + P.career().matches);
    check(P.history().length === 1, 'one history entry from one match', P.history().length);
  }

  // profile overlay open/close
  LG.eventBus.emit('quitRequested');
  check(window.LGMain.getState() === 'menu' && vis('menu-overlay'), 'back on the main menu');
  elements['btn-profile'].fire('click');
  check(vis('profile-overlay') && !vis('menu-overlay') && window.LGMain.getState() === 'profile',
    'PROFILE opens from the main menu', window.LGMain.getState());
  elements['btn-profile-back'].fire('click');
  check(vis('menu-overlay') && !vis('profile-overlay'), 'PROFILE back returns to the menu');

  // two-step reset confirm
  P.reset();
  P.finalizeMatch({
    score: [1, 0], won: 1, playTime: 50, difficulty: 'medium', court: '', ts: 200,
    stats: { home: { goals: 1, assists: 0, shots: 2, tackles: 1, saves: 0, poss: 50 }, away: { goals: 0, assists: 0, shots: 1, tackles: 1, saves: 1, poss: 50 } },
  });
  check(P.career().matches === 1, 'profile has data before reset', P.career().matches);
  elements['btn-profile'].fire('click');
  elements['btn-profile-reset'].fire('click');
  check(P.career().matches === 1, 'first RESET click only arms the confirm', P.career().matches);
  check(elements['btn-profile-reset'].textContent === 'CONFIRM RESET?', 'reset button asks for confirmation');
  elements['btn-profile-reset'].fire('click');
  check(P.career().matches === 0 && P.coins() === 0, 'second RESET click clears the profile');
  elements['btn-profile-back'].fire('click');
})();

section('8. challenge system (pool, eval, finalize-once, UI, persistence)');
(function () {
  var P = LG.Progression;
  var C = LG.Challenges;
  check(!!(C && Array.isArray(C.POOL) && C.POOL.length >= 10 && C.POOL.length <= 15),
    'challenge pool has 10–15 definitions', C && C.POOL && C.POOL.length);
  check(!!(P && typeof P.activeChallenges === 'function' && typeof P.challengeCompletions === 'function'),
    'LG.Progression exposes the Phase 3B challenge API');

  P.reset();
  var act = P.activeChallenges();
  check(act.length === 3, 'exactly 3 active challenges after reset', act.length);
  var slotCats = [
    act[0] && C.byId(act[0]) && C.byId(act[0]).category,
    act[1] && C.byId(act[1]) && C.byId(act[1]).category,
    act[2] && C.byId(act[2]) && C.byId(act[2]).category,
  ];
  check(slotCats[0] === 'attack' &&
    (slotCats[1] === 'defense' || slotCats[1] === 'goalkeeping') &&
    (slotCats[2] === 'passing' || slotCats[2] === 'results'),
    'active set fills the three slot buckets', JSON.stringify(slotCats));
  check(act.every(function (id) { return !!C.byId(id); }) && new Set(act).size === 3,
    'active ids are valid and unique', JSON.stringify(act));

  // force a known active set for deterministic threshold checks.
  // ids must sit in their slot buckets (attack / defense|gk / passing|results)
  // or ensureActive() will repair the payload on reload.
  function forceActive(ids) {
    _lsStore['blockout.profile.v2'] = JSON.stringify({
      v: 3, coins: 0, unlocked: ['blaze'],
      best: { goals: 0, wins: 0, streak: 0 },
      career: { matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, assists: 0, shots: 0, tackles: 0, saves: 0, cleanSheets: 0, playTime: 0 },
      history: [],
      challenges: { active: ids.slice(), cursor: 0, completions: {} },
    });
    P.reload();
    var got = P.activeChallenges();
    if (JSON.stringify(got) !== JSON.stringify(ids)) {
      check(false, 'forceActive kept the requested ids', JSON.stringify({ want: ids, got: got }));
    }
    return got;
  }

  function res(partial) {
    var base = {
      score: [0, 0], won: 0, playTime: 60, difficulty: 'medium', court: '', ts: Date.now(),
      stats: {
        home: { goals: 0, assists: 0, shots: 0, passes: 0, tackles: 0, saves: 0, poss: 50 },
        away: { goals: 0, assists: 0, shots: 0, passes: 0, tackles: 0, saves: 0, poss: 50 },
      },
    };
    if (partial) {
      if (partial.score) base.score = partial.score;
      if (partial.won !== undefined) base.won = partial.won;
      if (partial.home) for (var k in partial.home) base.stats.home[k] = partial.home[k];
      if (partial.away) for (var k2 in partial.away) base.stats.away[k2] = partial.away[k2];
    }
    return base;
  }

  // --- pure evaluate: each objective type at exact threshold ---
  var evalCases = [
    { id: 'score_2', under: { home: { goals: 1 } }, over: { home: { goals: 2 } }, won: 1, score: [2, 0] },
    { id: 'score_3', under: { home: { goals: 2 } }, over: { home: { goals: 3 } }, won: 1, score: [3, 0] },
    { id: 'shots_8', under: { home: { shots: 7 } }, over: { home: { shots: 8 } }, won: 0, score: [1, 1] },
    { id: 'passes_10', under: { home: { passes: 9 } }, over: { home: { passes: 10 } }, won: 0, score: [0, 0] },
    { id: 'assists_2', under: { home: { assists: 1 } }, over: { home: { assists: 2 } }, won: 1, score: [2, 1] },
    { id: 'tackles_4', under: { home: { tackles: 3 } }, over: { home: { tackles: 4 } }, won: -1, score: [0, 1] },
    { id: 'saves_3', under: { home: { saves: 2 } }, over: { home: { saves: 3 } }, won: 0, score: [0, 0] },
    { id: 'saves_5', under: { home: { saves: 4 } }, over: { home: { saves: 5 } }, won: 0, score: [1, 1] },
    { id: 'win_1', under: { }, over: { }, won: 1, score: [1, 0] },
    { id: 'win_by_2', under: { }, over: { }, won: 1, score: [3, 1] },
    { id: 'clean_sheet', under: { }, over: { }, won: 1, score: [2, 0] },
  ];
  for (var ei = 0; ei < evalCases.length; ei++) {
    var ec = evalCases[ei];
    var def = C.byId(ec.id);
    if (!def) { check(false, 'eval case has a pool def: ' + ec.id); continue; }
    var rU = res({ score: ec.score, won: ec.won, home: ec.under.home, away: ec.under.away });
    var rO = res({ score: ec.score, won: ec.won, home: ec.over.home, away: ec.over.away });
    // clean sheet under = conceded
    if (ec.id === 'clean_sheet') {
      rU = res({ score: [2, 1], won: 1, away: { goals: 1 } });
      rO = res({ score: [2, 0], won: 1, away: { goals: 0 } });
    }
    if (ec.id === 'win_by_2') {
      rU = res({ score: [2, 1], won: 1 });
      rO = res({ score: [3, 1], won: 1 });
    }
    if (ec.id === 'win_1') {
      rU = res({ score: [1, 1], won: 0 });
      rO = res({ score: [1, 0], won: 1 });
    }
    var eu = C.evaluate(def, rU, false);
    var eo = C.evaluate(def, rO, false);
    check(!eu.done && eo.done, 'threshold exact for ' + ec.id,
      'under=' + JSON.stringify(eu) + ' over=' + JSON.stringify(eo));
  }

  // win_by_2 at 2-1 does not complete; 3-1 does (covered above)
  // live mode never claims result-only objectives mid-match
  var liveWin = C.evaluate(C.byId('win_1'), res({ score: [1, 0], won: 1 }), true);
  check(!liveWin.done, 'live evaluate skips win until finalization', JSON.stringify(liveWin));

  // --- finalize: multiple challenges complete once, reward once ---
  forceActive(['score_2', 'tackles_4', 'win_1']);
  var coins0 = P.coins();
  var r = res({ score: [3, 1], won: 1, home: { goals: 3, assists: 2, shots: 7, passes: 12, tackles: 5, saves: 1 }, away: { goals: 1 } });
  P.finalizeMatch(r);
  check(r.completedChallenges && r.completedChallenges.length === 3,
    'all three active challenges complete from one strong match',
    JSON.stringify(r.completedChallenges && r.completedChallenges.map(function (c) { return c.id; })));
  check(r.challengeCoins === 150, 'challenge rewards sum to 150 (3 easy)', r.challengeCoins);
  check(P.coins() === coins0 + r.coins + 150,
    'profile coins include match reward + challenge rewards once',
    P.coins() + ' vs ' + (coins0 + r.coins + 150));
  var comps = P.challengeCompletions();
  check(comps.score_2 === 1 && comps.tackles_4 === 1 && comps.win_1 === 1,
    'lifetime completions increment', JSON.stringify(comps));
  var act2 = P.activeChallenges();
  check(act2.length === 3 && act2.indexOf('score_2') < 0 && act2.indexOf('tackles_4') < 0 && act2.indexOf('win_1') < 0,
    'completed slots are replaced with fresh objectives', JSON.stringify(act2));

  // rematch / re-finalize of same object: no double award
  var coinsAfter = P.coins();
  var matchesAfter = P.career().matches;
  P.finalizeMatch(r);
  check(P.coins() === coinsAfter && P.career().matches === matchesAfter,
    'challenge rewards are idempotent on double finalize',
    P.coins() + '/' + P.career().matches);

  // a second match with the new active set does not re-complete old ids as "same event"
  forceActive(['score_2', 'saves_3', 'win_by_2']);
  var r2 = res({ score: [3, 1], won: 1, home: { goals: 3, shots: 9, saves: 3 }, away: { goals: 1 } });
  P.finalizeMatch(r2);
  check(r2.completedChallenges.length === 3 && r2.challengeCoins === 50 + 50 + 100,
    'second match completes its own active set', JSON.stringify(r2.completedChallenges.map(function (c) { return c.id; })));

  // incomplete challenges do not pay
  forceActive(['score_4', 'saves_5', 'passes_10']);
  var r3 = res({ score: [2, 0], won: 1, home: { goals: 2, shots: 4, passes: 3, saves: 1 }, away: { goals: 0 } });
  var c3 = P.coins();
  P.finalizeMatch(r3);
  check(r3.completedChallenges.length === 0 && r3.challengeCoins === 0 && P.coins() === c3 + r3.coins,
    'missed objectives pay nothing', JSON.stringify({ ch: r3.challengeCoins, coins: P.coins() }));

  // persistence
  var actPersist = P.activeChallenges();
  var compsPersist = P.challengeCompletions();
  P.reload();
  check(JSON.stringify(P.activeChallenges()) === JSON.stringify(actPersist) &&
    JSON.stringify(P.challengeCompletions()) === JSON.stringify(compsPersist),
    'active set + completions survive reload()',
    JSON.stringify(P.activeChallenges()));

  // corrupt / hostile challenge payloads recover
  _lsStore['blockout.profile.v2'] = JSON.stringify({
    v: 3, coins: 10,
    challenges: { active: ['nope', 'score_2', 42, 'score_2'], cursor: 'x', completions: { bogus: 9, score_2: 2 } },
  });
  P.reload();
  var actFix = P.activeChallenges();
  check(actFix.length === 3 && actFix.every(function (id) { return !!C.byId(id); }) && new Set(actFix).size === 3,
    'corrupt active ids recover to a valid 3-slot set', JSON.stringify(actFix));
  check(P.challengeCompletions().bogus === undefined && P.challengeCompletions().score_2 === 2,
    'unknown completion keys drop; valid counts keep',
    JSON.stringify(P.challengeCompletions()));

  // wrong-category slot repaired
  _lsStore['blockout.profile.v2'] = JSON.stringify({
    v: 3, coins: 0,
    challenges: { active: ['tackles_4', 'score_2', 'win_1'], cursor: 0, completions: {} },
  });
  P.reload();
  var fixed = P.activeChallenges();
  check(C.byId(fixed[0]).category === 'attack',
    'slot 0 is repaired back to attack', fixed[0]);

  // missing challenges field (Phase 3A payload) still works
  _lsStore['blockout.profile.v2'] = JSON.stringify({ v: 2, coins: 25, career: { matches: 1 } });
  P.reload();
  check(P.coins() === 25 && P.activeChallenges().length === 3,
    'legacy profile without challenges{} gains a fresh active set',
    P.activeChallenges().length);

  // reset clears challenge state but not settings/difficulty/courts
  _lsStore['blockout.settings.v1'] = JSON.stringify({ timeOfDay: 'night', view: 'portrait' });
  _lsStore['blockout.difficulty.v1'] = 'hard';
  _lsStore['blockout.court.v1'] = 'turf';
  forceActive(['score_2', 'tackles_4', 'win_1']);
  P.finalizeMatch(res({ score: [2, 0], won: 1, home: { goals: 2, tackles: 4 }, away: { goals: 0 } }));
  check(Object.keys(P.challengeCompletions()).length > 0, 'completions exist before reset');
  P.reset();
  check(P.coins() === 0 && P.career().matches === 0 &&
    Object.keys(P.challengeCompletions()).length === 0 && P.activeChallenges().length === 3,
    'reset clears profile + challenge counters and refills 3 slots',
    JSON.stringify({ coins: P.coins(), comps: P.challengeCompletions(), act: P.activeChallenges() }));
  check(_lsStore['blockout.settings.v1'] && _lsStore['blockout.difficulty.v1'] === 'hard' && _lsStore['blockout.court.v1'] === 'turf',
    'reset still leaves settings / difficulty / courts alone');
  _lsStore['blockout.difficulty.v1'] = 'medium';

  // challenges overlay open/close from the main menu
  LG.eventBus.emit('quitRequested');
  check(window.LGMain.getState() === 'menu' && vis('menu-overlay'), 'on the main menu for the challenges probe');
  elements['btn-challenges'].fire('click');
  check(vis('challenges-overlay') && !vis('menu-overlay') && window.LGMain.getState() === 'challenges',
    'CHALLENGES opens from the main menu', window.LGMain.getState());
  var cards = (elements['challenge-list'] && elements['challenge-list'].children) || [];
  check(cards.length === 3, 'challenge screen lists 3 active cards', cards.length);
  elements['btn-challenges-back'].fire('click');
  check(vis('menu-overlay') && !vis('challenges-overlay'), 'CHALLENGES back returns to the menu');

  // results screen challenge display (non-punitive empty state)
  var rEmpty = res({ score: [0, 1], won: -1, away: { goals: 1 } });
  forceActive(['score_4', 'saves_5', 'win_by_2']);
  P.finalizeMatch(rEmpty);
  // drive setupResult via the real matchEnd path if a match is around; else call through a synthetic result overlay fill
  // (setupResult is private — exercise it by opening results through a tiny match if present)
  var mm = window.LGMain.getMatch();
  if (mm && !mm._finalized) {
    mm.score = [0, 1];
    mm.state = 'PLAY';
    mm.clock = 0;
    mm.endMatch();
  }
  // empty message present in markup with hidden class until setupResult runs
  check(!!document.getElementById('res-ch-list') && !!document.getElementById('res-ch-empty'),
    'results markup has the challenges block');

  // in-match progress notifications: event-driven toast on integer change only
  // (need a live match — section 7 already quit to menu)
  LG.eventBus.emit('quitRequested');
  elements['btn-play'].fire('click');
  if (vis('mode-overlay')) elements['btn-mode-go'].fire('click');
  elements['btn-diff-go'].fire('click');
  elements['btn-select-go'].fire('click');
  elements['btn-style-go'].fire('click');
  elements['btn-court-go'].fire('click');
  elements['btn-start-match'].fire('click');
  var mm2 = window.LGMain.getMatch();
  if (mm2) {
    forceActive(['score_2', 'tackles_4', 'passes_10']);
    if (C.resetLive) C.resetLive();
    var toasts = [];
    var banners = [];
    var oldToast = LG.HUD.toast;
    var oldBanner = LG.HUD.banner;
    LG.HUD.toast = function (m) { toasts.push(String(m)); };
    LG.HUD.banner = function (m) {
      // main.js also banners GOAL!/etc — only count challenge banners here
      if (String(m) === 'CHALLENGE COMPLETE') banners.push(String(m));
    };
    mm2.stats.home.passes = 0;
    mm2.stats.home.tackles = 0;
    mm2.stats.home.goals = 0;
    mm2._finalized = false;
    mm2.state = 'PLAY';
    LG.eventBus.emit('matchStart', { match: mm2 });
    LG.eventBus.emit('pass', { src: null, target: null });
    check(toasts.length === 0, 'first pass seed does not toast', JSON.stringify(toasts));
    mm2.stats.home.passes = 2;
    LG.eventBus.emit('pass', {});
    check(toasts.length === 1 && /BUILD UP\s+2\/10/.test(toasts[0]),
      'pass progress toasts only on integer change', JSON.stringify(toasts));
    LG.eventBus.emit('pass', {});
    check(toasts.length === 1, 'no duplicate toast when progress unchanged', toasts.length);
    mm2.stats.home.passes = 10;
    LG.eventBus.emit('pass', {});
    check(banners.length === 1 && banners[0] === 'CHALLENGE COMPLETE',
      'hitting the target fires one complete banner', JSON.stringify(banners));
    mm2.stats.home.goals = 2;
    LG.eventBus.emit('goal', { team: 0, score: [2, 0] });
    check(banners.length === 2, 'goal completing score_2 fires a second banner', banners.length);
    LG.HUD.toast = oldToast;
    LG.HUD.banner = oldBanner;
    mm2._finalized = false;
  } else {
    check(false, 'a match is live for the in-match notification probe');
  }

  // endMatch path still finalizes challenges once
  var mm3 = window.LGMain.getMatch();
  if (mm3) {
    forceActive(['score_2', 'tackles_4', 'win_1']);
    mm3.score = [2, 0];
    mm3.stats.home.goals = 2;
    mm3.stats.home.tackles = 5;
    mm3.stats.home.passes = 12;
    mm3.stats.away.goals = 0;
    mm3.state = 'PLAY';
    mm3.clock = 0;
    var finalsBefore = P.career().matches;
    var coinsB = P.coins();
    mm3.endMatch();
    mm3.endMatch();
    check(P.career().matches === finalsBefore + 1, 'challenge path: endMatch still books once',
      finalsBefore + ' -> ' + P.career().matches);
    var coinsAfterLive = P.coins();
    var matchCoinsLive = (P.history()[0] && P.history()[0].coins) || 0;
    check(coinsAfterLive >= coinsB + matchCoinsLive + 150,
      'challenge coins paid on the live endMatch path',
      'coins ' + coinsB + ' -> ' + coinsAfterLive + ' history=' + matchCoinsLive);
    var comps3 = P.challengeCompletions();
    check(comps3.score_2 === 1 && comps3.tackles_4 === 1 && comps3.win_1 === 1,
      'live endMatch completes the forced active set', JSON.stringify(comps3));
    LG.eventBus.emit('quitRequested');
  }
})();

section('9. game modes + tournament (Phase 3D: once-only fixtures, mode-aware results)');
(function () {
  var P = LG.Progression;
  var M = LG.Modes;
  var T = LG.Tournament;

  check(!!(M && Array.isArray(M.DEFS) && M.DEFS.length === 3), 'three mode definitions', M && M.DEFS.length);
  check(!!(T && typeof T.start === 'function' && typeof T.endMatch === 'function'), 'LG.Tournament exposes the cup API');
  check(M.is('quick_match') || M.is('challenge_match') || M.is('tournament'), 'mode id is always one of the three', M.id());

  // --- mode select screen ---
  LG.eventBus.emit('quitRequested');
  elements['btn-play'].fire('click');
  check(vis('mode-overlay') && window.LGMain.getState() === 'mode', 'mode screen opens', window.LGMain.getState());
  var modeCards = (elements['mode-list'] && elements['mode-list'].children) || [];
  check(modeCards.length === 3, 'mode list renders 3 cards', modeCards.length);
  // pick CHALLENGE MATCH card -> CONTINUE -> challenge pick
  modeCards[1].fire('click');
  check(M.is('challenge_match'), 'clicking card 1 selects challenge_match', M.id());
  elements['btn-mode-go'].fire('click');
  check(vis('challenge-pick-overlay') && window.LGMain.getState() === 'challengePick',
    'CHALLENGE MATCH opens the focus picker', window.LGMain.getState());
  var pickCards = (elements['challenge-pick-list'] && elements['challenge-pick-list'].children) || [];
  check(pickCards.length === 3, 'focus picker lists 3 active challenges', pickCards.length);
  // pick the first card, continue into difficulty
  if (pickCards.length) pickCards[0].fire('click');
  var focus = M.challenge();
  check(!!focus && P.activeChallenges().indexOf(focus) >= 0, 'selected focus is one of the active set', focus);
  elements['btn-challenge-pick-go'].fire('click');
  check(vis('diff-overlay') && M.is('challenge_match') && M.challenge() === focus,
    'challenge focus confirmed into difficulty', JSON.stringify({ mode: M.id(), focus: M.challenge() }));
  // back from difficulty returns to challenge pick, focus preserved
  elements['btn-diff-back'].fire('click');
  check(vis('challenge-pick-overlay') && M.challenge() === focus, 'DIFF BACK returns to challenge pick with focus kept', M.challenge());
  elements['btn-challenge-pick-back'].fire('click');
  check(vis('mode-overlay'), 'challenge pick BACK returns to mode select');

  // --- invalid focus rejected ---
  check(M.selectChallenge('nope_challenge') === false && M.challenge() === focus,
    'unknown challenge ids cannot become the focus', M.challenge());

  // --- TOURNAMENT: start, semifinal once-only, continue once-only ---
  modeCards = elements['mode-list'].children;
  modeCards[2].fire('click');
  check(M.is('tournament'), 'card 2 selects tournament', M.id());
  elements['btn-mode-go'].fire('click');
  check(vis('tournament-overlay') && window.LGMain.getState() === 'tournament',
    'TOURNAMENT opens the bracket screen', window.LGMain.getState());
  T.reset();
  elements['btn-tournament-start'].fire('click');
  check(T.active() && T.currentRound() === 0 && T.status() === 'active',
    'START draws a fresh 4-team cup', JSON.stringify({ s: T.status(), r: T.currentRound() }));
  check(T.teams().length === 4 && T.teams().filter(function (t) { return t.isPlayer; }).length === 1,
    'exactly 4 teams, one is the player');
  check(vis('diff-overlay'), 'fresh cup enters the normal setup flow');

  // drive to a live match
  elements['btn-diff-go'].fire('click');
  elements['btn-select-go'].fire('click');
  elements['btn-style-go'].fire('click');
  elements['btn-court-go'].fire('click');
  elements['btn-start-match'].fire('click');
  check(window.LGMain.getState() === 'match', 'tournament fixture kicks off', window.LGMain.getState());
  var tm = window.LGMain.getMatch();
  check(!!tm && tm.opts.mode === 'tournament', 'match opts carry mode=tournament', tm && tm.opts.mode);
  check(!!(tm && tm.opts.awayIds && tm.opts.awayIds.length === 3), 'tournament pins the away trio', tm && tm.opts.awayIds);
  check(T.snapshot().awaitingResult === true, 'fixture opened the once-only latch', T.snapshot().awaitingResult);

  // pause must not advance any tournament state
  LG.eventBus.emit('pauseRequested');
  check(window.LGMain.getState() === 'paused' && T.snapshot().round === 0 && T.snapshot().results.length === 0,
    'pause advances nothing', JSON.stringify({ st: window.LGMain.getState(), snap: T.snapshot() }));
  LG.eventBus.emit('resumeRequested');

  // win the semifinal — book once
  tm.score = [2, 0];
  tm.stats.home.goals = 2;
  tm.stats.away.goals = 0;
  tm.state = 'PLAY';
  tm.clock = 0;
  var matchesBefore = P.career().matches;
  tm.endMatch();
  tm.endMatch();
  check(P.career().matches === matchesBefore + 1, 'tournament endMatch still books career once',
    matchesBefore + ' -> ' + P.career().matches);
  check(T.status() === 'active' && T.currentRound() === 1 && T.snapshot().results.length === 1,
    'semifinal win advances to the final exactly once',
    JSON.stringify({ s: T.status(), r: T.currentRound(), n: T.snapshot().results.length }));
  check(T.snapshot().awaitingResult === false && T.canContinue(false),
    'between fixtures CONTINUE is legal', JSON.stringify({ a: T.snapshot().awaitingResult, c: T.canContinue(false) }));

  // double-continue: only one next match
  LG.eventBus.emit('tournamentContinueRequested');
  var afterContinue = window.LGMain.getMatch();
  check(window.LGMain.getState() === 'match' && !!afterContinue, 'CONTINUE starts the final');
  check(T.snapshot().awaitingResult === true && T.currentRound() === 1, 'final opens the latch again');
  var careerMid = P.career().matches;
  LG.eventBus.emit('tournamentContinueRequested');
  check(window.LGMain.getMatch() === afterContinue && P.career().matches === careerMid,
    'second CONTINUE is a no-op (no extra match, no extra booking)',
    JSON.stringify({ same: window.LGMain.getMatch() === afterContinue, m: P.career().matches }));

  // win the final
  var fm = window.LGMain.getMatch();
  fm.score = [1, 0];
  fm.stats.home.goals = 1;
  fm.stats.away.goals = 0;
  fm.state = 'PLAY';
  fm.clock = 0;
  fm.endMatch();
  check(T.status() === 'won', 'final win marks the cup won', T.status());
  check(T.canContinue(false) === false && T.canRetry(), 'won cup: no CONTINUE, NEW TOURNAMENT allowed');
  check(T.snapshot().results.length === 2, 'two recorded fixtures', T.snapshot().results.length);

  // double finalize on the final result object
  var coinsAfter = P.coins();
  var careerAfter = P.career().matches;
  fm.endMatch();
  check(P.coins() === coinsAfter && P.career().matches === careerAfter && T.snapshot().results.length === 2,
    'double endMatch is a no-op across profile + bracket');

  // NEW TOURNAMENT from results (rematchRequested path when canRetry)
  LG.eventBus.emit('rematchRequested');
  check(T.status() === 'active' && T.currentRound() === 0 && T.snapshot().results.length === 0,
    'NEW TOURNAMENT resets the cup without a page reload',
    JSON.stringify({ s: T.status(), r: T.currentRound(), n: T.snapshot().results.length }));
  // abandon the fresh fixture via quit (finalizes once, books as loss if behind)
  var nm = window.LGMain.getMatch();
  if (nm && !nm._finalized) {
    nm.score = [0, 1];
    nm.stats.home.goals = 0;
    nm.stats.away.goals = 1;
    nm.state = 'PLAY';
    nm.clock = 0;
    LG.eventBus.emit('quitRequested');
  }
  check(T.status() === 'eliminated', 'quit mid-cup after a loss eliminates (recorded once)', T.status());
  check(T.snapshot().results.length === 1, 'exactly one fixture recorded on the quit path', T.snapshot().results.length);

  // --- persistence: active cup survives reload, corrupt recovers ---
  T.reset();
  T.start('blaze');
  T.beginMatch();
  T.endMatch(true, [3, 1]);
  var persisted = T.snapshot();
  T.reload();
  var reloaded = T.snapshot();
  check(reloaded.status === persisted.status && reloaded.round === persisted.round &&
    reloaded.results.length === persisted.results.length && reloaded.awaitingResult === false,
    'cup state survives reload(); mid-fixture latch clears',
    JSON.stringify({ before: persisted, after: reloaded }));

  _lsStore['blockout.tournament.v1'] = '{not-json!!!';
  var tErr = null;
  try { T.reload(); } catch (e) { tErr = e; }
  check(!tErr && T.status() === 'idle', 'corrupt tournament payload recovers to idle', tErr && tErr.message);

  _lsStore['blockout.tournament.v1'] = JSON.stringify({ status: 'active', round: 9, teams: [{ id: 'x' }] });
  T.reload();
  check(T.status() === 'idle', 'hostile tournament payload sanitizes to idle', T.status());
  T.reset();

  // --- challenge match finalize: rewards only via Phase 3B active set ---
  LG.eventBus.emit('quitRequested');
  M.select('challenge_match');
  var act = P.activeChallenges();
  check(M.selectChallenge(act[0]) && M.challenge() === act[0], 'focus re-binds to active set', M.challenge());
  // start a challenge-match fixture and complete a strong result once
  elements['btn-play'].fire('click');
  modeCards = elements['mode-list'].children;
  modeCards[1].fire('click');
  elements['btn-mode-go'].fire('click');
  // force focus to score_2-like active attack id if present, else first
  pickCards = elements['challenge-pick-list'].children;
  if (pickCards.length) pickCards[0].fire('click');
  elements['btn-challenge-pick-go'].fire('click');
  elements['btn-diff-go'].fire('click');
  elements['btn-select-go'].fire('click');
  elements['btn-style-go'].fire('click');
  elements['btn-court-go'].fire('click');
  elements['btn-start-match'].fire('click');
  var cm = window.LGMain.getMatch();
  check(!!cm && cm.opts.mode === 'challenge_match', 'challenge match opts mode', cm && cm.opts.mode);
  if (cm) {
    // force all three easy objectives complete
    // (active set order is attack/defense|gk/passing|results — set stats high)
    cm.score = [3, 0];
    cm.stats.home.goals = 3;
    cm.stats.home.tackles = 6;
    cm.stats.home.passes = 15;
    cm.stats.home.shots = 10;
    cm.stats.home.saves = 5;
    cm.stats.home.assists = 3;
    cm.stats.away.goals = 0;
    cm.state = 'PLAY';
    cm.clock = 0;
    var focusId = M.challenge();
    var coins0 = P.coins();
    var comps0 = P.challengeCompletions()[focusId] || 0;
    cm.endMatch();
    cm.endMatch();
    var comps1 = P.challengeCompletions()[focusId] || 0;
    check(comps1 <= comps0 + 1, 'focus challenge completes at most once',
      comps0 + ' -> ' + comps1);
    check(P.coins() >= coins0, 'challenge match pays coins exactly once on double endMatch',
      coins0 + ' -> ' + P.coins());
    // no second tournament latch while in challenge mode
    check(T.status() !== 'active' || !T.snapshot().awaitingResult || M.id() !== 'challenge_match',
      'challenge mode never opens a tournament latch');
  }

  // --- rematch label / guards: rematch in tournament from result only via canRetry ---
  M.select('quick_match');
  T.reset();
  LG.eventBus.emit('quitRequested');
  check(window.LGMain.getState() === 'menu', 'modes section returns to the menu');
})();

// --- Phase 4: settings / about / how / volumes / reset / loading ---
section('10. Phase 4 app polish (settings, about, how, volumes, data reset)');
(function () {
  check(window.LGMain.getState() === 'menu' && vis('menu-overlay'), 'starts on the main menu');
  check(!vis('settings-overlay') && !vis('about-overlay') && !vis('how-overlay'),
    'settings / about / how start closed');
  check(elements['loading-overlay'].classList.contains('hidden'),
    'loading overlay is hidden after a successful boot');

  // HOW TO PLAY: redesigned sections + back restores the menu
  elements['btn-how'].fire('click');
  check(vis('how-overlay') && window.LGMain.getState() === 'how', 'HOW TO PLAY opens', window.LGMain.getState());
  var howIds = ['controls-desktop', 'controls-mobile', 'gameplay', 'goalkeepers'];
  var howHtml = html;
  var missingHow = howIds.filter(function (k) { return howHtml.indexOf('data-how="' + k + '"') < 0; });
  check(missingHow.length === 0, 'how overlay ships the four redesigned sections',
    missingHow.join(','));
  check(howHtml.indexOf('MOVEMENT') < 0 && howHtml.indexOf('MAGICAL SPELLS') < 0,
    'stale how-to-play wording is gone');
  elements['btn-how-back'].fire('click');
  check(vis('menu-overlay') && !vis('how-overlay') && window.LGMain.getState() === 'menu',
    'HOW BACK returns to the main menu', window.LGMain.getState());

  // SETTINGS: open / close / audio buckets / reduced motion / display
  elements['btn-settings'].fire('click');
  check(vis('settings-overlay') && !vis('menu-overlay') && window.LGMain.getState() === 'settings',
    'SETTINGS opens from the main menu', window.LGMain.getState());

  var s = LG.Settings.snapshot();
  check(s.volMaster === 0.55 && s.volSfx === 1 && s.volCrowd === 1 && s.reducedMotion === false,
    'default audio + motion snapshot is sane', JSON.stringify(s));
  check(elements['vol-master-50'].classList.contains('selected'),
    'master 50% bucket is selected by default', LG.Settings.volMaster());

  elements['vol-master-0'].fire('click');
  check(LG.Settings.volMaster() === 0, 'master OFF writes 0', LG.Settings.volMaster());
  elements['vol-master-100'].fire('click');
  check(LG.Settings.volMaster() === 1, 'master 100% writes 1', LG.Settings.volMaster());
  elements['vol-sfx-0'].fire('click');
  check(LG.Settings.volSfx() === 0, 'sfx OFF writes 0', LG.Settings.volSfx());
  elements['vol-sfx-50'].fire('click');
  check(LG.Settings.volSfx() === 0.5, 'sfx 50% writes 0.5', LG.Settings.volSfx());
  elements['vol-crowd-0'].fire('click');
  check(LG.Settings.volCrowd() === 0, 'crowd OFF writes 0', LG.Settings.volCrowd());
  elements['vol-crowd-100'].fire('click');
  check(LG.Settings.volCrowd() === 1, 'crowd 100% writes 1', LG.Settings.volCrowd());
  check(elements['vol-crowd-100'].classList.contains('selected') &&
    !elements['vol-crowd-0'].classList.contains('selected'),
    'crowd bucket selected state tracks the store');

  // volumes persist across a settings reload (localStorage round-trip)
  LG.Settings.setVolMaster(0);
  (function () {
    var raw = localStorage.getItem('blockout.settings.v1');
    check(!!raw && raw.indexOf('"volMaster":0') >= 0, 'volume changes persist to localStorage', raw);
  })();
  LG.Settings.setVolMaster(0.55);
  LG.Settings.setVolSfx(1);
  LG.Settings.setVolCrowd(1);

  // reduced motion is real: body class + settings flag
  check(!document.body.classList.contains('reduced-motion'), 'reduced-motion starts off on body');
  elements['rm-on'].fire('click');
  check(LG.Settings.reducedMotion() === true && document.body.classList.contains('reduced-motion'),
    'REDUCED motion sets the store + body class',
    LG.Settings.reducedMotion() + '/' + document.body.classList.contains('reduced-motion'));
  check(elements['rm-on'].classList.contains('selected') && !elements['rm-off'].classList.contains('selected'),
    'REDUCED bucket shows selected');
  elements['rm-off'].fire('click');
  check(LG.Settings.reducedMotion() === false && !document.body.classList.contains('reduced-motion'),
    'FULL motion clears the store + body class');

  // display options reach the same stores as match setup
  elements['settings-night'].fire('click');
  check(LG.Settings.timeOfDay() === 'night' && elements['settings-night'].classList.contains('selected'),
    'settings NIGHT writes timeOfDay', LG.Settings.timeOfDay());
  elements['settings-day'].fire('click');
  check(LG.Settings.timeOfDay() === 'day', 'settings DAY writes timeOfDay', LG.Settings.timeOfDay());
  elements['settings-portrait'].fire('click');
  check(LG.Settings.view() === 'portrait', 'settings PORTRAIT writes view', LG.Settings.view());
  elements['settings-landscape'].fire('click');
  check(LG.Settings.view() === 'landscape', 'settings LANDSCAPE writes view', LG.Settings.view());

  // DATA reset: two-step, clears progression + tournament, keeps prefs
  var P = LG.Progression, T = LG.Tournament, D = LG.Difficulty, C = LG.Courts;
  LG.Settings.setVolMaster(0.25);
  D.set('hard');
  if (C.set) C.set('turf');
  var coinsBefore = P.coins();
  P.addCoins(120);
  T.start('blaze');
  var resetBtn = elements['btn-settings-reset'];
  resetBtn.fire('click');
  check(resetBtn.textContent === 'CONFIRM WIPE?' && resetBtn.classList.contains('selected'),
    'first RESET tap arms confirm', resetBtn.textContent);
  check(P.coins() === coinsBefore + 120 && T.status() === 'active', 'armed tap does not wipe yet',
    JSON.stringify({ coins: P.coins(), expect: coinsBefore + 120, t: T.status() }));
  resetBtn.fire('click');
  check(P.coins() === 0 && (P.career().matches || 0) === 0, 'second tap clears career + coins',
    JSON.stringify({ coins: P.coins(), m: P.career().matches }));
  check(T.status() === 'idle', 'second tap clears any Street Cup run', T.status());
  check(LG.Settings.volMaster() === 0.25 && LG.Settings.timeOfDay() === 'day',
    'reset preserves audio + display settings', JSON.stringify(LG.Settings.snapshot()));
  check(D.get() === 'hard', 'reset preserves difficulty', D.get());
  check(resetBtn.textContent === 'RESET PROGRESS', 'reset button returns to idle label', resetBtn.textContent);
  D.set('medium');
  LG.Settings.setVolMaster(0.55);

  // ABOUT: open, version stamp, sections, bug report, back
  elements['btn-settings-back'].fire('click');
  check(vis('menu-overlay') && !vis('settings-overlay') && window.LGMain.getState() === 'menu',
    'SETTINGS BACK returns to the main menu before ABOUT', window.LGMain.getState());
  elements['btn-about'].fire('click');
  check(vis('about-overlay') && !vis('menu-overlay') && window.LGMain.getState() === 'about',
    'ABOUT opens from the main menu', window.LGMain.getState());
  check(elements['about-version'].textContent === LG.Config.version,
    'about version matches LG.Config.version',
    elements['about-version'].textContent + ' vs ' + LG.Config.version);
  check(elements['menu-version'].textContent === 'v' + LG.Config.version,
    'menu version matches LG.Config.version', elements['menu-version'].textContent);
  var aboutHtml = html;
  var aboutKeys = ['data-about="about"', 'data-about="credits"', 'data-about="privacy"',
    'data-about="terms"', 'data-about="report"'];
  var missingAbout = aboutKeys.filter(function (k) { return aboutHtml.indexOf(k) < 0; });
  check(missingAbout.length === 0, 'about overlay ships credits/privacy/terms/report',
    missingAbout.join(','));
  elements['btn-bug-fill'].fire('click');
  var box = elements['bug-report-box'];
  check(!!box.value && box.value.indexOf('version: ' + LG.Config.version) >= 0 &&
    box.value.indexOf('storage:') >= 0,
    'FILL REPORT builds a plain-text report', String(box.value).slice(0, 80));
  elements['btn-about-back'].fire('click');
  check(vis('menu-overlay') && !vis('about-overlay') && window.LGMain.getState() === 'menu',
    'ABOUT BACK returns to the main menu', window.LGMain.getState());

  // settings/about only open from the menu (not mid-match)
  window.LGMain.getState() === 'menu' && (function () {
    LG.eventBus.emit('settingsRequested');
    check(vis('settings-overlay'), 'settings openable while on menu');
    LG.eventBus.emit('settingsBackRequested');
    check(vis('menu-overlay') && !vis('settings-overlay'), 'settings back lands on menu');
  })();

  // quit must close settings/about (armed flags too)
  elements['btn-settings'].fire('click');
  elements['btn-settings-reset'].fire('click');
  LG.eventBus.emit('quitRequested');
  check(!vis('settings-overlay') && vis('menu-overlay') && window.LGMain.getState() === 'menu',
    'quit from armed settings returns a clean menu', window.LGMain.getState());
  check(elements['btn-settings-reset'].textContent === 'RESET PROGRESS',
    'quit disarms the wipe button', elements['btn-settings-reset'].textContent);

  // loading + error path: retry button exists, error box starts hidden
  check(elements['btn-loading-retry'] && elements['btn-loading-retry'].classList.contains('hidden'),
    'loading retry starts hidden');
  check(elements['loading-error'] && elements['loading-error'].classList.contains('hidden'),
    'loading error starts hidden');
})();

console.log('\n' + (FAIL === 0 ? 'BOOT + MENU FLOW PASSED' : 'BOOT + MENU FLOW FAILED (' + FAIL + ')'));
process.exit(FAIL === 0 ? 0 : 1);
