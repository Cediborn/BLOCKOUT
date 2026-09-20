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
  ['set', 'copy', 'add', 'sub', 'multiplyScalar', 'normalize', 'lerp', 'project', 'setFromMatrixPosition',
    'distanceTo', 'applyQuaternion', 'crossVectors', 'addVectors', 'subVectors', 'clone', 'setScalar'].forEach(function (m) {
      v[m] = function () { return v; };
    });
  return v;
}
function fakeNode() {
  var n = {
    position: vec3(), rotation: vec3(), scale: vec3(), quaternion: vec3(),
    userData: {}, children: [], isMesh: false, visible: true, material: null, geometry: null,
    shadow: { camera: { left: 0, right: 0, top: 0, bottom: 0, near: 0, far: 0 }, mapSize: { set: function () {} }, bias: 0 },
    add: function (c) { n.children.push(c); return n; },
    remove: function () { return n; },
    traverse: function (cb) { cb(n); return n; },
    lookAt: function () {}, updateProjectionMatrix: function () {},
    color: { setHex: function () {}, getHexString: function () { return 'ffffff'; }, set: function () {} },
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
global.THREE = new Proxy({}, {
  get: function (t, prop) {
    if (prop in threeCache) return threeCache[prop];
    if (prop === 'DoubleSide' || prop === 'AdditiveBlending' || prop === 'PCFSoftShadowMap') return 2;
    if (prop === 'RepeatWrapping') return 1000;
    if (prop === 'sRGBEncoding') return 3001;
    var Cls = function () {
      var node = fakeNode();
      if (arguments.length >= 2 && typeof arguments[1] === 'object') node.material = arguments[1];
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
    id: id, style: {}, dataset: {}, innerHTML: '', textContent: '', children: [], _classes: {}, _h: {},
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
  if (id && ids[id] === undefined) ids[id] = 1;
  return e;
}
function make(id) { var e = el(id); elements[id] = e; return e; }
Object.keys(ids).forEach(make);

// hidden state from the real markup, so overlay checks mean something
var hiddenInMarkup = {};
html.replace(/<div id="([^"]+)" class="([^"]*)"/g, function (m, id, cls) { if (/hidden/.test(cls)) hiddenInMarkup[id] = 1; return m; });
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
global.localStorage = undefined;                                 // exercise the no-storage path too

var winHandlers = {};
global.window.addEventListener = function (ev, fn) { (winHandlers[ev] = winHandlers[ev] || []).push(fn); };
global.window.removeEventListener = function (ev, fn) {
  var a = winHandlers[ev] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
};
global.window.fire = function (ev, arg) { (winHandlers[ev] || []).slice().forEach(function (f) { f(arg || {}); }); };

var rafQueue = [];
global.requestAnimationFrame = function (cb) { rafQueue.push(cb); return rafQueue.length; };
global.performance = global.performance || { now: function () { return Date.now(); } };
global.console.error = global.console.error;

// ---------------- load the real code ----------------
var SRC = ['js/config.js', 'js/difficulty.js', 'js/util.js', 'js/audio.js', 'js/progression.js', 'js/input.js',
  'js/particles.js', 'js/courts.js', 'js/models.js', 'js/ball.js', 'js/player.js', 'js/arena.js', 'js/abilities.js',
  'js/ai.js', 'js/keeper.js', 'js/camera.js', 'js/match.js', 'js/hud.js', 'js/main.js', 'js/living.js'];

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

section('2. the menu flow actually advances');
var flow = null;
try {
  elements['btn-play'].fire('click');
  flow = 'sides';
  check(vis('sides-overlay') && !vis('menu-overlay'), 'KICK OFF opens SELECT SIDES', 'sides=' + vis('sides-overlay') + ' menu=' + vis('menu-overlay'));
  elements['btn-sides-go'].fire('click');
  check(vis('diff-overlay'), 'CONTINUE opens SELECT DIFFICULTY');
  elements['btn-diff-go'].fire('click');
  check(vis('select-overlay'), 'CONTINUE opens PICK YOUR STAR');

  // player style: both kit grids (your kit + the opponent kit) build
  elements['btn-style'].fire('click');
  check(vis('style-overlay') && !vis('select-overlay'), 'PLAYER STYLE opens the style overlay');
  check(elements['color-grid'] && elements['color-grid'].children.length > 0, 'your kit colors build');
  check(elements['away-color-grid'] && elements['away-color-grid'].children.length > 0, 'the opponent kit colors build');
  elements['btn-style-back'].fire('click');
  check(vis('select-overlay') && !vis('style-overlay'), 'PLAYER STYLE BACK returns to PICK YOUR STAR');

  // court picker: the classic tile builds even with no assets discovered
  elements['btn-court'].fire('click');
  check(vis('court-overlay') && !vis('select-overlay'), 'COURT opens the court overlay');
  check(elements['court-grid'] && elements['court-grid'].children.length > 0, 'the court grid builds');
  if (elements['court-grid'] && elements['court-grid'].children.length) {
    elements['court-grid'].children[0].fire('click');       // CLASSIC STREET tile
  }
  check(LG.Courts.selected() === '', 'selecting CLASSIC persists an empty court id', LG.Courts.selected());
  elements['btn-court-go'].fire('click');
  check(vis('select-overlay') && !vis('court-overlay'), 'COURT CONFIRM returns to PICK YOUR STAR');

  elements['btn-start-match'].fire('click');
  check(window.LGMain.getState() === 'match', 'KICK OFF starts the match', window.LGMain.getState());
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
var m = window.LGMain.getMatch();
check(!!m, 'a match object exists');
check(m && (m.state === 'PLAY' || m.state === 'KICKOFF'), 'the match advanced past IDLE', m && m.state);

section('3b. fullscreen is taken at match start, never mid-tap');
check(fsCalls === 1, 'starting the match asked for fullscreen once', fsCalls);
window.fire('pointerdown', { clientX: 10, clientY: 10 });
check(fsCalls === 1, 'a stray tap afterwards does not re-request fullscreen', fsCalls);

section('4. the rotate overlay cannot get stuck over the game');
check(elements['rotate-overlay'] && elements['rotate-overlay'].classList.contains('hidden'),
  'landscape phone hides the rotate overlay');
window.innerWidth = 390; window.innerHeight = 844;
window.fire('resize');
check(!elements['rotate-overlay'].classList.contains('hidden'), 'portrait shows it again');
window.innerWidth = 844; window.innerHeight = 390;
window.fire('orientationchange');
check(elements['rotate-overlay'].classList.contains('hidden'), 'rotating back hides it');
window.innerWidth = 390; window.innerHeight = 844;
for (var k = 0; k < 3; k++) { var q2 = rafQueue; rafQueue = []; q2.forEach(function (cb) { cb(performance.now()); }); }
check(!elements['rotate-overlay'].classList.contains('hidden'),
  'the loop re-checks orientation and re-shows the overlay (no resize event needed)');

check(missed.length === 0, 'no getElementById ever missed the real DOM', missed.join(', '));

console.log('\n' + (FAIL === 0 ? 'BOOT + MENU FLOW PASSED' : 'BOOT + MENU FLOW FAILED (' + FAIL + ')'));
process.exit(FAIL === 0 ? 0 : 1);
