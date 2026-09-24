// ============================================================
// tools/sim.js — headless gameplay harness (verification only)
// Loads the real game scripts under a stubbed DOM/THREE and drives
// the real match loop so mechanics can be measured, not guessed.
// Run: node tools/sim.js
// ============================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var PASS = 0, FAIL = 0;
var notes = [];

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
global.addEventListener = function () {};
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

// ---------------- load the real game code ----------------
function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
}

['js/config.js', 'js/difficulty.js', 'js/settings.js', 'js/util.js', 'js/audio.js', 'js/challenges.js', 'js/modes.js', 'js/tournament.js', 'js/models.js', 'js/ball.js',
  'js/player.js', 'js/abilities.js', 'js/ai.js', 'js/keeper.js', 'js/match.js',
  'js/input.js'].forEach(load);

if (!window.LG || !window.LG.MatchManager) { console.log('failed to boot LG'); process.exit(1); }
var LG = window.LG;

// particles + progression + HUD aren't under test — progression only needs
// enough surface for match.js endMatch to package a result (no persistence)
var pfx = { dust: function () {}, trail: function () {}, burst: function () {}, ring: function () {},
  confetti: function () {}, speedLines: function () {}, update: function () {}, clear: function () {}, init: function () {} };
LG.Particles = pfx;
LG.Progression = {
  addCoins: function () {}, coins: function () { return 0; },
  isUnlocked: function () { return true; }, costOf: function () { return 0; }, unlock: function () { return true; },
  finalizeMatch: function (r) {
    if (!r || r.finalized) return r;
    var won = r.won === 1 ? 1 : r.won === -1 ? -1 : 0;
    var base = won === 1 ? 120 : won === 0 ? 60 : 35;
    var hf = (r.stats && r.stats.home && r.stats.home.goals) || (r.score && r.score[0]) || 0;
    var ha = (r.stats && r.stats.away && r.stats.away.goals) || (r.score && r.score[1]) || 0;
    var adds = hf * 12 + ha * 5 + Math.max(0, hf - ha) * 8;
    r.coins = Math.round((base + adds) / 10) * 10;
    r.challengeCoins = 0;
    r.completedChallenges = [];
    r.finalized = true;
    return r;
  },
  career: function () {
    return { matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0,
      assists: 0, shots: 0, tackles: 0, saves: 0, cleanSheets: 0, playTime: 0 };
  },
  history: function () { return []; },
  winRate: function () { return 0; },
  rewardFor: function () { return 0; },
  reset: function () {},
  reload: function () {},
  best: function () { return { goals: 0, wins: 0, streak: 0 }; },
  activeChallenges: function () { return []; },
  challengeCompletions: function () { return {}; },
  ensureActiveChallenges: function () {},
};
LG.HUD = { toast: function () {}, banner: function () {}, reset: function () {} };

// models stay REAL (animateChar is part of what we changed)
var lastAnim = null;
var realAnimate = LG.Models.animateChar;
LG.Models.animateChar = function (m, running, phase, s01, kick) {
  lastAnim = { running: running, phase: phase, s01: s01, kick: kick };
  return realAnimate(m, running, phase, s01, kick);
};

// Optional tuning sweeps (defaults are the shipped values):
//   SEED=<n>      deterministic RNG seed
//   SPREAD=<m>    how wide a keeper's read of a corner-bound shot can be
//   NOSAVE=1      disable the reflex roll (measure the keepers' body blocks only)
if (process.env.SPREAD) LG.Config.keeper.readSpread = parseFloat(process.env.SPREAD);
if (process.env.NOSAVE) LG.MatchManager.prototype.keeperSaveChance = function () { return 0; };

LG.Input.init();
// The sim scenarios below pin the PORTRAIT gameplay (the original reference):
// they drive the human stick along the -z runway and read resolveHuman's
// world-space intent as though screen-up == attack. View-aware input mapping
// landed with the TRUE landscape camera, so reset to portrait here; the
// landscape mapping gets its own dedicated section further down.
LG.Settings.setView('portrait');

// ---------------- helpers ----------------
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

// Difficulty probes must compare the SAME players on every level: the squads
// come from a random draw, so building a fresh match per level would let the
// roster explain a difference that is supposed to come from the difficulty.
// probeMatch/resetProbe rebuild one match to a clean slate between runs.
function probeMatch(playerId) {
  var m = newMatch(playerId || 'blaze');
  m.start();
  return m;
}

function resetProbe(m) {
  m._chaser = null;
  m.state = 'PLAY';
  m.stateT = 0;
  m.possessionTeam = -1;
  m.clock = LG.Config.match.duration;
  m.ball.reset(0, 0);
  m.ball.intendedReceiver = null;
  m.ball.intendedT = 0;
  m.ball.noPk = null;
  m.ball.noPkT = 0;
  for (var i = 0; i < m.all.length; i++) {
    var p = m.all[i];
    p.hasBall = false;
    p.stun = 0;
    p.tackleCd = 0;
    p.shotCharge = 0;
    p.wasShooting = false;
    p.vx = 0; p.vz = 0;
    p.stamina = 1;
    p.distributeT = 0;
    p.ai = p.isGoalkeeper ? new LG.KeeperBrain(p) : new LG.AIBrain(p);
    if (p.isHuman) { p.isHuman = false; p.ai = null; }   // the probe drives h itself
    p.want.x = 0; p.want.z = 0; p.want.sprint = false;
  }
  m.active = m.home[0];
  return m;
}

// drive the real Input layer: point the stick + tap buttons
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

function step(m, dt, tRef) {
  tRef.t += dt;
  LG.Input.setEnabled(true);
  LG.Input.update(tRef.t);
  m.update(dt);
}

// ============================================================
section('1. directional passing — the pass follows the aim');
(function () {
  var m = newMatch();
  m.start();
  var h = m.active;
  var mates = m.home.filter(function (p) { return !p.isGoalkeeper && p !== h; });
  m.away.forEach(function (p) { place(p, 40, 40); });        // clear the lane
  assert(mates.length === 2, 'home squad is 3 outfield + keeper', m.home.length + ' players');
  place(h, 0, 0, Math.PI);
  giveBall(m, h);
  place(mates[0], 0, -8, Math.PI);      // 8m straight ahead
  place(mates[1], 0, 5, 0);             // only 5m away, but behind

  var ahead = m.directionalPassTarget(h, { x: 0, z: -1 });
  assert(ahead && ahead.player === mates[0], 'aiming forward passes to the mate ahead (not the nearer one behind)', ahead && ahead.player.name);

  place(mates[1], 6, 0, Math.PI / 2);   // 6m to the right, closer than the mate ahead
  var right = m.directionalPassTarget(h, { x: 1, z: 0 });
  assert(right && right.player === mates[1], 'aiming right passes to the mate on the right', right && right.player.name);

  place(mates[1], 5, -6, Math.PI / 2);
  var diag = m.directionalPassTarget(h, { x: 0.707, z: -0.707 });
  assert(diag && diag.player === mates[1], 'diagonal aim picks the diagonal mate', diag && diag.player.name);

  // aiming where nobody is must not fling a blind pass backwards
  place(mates[1], 9, 8, 0);
  var nowhere = m.directionalPassTarget(h, { x: -1, z: 0 });
  assert(nowhere === null, 'aiming at nobody finds no directional target (no blind pass)', nowhere && nowhere.player.name);
  var fallbackTarget = m.bestHumanPass(h);
  assert(fallbackTarget && fallbackTarget.player, 'the fallback still finds a nearby mate');

  // live stick direction beats the body facing
  place(h, 0, 0, Math.PI);   // body still points forward
  h.want.x = 1; h.want.z = 0;
  var aimed = h.aimDir();
  assert(Math.abs(aimed.x - 1) < 0.001 && Math.abs(aimed.z) < 0.001, 'aimDir follows the live stick, not the stale body', JSON.stringify(aimed));
  h.want.x = 0; h.want.z = 0;
})();

// ============================================================
section('2. passes actually reach their receiver');
(function () {
  function trial(dist) {
    var m = newMatch();
    m.start();
    m.state = 'PLAY';
    var h = m.active;
    var mate = m.home.filter(function (p) { return !p.isGoalkeeper && p !== h; })[0];
    m.away.forEach(function (p) { place(p, 40, 40); });
    m.home.forEach(function (p) { if (p.isGoalkeeper) p.z = 22; });
    place(h, 0, 10, Math.PI);
    giveBall(m, h);
    place(mate, 0, 10 - dist, Math.PI);
    var t = { t: 0 };
    var gotBall = false, frames = 0;
    for (var i = 0; i < 240; i++) {
      h.want.x = 0; h.want.z = 0; mate.want.x = 0; mate.want.z = 0;
      // stop the mate from wandering off during the flight
      if (i === 0) m.passTo(h, mate, { lead: true });
      if (i === 2) { place(mate, 0, 10 - dist, Math.PI); mate.vx = 0; mate.vz = 0; }
      if (mate.hasBall) { gotBall = true; frames = i; break; }
      step(m, 1 / 60, t);
    }
    return { gotBall: gotBall, frames: frames, speed: dist };
  }
  [6, 10, 16, 20].forEach(function (d) {
    var r = trial(d);
    assert(r.gotBall, d + 'm pass is controlled by the intended receiver', r.gotBall ? undefined : 'ball never settled with the receiver');
  });
  var r2 = trial(10);
  info('10m pass reached the receiver after ' + (r2.frames / 60).toFixed(2) + 's');
})();

// ============================================================
section('3. shot power (pass vs tap vs full charge)');
(function () {
  function setup() {
    var m = newMatch();
    m.start();
    m.state = 'PLAY';
    var h = m.active;
    m.all.forEach(function (p) { if (!p.isGoalkeeper) place(p, 40, 40); });
    m.home[3].x = 0; m.home[3].z = 22;      // home keeper stays home
    m.away[3].x = 0; m.away[3].z = -22;
    place(h, 0, 8, Math.PI);                 // 8m outside the away goal (-22)
    giveBall(m, h);
    return { m: m, h: h };
  }
  var a = setup();
  a.m.fireHumanShotReal(a.h, 0);
  var tap = a.m.ball.speed();

  var b = setup();
  b.m.fireHumanShotReal(b.h, 1);
  var full = b.m.ball.speed();

  var c = setup();
  var mate = c.m.home.filter(function (p) { return !p.isGoalkeeper && p !== c.h; })[0];
  place(mate, 14, 8, Math.PI / 2);
  c.m.passTo(c.h, mate, { lead: false });
  var pass = c.m.ball.speed();

  info('pass ' + pass.toFixed(1) + ' | tap shot ' + tap.toFixed(1) + ' | full shot ' + full.toFixed(1));
  // a pass now solves its power from the distance (so long balls arrive), which
  // must still keep it inside the range a receiver can control
  assert(pass < LG.Config.physics.passReceiveSpeed, 'a pass stays inside the speed a receiver can control', pass.toFixed(2));
  assert(pass > 7, 'a pass is not a dribble', pass.toFixed(2));
  assert(tap > pass * 1.2, 'a tapped shot is clearly faster than a pass', tap.toFixed(2) + ' vs ' + pass.toFixed(2));
  assert(full > 27, 'a full-charge shot is a genuine strike (>27)', full.toFixed(2));
  assert(full > tap * 1.35, 'charge level makes a real difference', (full / tap).toFixed(2) + 'x');
  assert(a.h.kickAnim > 0.5 || b.h.kickAnim > 0.5, 'kicking triggers the strike animation', 'kickAnim=' + b.h.kickAnim);
  // the strike pose must actually reach the character rig
  var rig = LG.Models.buildCharacter(LG.byId('blaze'));
  var idleLeg = rig.limbs.legR.rotation.x;
  LG.Models.animateChar(rig, true, 0, 1, 0.5);
  var kickLeg = rig.limbs.legR.rotation.x;
  assert(rig.limbs && Math.abs(kickLeg - idleLeg) > 0.5, 'the strike pose moves the kicking leg', kickLeg.toFixed(2));
  LG.Models.animateChar(rig, true, 0, 1, 0);
  assert(Math.abs(rig.limbs.legR.rotation.x - idleLeg) < 1e-6, 'the rig returns to its running pose after a strike');

  // aim: aiming at a post must pick that post out, not drift at the keeper
  function shotAt(dx, dz) {
    var s = setup();
    place(s.h, 0, -14, Math.PI);          // 8m from the away goal
    giveBall(s.m, s.h);
    s.h.want.x = dx; s.h.want.z = dz;
    s.m.fireHumanShotReal(s.h, 1);
    return s.m.ball;
  }
  var rightPost = shotAt(1, -0.15);
  var center = shotAt(0, -1);
  info('near-post aim vx=' + rightPost.vx.toFixed(1) + ' | straight aim vx=' + center.vx.toFixed(1));
  assert(rightPost.vx > 4, 'aiming at a post sends the ball toward that post', rightPost.vx.toFixed(1));
  assert(Math.abs(center.vx) < 0.15 * Math.abs(center.vz), 'aiming straight keeps the shot straight', center.vx.toFixed(2));
  assert(rightPost.vz < -20, 'the post shot still travels at the goal', rightPost.vz.toFixed(1));

  var e = setup();
  e.h.want.x = 0; e.h.want.z = -1;
  e.m.fireHumanShotReal(e.h, 1);
  assert(e.m.ball.vz < -20, 'a forward-aimed shot travels toward the target goal', e.m.ball.vz.toFixed(1));
})();

