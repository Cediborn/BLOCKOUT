// ============================================================
// tools/feelprobe.js — PHASE 4 gameplay-feel probe (measurement)
// Headless: loads the real scripts under a stubbed DOM/THREE and
// measures what the feel pass claims, not what it hopes:
//   4.1 movement — accel / brake / diagonal / reversal snappiness,
//      facing turn has weight (not instant) but still converges,
//      idle square-up to the ball, stamina stat actually drains at
//      different rates, sprint > jog, carry push-out at pace
//   4.2 ball    — bounce tail settles (no endless micro-hop), pass
//      loft rises with distance, short passes stay low, passes arrive
//   4.4 controls— possession flips PASS/SHOOT vs SWITCH/TACKLE, the
//      press buffer survives a state change without double-firing,
//      W+SHIFT multi-key holds, R reads as rematch from a cold menu
//   4.3 AI      — crowd metrics: the side does not collapse into one
//      scrum around the ball, possession keeps flowing
// Invariants are assert()s; raw numbers are info() so the report can
// quote them. Deterministic: pinned LCG like sim.js.
// Run: node tools/feelprobe.js
// ============================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var PASS = 0, FAIL = 0;

function assert(cond, label, detail) {
  if (cond) { PASS++; console.log('  ok   ' + label); }
  else { FAIL++; console.log('  FAIL ' + label + (detail !== undefined ? '  ->  ' + detail : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }
function info(t) { console.log('  ·    ' + t); }

// ---------------- deterministic RNG ----------------
var _seed = parseInt(process.env.SEED || '1234567', 10);
Math.random = function () {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
};

// ---------------- DOM / THREE stubs ----------------
global.window = global;
var keyHandlers = {};
global.addEventListener = function (ev, fn) { (keyHandlers[ev] = keyHandlers[ev] || []).push(fn); };
global.removeEventListener = function () {};

var ctx2d = new Proxy({}, {
  get: function (t, p) {
    if (p === 'createRadialGradient' || p === 'createLinearGradient' || p === 'createPattern') {
      return function () { return { addColorStop: function () {} }; };
    }
    if (p === 'getImageData') return function () { return { data: [] }; };
    return function () {};
  },
  set: function () { return true; }
});

function vec3() {
  var v = { x: 0, y: 0, z: 0 };
  v.set = function (x, y, z) { v.x = x; v.y = y; v.z = z; return v; };
  v.copy = function (o) { v.x = o.x; v.y = o.y; v.z = o.z; return v; };
  v.setScalar = function (s) { v.x = v.y = v.z = s; return v; };
  v.project = function () { return v; };
  v.normalize = function () { return v; };
  v.add = v.sub = v.multiplyScalar = function () { return v; };
  return v;
}

function fakeNode() {
  var n = {
    position: vec3(), rotation: vec3(), scale: vec3(),
    userData: {}, children: [], isMesh: false, visible: true,
    castShadow: false, receiveShadow: false, material: null, geometry: null,
    add: function (c) { n.children.push(c); return n; },
    remove: function () { return n; },
    traverse: function (cb) { cb(n); n.children.forEach(function (c) { if (c.traverse) c.traverse(cb); }); return n; },
    lookAt: function () {}, updateProjectionMatrix: function () {},
    color: { setHex: function () {}, getHexString: function () { return 'ffffff'; }, set: function () {}, getHex: function () { return 0; } },
    copy: function () { return n; }, clone: function () { return fakeNode(); },
    setFromPoints: function () { return n; }, setAttribute: function () { return n; },
    dispose: function () {}
  };
  return new Proxy(n, {
    get: function (o, p) {
      if (p in o) return o[p];
      var fn = function () { return o; };
      o[p] = fn;
      return fn;
    },
    set: function (o, p, val) { o[p] = val; return true; }
  });
}

var threeCache = {};
global.THREE = new Proxy({}, {
  get: function (t, prop) {
    if (prop in threeCache) return threeCache[prop];
    if (prop === 'DoubleSide' || prop === 'AdditiveBlending' || prop === 'FrontSide') return 2;
    if (prop === 'RepeatWrapping') return 1000;
    if (prop === 'sRGBEncoding') return 3001;
    if (prop === 'PCFSoftShadowMap') return 2;
    var Cls = function () {
      var node = fakeNode();
      if (arguments.length >= 2 && typeof arguments[1] === 'object') node.material = arguments[1];
      return node;
    };
    threeCache[prop] = Cls;
    return Cls;
  }
});

var elements = {};
function el(extra) {
  var e = {
    style: {}, dataset: {}, innerHTML: '', textContent: '', children: [],
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    _h: {},
    addEventListener: function (ev, fn) { (e._h[ev] = e._h[ev] || []).push(fn); },
    removeEventListener: function () {},
    appendChild: function () {}, removeChild: function () {}, remove: function () {},
    querySelector: function () { return el(); }, querySelectorAll: function () { return []; },
    getBoundingClientRect: function () {
      var box = e._box || { left: 0, top: 0, width: 190, height: 190 };
      box.right = box.left + box.width; box.bottom = box.top + box.height;
      return box;
    },
    setPointerCapture: function () {}, releasePointerCapture: function () {},
    fire: function (type, ev) {
      ev = ev || {};
      ev.preventDefault = ev.preventDefault || function () {};
      (e._h[type] || []).forEach(function (f) { f(ev); });
    }
  };
  if (extra) for (var k in extra) e[k] = extra[k];
  return e;
}

global.document = {
  createElement: function (tag) {
    if (tag === 'canvas') return { width: 2, height: 2, getContext: function () { return ctx2d; }, style: {} };
    return el();
  },
  getElementById: function (id) { return elements[id] || null; },
  querySelectorAll: function () { return []; },
  body: el(),
  documentElement: el()
};

['pass', 'shoot', 'tackle', 'sprint', 'switch'].forEach(function (n) { elements['btn-' + n] = el(); });
elements['special-btn'] = el();
elements['joystick-zone'] = el({ _box: { left: 0, top: 0, width: 190, height: 190 } });
elements['joy-knob'] = el();

function key(type, code) {
  var ev = { code: code, preventDefault: function () {}, isTyping: false };
  (keyHandlers[type] || []).forEach(function (f) { f(ev); });
}

// ---------------- load the real game code ----------------
function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
}
['js/config.js', 'js/difficulty.js', 'js/settings.js', 'js/util.js', 'js/audio.js', 'js/challenges.js', 'js/modes.js', 'js/tournament.js', 'js/models.js', 'js/rig.js', 'js/ball.js',
  'js/player.js', 'js/abilities.js', 'js/ai.js', 'js/keeper.js', 'js/match.js',
  'js/input.js'].forEach(load);

if (!window.LG || !window.LG.MatchManager) { console.log('FEELPROBE FAIL scripts did not load'); process.exit(1); }
var LG = window.LG;

var pfx = { dust: function () {}, trail: function () {}, burst: function () {}, ring: function () {},
  confetti: function () {}, speedLines: function () {}, update: function () {}, clear: function () {}, init: function () {} };
LG.Particles = pfx;
LG.Progression = {
  addCoins: function () {}, coins: function () { return 0; },
  isUnlocked: function () { return true; }, costOf: function () { return 0; }, unlock: function () { return true; },
  finalizeMatch: function (r) { if (r && !r.finalized) { r.finalized = true; r.coins = 60; } return r; },
  career: function () { return { matches: 0 }; }, history: function () { return []; },
  winRate: function () { return 0; }, rewardFor: function () { return 0; }, reset: function () {},
  reload: function () {}, best: function () { return { goals: 0, wins: 0, streak: 0 }; },
  activeChallenges: function () { return []; }, challengeCompletions: function () { return {}; },
  ensureActiveChallenges: function () {}
};
LG.HUD = { toast: function () {}, banner: function () {}, reset: function () {} };

LG.Input.init();
LG.Settings.setView('portrait');

// ---------------- input helpers (public layer only) ----------------
var ZONE = { ox: 95, oy: 95, fullR: LG.Util.clamp(95 * LG.Config.touch.stickFullTilt, LG.Config.touch.stickFullMin, LG.Config.touch.stickFullMax) };
var joyDown = false;
function stickTo(dx, dz, mag) {
  mag = mag === undefined ? 1 : mag;
  var m = Math.sqrt(dx * dx + dz * dz) || 1;
  var ux = dx / m, uz = dz / m;
  var r = ZONE.fullR * LG.Util.clamp(mag, 0, 1);
  if (!joyDown) {
    joyDown = true;
    elements['joystick-zone'].fire('pointerdown', { clientX: ZONE.ox, clientY: ZONE.oy, pointerId: 1 });
  }
  elements['joystick-zone'].fire('pointermove', { clientX: ZONE.ox + ux * r, clientY: ZONE.oy + uz * r, pointerId: 1 });
}
function stickRelease() {
  if (!joyDown) return;
  joyDown = false;
  elements['joystick-zone'].fire('pointerup', { pointerId: 1 });
}
function btn(name, down) {
  elements['btn-' + name].fire(down ? 'pointerdown' : 'pointerup', { pointerId: 9 });
}

// ---------------- helpers ----------------
var DT = 1 / 60;
function newMatch(playerId) {
  return new LG.MatchManager({ playerId: playerId || 'blaze', homeName: 'YOU', awayName: 'ROGUE' });
}
function place(p, x, z, facing) {
  p.x = x; p.z = z; p.vx = 0; p.vz = 0;
  if (facing !== undefined) p.facing = facing;
  p.model.group.position.set(x, 0, z);
}
function giveBall(m, p) {
  m.all.forEach(function (o) { o.hasBall = false; });
  p.hasBall = true;
  m.ball.owner = p;
  m.possessionTeam = p.team;
  m.ball.x = p.x + Math.sin(p.facing) * 0.72;
  m.ball.z = p.z + Math.cos(p.facing) * 0.72;
}
function speed(p) { return Math.sqrt(p.vx * p.vx + p.vz * p.vz); }
function angDiff(a, b) {
  var d = a - b;
  return ((d + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
}
function isolate(m) {
  // park everyone except p, kill AI so the probe owns the intent
  var p = m.active;
  m.all.forEach(function (o) { o.ai = null; o.isHuman = false; if (o !== p) place(o, 60, 60); });
  p.isHuman = false;
  m.state = 'PLAY';
  return p;
}
function drive(p, wx, wz, frames, sprint) {
  p.want.x = wx; p.want.z = wz; p.want.sprint = !!sprint;
  for (var i = 0; i < frames; i++) p.update(DT);
}

// ============================================================
section('4.1 movement — accel, brake, reversal, facing weight');
(function () {
  var m = newMatch();
  m.start();
  var p = isolate(m);

  // top speed (straight, no sprint)
  drive(p, 0, 1, 90, false);
  var jogTop = speed(p);
  info('jog top ' + jogTop.toFixed(2) + ' m/s');
  assert(jogTop > 3.5 && jogTop < 8, 'jog top speed is a sane arcade pace', jogTop.toFixed(2));

  // accel from rest to 90% of top
  place(p, 0, 0); p.vx = p.vz = 0; p.facing = 0;
  p.want.x = 0; p.want.z = 0;
  var t90 = -1;
  for (var i = 0; i < 120; i++) {
    drive(p, 0, 1, 1, false);
    if (t90 < 0 && speed(p) >= jogTop * 0.9) t90 = (i + 1) * DT;
  }
  info('rest -> 90% pace in ' + t90.toFixed(2) + 's');
  assert(t90 > 0.05 && t90 < 0.55, 'pickup is immediate but not teleporty', t90.toFixed(2) + 's');

  // brake: release from full pace — plant, don't glide
  var brakeDist = 0, tb = -1;
  for (var j = 0; j < 120; j++) {
    drive(p, 0, 1, 1, false);            // keep it at pace
  }
  p.want.x = 0; p.want.z = 0;
  for (var k2 = 0; k2 < 120; k2++) {
    var v0 = speed(p);
    p.update(DT);
    brakeDist += (v0 + speed(p)) / 2 * DT;
    if (tb < 0 && speed(p) < 0.5) tb = (k2 + 1) * DT;
  }
  info('brake to <0.5 m/s in ' + (tb < 0 ? '>2s' : tb.toFixed(2)) + 's over ' + brakeDist.toFixed(2) + 'm');
  assert(tb > 0 && tb < 0.45, 'released stick brakes briskly (no ice-skate)', tb.toFixed(2) + 's');
  assert(brakeDist < 2.0, 'stop distance is short enough to plant', brakeDist.toFixed(2) + 'm');

  // diagonal must not be faster than straight
  place(p, 0, 0); p.vx = p.vz = 0;
  drive(p, 0, 1, 90, false); var straight = speed(p);
  place(p, 0, 0); p.vx = p.vz = 0;
  drive(p, 0.7071, 0.7071, 90, false); var diag = speed(p);
  info('straight ' + straight.toFixed(2) + ' vs diagonal ' + diag.toFixed(2));
  assert(Math.abs(diag - straight) < 0.12, 'diagonal is normalised (no speed boost)', (diag - straight).toFixed(2));

  // reversal: at pace toward +z, flip to -z — snappy turnaround
  place(p, 0, 0); p.vx = p.vz = 0;
  drive(p, 0, 1, 90, false);
  var backT = -1;
  for (var r = 0; r < 120; r++) {
    p.want.x = 0; p.want.z = -1;
    p.update(DT);
    if (backT < 0 && p.vz < 0) backT = (r + 1) * DT;
  }
  info('180° turnaround (velocity flips) in ' + (backT < 0 ? '>2s' : backT.toFixed(2)) + 's');
  assert(backT > 0 && backT < 0.4, 'reversing direction has bite', backT.toFixed(2) + 's');
  var respeed = speed(p);
  assert(respeed > jogTop * 0.85, 'and it gets back up to pace', respeed.toFixed(2));

  // FACING: weight — a big reversal must take real time (not instant snap)
  // but still converge well inside a second.
  place(p, 0, 0); p.vx = p.vz = 0;
  p.facing = 0;
  drive(p, 0, 1, 90, false);           // body now faces ~+z
  var target = Math.PI;                 // reverse direction
  var halfT = -1, doneT = -1;
  for (var f = 0; f < 180; f++) {
    p.want.x = 0; p.want.z = -1;
    p.update(DT);
    var err = Math.abs(angDiff(p.facing, target));
    if (halfT < 0 && err < Math.PI / 2) halfT = (f + 1) * DT;
    if (err < 0.2 && doneT < 0) doneT = (f + 1) * DT;
  }
  info('facing 180° turn: half in ' + (halfT < 0 ? '>3s' : halfT.toFixed(2)) + 's, settled in ' + (doneT < 0 ? '>3s' : doneT.toFixed(2)) + 's');
  assert(halfT > 0.08, 'the body swings through a reversal instead of snapping', halfT.toFixed(2) + 's');
  assert(doneT > 0 && doneT < 1.0, 'and settles inside a second', doneT.toFixed(2) + 's');

  // idle square-up: standing still, ball-less, facing away -> faces the ball
  place(p, 0, 0); p.vx = p.vz = 0;
  p.facing = Math.PI;                   // back to the ball at origin-ish
  p.want.x = 0; p.want.z = 0;
  m.ball.x = 6; m.ball.z = 0;           // ball to the side
  for (var s = 0; s < 120; s++) p.update(DT);
  var sq = Math.abs(angDiff(p.facing, Math.atan2(m.ball.x - p.x, m.ball.z - p.z)));
  info('idle square-up residual ' + sq.toFixed(2) + ' rad after 2s');
  assert(sq < 0.4, 'a stopped player squares up to the ball', sq.toFixed(2) + ' rad');

  // sprint is real, and stamina drains while it runs
  place(p, 0, 0); p.vx = p.vz = 0; p.stamina = 1;
  drive(p, 0, 1, 120, true);
  var sprintTop = speed(p);
  var before = p.stamina;
  drive(p, 0, 1, 120, true);
  var drainRate = (before - p.stamina) / 2;
  info('sprint top ' + sprintTop.toFixed(2) + ' m/s, drain ' + drainRate.toFixed(3) + '/s');
  assert(sprintTop > jogTop * 1.25, 'sprint is visibly faster than jog', (sprintTop / jogTop).toFixed(2) + 'x');
  assert(drainRate > 0.05 && drainRate < 0.35, 'sprint drains the tank at a tactical rate', drainRate.toFixed(3) + '/s');
})();

section('4.1 stamina stat — high stamina really lasts longer');
(function () {
  function drainFor(stStat) {
    var m = newMatch();
    m.start();
    var p = isolate(m);
    p.stats.stamina = stStat;
    p.stamina = 1; p._sprintLocked = false;
    drive(p, 0, 1, 120, true);        // 2s of sprinting
    return 1 - p.stamina;
  }
  var dHi = drainFor(10), dLo = drainFor(3);
  info('2s sprint drain: stamina10=' + dHi.toFixed(3) + ' stamina3=' + dLo.toFixed(3));
  assert(dHi > 0 && dLo > 0, 'both players drain', dHi.toFixed(3) + ' / ' + dLo.toFixed(3));
  assert(dLo > dHi * 1.15, 'a high-stamina player clearly lasts longer', (dLo / dHi).toFixed(2) + 'x the drain');
})();

section('4.1 ball carry — tight at rest, pushed out at pace');
(function () {
  var m = newMatch();
  m.start();
  var p = isolate(m);
  function carryDist(sprint) {
    place(p, 0, 0); p.vx = p.vz = 0; p.facing = 0;
    p.stamina = 1; p._sprintLocked = false;
    giveBall(m, p);
    drive(p, 0, 1, 150, sprint);
    return Math.sqrt(Math.pow(m.ball.x - p.x, 2) + Math.pow(m.ball.z - p.z, 2));
  }
  // at rest the ball sits at the classic tight carry
  place(p, 0, 0); p.vx = p.vz = 0; p.facing = 0;
  giveBall(m, p);
  p.update(DT);
  var dRest = Math.sqrt(Math.pow(m.ball.x - p.x, 2) + Math.pow(m.ball.z - p.z, 2));
  var dWalk = carryDist(false);
  var dSprint = carryDist(true);
  info('carry distance: rest ' + dRest.toFixed(2) + 'm, jog ' + dWalk.toFixed(2) + 'm, sprint ' + dSprint.toFixed(2) + 'm');
  assert(dRest > 0.66 && dRest < 0.78, 'standing still keeps the ball tight at the feet', dRest.toFixed(2) + 'm');
  assert(dWalk > dRest + 0.1, 'pace pushes the ball ahead of the stride', dWalk.toFixed(2) + 'm vs ' + dRest.toFixed(2) + 'm');
  assert(dSprint >= dWalk && dSprint < 1.0, 'a full sprint carries it furthest but never loose', dSprint.toFixed(2) + 'm');
})();

// ============================================================
section('4.2 ball — the bounce tail settles, loft scales with distance');
(function () {
  // settle: dropped from height, the ball must come fully to rest with no
  // perpetual micro-hop left in it.
  var m = newMatch();
  m.start();
  m.state = 'PLAY';
  m.all.forEach(function (o) { o.ai = null; o.isHuman = false; place(o, 60, 60); });
  var b = m.ball;
  b.reset(0, 0);
  b.owner = null;
  b.x = 0; b.z = 0; b.y = 2.2; b.vx = 3; b.vz = 0; b.vy = 0;
  var settleT = -1, maxAfter = 0;
  for (var i = 0; i < 240; i++) {
    b.step(DT, null);
    if (b.vy === 0 && b.y <= b.r + 0.001 && (b.vx * b.vx + b.vz * b.vz) < 0.36) { if (settleT < 0) settleT = (i + 1) * DT; }
    if (settleT > 0 && (i + 1) * DT > settleT + 0.5) maxAfter = Math.max(maxAfter, b.y - b.r);
  }
  info('dropped ball settles at ' + (settleT < 0 ? '>4s' : settleT.toFixed(2) + 's') + ', residual hop after ' + maxAfter.toFixed(4) + 'm');
  assert(settleT > 0 && settleT < 3.5, 'a dropped ball comes to rest quickly', settleT + 's');
  assert(maxAfter < 0.01, 'and stays down (no endless micro-hop)', maxAfter.toFixed(4) + 'm');

  // loft: short pass skims low, long pass carries height
  function apexFor(dist) {
    var m2 = newMatch();
    m2.start();
    m2.state = 'PLAY';
    var h = m2.active;
    m2.all.forEach(function (o) { if (o !== h) { o.ai = null; o.isHuman = false; place(o, 60, 60); } });
    h.isHuman = false; h.ai = null;
    place(h, 0, 10, Math.PI);
    giveBall(m2, h);
    var mate = m2.home.filter(function (q) { return q !== h && !q.isGoalkeeper; })[0];
    place(mate, 0, 10 - dist, Math.PI);
    h.want.x = 0; h.want.z = 0;
    m2.passTo(h, mate, {});
    var apex = 0, d = 1e9;
    for (var i2 = 0; i2 < 180; i2++) {
      m2.ball.step(DT, null);
      apex = Math.max(apex, m2.ball.y - m2.ball.r);
      d = LG.Util.dist(m2.ball.x, m2.ball.z, mate.x, mate.z);
      if (m2.ball.owner === mate || d < 1.2) break;
    }
    return { apex: apex, got: m2.ball.owner === mate || d < 1.3, d: d };
  }
  var a6 = apexFor(6), a12 = apexFor(12), a18 = apexFor(18);
  info('pass apex: 6m=' + a6.apex.toFixed(2) + 'm, 12m=' + a12.apex.toFixed(2) + 'm, 18m=' + a18.apex.toFixed(2) + 'm (arrived ' + a6.got + '/' + a12.got + '/' + a18.got + ')');
  assert(a6.apex < a12.apex && a12.apex < a18.apex, 'loft rises with distance', [a6.apex, a12.apex, a18.apex].map(function (v) { return v.toFixed(2); }).join(' < '));
  assert(a6.apex < 1.1, 'a short pass stays low under a lunge', a6.apex.toFixed(2) + 'm');
  assert(a18.apex <= 2.4, 'a long ball carries height but is not a lob clinic', a18.apex.toFixed(2) + 'm');
  assert(a12.got && a18.got, 'both medium and long passes still arrive', JSON.stringify([a12.d, a18.d]));
})();

section('4.4 controls — possession mapping, buffer, multi-key, rematch key');
(function () {
  // -- attack: PASS executes a pass, SHOOT charges --
  var m = newMatch();
  m.start();
  m.state = 'PLAY';
  LG.Input.reset(); LG.Input.setEnabled(true);
  var h = m.active;
  m.all.forEach(function (o) { if (o !== h) { o.ai = null; o.isHuman = false; place(o, o.team === h.team ? 5 : -5, 0); } });
  place(h, 0, 0, Math.PI);
  giveBall(m, h);
  var t = { t: 0 };
  function step() { t.t += DT; LG.Input.setEnabled(true); LG.Input.update(t.t); m.update(DT); }
  step();
  assert(m._ctrlMode === 'attack', 'own possession -> attack controls', m._ctrlMode);
  btn('pass', true); step(); btn('pass', false);
  assert(m.ball.owner !== h || m.ball.speed() > 2, 'PASS press executes a pass while attacking', m.ball.speed().toFixed(1));

  // -- defend: SAME press becomes SWITCH, SHOOT becomes TACKLE --
  var m2 = newMatch();
  m2.start();
  m2.state = 'PLAY';
  LG.Input.reset(); LG.Input.setEnabled(true);
  var h2 = m2.active;
  var carrier = m2.away.filter(function (q) { return !q.isGoalkeeper; })[0];
  // nobody moves between setup and the press: the control mapping under test
  // must not be disturbed by live AI winning the ball in the gap
  m2.all.forEach(function (q) { if (q !== h2 && q !== carrier) { place(q, 40, 40); q.ai = null; } });
  place(carrier, 0, -4, 0);
  carrier.ai = null;
  giveBall(m2, carrier);
  place(h2, 0, 2, Math.PI);
  var mate = m2.home.filter(function (q) { return q !== h2 && !q.isGoalkeeper; })[0];
  place(mate, 0, -2, Math.PI);
  var t2 = { t: 0 };
  function step2() { t2.t += DT; LG.Input.setEnabled(true); LG.Input.update(t2.t); m2.update(DT); }
  step2();
  assert(m2._ctrlMode === 'defend', 'opponent possession -> defend controls', m2._ctrlMode);
  h2.tackleCd = 0;
  if (process.env.FEELDEBUG) {
    console.log('  dbg before: active=' + m2.active.name + ' isHuman=' + h2.isHuman +
      ' home=' + m2.home.map(function (q) { return q.name + (q.isGoalkeeper ? '(gk)' : ''); }).join(',') +
      ' poss=' + m2.possessionTeam + ' ctrl=' + m2._ctrlMode + ' swFrame=' + m2._switchedThisFrame);
  }
  btn('pass', true); step2(); btn('pass', false);
  if (process.env.FEELDEBUG) {
    console.log('  dbg after pass: active=' + m2.active.name + ' swFrame=' + m2._switchedThisFrame +
      ' heldPass=' + LG.Input.down('pass'));
  }
  assert(m2.active === mate, 'PASS press switches to the nearest teammate while defending', m2.active.name);
  btn('shoot', true); step2(); btn('shoot', false);
  assert(m2.active.tackleCd > 0, 'SHOOT press tackles while defending', 'cd=' + m2.active.tackleCd);

  // -- buffer: a press nobody could read during a frozen state still lands --
  var m3 = newMatch();
  m3.start();
  m3.state = 'KICKOFF';
  LG.Input.reset(); LG.Input.setEnabled(true);
  var h3 = m3.active;
  var mates3 = m3.home.filter(function (q) { return q !== h3 && !q.isGoalkeeper; });
  m3.all.forEach(function (q) { if (q !== h3 && q !== mates3[0]) place(q, 40, 40); q.ai = null; });
  place(mates3[0], 0, -8, Math.PI);     // clear pass lane ahead
  place(h3, 0, 0, Math.PI);
  giveBall(m3, h3);
  var t3 = { t: 0 };
  function step3() { t3.t += DT; LG.Input.setEnabled(true); LG.Input.update(t3.t); m3.update(DT); }
  btn('pass', true); step3(); btn('pass', false);   // pressed into a frozen state
  step3();                                          // nobody could read it...
  assert(m3.ball.owner === h3 && m3.ball.speed() < 1, 'a press during a frozen state does nothing yet', 'owner=' + (m3.ball.owner && m3.ball.owner.name));
  m3.state = 'PLAY';
  var landed = false;
  for (var i = 0; i < 6 && !landed; i++) { step3(); if (m3.ball.owner !== h3 || m3.ball.speed() > 2) landed = true; }
  assert(landed, 'the same press lands the moment play resumes (within the buffer window)', 'speed=' + m3.ball.speed().toFixed(1));

  // -- no double fire: a consumed press cannot fire a second pass --
  var m4 = newMatch();
  m4.start();
  m4.state = 'PLAY';
  LG.Input.reset(); LG.Input.setEnabled(true);
  var h4 = m4.active;
  var mates4 = m4.home.filter(function (q) { return q !== h4 && !q.isGoalkeeper; });
  m4.all.forEach(function (q) { if (q !== h4 && q !== mates4[0]) { q.ai = null; q.isHuman = false; place(q, 40, 40); } });
  mates4[0].ai = null;
  place(mates4[0], 0, -8, Math.PI);
  place(h4, 0, 0, Math.PI);
  giveBall(m4, h4);
  var t4 = { t: 0 };
  var passCount = 0;
  m4.bus.on('pass', function () { passCount++; });
  function step4() { t4.t += DT; LG.Input.setEnabled(true); LG.Input.update(t4.t); m4.update(DT); }
  btn('pass', true); step4(); btn('pass', false);
  var fired1 = passCount;
  step4(); step4(); step4();
  var firedAgain = passCount > fired1;
  assert(fired1 === 1 && !firedAgain && !LG.Input.pressed('pass'),
    'a consumed press never fires a second time', 'pass events ' + fired1 + ' -> ' + passCount);

  // -- W + SHIFT: releasing ONE of two sprint keys keeps sprint held --
  LG.Input.reset(); LG.Input.setEnabled(true); LG.Input.update(t4.t);
  key('keydown', 'KeyW');
  key('keydown', 'ShiftLeft');
  var both = LG.Input.down('sprint');
  key('keyup', 'KeyW');
  var afterW = LG.Input.down('sprint');
  key('keyup', 'ShiftLeft');
  var afterShift = LG.Input.down('sprint');
  info('W+SHIFT hold: both=' + both + ' afterW-release=' + afterW + ' afterShift-release=' + afterShift);
  assert(both, 'W or SHIFT alone starts a sprint hold', 'both=' + both);
  assert(afterW, 'releasing one of the two keys keeps the sprint held', 'afterW=' + afterW);
  assert(!afterShift, 'releasing the last sprint key ends the hold', 'afterShift=' + afterShift);

  // -- R reads as rematch from a cold (disabled) screen --
  LG.Input.reset(); LG.Input.setEnabled(false); LG.Input.update(t4.t += DT);
  key('keydown', 'KeyR');
  LG.Input.update(t4.t += DT);
  var isRematch = LG.Input.pressed('rematch');
  key('keyup', 'KeyR');
  assert(isRematch, 'R presses as REMATCH from a cold screen (results key)', 'rematch=' + isRematch);
  // and the edge does not linger
  LG.Input.update(t4.t += DT);
  assert(!LG.Input.pressed('rematch'), 'the rematch edge is one-shot');
})();

// ============================================================
section('4.3 AI shape — no scrum around the ball, possession keeps flowing');
(function () {
  var m = newMatch();
  m.start();
  m.state = 'PLAY';
  var frames = 0, playFrames = 0, possFlips = 0, lastPoss = -1;
  var crowdSum = 0, crowdMax = 0, gapSum = 0, nonChaserSum = 0, nonChaserN = 0;
  var t = { t: 0 };
  var shootHeld = 0;
  for (var i = 0; i < 45 * 60; i++) {
    // crude human masher on the public input layer (same spirit as sim.js),
    // so the probe measures REAL open play, not a team parked around a
    // statue holding the ball forever
    var hh = m.active;
    var ball = m.ball;
    var carrier = m.ownerPlayer();
    var aimX = 0, aimZ = 0, mag = 1;
    if (hh.hasBall) {
      var g = m.enemyGoal(hh.team);
      aimX = g.x - hh.x; aimZ = g.z - hh.z;
      if (hh.distTo(g.x, g.z) < 14 && shootHeld === 0 && Math.random() < 0.05) {
        btn('shoot', true); shootHeld = 1;
      } else if (shootHeld > 0) {
        shootHeld++;
        if (shootHeld > 18) { btn('shoot', false); shootHeld = 0; }
      } else if (Math.random() < 0.03) {
        btn('pass', true);
      } else {
        btn('pass', false);
      }
    } else {
      if (shootHeld) { btn('shoot', false); shootHeld = 0; }
      if (carrier && carrier.team !== hh.team) {
        aimX = carrier.x - hh.x; aimZ = carrier.z - hh.z;
        if (hh.distTo(carrier.x, carrier.z) < 2.0 && Math.random() < 0.15) btn('tackle', true);
        else btn('tackle', false);
      } else {
        aimX = ball.x - hh.x; aimZ = ball.z - hh.z;
        btn('tackle', false);
      }
      if (hh.distTo(ball.x, ball.z) > 12) mag = 1;
    }
    stickTo(aimX, aimZ, mag);
    btn('sprint', !hh.hasBall && hh.distTo(ball.x, ball.z) > 5);

    t.t += DT; LG.Input.setEnabled(true); LG.Input.update(t.t);
    m.update(DT);
    frames++;
    if (m.state !== 'PLAY') continue;
    playFrames++;
    if (m.possessionTeam !== lastPoss) { possFlips++; lastPoss = m.possessionTeam; }
    var b = m.ball;
    var within = 0;
    [0, 1].forEach(function (team) {
      var outfield = m.teamPlayers(team).filter(function (p) { return !p.isGoalkeeper; });
      var dists = outfield.map(function (p) { return p.distTo(b.x, b.z); }).sort(function (a, c) { return a - c; });
      // closest is (usually) the chaser; everyone else measures the hold-the-line
      for (var q = 1; q < dists.length; q++) { nonChaserSum += dists[q]; nonChaserN++; }
      for (var u = 0; u < outfield.length; u++) {
        for (var v = u + 1; v < outfield.length; v++) {
          var gp = Math.sqrt(Math.pow(outfield[u].x - outfield[v].x, 2) + Math.pow(outfield[u].z - outfield[v].z, 2));
          gapSum += gp;
        }
      }
    });
    m.all.forEach(function (p) { if (p.distTo(b.x, b.z) < 3.0) within++; });
    crowdSum += within;
    if (within > crowdMax) crowdMax = within;
  }
  var crowdAvg = crowdSum / Math.max(1, playFrames);
  var gapAvg = gapSum / Math.max(1, playFrames * 2 * 3);   // 3 pairs per team
  var nonChAvg = nonChaserSum / Math.max(1, nonChaserN);
  info('45s: crowd within 3m avg ' + crowdAvg.toFixed(2) + ' max ' + crowdMax +
    ' | teammate gap avg ' + gapAvg.toFixed(2) + 'm | 2nd+ defender from ball avg ' + nonChAvg.toFixed(2) + 'm');
  info('possession flips ' + possFlips + ' over ' + playFrames + ' play frames');
  assert(playFrames > 1000, 'the probe actually played', playFrames + ' frames');
  assert(crowdAvg <= 3.2, 'the side does not collapse into a scrum (avg within 3m of ball)', crowdAvg.toFixed(2));
  assert(crowdMax <= 7, 'even worst-case pile-ons stay readable', crowdMax);
  assert(gapAvg >= 1.6, 'teammates keep real gaps between them', gapAvg.toFixed(2) + 'm');
  assert(nonChAvg >= 2.6, 'the second defender holds a line instead of ball-watching', nonChAvg.toFixed(2) + 'm');
  assert(possFlips >= 10, 'possession keeps flowing in open play', possFlips + ' flips');
})();

// ============================================================
console.log('\n== feelprobe: ' + PASS + ' passed, ' + FAIL + ' failed ==');
process.exit(FAIL ? 1 : 0);


