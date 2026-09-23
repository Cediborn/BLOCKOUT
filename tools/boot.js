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
var SRC = ['js/config.js', 'js/difficulty.js', 'js/util.js', 'js/audio.js', 'js/progression.js', 'js/settings.js',
  'js/input.js', 'js/particles.js', 'js/courts.js', 'js/models.js', 'js/ball.js', 'js/player.js', 'js/arena.js', 'js/abilities.js',
  'js/ai.js', 'js/keeper.js', 'js/camera.js', 'js/lighting.js', 'js/match.js', 'js/hud.js', 'js/main.js', 'js/living.js'];

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

section('2. the menu flow actually advances (one screen, one purpose)');
var flow = null;
try {
  elements['btn-play'].fire('click');
  flow = 'diff';
  check(vis('diff-overlay') && !vis('menu-overlay'), 'KICK OFF opens SELECT DIFFICULTY', 'diff=' + vis('diff-overlay') + ' menu=' + vis('menu-overlay'));

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
  check(vis('menu-overlay') && !vis('diff-overlay'), 'DIFFICULTY BACK returns to the main menu');
  elements['btn-play'].fire('click');
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

console.log('\n' + (FAIL === 0 ? 'BOOT + MENU FLOW PASSED' : 'BOOT + MENU FLOW FAILED (' + FAIL + ')'));
process.exit(FAIL === 0 ? 0 : 1);