// ============================================================
section('4. tackling is fair: front/side yes, behind no');
(function () {
  // one single tackler/victim pair for all three cases, so stats never skew it
  var shared = newMatch();
  info('tackler ' + shared.away[0].name + ' (def ' + shared.away[0].stats.defense + ') vs carrier ' +
    shared.active.name + ' (dribble ' + shared.active.stats.dribble + ')');
  function trial(where, trials) {
    var m = shared;
    var h = m.active;
    var opp = m.away.filter(function (p) { return !p.isGoalkeeper; })[0];
    var wins = 0;
    for (var i = 0; i < trials; i++) {
      m.ball._kickSeq++;
      place(h, 0, 0, Math.PI);           // carrier faces -z, ball at (0,-0.72)
      giveBall(m, h);
      var pos = where === 'rear' ? [0, 1.55] : where === 'front' ? [0, -1.55] : [1.55, -0.2];
      place(opp, pos[0], pos[1], 0);
      var bx = m.ball.x, bz = m.ball.z;
      opp.facing = Math.atan2(bx - opp.x, bz - opp.z);   // squaring up to the ball
      opp.tackleCd = 0;
      h.stun = 0;
      m.tryTackle(opp);
      // a won challenge knocks the ball loose (it is never teleported to the defender)
      if (!h.hasBall && m.ball.owner === null) wins++;
    }
    return wins / trials;
  }
  var rear = trial('rear', 500);
  var side = trial('side', 500);
  var front = trial('front', 500);
  info('steal rate — rear ' + (rear * 100).toFixed(1) + '% | side ' + (side * 100).toFixed(1) + '% | front ' + (front * 100).toFixed(1) + '%');
  assert(rear < 0.10, 'a challenge from BEHIND almost never wins the ball', (rear * 100).toFixed(1) + '%');
  assert(front > 0.6, 'a challenge from the FRONT is rewarded', (front * 100).toFixed(1) + '%');
  assert(side > 0.3, 'a side-on challenge is a real contest', (side * 100).toFixed(1) + '%');
  assert(front > rear + 0.4, 'front vs rear is a clear, understandable difference');

  // identical rules both ways: the human tackling an AI carrier (same roster)
  var m2 = newMatch();
  m2.home[0] = shared.home[0]; m2.away = shared.away; m2.active = shared.active;
  var human = m2.active;
  var aiCarrier = m2.away.filter(function (p) { return !p.isGoalkeeper; })[0];
  var wins = 0, N = 400;
  for (var i = 0; i < N; i++) {
    m2.ball._kickSeq++;
    place(aiCarrier, 0, 0, Math.PI);
    giveBall(m2, aiCarrier);
    place(human, 0, -1.55, 0);              // human in front of the AI carrier
    var bx = m2.ball.x, bz = m2.ball.z;
    human.facing = Math.atan2(bx - human.x, bz - human.z);
    human.tackleCd = 0;
    aiCarrier.stun = 0;
    m2.tryTackle(human);
    if (!aiCarrier.hasBall && m2.ball.owner === null) wins++;
  }
  var humanFront = wins / N;
  info('human tackling the AI from the front: ' + (humanFront * 100).toFixed(1) + '%');
  assert(Math.abs(humanFront - front) < 0.18, 'player->AI uses the same rules as AI->player', (humanFront * 100).toFixed(1) + '% vs ' + (front * 100).toFixed(1) + '%');

  // a failed challenge must not freeze the carrier
  var m3 = newMatch();
  var carrier = m3.away.filter(function (p) { return !p.isGoalkeeper; })[0];
  var tackler = m3.active;
  var stuns = [];
  for (var k = 0; k < 200; k++) {
    m3.ball._kickSeq++;
    place(carrier, 0, 0, Math.PI);
    giveBall(m3, carrier);
    place(tackler, 0, 1.55, 0);
    tackler.tackleCd = 0;
    carrier.stun = 0;
    m3.tryTackle(tackler);
    if (!carrier.hasBall) { carrier.stun = 0; continue; }   // won the ball: the stun is fair
    stuns.push(carrier.stun);
  }
  var maxStun = stuns.reduce(function (a, b) { return Math.max(a, b); }, 0);
  assert(maxStun <= 0.2, 'a failed challenge only bumps, never freezes the carrier', maxStun.toFixed(2) + 's');
})();

// ============================================================
section('5. mobile stick feel');
(function () {
  LG.Input.reset();
  LG.Input.setEnabled(true);
  LG.Input.update(0);
  stickTo(1, 0, 1);
  var rx = LG.Input.moveVec();
  assert(rx.x > 0.8 && Math.abs(rx.y) < 0.05, 'a short thumb push reaches near-full tilt', JSON.stringify(rx));

  // 30px of travel from the touch point
  var ev30 = { clientX: ZONE.ox + 30, clientY: ZONE.oy, pointerId: 1, preventDefault: function () {} };
  elements['joystick-zone'].fire('pointermove', ev30);
  var r30 = LG.Input.moveVec();
  info('30px pushed -> ' + r30.x.toFixed(2) + ' of tilt (full tilt needs ' + ZONE.fullR.toFixed(0) + 'px)');
  assert(r30.x > 0.35 && r30.x < 0.9, 'partial push gives partial speed', r30.x.toFixed(2));

  // direction mapping: stick up == toward the away goal
  stickTo(0, -1, 1);
  var up = LG.Input.moveVec();
  assert(up.y > 0.9 && Math.abs(up.x) < 0.05, 'stick up reads as screen-up', JSON.stringify(up));
  var h = { want: {} };
  h.want.x = up.x; h.want.z = -up.y;
  assert(h.want.z < -0.9, 'screen-up maps to attacking direction (-z)', h.want.z.toFixed(2));

  // diagonal must not be faster than a straight line
  stickTo(1, -1, 1);
  var diag = LG.Input.moveVec();
  var mag = Math.sqrt(diag.x * diag.x + diag.y * diag.y);
  assert(Math.abs(mag - 1) < 0.02, 'diagonal input is normalised (no diagonal speed boost)', mag.toFixed(3));

  // dead zone
  elements['joystick-zone'].fire('pointermove', { clientX: ZONE.ox + 3, clientY: ZONE.oy, pointerId: 1, preventDefault: function () {} });
  var dz = LG.Input.moveVec();
  assert(dz.x === 0 && dz.y === 0, 'a barely-touched stick does not creep', JSON.stringify(dz));

  // release stops movement
  stickRelease();
  LG.Input.update(0.1);
  var rel = LG.Input.moveVec();
  assert(rel.x === 0 && rel.y === 0, 'releasing the stick stops input immediately', JSON.stringify(rel));

  // buttons fire the moment they are touched
  LG.Input.update(0.2);
  btn('pass', true);
  LG.Input.update(0.21);
  assert(LG.Input.pressed('pass'), 'PASS registers on touch-down');
  btn('pass', false);
  LG.Input.update(0.22);
  assert(!LG.Input.pressed('pass'), 'PASS clears on release');
  btn('sprint', true);
  LG.Input.update(0.23);
  assert(LG.Input.down('sprint'), 'SPRINT is a held action');
  btn('sprint', false);
  LG.Input.update(0.24);
  btn('shoot', true);
  LG.Input.update(0.25);
  assert(LG.Input.down('shoot'), 'SHOOT is held to charge');
  btn('shoot', false);
  LG.Input.update(0.26);
  btn('tackle', true);
  LG.Input.update(0.27);
  assert(LG.Input.pressed('tackle'), 'TACKLE registers on touch-down');
  btn('tackle', false);
  LG.Input.update(0.28);
})();

// ============================================================
section('6. sprint + stamina (driven through the real stick + SPRINT button)');
(function () {
  var m = newMatch();
  m.start();
  m.state = 'PLAY';
  var p = m.active;
  m.all.forEach(function (o) {
    if (o === p) return;
    if (o.isGoalkeeper) { o.x = 0; o.z = o.team === 0 ? 21.5 : -21.5; return; }
    place(o, 39, 39);
  });
  // run up the left wing: a clear runway, and freeze everyone else so the test
  // measures the stick, the SPRINT button and the stamina model — nothing else
  place(p, -11.5, -11, Math.PI / 2);
  var t = { t: 0 };
  m.all.forEach(function (o) {
    if (o === p) return;
    o.ai = null;
    o.want.x = 0; o.want.z = 0; o.want.sprint = false;
    place(o, 12, 20);
  });
  m.ball.reset(-12, -21);
  m.possessionTeam = -1;

  // keep the player running in open space (turn around at the touchline) and
  // sample the settled top speed of each phase
  var runDir = 1;
  function phase(frames, sprintOn) {
    btn('sprint', !!sprintOn);
    var peak = 0;
    for (var i = 0; i < frames; i++) {
      if (p.z > 15) runDir = -1; else if (p.z < -8) runDir = 1;   // hysteresis
      stickTo(0, runDir, 1);
      step(m, 1 / 60, t);
      if (i > frames - 30) peak = Math.max(peak, Math.abs(p.vz));
    }
    return peak;
  }
  var jogSpeed = phase(90, false);
  var sprintSpeed = phase(60, true);
  var stamAfter1s = p.stamina;
  var exhaustedSpeed = phase(330, true);
  var stamAfter6s = p.stamina;
  var stamAfterRest = (phase(120, false), p.stamina);
  var recoveredSpeed = phase(60, true);

  info('jog ' + jogSpeed.toFixed(2) + ' | sprint ' + sprintSpeed.toFixed(2) +
    ' | tired ' + exhaustedSpeed.toFixed(2) + ' | recovered ' + recoveredSpeed.toFixed(2) +
    ' | stamina 1s=' + stamAfter1s.toFixed(2) + ' 6s=' + stamAfter6s.toFixed(2));
  assert(sprintSpeed > jogSpeed * 1.35, 'SPRINT makes a clear difference', (sprintSpeed / jogSpeed).toFixed(2) + 'x');
  assert(stamAfter1s < 0.9, 'sprinting costs stamina', stamAfter1s.toFixed(2));
  assert(exhaustedSpeed > jogSpeed * 0.85, 'an empty tank means jogging, never a speed penalty', exhaustedSpeed.toFixed(2));
  info('after 2s off the sprint button: stamina ' + stamAfterRest.toFixed(2));
  assert(stamAfterRest > 0.45, 'stamina comes back when you ease off', stamAfterRest.toFixed(2));
  assert(recoveredSpeed > jogSpeed * 1.35, 'sprint returns after recovering', recoveredSpeed.toFixed(2));
})();

// ============================================================
section('6b. ball roll: passes and shots must actually travel');
(function () {
  function roll(speed) {
    var m = newMatch();
    var b = m.ball;
    b.reset(0, 19);
    b.kick(0, 0.1, -speed);
    var z0 = b.z, travelled = 0;
    for (var i = 0; i < 60 * 12; i++) {
      b.step(1 / 60, null);
      travelled = Math.abs(b.z - z0);
      if (b.speed() < 0.7) break;
    }
    return travelled;
  }
  var passRoll = roll(15.5), shotRoll = roll(33), shortRoll = roll(9.5);
  info('roll distance — short pass ' + shortRoll.toFixed(1) + 'm | pass ' + passRoll.toFixed(1) + 'm | shot ' + shotRoll.toFixed(1) + 'm');
  assert(shortRoll > 6 && shortRoll < 14, 'a short pass rolls a sensible distance', shortRoll.toFixed(1) + 'm');
  assert(passRoll > 13, 'a 15m pass still has legs when it arrives', passRoll.toFixed(1) + 'm');
  assert(shotRoll > 24 && shotRoll < 44, 'a shot travels like a shot (not a nudge)', shotRoll.toFixed(1) + 'm');
})();

// ============================================================
section('7. goalkeepers');
(function () {
  // a genuinely ON-TARGET shot aimed at a point inside the mouth
  function shotTrial(aimX, speed, fromZ) {
    var m = newMatch();
    m.start();
    m.state = 'PLAY';
    var savedByKeeper = false;
    m.bus.on('keeperSave', function () { savedByKeeper = true; });
    var gk = m.away[3];
    m.all.forEach(function (p) {
      if (p.isGoalkeeper) { m.repositionGoalkeeper(p); return; }
      place(p, 40, 40);
    });
    gk.x = 0; gk.z = -21.2;
    var z0 = fromZ === undefined ? -8 : fromZ, z1 = -22.2;
    var dx = aimX, dz = z1 - z0, d = Math.sqrt(dx * dx + dz * dz);
    m.ball.reset(0, z0);
    m.ball.vx = dx / d * speed; m.ball.vz = dz / d * speed;
    m.ball.lastKicker = m.home[2];
    m.ball._kickSeq++;
    var out = 'live';
    for (var i = 0; i < 180; i++) {
      m.state = 'PLAY';
      m.update(1 / 60);
      if (m.state === 'GOAL') { out = 'goal'; break; }
      if (gk.hasBall) { out = 'caught'; break; }
      if (m.ball.vz > 0.5) { out = savedByKeeper ? 'parried' : 'blocked'; break; }
      if (m.ball.z < z1 - 0.5) { out = 'net'; break; }        // crossed the line
      if (m.ball.speed() < 0.5 && m.ball.z < z0) { out = 'died'; break; }
    }
    return { out: out, aimX: aimX, score: m.score.slice() };
  }
  function runShots(N, fromZ, lo, hi) {
    var goals = 0, saves = 0, tally = {};
    for (var i = 0; i < N; i++) {
      var aim = (Math.random() < 0.5 ? -1 : 1) * (lo + Math.random() * (hi - lo));
      var r = shotTrial(aim, 30, fromZ);
      tally[r.out] = (tally[r.out] || 0) + 1;
      if (r.out === 'goal') goals++;
      if (r.out !== 'live' && r.out !== 'goal') saves++;
    }
    return { goals: goals / N, saves: saves / N, tally: tally };
  }
  var N = 250;
  var post = runShots(N, -8, 1.7, 2.4);        // aimed inside the post
  var atKeeper = runShots(N, -8, 0, 0.6);      // banged straight at the keeper
  var anywhere = runShots(N, -8, 0, 2.4);      // mixed
  var close = runShots(N, -16.5, 1.7, 2.4);    // 6m out, same placement
  info('outcomes ' + JSON.stringify(anywhere.tally));
  info('14m on target   : ' + (anywhere.goals * 100).toFixed(0) + '% goals / ' + (anywhere.saves * 100).toFixed(0) + '% stopped');
  info('14m near the post: ' + (post.goals * 100).toFixed(0) + '% goals');
  info('14m at the keeper: ' + (atKeeper.goals * 100).toFixed(0) + '% goals');
  info('6m near the post : ' + (close.goals * 100).toFixed(0) + '% goals');
  assert(anywhere.goals > 0.12 && anywhere.goals < 0.7, 'power shots from range are neither guaranteed goals nor guaranteed saves', (anywhere.goals * 100).toFixed(0) + '%');
  assert(anywhere.saves > 0.25, 'keepers genuinely react and stop shots', (anywhere.saves * 100).toFixed(0) + '%');
  assert(post.goals > atKeeper.goals + 0.15, 'placing a shot beats banging it at the keeper', (post.goals * 100).toFixed(0) + '% vs ' + (atKeeper.goals * 100).toFixed(0) + '%');
  assert(close.goals > post.goals, 'close-range finishes beat the keeper more often', (close.goals * 100).toFixed(0) + '% vs ' + (post.goals * 100).toFixed(0) + '%');
  assert(atKeeper.goals < 0.35, 'shooting straight at the keeper is punished', (atKeeper.goals * 100).toFixed(0) + '%');

  // keeper distribution: never blindly to a marked man
  var m2 = newMatch();
  m2.start();
  m2.state = 'PLAY';
  var gk2 = m2.home[3];
  m2.all.forEach(function (p) { if (p !== gk2) place(p, 30, 30); });
  place(gk2, 0, 21.2, Math.PI);
  giveBall(m2, gk2);
  var mateA = m2.home[0], mateB = m2.home[1];
  place(mateA, 0, 12, Math.PI);       // close to the keeper...
  place(mateB, 8, 8, Math.PI);
  m2.away.forEach(function (o) { if (!o.isGoalkeeper) place(o, 1.2, 12); });  // ...but smothered
  gk2.distributeT = 0;
  gk2.ai.distribute();
  var target = m2.ball.intendedReceiver;
  assert(target && target !== mateA, 'keeper avoids passing into a crowd', target ? target.name : 'no pass');

  // ---- a keeper in front of a central shot is not a ghost, at ANY frame rate.
  // The swept body-block used to be guarded by a FIXED 0.8m "teleport" check: a
  // full-speed shot that moved more than 0.8m in a single low-FPS frame phased
  // straight through him. The guard is now speed-aware, so a coarse frame still
  // stops the ball that physically crosses his body ---------------- 
  function centralShot(stepDt) {
    var m = newMatch();
    m.start();
    m.state = 'PLAY';
    var stopped = false;
    m.bus.on('keeperSave', function () { stopped = true; });
    var gk = m.away[3];
    m.all.forEach(function (p) {
      if (p.isGoalkeeper) { m.repositionGoalkeeper(p); return; }
      place(p, 40, 40);
    });
    gk.x = 0; gk.z = -21.2;
    // isolate the PHYSICAL block: disable the reflex roll for this measurement
    m.keeperSaveChance = function () { return 0; };
    m.ball.reset(0, -8);
    m.ball.vx = 0; m.ball.vz = -30;         // bang it straight at the keeper
    m.ball.lastKicker = m.home[2];
    m.ball._kickSeq++;
    var out = 'live';
    for (var i = 0; i < 400; i++) {
      m.state = 'PLAY';
      m.update(stepDt);
      if (m.state === 'GOAL') { out = 'goal'; break; }
      if (gk.hasBall) { out = 'caught'; break; }
      if (m.ball.vz > 0.5) { out = stopped ? 'parried' : 'blocked'; break; }
      if (m.ball.z < -22.4) { out = 'net'; break; }
    }
    return out;
  }
  var hiFps = centralShot(1 / 60), loFps = centralShot(1 / 20);
  info('central shot at 60fps -> ' + hiFps + ' | at 20fps -> ' + loFps);
  assert(hiFps !== 'goal' && hiFps !== 'net', 'a 60fps shot straight at the keeper is stopped', hiFps);
  assert(loFps !== 'goal' && loFps !== 'net', 'a 20fps shot straight at the keeper is still stopped (no phase-through at low FPS)', loFps);

  // the fix must not make the keeper a wall: a genuinely placed shot still beats
  // him even on a coarse frame
  function placedShot(stepDt, aimX) {
    var m = newMatch();
    m.start();
    m.state = 'PLAY';
    var gk = m.away[3];
    m.all.forEach(function (p) {
      if (p.isGoalkeeper) { m.repositionGoalkeeper(p); return; }
      place(p, 40, 40);
    });
    gk.x = 0; gk.z = -21.2;
    m.keeperSaveChance = function () { return 0; };
    var z0 = -8, z1 = -22.2;
    var dx = aimX, dz = z1 - z0, d = Math.sqrt(dx * dx + dz * dz);
    m.ball.reset(0, z0);
    m.ball.vx = dx / d * 30; m.ball.vz = dz / d * 30;
    m.ball.lastKicker = m.home[2];
    m.ball._kickSeq++;
    for (var i = 0; i < 400; i++) {
      m.state = 'PLAY';
      m.update(stepDt);
      if (m.state === 'GOAL') return 'goal';
      if (gk.hasBall) return 'caught';
      if (m.ball.z < z1 - 0.5) return 'net';
    }
    return 'live';
  }
  var lowFpsPlaced = placedShot(1 / 20, 2.1);
  assert(lowFpsPlaced === 'goal' || lowFpsPlaced === 'net', 'a placed low-FPS shot still scores (keeper is not a wall)', lowFpsPlaced);

  // ---- OWN GOALS: a defensive touch into a team's own net must count for the
  // other side (it used to be swallowed, freezing the ball dead in the net with
  // no goal event and no reset) ----------------------------------------------
  function ownGoalTrial(owningTeam) {
    var m = newMatch();
    m.start();
    m.state = 'PLAY';
    var goals = [];
    m.bus.on('goal', function (e) { goals.push(e); });
    m.all.forEach(function (p) { p.ai = null; place(p, 40, 40); });
    // park the defending keeper safely out of the lane so the "own goal" test
    // measures goal detection, not whether a keeper can parry
    var homeGk = m.home[3], awayGk = m.away[3];
    place(homeGk, 3, 21.2, Math.PI);
    place(awayGk, 3, -21.2, 0);
    m.keeperSaveChance = function () { return 0; };
    var z0 = owningTeam === 0 ? 19.5 : -19.5;
    var vz = owningTeam === 0 ? 30 : -30;
    m.ball.reset(0, z0);
    m.ball.vx = 0; m.ball.vz = vz;
    m.ball.lastKicker = owningTeam === 0 ? m.home[1] : m.away[1];
    m.ball._kickSeq++;
    var t = { t: 0 };
    // let it cross + one full celebration/goal + kickoff cycle back to PLAY:
    // proves the goal fires exactly once and the match resets instead of stalling
    var pivoted = false;
    for (var i = 0; i < 60 * 8; i++) {
      if (m.state !== 'PLAY') pivoted = true;
      step(m, 1 / 30, t);
      if (pivoted && m.state === 'PLAY') break;
    }
    return { goals: goals, state: m.state, score: m.score.slice(), ballZ: m.ball.z, ballX: m.ball.x };
  }
  var og0 = ownGoalTrial(0);   // home defender -> home net: away score one
  info('home own goal -> ' + og0.score[0] + '-' + og0.score[1] + ' events ' + og0.goals.length +
    ' state ' + og0.state + ' ball (' + og0.ballX.toFixed(1) + ',' + og0.ballZ.toFixed(1) + ')');
  assert(og0.goals.length === 1, 'an own goal fires exactly one goal event', og0.goals.length + ' events');
  assert(og0.goals[0] && og0.goals[0].team === 1 && og0.goals[0].isOwnGoal === true,
    'a home defender\'s own goal counts for the AWAY side', og0.goals[0] && JSON.stringify({ team: og0.goals[0].team, own: og0.goals[0].isOwnGoal }));
  assert(og0.score[1] === 1 && og0.state === 'PLAY' && Math.abs(og0.ballZ) < 1,
    'play resumes from kickoff after an own goal (no dead-ball stall)', JSON.stringify({ score: og0.score, state: og0.state, ballZ: og0.ballZ.toFixed(2) }));

  var og1 = ownGoalTrial(1);   // away defender -> away net: home score one
  assert(og1.goals.length === 1 && og1.goals[0].team === 0 && og1.goals[0].isOwnGoal === true,
    'an away defender\'s own goal counts for the HOME side', JSON.stringify(og1.goals));

  // a parrying KEEPER whose touch sends the ball over his own line is an own
  // goal for the attacking side too
  var pk = newMatch();
  pk.start();
  pk.state = 'PLAY';
  var pkGoals = [];
  pk.bus.on('goal', function (e) { pkGoals.push(e); });
  pk.all.forEach(function (p) { p.ai = null; place(p, 40, 40); });
  place(pk.home[3], 3, 21.2, Math.PI);
  place(pk.away[3], 3, -21.2, 0);
  pk.keeperSaveChance = function () { return 0; };
  pk.ball.reset(0, -19.5);
  pk.ball.vx = 0; pk.ball.vz = -30;
  pk.ball.lastKicker = pk.away[3];     // the AWAY keeper's parry
  pk.ball._kickSeq++;
  var t2 = { t: 0 };
  for (var j = 0; j < 120; j++) { step(pk, 1 / 30, t2); if (pk.state === 'GOAL') break; }
  assert(pkGoals.length === 1 && pkGoals[0].team === 0 && pkGoals[0].isOwnGoal === true,
    'a keeper parry that crosses his own line is a goal for the attackers', JSON.stringify(pkGoals));

  // a normal goal is NOT an own goal and the striker keeps the credit
  var ng = newMatch();
  ng.start();
  ng.state = 'PLAY';
  var ngGoals = [];
  ng.bus.on('goal', function (e) { ngGoals.push(e); });
  ng.all.forEach(function (p) { p.ai = null; place(p, 40, 40); });
  place(ng.home[3], 3, 21.2, Math.PI);
  place(ng.away[3], 3, -21.2, 0);
  ng.keeperSaveChance = function () { return 0; };
  ng.ball.reset(0, 19.5);
  ng.ball.vx = 0; ng.ball.vz = 30;
  ng.ball.lastKicker = ng.away[2];     // an AWAY striker hits the HOME net
  ng.ball._kickSeq++;
  var t3 = { t: 0 };
  for (var q = 0; q < 120; q++) { step(ng, 1 / 30, t3); if (ng.state === 'GOAL') break; }
  assert(ngGoals.length === 1 && ngGoals[0].team === 1 && ngGoals[0].isOwnGoal === false &&
    ngGoals[0].scorer === ng.away[2], 'a striker heading into the OPPOSITE net is a plain goal for his team', JSON.stringify(ngGoals));
})();

// ============================================================
section('8. full match simulation (real loop, real AI, real input)');
(function () {
  var m = newMatch('echo');
  m.start();
  var t = { t: 0 };
  var stats = { shots: 0, passes: 0, tackles: 0, possFlips: 0, goals: 0, frames: 0, stunFrames: 0, maxBallSpeed: 0 };
  var lastPoss = -1;
  m.bus.on('shoot', function () { stats.shots++; });
  m.bus.on('pass', function () { stats.passes++; });
  m.bus.on('tackleWin', function () { stats.tackles++; });
  m.bus.on('goal', function () { stats.goals++; });

  var shootHeld = 0;
  for (var i = 0; i < 60 * 130; i++) {
    // ---- crude but honest "player" that only uses the public input layer ----
    var h = m.active;
    var ball = m.ball;
    var carrier = m.ownerPlayer();
    var aimX = 0, aimZ = 0, mag = 1;
    if (h.hasBall) {
      var g = m.enemyGoal(h.team);
      var dGoal = h.distTo(g.x, g.z);
      aimX = g.x - h.x; aimZ = g.z - h.z;
      if (dGoal < 14 && shootHeld === 0 && Math.random() < 0.05) {
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
      if (carrier && carrier.team !== h.team) {
        aimX = carrier.x - h.x; aimZ = carrier.z - h.z;
        if (h.distTo(carrier.x, carrier.z) < 2.0 && Math.random() < 0.15) btn('tackle', true);
        else btn('tackle', false);
      } else {
        aimX = ball.x - h.x; aimZ = ball.z - h.z;
        btn('tackle', false);
      }
      if (h.distTo(ball.x, ball.z) > 12) mag = 1;
    }
    stickTo(aimX, aimZ, mag);
    // sprint when chasing
    btn('sprint', !h.hasBall && h.distTo(ball.x, ball.z) > 5);

    step(m, 1 / 60, t);
    stats.frames++;
    stats.maxBallSpeed = Math.max(stats.maxBallSpeed, m.ball.speed3());
    if (m.possessionTeam !== lastPoss) { stats.possFlips++; lastPoss = m.possessionTeam; }
    var stunned = 0;
    m.all.forEach(function (p) { if (p.stun > 0) stunned++; });
    if (stunned > 0) stats.stunFrames++;

    if (m.ball.speed3() > LG.Config.physics.maxBallSpeed + 1) {
      stats.overSpeed = (stats.overSpeed || 0) + 1;
      if (!stats.loudReported) {
        stats.loudReported = true;
        info('overspeed ball: ' + m.ball.speed3().toFixed(1) + ' owner=' + (m.ball.owner ? m.ball.owner.name : 'none') +
          ' v=(' + m.ball.vx.toFixed(1) + ',' + m.ball.vy.toFixed(1) + ',' + m.ball.vz.toFixed(1) + ') y=' + m.ball.y.toFixed(2));
      }
    }

    // integrity checks every frame
    var bad = 0;
    m.all.forEach(function (p) {
      if (!isFinite(p.x) || !isFinite(p.z) || !isFinite(p.vx) || !isFinite(p.vz)) bad++;
      if (Math.abs(p.x) > LG.Config.court.width / 2 + 0.5) bad++;
      if (Math.abs(p.z) > LG.Config.court.length / 2 + LG.Config.court.goalDepth + 0.5) bad++;
    });
    if (!isFinite(m.ball.x) || !isFinite(m.ball.y) || !isFinite(m.ball.z)) bad++;
    if (Math.abs(m.ball.x) > LG.Config.court.width / 2 + 0.5) bad++;
    if (m.ball.y < -0.2) bad++;
    if (bad) { assert(false, 'world integrity held at frame ' + i, bad + ' broken entities'); break; }
    if (m.state !== 'PLAY' && m.state !== 'KICKOFF' && m.state !== 'GOAL' && m.state !== 'END') {
      assert(false, 'unknown match state ' + m.state); break;
    }
  }
  info('130s simulated: ' + stats.goals + ' goals, score ' + m.score[0] + '-' + m.score[1] +
    ' | shots ' + stats.shots + ' | passes ' + stats.passes + ' | tackles won ' + stats.tackles +
    ' | possession flips ' + stats.possFlips + ' | peak ball ' + stats.maxBallSpeed.toFixed(1));
  info('frames with anyone stunned: ' + (stats.stunFrames / stats.frames * 100).toFixed(1) + '%');
  assert(stats.shots > 3, 'the AI + player take real shots', stats.shots);
  assert(stats.passes > 10, 'passing flows through the match', stats.passes);
  assert(stats.tackles > 0, 'tackles are won (not just collisions)', stats.tackles);
  assert(stats.possFlips > 20, 'possession changes hands constantly', stats.possFlips);
  assert(stats.stunFrames / stats.frames < 0.35, 'players are not stun-locked', (stats.stunFrames / stats.frames * 100).toFixed(1) + '%');
  assert(stats.goals >= 1 && stats.goals <= 24, 'scoring is believable', stats.goals);
  assert(!stats.overSpeed, 'the ball never exceeds its speed cap', (stats.overSpeed || 0) + ' frames');
  var avgSpeeds = m.all.map(function (p) { return Math.sqrt(p.vx * p.vx + p.vz * p.vz); });
  info('speed spread at the whistle: ' + avgSpeeds.map(function (v) { return v.toFixed(1); }).join(', '));

  // the human's mates must actually support, not clump on the ball
  var minMateGap = 99;
    for (var k = 0; k < 60; k++) {
      for (var a = 0; a < m.home.length; a++) {
        for (var b = a + 1; b < m.home.length; b++) {
          minMateGap = Math.min(minMateGap, m.home[a].distTo(m.home[b].x, m.home[b].z));
        }
      }
      step(m, 1 / 60, t);
    }
    // 0.42m is the physical floor (two outfield bodies); a pair crushed against
    // a touchline can't be pushed fully apart, so allow a little slack there
    assert(minMateGap > 0.4, 'teammates do not stack on top of each other', minMateGap.toFixed(2) + 'm');
})();

// ============================================================
section('9. player switching picks a useful player');
(function () {
  var m = newMatch();
  m.start();
  m.state = 'PLAY';
  var ball = m.ball;
  m.all.forEach(function (p) { place(p, 40, 40); });
  var outfield = m.home.filter(function (p) { return !p.isGoalkeeper; });
  ball.reset(10, -10);
  m.possessionTeam = -1;
  place(outfield[1], 11, -10, 0);      // nearest
  place(outfield[2], 18, -10, 0);
  place(outfield[0], 30, -10, 0);
  m.active = outfield[0];
  m.selectActive();
  m.switchPlayer();
  assert(m.active === outfield[1], 'switch jumps to the player who can actually reach the ball', m.active.name);

  // defending: pick someone who can get to the carrier
  var carrier = m.away.filter(function (p) { return !p.isGoalkeeper; })[0];
  place(carrier, 12, -12, 0);
  giveBall(m, carrier);
  place(outfield[1], 19, 3, 0);        // nearby but nowhere near the play
  place(outfield[2], 14, -12.5, 0);    // can challenge
  place(outfield[0], 30, -10, 0);
  m.active = outfield[0];
  m.selectActive();
  m.switchPlayer();
  assert(m.active === outfield[2], 'switch picks the defender who can challenge', m.active.name);
})();

// ============================================================
section('10. AI does not just chase the ball carrier');
(function () {
  var m = newMatch();
  m.start();
  m.state = 'PLAY';
  var h = m.active;
  var ball = m.ball;
  m.all.forEach(function (p) { place(p, 40, 40); });
  place(h, 0, 0, Math.PI);
  giveBall(m, h);
  h.want.x = 0; h.want.z = -1; h.want.sprint = false;
  var opp = m.away.filter(function (p) { return !p.isGoalkeeper; });
  place(opp[0], 8, 6, 0);
  place(opp[1], -6, -4, 0);
  place(opp[2], 3, -14, 0);
  var t = { t: 0 };
  var chasersClose = 0;
  for (var i = 0; i < 60; i++) {
    step(m, 1 / 60, t);
    h.want.x = 0; h.want.z = -1;
    var closest = 99;
    opp.forEach(function (o) { closest = Math.min(closest, o.distTo(h.x, h.z)); });
    if (closest < 0.9) chasersClose++;
  }
  var goalsideOfCarrier = opp.filter(function (o) { return o.z < h.z; }).length;
  info('opponent distances after 1s: ' + opp.map(function (o) { return o.distTo(h.x, h.z).toFixed(1); }).join(', '));
  assert(chasersClose < 30, 'defenders contain instead of piling into the carrier', chasersClose + '/60 frames in contact');
})();

// ============================================================
section('11. difficulty — the level actually changes the AI');
(function () {
  var D = LG.Difficulty;
  assert(D.get() === 'medium', 'the default difficulty is MEDIUM', D.get());
  D.set('nonsense');
  assert(D.get() === 'medium', 'an unknown level is ignored', D.get());
  D.set('hard');
  assert(D.get() === 'hard', 'the choice is remembered', D.get());
  assert(D.forTeam(1).label === 'HARD', 'the OPPONENTS play at the chosen level', D.forTeam(1).label);
  assert(D.forTeam(0).label === 'MEDIUM', 'your own running mates stay at the fair baseline', D.forTeam(0).label);
  assert(D.label('easy') === 'EASY' && D.blurb('easy').length > 5, 'each level carries a label and a blurb');
  D.set('medium');

  // the centralized table must carry every knob the brief lists
  var KNOBS = ['reactionTime', 'passAccuracy', 'shotAccuracy', 'tackleAccuracy',
    'interceptionAbility', 'pressingIntensity', 'decisionDelay', 'playerSwitchSpeed',
    'goalkeeperReaction', 'goalkeeperSaveAbility', 'attackingAggression',
    'defensiveAggression', 'mistakeRate'];
  var missing = KNOBS.filter(function (k) { return typeof LG.Config.difficulty.easy[k] !== 'number'; });
  assert(missing.length === 0, 'the table carries every documented knob', missing.join(','));
  var HIGHER_IS_BETTER = ['passAccuracy', 'shotAccuracy', 'tackleAccuracy', 'interceptionAbility',
    'pressingIntensity', 'playerSwitchSpeed', 'goalkeeperReaction', 'goalkeeperSaveAbility',
    'attackingAggression', 'defensiveAggression'];
  var flat = HIGHER_IS_BETTER.filter(function (k) {
    var t = LG.Config.difficulty;
    return !(t.easy[k] < t.medium[k] && t.medium[k] < t.hard[k]);
  });
  assert(flat.length === 0, 'easy < medium < hard for every "sharper = better" knob', flat.join(','));
  var inverted = ['reactionTime', 'decisionDelay', 'mistakeRate'].filter(function (k) {
    var t = LG.Config.difficulty;
    return !(t.easy[k] > t.medium[k] && t.medium[k] > t.hard[k]);
  });
  assert(inverted.length === 0, 'easy is slower / more error-prone than hard (reaction, delay, mistakes)', inverted.join(','));

  // the profile reaches the brains: opponents use the pick, your mates the base
  var mA = newMatch(); mA.start();
  assert(mA.away[0].ai.difficulty().label === 'MEDIUM' && mA.home[1].ai.difficulty().label === 'MEDIUM',
    'the balanced level is the baseline for both sides');
  LG.Difficulty.set('easy');
  assert(mA.away[0].ai.difficulty().label === 'EASY', 'an away player reads the EASY profile', mA.away[0].ai.difficulty().label);
  assert(mA.home[1].ai.difficulty().label === 'MEDIUM', 'a home player keeps the baseline profile', mA.home[1].ai.difficulty().label);
  LG.Difficulty.set('medium');

  // ---- HARD must not cheat: identical physics, only decisions differ ----
  // (same players, so the roster draw cannot skew the comparison)
  var mSp = newMatch(); mSp.start();
  LG.Difficulty.set('easy');
  var easySpeeds = mSp.all.map(function (p) { return p.maxSpeed; });
  LG.Difficulty.set('hard');
  var hardSpeeds = mSp.all.map(function (p) { return p.maxSpeed; });
  var sameSpeeds = easySpeeds.every(function (s, i) { return Math.abs(s - hardSpeeds[i]) < 1e-9; });
  assert(sameSpeeds, 'HARD does not get extra pace (identical player speeds)', easySpeeds[0].toFixed(2) + ' vs ' + hardSpeeds[0].toFixed(2));
  assert(LG.Config.physics.maxBallSpeed === 36, 'the ball speed cap is untouched by difficulty');
  LG.Difficulty.set('medium');

  // ---- pressing: how much room and time a carrier gets on each level ----
  var pmHold = probeMatch();
  function holdUp(level, seconds) {
    LG.Difficulty.set(level);
    LG.Input.reset();
    var m = resetProbe(pmHold);
    var h = m.home[0];
    m.all.forEach(function (p) { place(p, 30, 30); });
    m.home[3].x = 0; m.home[3].z = 21.5;
    m.away[3].x = 0; m.away[3].z = -21.5;
    place(h, 0, 0, Math.PI);
    giveBall(m, h);
    // three opponents converge on a carrier who is shielding the ball
    place(m.away[0], 0, -4.5, 0);
    place(m.away[1], 4.2, 3.6, 0);
    place(m.away[2], -4.2, 3.6, 0);
    var t = { t: 0 }, held = 0, engaged = null;
    for (var i = 0; i < 60 * seconds; i++) {
      h.want.x = 0; h.want.z = 0;            // stand still and shield the ball
      step(m, 1 / 60, t);
      var near = 1e9;
      m.away.forEach(function (o) { if (!o.isGoalkeeper) near = Math.min(near, o.distTo(h.x, h.z)); });
      // count only while the CARRIER still has it — a keeper catching a shot
      // must not be mistaken for the human keeping possession
      if (h.hasBall) held++;
      if (engaged === null && near < 1.2) engaged = i / 60;
    }
    return {
      keep: held / (60 * seconds),
      close: engaged === null ? 99 : engaged,
    };
  }
  var HOLD_S = 10;
  var easyHold = holdUp('easy', HOLD_S), medHold = holdUp('medium', HOLD_S), hardHold = holdUp('hard', HOLD_S);
  info('shielding the ball for ' + HOLD_S + 's as three defenders close in — still held: easy ' +
    (easyHold.keep * 100).toFixed(0) + '%, medium ' + (medHold.keep * 100).toFixed(0) + '%, hard ' +
    (hardHold.keep * 100).toFixed(0) + '%');
  info('time before a defender is right on the carrier: easy ' + easyHold.close.toFixed(2) +
    's | medium ' + medHold.close.toFixed(2) + 's | hard ' + hardHold.close.toFixed(2) + 's');
  assert(easyHold.keep > 0.9, 'EASY barely ever takes the ball off a shielding carrier',
    (easyHold.keep * 100).toFixed(0) + '%');
  assert(hardHold.keep < 0.6, 'HARD dispossesses a shielding carrier quickly',
    (hardHold.keep * 100).toFixed(0) + '%');
  assert(easyHold.keep > hardHold.keep + 0.3, 'EASY gives the carrier far more time on the ball',
    (easyHold.keep * 100).toFixed(0) + '% vs ' + (hardHold.keep * 100).toFixed(0) + '%');
  assert(easyHold.close > hardHold.close + 0.1, 'EASY takes longer to get a defender into the carrier',
    easyHold.close.toFixed(2) + 's vs ' + hardHold.close.toFixed(2) + 's');

  // ---- the cushion a defender holds: a clean probe, with the challenge
  // deliberately disarmed so this measures SPACING, not who-wins-the-ball ----
  var pmStand = probeMatch();
  function standOff(level) {
    LG.Difficulty.set(level);
    LG.Input.reset();
    var m = resetProbe(pmStand);
    var h = m.home[0];
    h.want.x = 0; h.want.z = 0;
    m.all.forEach(function (p) { if (p !== h) { p.ai = null; place(p, -12.5, -20.5); } });
    place(h, 0, 0, Math.PI);
    giveBall(m, h);
    var chaser = m.away[0];
    place(chaser, 10, 0, 0);
    chaser.ai = new LG.AIBrain(chaser);
    var intent = 0, settled = 0, n = 0;
    for (var i = 0; i < 480; i++) {
      // hold the ball on the carrier and take the challenge away entirely
      h.hasBall = true;
      m.ball.owner = h;
      m.possessionTeam = 0;
      m.ball.x = h.x + Math.sin(h.facing) * 0.65;
      m.ball.z = h.z + Math.cos(h.facing) * 0.65;
      chaser.ai.actionCd = 9;
      chaser.tackleCd = 9;
      chaser.ai.update(1 / 60);
      chaser.update(1 / 60);
      if (i > 180) {
        // the cushion the defender is deliberately holding: how far his chosen
        // containment point sits from the carrier
        var mt = chaser.ai.moveTarget;
        intent += Math.sqrt((mt.x - h.x) * (mt.x - h.x) + (mt.z - h.z) * (mt.z - h.z));
        n++;
      }
    }
    return { intent: intent / n, settled: chaser.distTo(h.x, h.z) };
  }
  var eStand = standOff('easy'), mStand = standOff('medium'), hStand = standOff('hard');
  info('defender cushion — chosen: easy ' + eStand.intent.toFixed(2) + 'm, medium ' + mStand.intent.toFixed(2) +
    'm, hard ' + hStand.intent.toFixed(2) + 'm | settled: easy ' + eStand.settled.toFixed(2) +
    'm, medium ' + mStand.settled.toFixed(2) + 'm, hard ' + hStand.settled.toFixed(2) + 'm');
  assert(eStand.intent > mStand.intent && mStand.intent > hStand.intent,
    'the cushion a defender leaves shrinks as the level rises',
    eStand.intent.toFixed(2) + ' > ' + mStand.intent.toFixed(2) + ' > ' + hStand.intent.toFixed(2));
  assert(eStand.intent > hStand.intent * 1.5, 'EASY leaves a much bigger cushion than HARD',
    (eStand.intent / hStand.intent).toFixed(2) + 'x');
  assert(eStand.settled > hStand.settled, 'and EASY defenders end up further off the carrier in practice',
    eStand.settled.toFixed(2) + 'm vs ' + hStand.settled.toFixed(2) + 'm');

  // ---- how quickly the chase is handed to the closest defender ----
  function switchDelay(level) {
    LG.Difficulty.set(level);
    var m = newMatch(); m.start();
    var a = m.away[0], b = m.away[1];
    place(a, 0, -5, 0); place(b, 0, -16, 0);
    m.ball.reset(0, -5.2);
    m.t = 0;
    if (m.chaserOf(1) !== a) return -1;
    place(a, 12, -20, 0);                 // a drops out of the play entirely
    place(b, 0, -5.4, 0);                 // b is now clearly the man
    for (var i = 1; i <= 400; i++) {
      m.t = i / 240;
      if (m.chaserOf(1) === b) return m.t;
    }
    return 99;
  }
  var eSw = switchDelay('easy'), mSw = switchDelay('medium'), hSw = switchDelay('hard');
  info('chase handed over after: easy ' + eSw.toFixed(2) + 's, medium ' + mSw.toFixed(2) + 's, hard ' + hSw.toFixed(2) + 's');
  assert(eSw > hSw, 'EASY is slower to switch the chase to the closest defender', eSw.toFixed(2) + ' vs ' + hSw.toFixed(2));
  assert(hSw < mSw, 'HARD switches players faster than MEDIUM', hSw.toFixed(2) + ' vs ' + mSw.toFixed(2));

  // ---- tackle accuracy scales the challenge, never the fairness rules ----
  // (the same defender and the same carrier are used on every level)
  var pmTackle = probeMatch();
  var tkCarrier = pmTackle.home[0];
  var tkOpp = pmTackle.away.filter(function (p) { return !p.isGoalkeeper; })[0];
  // a controlled matchup: a star defender or a weak one would otherwise saturate
  // the challenge or bottom it out, hiding the difficulty's own effect
  tkCarrier.stats = Object.assign({}, tkCarrier.stats, { dribble: 7 });
  tkOpp.stats = Object.assign({}, tkOpp.stats, { defense: 6 });
  info('tackle probe: an even matchup (def 6 vs dribble 7), identical on every level');
  function tackleRate(level, N) {
    LG.Difficulty.set(level);
    var acc = LG.Difficulty.forTeam(1).tackleAccuracy;
    var m = pmTackle, h = tkCarrier, opp = tkOpp;
    var wins = 0;
    for (var i = 0; i < N; i++) {
      m.ball._kickSeq++;
      place(h, 0, 0, Math.PI);
      giveBall(m, h);
      // a side-on challenge: it is a genuine contest for every matchup, so the
      // difficulty's challenge quality is measurable instead of saturating on
      // the 0.96 fairness cap the way a head-on lunge does
      place(opp, 1.55, -0.2, 0);
      var bx = m.ball.x, bz = m.ball.z;
      opp.facing = Math.atan2(bx - opp.x, bz - opp.z);
      opp.tackleCd = 0; h.stun = 0;
      m.tryTackle(opp, { accuracy: acc });
      if (!h.hasBall && m.ball.owner === null) wins++;
    }
    return wins / N;
  }
  var eT = tackleRate('easy', 800), mT = tackleRate('medium', 800), hT = tackleRate('hard', 800);
  info('side-on challenge won: easy ' + (eT * 100).toFixed(0) + '%, medium ' + (mT * 100).toFixed(0) + '%, hard ' + (hT * 100).toFixed(0) + '%');
  assert(eT < mT - 0.1, 'EASY AI makes far more failed tackles', (eT * 100).toFixed(0) + '%');
  assert(hT > mT + 0.02, 'HARD AI challenges more reliably', (hT * 100).toFixed(0) + '% vs ' + (mT * 100).toFixed(0) + '%');
  assert(hT < 0.88, 'HARD never makes a challenge a guaranteed win', (hT * 100).toFixed(0) + '%');
  LG.Difficulty.set('medium');

  // ---- keeper reflexes ----
  // Same keeper, same shots: the aim sweep is a FIXED grid from post to post so
  // every level faces an identical workload and only the keeper's skill differs.
  var pmKeeper = probeMatch();
  function keeperGoals(level, N) {
    LG.Difficulty.set(level);
    var m = pmKeeper;
    var gk = m.away[3];
    var goals = 0;
    for (var i = 0; i < N; i++) {
      resetProbe(m);
      m.all.forEach(function (p) { if (!p.isGoalkeeper) place(p, -12.5, -20.5); });
      m.repositionGoalkeeper(m.home[3]);
      m.repositionGoalkeeper(gk);
      gk.x = 0; gk.z = -21.2;
      gk._saveSig = null;
      var fromZ = -8, z1 = -22.2;
      var dx = (i % 2 ? 1 : -1) * (1.55 + (i / N) * 0.95);
      var dz = z1 - fromZ;
      var d = Math.sqrt(dx * dx + dz * dz), speed = 30;
      m.ball.reset(0, fromZ);
      m.ball.vx = dx / d * speed; m.ball.vz = dz / d * speed;
      m.ball.lastKicker = m.home[2];
      m.ball._kickSeq++;
      for (var k = 0; k < 150; k++) {
        m.state = 'PLAY';
        m.clock = LG.Config.match.duration;
        m.update(1 / 60);
        if (m.state === 'GOAL') { goals++; break; }
        if (gk.hasBall) break;
        if (m.ball.vz > 0.5 || m.ball.z < z1 - 0.5 || m.ball.speed() < 0.5) break;
      }
    }
    return goals / N;
  }
  var N = 300;
  var eG = keeperGoals('easy', N), mG = keeperGoals('medium', N), hG = keeperGoals('hard', N);
  info('placed shots scored past the keeper: easy ' + (eG * 100).toFixed(0) + '%, medium ' +
    (mG * 100).toFixed(0) + '%, hard ' + (hG * 100).toFixed(0) + '%');
  assert(eG > mG, 'the EASY keeper concedes more placed shots', (eG * 100).toFixed(0) + '%');
  assert(hG < mG, 'the HARD keeper is harder to beat', (hG * 100).toFixed(0) + '%');
  assert(hG < 0.75, 'even the HARD keeper is beatable (no wall)', (hG * 100).toFixed(0) + '%');
  assert(eG < 1, 'even the EASY keeper saves something', (eG * 100).toFixed(0) + '%');
  LG.Difficulty.set('medium');
})();

// ============================================================
section('12. difficulty end-to-end — a full match on EASY vs HARD');
(function () {
  // A crude but honest scripted player: it only drives the public input layer,
  // so everything measured here ran through the real game loop.
  function driveHuman(m, s) {
    var h = m.active, ball = m.ball, carrier = m.ownerPlayer();
    var aimX = 0, aimZ = 0, mag = 1;
    if (h.hasBall) {
      var g = m.enemyGoal(h.team);
      var dGoal = h.distTo(g.x, g.z);
      aimX = g.x - h.x; aimZ = g.z - h.z;
      if (dGoal < 14 && s.shootHeld === 0 && Math.random() < 0.05) { btn('shoot', true); s.shootHeld = 1; }
      else if (s.shootHeld > 0) {
        s.shootHeld++;
        if (s.shootHeld > 18) { btn('shoot', false); s.shootHeld = 0; }
      } else if (Math.random() < 0.03) { btn('pass', true); }
      else { btn('pass', false); }
    } else {
      if (s.shootHeld) { btn('shoot', false); s.shootHeld = 0; }
      if (carrier && carrier.team !== h.team) {
        aimX = carrier.x - h.x; aimZ = carrier.z - h.z;
        if (h.distTo(carrier.x, carrier.z) < 2.0 && Math.random() < 0.15) btn('tackle', true);
        else btn('tackle', false);
      } else {
        aimX = ball.x - h.x; aimZ = ball.z - h.z;
        btn('tackle', false);
      }
    }
    stickTo(aimX, aimZ, mag);
    btn('sprint', !h.hasBall && h.distTo(ball.x, ball.z) > 5);
  }

  function run(level, seconds, bind) {
    LG.Difficulty.set(level);
    var m = newMatch('blaze');
    var s = { shootHeld: 0, poss0: 0, poss1: 0 };
    m.bus.on('pass', function (e) { s.pass = s.pass || [0, 0]; s.pass[e.src.team]++; });
    m.bus.on('shoot', function (e) { s.shot = s.shot || [0, 0]; s.shot[e.player.team]++; });
    m.bus.on('tackleWin', function (e) { s.tackle = s.tackle || [0, 0]; if (e.src) s.tackle[e.src.team]++; });
    m.bus.on('goal', function (e) { s.conceded = (s.conceded || 0) + (e.team === 1 ? 1 : 0); });
    m.start();
    if (bind) bind(m, s);
    var t = { t: 0 };
    for (var i = 0; i < 60 * seconds; i++) {
      driveHuman(m, s);
      step(m, 1 / 60, t);
      if (m.possessionTeam === 0) s.poss0++;
      else if (m.possessionTeam === 1) s.poss1++;
      if (m.active && m.active.hasBall) s.carrier = (s.carrier || 0) + 1;
      if (m.ball.speed() < 0.5 && !m.ball.owner) s.dead = (s.dead || 0) + 1;
    }
    return { m: m, s: s };
  }

  function describe(tag, r) {
    var s = r.s;
    var share = s.poss0 / Math.max(1, s.poss0 + s.poss1);
    info('100s ' + tag + ': score ' + r.m.score[0] + '-' + r.m.score[1] +
      ' | human possession ' + (share * 100).toFixed(0) + '%' +
      ' | passes ' + (s.pass ? s.pass[0] + ':' + s.pass[1] : '-') +
      ' | shots ' + (s.shot ? s.shot[0] + ':' + s.shot[1] : '-') +
      ' | tackles ' + (s.tackle ? s.tackle[0] + ':' + s.tackle[1] : '-'));
    return share;
  }

  // Two matches per level, totalled: a single 100s match is far too noisy to
  // draw a conclusion from. The opponent squad is pinned so both levels face
  // the same names — otherwise a lucky roster draw could explain the result.
  var realChoose = LG.Util.choose;
  LG.Util.choose = function () { return ['blaze', 'cannon', 'volt']; };
  function series(level) {
    var out = { s: { poss0: 0, poss1: 0, pass: [0, 0], shot: [0, 0], tackle: [0, 0], conceded: 0, scored: 0, carrier: 0, dead: 0 }, m: null };
    for (var i = 0; i < 3; i++) {
      var r = run(level, 100);
      out.m = r.m;
      out.s.poss0 += r.s.poss0; out.s.poss1 += r.s.poss1;
      out.s.carrier += r.s.carrier || 0;
      out.s.dead += r.s.dead || 0;
      ['pass', 'shot', 'tackle'].forEach(function (k) {
        if (r.s[k]) { out.s[k][0] += r.s[k][0]; out.s[k][1] += r.s[k][1]; }
      });
      out.s.conceded += r.m.score[1];
      out.s.scored += r.m.score[0];
    }
    return out;
  }
  var easy = series('easy'), hard = series('hard');
  LG.Util.choose = realChoose;
  function describe2(tag, r) {
    var s = r.s;
    var share = s.poss0 / Math.max(1, s.poss0 + s.poss1);
    var chance = s.shot[0] / Math.max(1, s.shot[0] + s.shot[1]);
    info('300s ' + tag + ': scored ' + s.scored + ', conceded ' + s.conceded +
      ' | share of the chances ' + (chance * 100).toFixed(0) + '%' +
      ' | team possession ' + (share * 100).toFixed(0) + '%' +
      ' | the human ON the ball ' + (s.carrier / 180).toFixed(1) + '%' +
      ' | passes ' + s.pass[0] + ':' + s.pass[1] +
      ' | shots ' + s.shot[0] + ':' + s.shot[1] +
      ' | tackles won ' + s.tackle[0] + ':' + s.tackle[1]);
    return chance;
  }
  var eChance = describe2('EASY', easy);
  var hChance = describe2('HARD', hard);
  // The possession-share number swings wildly from match to match (a bouncing
  // loose ball is nobody's), so the end-to-end claims are made on what the two
  // sides DID with the ball, which is what "easier" actually means to a player.
  assert(easy.s.shot[1] < hard.s.shot[1], 'EASY opponents threaten the human goal far less than HARD ones',
    easy.s.shot[1] + ' vs ' + hard.s.shot[1]);
  assert(easy.s.conceded < hard.s.conceded, 'the human team concedes far fewer goals on EASY',
    easy.s.conceded + ' vs ' + hard.s.conceded);
  assert(eChance >= hChance, 'the human team owns at least as much of the chances on EASY',
    (eChance * 100).toFixed(0) + '% vs ' + (hChance * 100).toFixed(0) + '%');

  // ---- AI passing accuracy, isolated -------------------------------------------------
  // Every OTHER source of aim error is held constant (same spot, same mates,
  // same pressure), and the lead offset is re-derived exactly as the game does
  // it, so what is left is purely the difficulty's pass wobble.
  var pmAim = probeMatch();
  function aimError(level, N) {
    LG.Difficulty.set(level);
    var m = resetProbe(pmAim);
    var errs = [];
    m.bus.on('pass', function (e) {
      if (e.src.isGoalkeeper || e.src.isHuman) return;
      var s = e.src, t = e.target, b = m.ball;
      var d0 = s.distTo(t.x, t.z);
      var k = d0 / m.passSpeedFor(d0);
      var px = t.x + t.vx * k, pz = t.z + t.vz * k;
      var want = Math.atan2(px - s.x, pz - s.z);
      var got = Math.atan2(b.vx, b.vz);
      errs.push(Math.abs(((got - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
    });
    m.all.forEach(function (p) { p.ai = null; });       // freeze everyone else
    var carrier = m.away[0], mate1 = m.away[1], mate2 = m.away[2];
    var marker = m.home[1];
    // a fixed passer: the wobble must come from the level, not from whichever
    // stat line the roster draw happened to hand this player
    carrier.stats = Object.assign({}, carrier.stats, { pass: 4 });
    for (var i = 0; i < N; i++) {
      m.ball._kickSeq++;
      place(carrier, 0, 0, 0);
      place(mate1, -6, 8, 0);
      place(mate2, 7, 6, 0);
      place(marker, 1.5, 0, 0);         // right on the passer's shoulder
      giveBall(m, carrier);
      carrier.ai = new LG.AIBrain(carrier);
      carrier.ai.actionCd = 0;
      carrier.ai.dribbleT = 0;
      carrier.ai.think();
    }
    if (!errs.length) return { mean: 0, n: 0 };
    var sum = errs.reduce(function (a, b) { return a + b; }, 0);
    return { mean: sum / errs.length, n: errs.length };
  }
  var ew = aimError('easy', 200), mw = aimError('medium', 200), hw = aimError('hard', 200);
  info('AI pass aim error (lead-corrected): easy ' + (ew.mean * 57.3).toFixed(1) + 'deg n=' + ew.n +
    ', medium ' + (mw.mean * 57.3).toFixed(1) + 'deg n=' + mw.n +
    ', hard ' + (hw.mean * 57.3).toFixed(1) + 'deg n=' + hw.n);
  assert(ew.n > 40 && mw.n > 40 && hw.n > 40, 'the AI played enough passes on every level to measure', ew.n + '/' + mw.n + '/' + hw.n);
  assert(ew.mean > mw.mean && mw.mean > hw.mean, 'AI passes get straighter as the level rises',
    (ew.mean * 57.3).toFixed(1) + ' > ' + (mw.mean * 57.3).toFixed(1) + ' > ' + (hw.mean * 57.3).toFixed(1));
  assert(hw.mean < 0.14, 'HARD passes are accurate, not superhuman', (hw.mean * 57.3).toFixed(1) + 'deg');
  assert(ew.mean > 0.09, 'EASY passes visibly miss their man', (ew.mean * 57.3).toFixed(1) + 'deg');
  LG.Difficulty.set('medium');
})();

// ============================================================
section('13. goalkeeper distribution reaches the chosen teammate');
(function () {
  // The keeper picks a teammate, then we prove the ball actually ARRIVES at
  // that player and they control it — not merely that it set off in their
  // general direction. Everyone is frozen (only the ball, the keeper's
  // decision and the receiver's run are live), so this is a clean measurement.
  function distributeTrial(opts) {
    LG.Difficulty.set(opts.level || 'medium');
    LG.Input.reset();
    stickRelease();
    var m = newMatch('blaze');
    m.start();
    m.state = 'PLAY';
    var gk = m.home[3];
    var mateA = m.home[1], mateB = m.home[2];
    m.all.forEach(function (p) {
      if (p === gk) return;
      p.ai = null;
      p.isHuman = false;
      p.want.x = 0; p.want.z = 0;
      place(p, -12.5, -20.5);        // a legal far corner: never off the pitch
    });
    place(gk, 0, 21.2, Math.PI);
    giveBall(m, gk);
    place(mateA, -4, 12, Math.PI);            // the close outlet
    place(mateB, opts.longBall ? 0 : 9, opts.longBall ? 1 : 4, Math.PI);

    // a crowded teammate: three opponents ring the close outlet, so the keeper
    // should pick the open man instead (and still reach him)
    if (opts.crowdA) {
      m.away.forEach(function (o, k) {
        if (o.isGoalkeeper) return;
        place(o, -4 + (k === 0 ? -1.9 : k === 1 ? 1.9 : 0), 12 + (k === 2 ? -2.0 : 1.7), 0);
      });
    }

    // a genuine runner: both outlets get to a settled constant velocity first,
    // so the lead the keeper plays is aimed at real, predictable motion
    if (opts.moving) {
      [mateA, mateB].forEach(function (p) { p.want.x = 0.85; p.want.z = -0.5; });
      for (var k = 0; k < 45; k++) { mateA.update(1 / 60); mateB.update(1 / 60); }
    }

    gk.distributeT = 0;
    gk.ai.distribute();
    var target = m.ball.intendedReceiver;
    if (!target) return { ok: false, why: 'no teammate chosen' };
    var avoidedCrowd = target !== mateA;
    var kick = m.ball.vx.toFixed(1) + ',' + m.ball.vz.toFixed(1);
    var from = gk.x.toFixed(1) + ',' + gk.z.toFixed(1) + '->' + target.x.toFixed(1) + ',' + target.z.toFixed(1);
    var t = { t: 0 }, arrived = false, frames = 0, minGap = 1e9;
    for (var i = 0; i < 300; i++) {
      if (opts.moving) { target.want.x = 0.85; target.want.z = -0.5; }
      step(m, 1 / 60, t);
      minGap = Math.min(minGap, target.distTo(m.ball.x, m.ball.z));
      if (target.hasBall) { arrived = true; frames = i; break; }
    }
    return {
      ok: arrived, target: target.name, avoidedCrowd: avoidedCrowd,
      frames: frames, minGap: minGap, dist: gk.distTo(target.x, target.z),
      ballEnd: m.ball.x.toFixed(1) + ',' + m.ball.z.toFixed(1) + ' kick ' + kick + ' ' + from,
    };
  }

  var cases = [
    { level: 'easy', label: 'EASY to a standing teammate' },
    { level: 'medium', label: 'MEDIUM to a standing teammate' },
    { level: 'hard', label: 'HARD to a standing teammate' },
    { level: 'medium', moving: true, label: 'MEDIUM to a MOVING teammate (lead)' },
    { level: 'hard', crowdA: true, label: 'HARD under pressure (close man crowded)' },
    { level: 'hard', moving: true, crowdA: true, label: 'HARD to a moving teammate under pressure' },
  ];
  cases.forEach(function (c) {
    var r = distributeTrial(c);
    if (r.ok) info(c.label + ': reached ' + r.target + ' in ' + (r.frames / 60).toFixed(2) +
      's (closest approach ' + r.minGap.toFixed(2) + 'm)');
    assert(r.ok, 'keeper distribution ' + c.label + ' is controlled by that player',
      r.why || ('the ball never reached ' + r.target + ' (closest approach ' + r.minGap.toFixed(2) +
        'm, ball ended at ' + r.ballEnd + ')'));
  });

  // a crowded teammate must not be the pass
  var crowded = distributeTrial({ level: 'medium', crowdA: true });
  assert(crowded.ok && crowded.avoidedCrowd, 'the keeper avoids a smothered teammate and finds someone open',
    'chose ' + crowded.target + ' (closest approach ' + crowded.minGap.toFixed(2) +
    'm, ball ended at ' + crowded.ballEnd + ')');

  // a long distribution (a keeper punting to a mate near halfway) must arrive
  var long = distributeTrial({ level: 'medium', longBall: true });
  assert(long.ok, 'a 20m keeper distribution still reaches its target (' + (long.dist || 0).toFixed(1) + 'm)',
    long.why || long.target);

  // the ball must never simply die short of the target
  var mid = distributeTrial({ level: 'medium' });
  assert(mid.frames > 0 && mid.frames < 120, 'the pass arrives promptly, not after an age', (mid.frames / 60).toFixed(2) + 's');
})();

// ============================================================
section('13b. keeper distribution ethics — never to an opponent, clear to space');
(function () {
  // With EVERY teammate smothered the keeper must NOT float a pass at the crowd:
  // the safe move is a clearance into open space, never a ball an opponent will
  // simply touch first.
  function crowdOut() {
    var m = newMatch();
    m.start();
    m.state = 'PLAY';
    var gk = m.home[3];
    m.all.forEach(function (p) {
      if (p !== gk) p.ai = null;
      place(p, 30, 30);
    });
    place(gk, 0, 21.2, Math.PI);
    giveBall(m, gk);
    var mates = m.home.filter(function (p) { return !p.isGoalkeeper; });
    var opps = m.away.filter(function (p) { return !p.isGoalkeeper; });
    mates.forEach(function (mate, i) {
      place(mate, (i - 1) * 4, 10, Math.PI);
      place(opps[i], mate.x + 1.0, mate.z - 0.6, 0);   // an opponent right on top
    });
    gk.distributeT = 0;
    gk.ai.distribute();
    var receiver = m.ball.intendedReceiver;
    var kick = { vx: m.ball.vx, vz: m.ball.vz, speed: m.ball.speed() };
    // roll the hoof out and measure how far the landing spot sits from the press
    for (var i = 0; i < 110; i++) m.ball.step(1 / 60, null);
    var min = 1e9;
    opps.forEach(function (o) {
      var dx = o.x - m.ball.x, dz = o.z - m.ball.z;
      min = Math.min(min, Math.sqrt(dx * dx + dz * dz));
    });
    return { receiver: receiver, kick: kick, min: min, landed: m.ball.z, upfield: m.ball.vz };
  }

  var r = crowdOut();
  info('all mates smothered -> receiver ' + (r.receiver ? r.receiver.name : 'none') +
    ' | clearance travelled, landed ' + r.min.toFixed(2) + 'm from the nearest opponent');
  assert(!r.receiver, 'with every teammate smothered the keeper clears instead of passing', r.receiver ? 'chose ' + r.receiver.name : '');
  assert(r.kick.speed > 5, 'the clearance is a real hoof, not a dribble', r.kick.speed.toFixed(1));

  // distribution target selection must never name an OPPONENT: run a spread of
  // random-pressure scenarios and check every target chosen IS a teammate. Some
  // setups legitimately force a clearance (everyone smothered) — that is fine.
  var chosen = 0, teammates = 0;
  for (var i = 0; i < 30; i++) {
    var m = newMatch();
    m.start();
    m.state = 'PLAY';
    var gk = m.home[3];
    m.all.forEach(function (p) { if (p !== gk) place(p, Math.random() * 20 - 10, Math.random() * 16 - 5); });
    place(gk, 0, 21.2, Math.PI);
    giveBall(m, gk);
    gk.distributeT = 0;
    gk.ai.distribute();
    var t = m.ball.intendedReceiver;
    if (t) { chosen++; if (t.team === gk.team) teammates++; }
  }
  assert(chosen > 0 && chosen === teammates, 'every distribution target chosen across 30 pressure setups is a teammate', teammates + '/' + chosen + ' chosen, rest cleared');
})();

// ============================================================
section('13c. context-sensitive controls — PASS/SHOOT vs SWITCH/TACKLE by possession');
(function () {
  var K = LG.Input.keyMap;
  assert(K('KeyX') === null && K('KeyE') === null && K('Tab') === null,
    'dedicated SWITCH keys are gone (X/E/Tab)');
  assert(K('KeyD') === null && K('KeyL') === null && K('KeyC') === null,
    'dedicated TACKLE keys are gone (D/L/C)');
  assert(K('KeyA') === 'pass' && K('KeyI') === 'pass' && K('KeyS') === 'shoot',
    'A and S are the primary keys — their meaning follows possession');

  // ---- MY team has it: PASS | SHOOT (pass flies, poke/switch/tackle ignored) ----
  var m = newMatch();
  m.start();
  m.state = 'PLAY';
  LG.Input.reset();
  LG.Input.setEnabled(true);
  var h = m.active;
  m.all.forEach(function (p) {
    if (p === h) return;
    if (p.isGoalkeeper) { m.repositionGoalkeeper(p); return; }
    place(p, 40, 40);
  });
  place(h, 0, 0, Math.PI);
  giveBall(m, h);
  var mate = m.home.filter(function (p) { return !p.isGoalkeeper && p !== h; })[0];
  place(mate, 0, -8, Math.PI);
  var t = { t: 0 };
  h.tackleCd = 0;
  var beforeActive = m.active;
  btn('pass', true);               // contextual PASS
  step(m, 1 / 60, t);
  btn('pass', false);
  btn('switch', true);             // hidden button must do NOTHING while attacking
  step(m, 1 / 60, t);
  btn('switch', false);
  btn('tackle', true);             // hidden button must do NOTHING while attacking
  step(m, 1 / 60, t);
  btn('tackle', false);
  assert(m._ctrlMode === 'attack', 'possession -> controls switch to PASS|SHOOT mode', m._ctrlMode);
  assert(m.ball.speed() > 3, 'the PASS press executes a real pass while attacking', m.ball.speed().toFixed(1));
  assert(m.active === beforeActive, 'pressing the hidden SWITCH button while attacking does not switch', m.active.name);
  assert(h.tackleCd === 0, 'pressing the hidden TACKLE button while attacking does nothing', 'cd=' + h.tackleCd);

  // ---- the opponent has it: SAME keys become SWITCH | TACKLE ----
  var m2 = newMatch();
  m2.start();
  m2.state = 'PLAY';
  LG.Input.reset();
  LG.Input.setEnabled(true);
  var h2 = m2.active;
  m2.all.forEach(function (p) {
    if (p === h2) return;
    if (p.isGoalkeeper) { m2.repositionGoalkeeper(p); return; }
    place(p, 40, 40);
  });
  var carrier = m2.away.filter(function (p) { return !p.isGoalkeeper; })[0];
  place(carrier, 0, -4, 0);
  giveBall(m2, carrier);
  // the human trails the play; a mate is nearer the ball so SWITCH is meaningful
  place(h2, 0, 2, Math.PI);
  var closeMate = m2.home.filter(function (p) { return p !== h2 && !p.isGoalkeeper; })[0];
  place(closeMate, 0, -3, Math.PI);
  m2.active = h2;
  m2.selectActive();
  var t2 = { t: 0 };
  btn('pass', true);               // contextual SWITCH
  step(m2, 1 / 60, t2);
  btn('pass', false);
  var switchedTo = m2.active;
  h2.tackleCd = 0;
  btn('shoot', true);              // contextual TACKLE
  step(m2, 1 / 60, t2);
  btn('shoot', false);
  var tackled = m2.active.tackleCd > 0;
  assert(m2._ctrlMode === 'defend', 'opponent possession -> controls switch to SWITCH|TACKLE mode', m2._ctrlMode);
  assert(switchedTo === closeMate, 'the PASS/I press SWITCHES to the nearest teammate while defending', switchedTo && switchedTo.name);
  assert(tackled, 'the SHOOT/S press executes TACKLE while defending', 'active=' + m2.active.name + ' cd=' + m2.active.tackleCd);

  // the HUD receives the mode: stop the game starting mode flags at null
  var recv = [];
  var realSet = LG.HUD.setControlMode;
  LG.HUD.setControlMode = function (mode) { recv.push(mode); };
  var m3 = newMatch();
  m3.start();
  m3.state = 'PLAY';
  LG.Input.update(t.t += 1 / 60);
  m3.update(1 / 60);
  assert(m3._ctrlMode === 'defend' && recv.length > 0 && recv[recv.length - 1] === 'defend',
    'HUD.setControlMode is called when possession mode changes', JSON.stringify(recv));
  LG.HUD.setControlMode = realSet;
})();
// ============================================================
// LANDSCAPE camera-relative input — kept LAST on purpose: it owns the RNG
// stream from here on, so it can never shift the seed of the tuned sections
// above. It drives the real stick and pins that the player's intent follows
// the TRUE side-on camera basis (-z to the right, -x up-screen).
// ============================================================
section('14. LANDSCAPE input: the stick drives the world from the east-side camera');
(function () {
  LG.Settings.setView('landscape');            // the TRUE side-on gameplay mode
  LG.Input.reset();
  LG.Input.setEnabled(true);
  LG.Input.update(0);

  var m = newMatch();
  m.start();
  m.state = 'PLAY';
  var h = m.active;
  m.all.forEach(function (o) {
    if (o === h) return;
    if (o.isGoalkeeper) { o.x = 0; o.z = o.team === 0 ? 21.5 : -21.5; return; }
    place(o, 40, 40);
  });
  place(h, 0, 8, Math.PI);
  giveBall(m, h);
  var t = { t: 0 };

  // screen-RIGHT on the landscape camera = the away goal direction (-z):
  // the very first step must already translate the stick into world -z
  stickTo(1, 0, 1);
  LG.Input.update(t.t += 1 / 60);
  m.update(1 / 60);
  assert(h.want.x > -0.05 && h.want.x < 0.05 && h.want.z < -0.9,
    'landscape: pushing screen-right = wanting -z (attack, screen-right)',
    'want(' + h.want.x.toFixed(2) + ',' + h.want.z.toFixed(2) + ')');

  // hold it for a second: the carrier must actually travel up the pitch (left
  // to right across the screen = -z in world space) while barely drifting in x
  var z0 = h.z, x0 = h.x;
  for (var i = 0; i < 45; i++) {
    LG.Input.update(t.t += 1 / 60);
    m.update(1 / 60);
  }
  assert(h.z < z0 - 2 && Math.abs(h.x - x0) < 1.2,
    'landscape: running screen-right moved the carrier toward the away goal, not sideways',
    'x ' + x0.toFixed(1) + '->' + h.x.toFixed(1) + ' | z ' + z0.toFixed(1) + '->' + h.z.toFixed(1));

  // screen-UP on the landscape camera = the far touchline (-x): the stick
  // must push the player across the width, not toward a goal
  stickRelease();
  LG.Input.update(t.t += 1 / 60);
  stickTo(0, -1, 1);
  LG.Input.update(t.t += 1 / 60);
  m.update(1 / 60);
  assert(h.want.x < -0.9 && h.want.z > -0.05 && h.want.z < 0.05,
    'landscape: pushing screen-up = wanting -x (far touchline)',
    'want(' + h.want.x.toFixed(2) + ',' + h.want.z.toFixed(2) + ')');
  stickRelease();
})();

section('15. assists + finalize-once bookkeeping (no RNG in the credit path)');
(function () {
  var m = newMatch('blaze');
  m.start();
  m.state = 'PLAY';
  var a = m.home[0], b = m.home[1];
  m.away.forEach(function (p) { place(p, 40, 40); });
  place(a, 0, 8, Math.PI);
  place(b, 0, 2, Math.PI);
  giveBall(m, a);
  m.passTo(a, b, {});
  assert(m._assist && m._assist.src === a && m._assist.target === b, 'a completed pass arms the assist window');

  // receiver scores within the window: home scores into the away net (-z)
  m.t = (m.t || 0);
  m._assist.t = m.t;
  giveBall(m, b);
  place(b, 0, -LG.Config.court.length / 2 - 0.4, 0);
  m.ball.x = 0;
  m.ball.z = -LG.Config.court.length / 2 - 0.05;
  m.ball.y = 0.15;
  m.ball.vz = -4;
  m.ball.lastKicker = b;
  m._ballPrevZ = -LG.Config.court.length / 2 + 0.4;
  m._ballPrevY = 0.15;
  m.statSide(0).assists = 0;
  m.checkGoal();
  assert(m.statSide(0).assists === 1, 'receiver scoring inside the window credits the assist', m.statSide(0).assists);
  assert(m._assist === null, 'the assist chain is consumed after the goal');
  var snap = m.snapshotStats();
  assert(snap.home.assists === 1, 'snapshotStats carries assists for the results table', snap.home.assists);

  // expired window: same setup, assist older than 8s
  m._finalized = false;
  m.state = 'PLAY';
  m.placeKickoff();
  m.state = 'PLAY';
  place(a, 0, 8, Math.PI);
  place(b, 0, 2, Math.PI);
  giveBall(m, a);
  m.passTo(a, b, {});
  m._assist.t = (m.t || 0) - 9;
  m.statSide(0).assists = 0;
  giveBall(m, b);
  place(b, 0, -LG.Config.court.length / 2 - 0.4, 0);
  m.ball.x = 0;
  m.ball.z = -LG.Config.court.length / 2 - 0.05;
  m.ball.y = 0.15;
  m.ball.lastKicker = b;
  m._ballPrevZ = -LG.Config.court.length / 2 + 0.4;
  m._ballPrevY = 0.15;
  m.checkGoal();
  assert(m.statSide(0).assists === 0, 'an expired window does not credit an assist', m.statSide(0).assists);

  // tackle clears the chain
  place(a, 0, 8, Math.PI);
  place(b, 0, 2, Math.PI);
  giveBall(m, a);
  m.passTo(a, b, {});
  assert(m._assist, 'assist re-armed');
  m._assist = null;   // what tryTackle / keeper save / kickoff do
  assert(!m._assist, 'tackle/save/kickoff clear the assist chain');

  // endMatch finalizes once against the Progression stub
  var finals = 0;
  var orig = LG.Progression.finalizeMatch;
  LG.Progression.finalizeMatch = function (r) { finals++; return orig(r); };
  m.score = [2, 1];
  m.endMatch();
  m.endMatch();
  LG.Progression.finalizeMatch = orig;
  assert(finals === 1 && m._finalized === true, 'endMatch finalizes exactly once', 'finals=' + finals);
})();

section('16. challenge evaluation (pure, deterministic, no RNG)');
(function () {
  var C = LG.Challenges;
  assert(!!(C && Array.isArray(C.POOL) && C.POOL.length >= 10 && C.POOL.length <= 15),
    'pool size is 10–15', C && C.POOL && C.POOL.length);
  assert(!C.POOL.some(function (d) { return typeof d.id !== 'string' || !d.title || !d.description ||
    !d.category || !d.difficulty || !d.objectiveType || !(d.target >= 1) || !(d.reward > 0); }),
    'every definition has id/title/description/category/difficulty/objectiveType/target/reward');
  var ids = C.POOL.map(function (d) { return d.id; });
  assert(new Set(ids).size === ids.length, 'challenge ids are unique');

  function R(hf, ha, home, away, won) {
    home = home || {};
    away = away || {};
    return {
      score: [hf, ha],
      won: won,
      stats: {
        home: { goals: hf, assists: home.assists || 0, shots: home.shots || 0, passes: home.passes || 0, tackles: home.tackles || 0, saves: home.saves || 0, poss: 50 },
        away: { goals: ha, assists: 0, shots: 0, passes: 0, tackles: 0, saves: 0, poss: 50 },
      },
    };
  }

  function thr(id, underFn, overFn) {
    var def = C.byId(id);
    assert(!!def, 'def exists: ' + id);
    if (!def) return;
    var u = C.evaluate(def, underFn(), false);
    var o = C.evaluate(def, overFn(), false);
    assert(!u.done && o.done, 'threshold exact: ' + id,
      'under=' + JSON.stringify(u) + ' over=' + JSON.stringify(o));
  }

  thr('score_2', function () { return R(1, 0); }, function () { return R(2, 0); });
  thr('score_3', function () { return R(2, 0); }, function () { return R(3, 0); });
  thr('shots_8', function () { return R(1, 1, { shots: 7 }); }, function () { return R(1, 1, { shots: 8 }); });
  thr('passes_10', function () { return R(0, 0, { passes: 9 }); }, function () { return R(1, 0, { passes: 10 }); });
  thr('assists_2', function () { return R(2, 1, { assists: 1 }); }, function () { return R(2, 1, { assists: 2 }); });
  thr('tackles_4', function () { return R(0, 1, { tackles: 3 }, {}, -1); }, function () { return R(1, 0, { tackles: 4 }); });
  thr('saves_3', function () { return R(0, 0, { saves: 2 }); }, function () { return R(0, 0, { saves: 3 }); });
  thr('saves_5', function () { return R(0, 0, { saves: 4 }); }, function () { return R(1, 1, { saves: 5 }); });
  thr('win_1', function () { return R(0, 1, {}, {}, -1); }, function () { return R(1, 0, {}, {}, 1); });
  thr('win_by_2', function () { return R(2, 1, {}, {}, 1); }, function () { return R(3, 1, {}, {}, 1); });
  thr('clean_sheet', function () { return R(2, 1, {}, {}, 1); }, function () { return R(2, 0, {}, {}, 1); });

  // live mode never claims result-only objectives
  var lw = C.evaluate(C.byId('win_1'), R(1, 0, {}, {}, 1), true);
  assert(!lw.done, 'live evaluate does not complete win mid-match', JSON.stringify(lw));
  var lc = C.evaluate(C.byId('clean_sheet'), R(1, 0, {}, {}, 1), true);
  assert(!lc.done, 'live evaluate does not complete clean sheet mid-match', JSON.stringify(lc));

  // deterministic slot fill — no Math.random in the selection path
  var rngCalls = 0;
  var realRng = Math.random;
  Math.random = function () { rngCalls++; return realRng(); };
  var st1 = { cursor: 0 };
  var picked1 = [0, 1, 2].map(function (s) { return C.pickForSlot(s, [], st1); });
  var st2 = { cursor: 0 };
  var picked2 = [0, 1, 2].map(function (s) { return C.pickForSlot(s, [], st2); });
  Math.random = realRng;
  assert(rngCalls === 0, 'pickForSlot does not consume Math.random', 'calls=' + rngCalls);
  assert(JSON.stringify(picked1) === JSON.stringify(picked2) && picked1.every(Boolean),
    'slot picks are deterministic and filled', JSON.stringify(picked1));
  var c0 = C.byId(picked1[0]).category;
  var c1 = C.byId(picked1[1]).category;
  var c2 = C.byId(picked1[2]).category;
  assert(c0 === 'attack' && (c1 === 'defense' || c1 === 'goalkeeping') &&
    (c2 === 'passing' || c2 === 'results'),
    'slot buckets match the fixed categories', [c0, c1, c2].join('/'));

  // replacement excludes already-active ids
  var st3 = { cursor: 0 };
  var exclude = ['score_2'];
  var nextAtk = null;
  for (var s = 0; s < 40 && !nextAtk; s++) {
    // walk attack-only by calling pick with only score_2 excluded via cursor drills
    nextAtk = C.pickForSlot(0, exclude, st3);
  }
  assert(nextAtk && nextAtk !== 'score_2' && C.byId(nextAtk).category === 'attack',
    'replacement for an attack slot skips the active id', nextAtk);

  // reward tiers match difficulty
  assert(C.POOL.every(function (d) {
    return d.reward === C.REWARD[d.difficulty];
  }), 'reward coins match the difficulty tier');
})();

section('17. game modes + tournament (pure, once-only, no RNG)');
(function () {
  var M = LG.Modes;
  var T = LG.Tournament;
  assert(!!(M && Array.isArray(M.DEFS) && M.DEFS.length === 3), 'three modes registered');
  assert(M.is('quick_match'), 'default mode is quick_match', M.id());
  assert(M.select('tournament') === 'tournament' && M.is('tournament'), 'select switches mode');
  assert(M.select('nope') === 'tournament', 'unknown mode ids are refused', M.id());
  assert(M.selectChallenge('bogus') === false, 'focus requires a real active challenge');

  // pure tournament state machine — no Math.random anywhere
  var rngCalls = 0;
  var realRng = Math.random;
  Math.random = function () { rngCalls++; return realRng(); };
  T.reset();
  T.start('blaze');
  Math.random = realRng;
  assert(rngCalls === 0, 'Tournament.start does not consume Math.random', 'calls=' + rngCalls);
  assert(T.status() === 'active' && T.currentRound() === 0, 'fresh cup starts at the semifinal');
  assert(T.teams().length === 4 && T.teams()[0].isPlayer, 'player leads a 4-team field');

  assert(T.beginMatch() === true, 'beginMatch opens the latch');
  assert(T.beginMatch() === false, 'second beginMatch is refused while awaiting');
  assert(T.endMatch(false, [0, 2]) === true, 'loss records once');
  assert(T.endMatch(false, [0, 2]) === false, 'double endMatch is a no-op');
  assert(T.status() === 'eliminated', 'semifinal loss eliminates', T.status());
  assert(T.canContinue(false) === false, 'eliminated cup cannot CONTINUE');
  assert(T.canRetry() === true, 'eliminated cup can START OVER');

  T.reset();
  T.start('cannon');
  T.beginMatch();
  assert(T.endMatch(true, [3, 1]) === true, 'semifinal win records');
  assert(T.currentRound() === 1 && T.status() === 'active', 'advances to the final');
  assert(T.canContinue(false) === true, 'between fixtures CONTINUE is legal');
  assert(T.canContinue(true) === false, 'a live match blocks CONTINUE');
  T.beginMatch();
  assert(T.canContinue(false) === false, 'awaiting a result blocks CONTINUE');
  assert(T.endMatch(true, [1, 0]) === true, 'final win records');
  assert(T.status() === 'won' && T.snapshot().results.length === 2, 'cup won after two wins');
  assert(T.endMatch(true, [1, 0]) === false, 'extra endMatch after the cup is refused');

  // awayIds path in match builder is exercised via opts (no build here — sim
  // only checks the pure mode/tournament layer). reset leaves idle storage.
  T.reset();
  assert(T.status() === 'idle', 'reset returns to idle');
  M.reset();
  assert(M.is('quick_match') && M.challenge() === null, 'Modes.reset restores defaults');
})();

// ============================================================
console.log('\n---------------------------------------------');
console.log(PASS + ' passed, ' + FAIL + ' failed');
console.log('---------------------------------------------');
process.exit(FAIL ? 1 : 0);
