// ============================================================
// CELEBPROBE — headless unit probe for js/celebration.js (3D.6)
//
// Loads the real config/util/settings/celebration scripts under a bare
// window global, then drives the celebration lifecycle against fake
// match/player objects with real limb/body stubs. Proves:
//   * variant selection: 6 active types, 2-back anti-repeat, 'calm' held
//     back for own goals + reduced motion
//   * every variant actually poses the body it claims to (arms/wide/slide/
//     point/signature/huddle/calm) with zero travel and zero velocities
//   * point captures its target (assist, else nearest mate) and the scorer
//     turns to face them
//   * reaction roles assigned once: close/far/wkeep + four conceding roles
//     + the conceding keeper's fold-and-reset, distant players never move
//   * micro-motion keeps holds alive, clearPoses restores every channel
//     (arms, z-spread, legs, spine), kickoff stops, repeated cycles clean
//   * missing limbs / missing model degrade to no-ops, never throws
//
// Run: node tools/celebprobe.js
// ============================================================
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
global.window = global;

function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
}

['js/config.js', 'js/util.js', 'js/settings.js', 'js/celebration.js'].forEach(load);
var LG = global.LG;
if (!LG || !LG.Celebration || !LG.eventBus) {
  console.log('CELEBPROBE FAIL scripts did not load');
  process.exit(1);
}

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name); }
}

// ---- fixtures ----------------------------------------------------------

function limb() { return { rotation: { x: 0, y: 0, z: 0 } }; }

function makeP(o) {
  o = o || {};
  return {
    x: o.x || 0, z: o.z || 0, y: 0, facing: 0, vx: 0, vz: 0,
    team: o.team == null ? 0 : o.team,
    idx: o.idx == null ? 0 : o.idx,
    isGoalkeeper: !!o.gk,
    model: {
      group: { position: { set: function () {} }, rotation: { y: 0 } },
      body: { rotation: { x: 0 } },
      limbs: { armL: limb(), armR: limb(), legL: limb(), legR: limb() },
    },
  };
}

function roster() {
  return [
    makeP({ x: 0, z: -14, team: 0, idx: 0 }),            // scorer
    makeP({ x: -4, z: -13, team: 0, idx: 1 }),           // close (4.1m)
    makeP({ x: 2, z: -16, team: 0, idx: 2 }),            // close (2.8m)
    makeP({ x: 0, z: 10, team: 0, idx: 3, gk: true }),   // winning keeper
    makeP({ x: 0, z: 2, team: 0, idx: 4 }),              // far (16m)
    makeP({ x: 0, z: 6, team: 1, idx: 0 }),              // ldown
    makeP({ x: 3, z: 4, team: 1, idx: 1 }),              // lhips
    makeP({ x: -3, z: 5, team: 1, idx: 2 }),             // lturn
    makeP({ x: 1, z: 8, team: 1, idx: 3 }),              // lstare
    makeP({ x: 0, z: -8, team: 1, idx: 4, gk: true }),   // conceding keeper
  ];
}

function mkMatch(players) {
  return {
    all: players,
    state: 'GOAL',
    teamPlayers: function (t) {
      return this.all.filter(function (p) { return p.team === t; });
    },
    enemyGoal: function (t) { return { x: 0, z: t === 0 ? -22.5 : 22.5 }; },
  };
}

var DT = 1 / 60;
function play(seconds) {
  var steps = Math.round(seconds / DT);
  for (var i = 0; i < steps; i++) {
    if (!LG.Celebration.current) break;
    LG.Celebration.update(mk, DT);
  }
}
var mk = mkMatch(roster());

// role lookup for assertions
function roleOf(cur, team, idx) {
  var rs = cur.roles || [];
  for (var i = 0; i < rs.length; i++) {
    if (rs[i].p.team === team && rs[i].p.idx === idx) return rs[i].p === null ? null : rs[i].role;
  }
  return null;
}

// ---- 1. selection: variety + anti-repeat + fallbacks --------------------

console.log('== variant selection ==');
LG.Celebration.bind();
var scorer = mk.all[0];
var seen = [], prev1 = null, prev2 = null, repeats = 0, calms = 0, badDur = 0;
for (var n = 0; n < 30; n++) {
  var cur = LG.Celebration.start(scorer, 0, false);
  seen.push(cur.type);
  if (prev1 && cur.type === prev1) repeats++;
  if (prev2 && cur.type === prev2) repeats++;
  prev2 = prev1; prev1 = cur.type;
  if (cur.type === 'calm') calms++;
  if (!(cur.dur >= 2.4 && cur.dur <= 3.9)) badDur++;
  LG.Celebration.stop();
}
ok(repeats === 0, 'no variant repeats within 2 picks (violations=' + repeats + ')');
ok(calms === 0, "'calm' never picked for a normal goal (got " + calms + ')');
ok(badDur === 0, 'durations stay inside the short goal window (bad=' + badDur + ')');
var distinct = {};
for (var d = 0; d < seen.length; d++) distinct[seen[d]] = 1;
var dcount = Object.keys(distinct).length;
ok(dcount >= 5, 'variant variety >= 5 types across 30 goals (got ' + dcount + ')');
ok(seen.indexOf('arms') >= 0 && seen.indexOf('wide') >= 0 && seen.indexOf('slide') >= 0 &&
   seen.indexOf('point') >= 0 && seen.indexOf('huddle') >= 0 && seen.indexOf('signature') >= 0,
  'all 6 active variants appear across the run');
ok(LG.Celebration.TYPES.length === 7 && LG.Celebration.ACTIVE.length === 6,
  'TYPES=7 (incl calm) / ACTIVE=6');

// ---- 2. each variant poses what it claims -------------------------------

function fresh(type) {
  mk = mkMatch(roster());
  scorer = mk.all[0];
  var c = LG.Celebration.start(scorer, 0, false);
  c.type = type;               // drive each variant deterministically
  c.dur = 2.6;                 // and pin the window so timing asserts hold
  return c;
}

console.log('== variant poses ==');
var c = fresh('arms');
play(0.6);
ok(scorer.model.limbs.armL.rotation.x < -1.5 && scorer.model.limbs.armR.rotation.x < -1.5,
  'arms: both arms overhead (armL=' + scorer.model.limbs.armL.rotation.x.toFixed(2) + ')');
LG.Celebration.stop();

c = fresh('wide');
play(0.6);
var Lw = scorer.model.limbs;
ok(Lw.armL.rotation.z > 0.4 && Lw.armR.rotation.z < -0.4,
  'arms wide: elbows out (z=' + Lw.armL.rotation.z.toFixed(2) + '/' + Lw.armR.rotation.z.toFixed(2) + ')');
ok(scorer.model.body.rotation.x < -0.05, 'arms wide: chest lift (body=' + scorer.model.body.rotation.x.toFixed(3) + ')');
LG.Celebration.stop();

c = fresh('slide');
play(1.0);
ok(scorer.model.body.rotation.x > 0.3, 'slide: torso leaning back (body=' + scorer.model.body.rotation.x.toFixed(2) + ')');
ok(scorer.model.limbs.legL.rotation.x < -0.6 && scorer.model.limbs.legR.rotation.x < -0.4,
  'slide: legs extended forward (legL=' + scorer.model.limbs.legL.rotation.x.toFixed(2) + ')');
play(1.5);   // t=2.5: inside the rise window (dur-0.55 = 2.05)
ok(scorer.model.body.rotation.x < 0.2, 'slide: rises again late (' + scorer.model.body.rotation.x.toFixed(2) + ')');
LG.Celebration.stop();

c = fresh('signature');
var face0 = scorer.facing;
play(0.5);
ok(Math.abs(scorer.facing - face0) > 0.8,
  'signature: spins (facing ' + face0.toFixed(2) + ' -> ' + scorer.facing.toFixed(2) + ')');
LG.Celebration.stop();

c = fresh('huddle');
play(0.6);
ok(scorer.model.limbs.armL.rotation.x < -1.5, 'huddle: scorer arms up at the centre');
LG.Celebration.stop();

c = fresh('calm');
play(0.6);
ok(Math.abs(scorer.model.limbs.armL.rotation.x) < 0.6 && scorer.model.body.rotation.x < -0.03,
  'calm: quiet — arms down, slight head lift');
LG.Celebration.stop();

// ---- 3. point: target capture + facing ---------------------------------

console.log('== point target ==');
c = fresh('point');
// no assist yet: first update should pick the nearest outfield teammate
play(0.02);
ok(c.pointAt && c.pointAt.x === 2 && c.pointAt.z === -16,
  'point: falls back to the nearest mate (' + (c.pointAt ? c.pointAt.x + ',' + c.pointAt.z : 'null') + ')');
play(1.4);
var expFace = Math.atan2(2 - scorer.x, -16 - scorer.z);
ok(Math.abs(scorer.facing - expFace) < 0.05,
  'point: scorer turns to face the target (facing=' + scorer.facing.toFixed(3) +
  ' expected=' + expFace.toFixed(3) + ')');
LG.Celebration.stop();

c = fresh('point');
// assist via the goal event: current.assist -> pointAt uses it
LG.eventBus.emit('goal', { team: 0, scorer: scorer, assist: mk.all[1], isOwnGoal: false, score: [1, 0] });
ok(c.assist === mk.all[1], 'assist attached from the goal event');
play(0.02);
ok(c.pointAt && c.pointAt.x === -4 && c.pointAt.z === -13,
  'point: assist preferred over the nearest mate');
LG.Celebration.stop();

// ---- 4. reaction roles (3D.6B) -----------------------------------------

console.log('== reaction roles ==');
c = fresh('arms');
play(0.02);
ok(c.roles && c.roles.length === 9, 'roles assigned once for every non-scorer (got ' +
  (c.roles ? c.roles.length : 0) + ')');
ok(roleOf(c, 0, 1) === 'close' && roleOf(c, 0, 2) === 'close', 'near teammates get close');
ok(roleOf(c, 0, 4) === 'far', 'distant teammate gets far');
ok(roleOf(c, 0, 3) === 'wkeep', 'winning keeper gets wkeep');
ok(roleOf(c, 1, 4) === 'lkeep', 'conceding keeper gets lkeep');
ok(roleOf(c, 1, 0) === 'ldown' && roleOf(c, 1, 1) === 'lhips' &&
   roleOf(c, 1, 2) === 'lturn' && roleOf(c, 1, 3) === 'lstare',
  'four distinct conceding-field roles by idx');

// timing: close engages immediately, far waits, then reacts weaker
mk = mkMatch(roster());
scorer = mk.all[0];
c = LG.Celebration.start(scorer, 0, false);
c.type = 'arms';
play(0.05);
var runsBefore = c.roles;
var closeP = mk.all[1], farP = mk.all[4], wkeepP = mk.all[3];
var closeArm = Math.abs(closeP.model.limbs.armL.rotation.x) + Math.abs(closeP.model.limbs.armL.rotation.z);
ok(closeArm > 0.5, 'close teammate reacts immediately (displacement=' + closeArm.toFixed(2) + ')');
ok(Math.abs(farP.model.limbs.armL.rotation.x) < 0.1 && Math.abs(wkeepP.model.limbs.armL.rotation.x) < 0.1,
  'far teammate + winning keeper hold off at t=0.05');
play(0.55);
ok(farP.model.limbs.armL.rotation.x < -1.4, 'far teammate reacts late (armL=' +
  farP.model.limbs.armL.rotation.x.toFixed(2) + ')');
ok(farP.model.limbs.armL.rotation.x > -2.3, 'far reaction is weaker — partial raise (not full -2.6)');
ok(wkeepP.model.limbs.armL.rotation.x < -1.5, 'winning keeper raises late (t>0.5)');
ok(c.roles === runsBefore, 'roles are NOT recalculated during the celebration');
LG.Celebration.stop();

// ---- 5. conceding side (3D.6C) -----------------------------------------

console.log('== conceding reactions ==');
mk = mkMatch(roster());
scorer = mk.all[0];
c = LG.Celebration.start(scorer, 0, false);
c.type = 'arms';
play(0.25);
var gkLose = mk.all[9], down = mk.all[5], hips = mk.all[6], turn = mk.all[7], stare = mk.all[8];
ok(gkLose.model.limbs.armL.rotation.x < -1.5 && gkLose.model.body.rotation.x > 0.2,
  'conceding keeper: brief hands-to-head fold');
ok(down.model.limbs.armL.rotation.x < -1.5 && down.model.body.rotation.x > 0.15,
  'ldown: hands on head + lowered head');
ok(hips.model.limbs.armL.rotation.z > 0.3 && Math.abs(hips.model.limbs.armL.rotation.x) < 0.8,
  'lhips: hands on hips (not raised)');
ok(turn.facing > 0.05, 'lturn: slowly turns away (facing=' + turn.facing.toFixed(2) + ')');
var stareFace = Math.atan2(scorer.x - stare.x, scorer.z - stare.z);
play(1.4);
ok(gkLose.model.body.rotation.x < 0.05 && gkLose.model.limbs.armL.rotation.x > -0.5,
  'conceding keeper resets after the fold');
ok(down.model.limbs.armL.rotation.x < -1.5, 'ldown still holds its head (keeper reset did not leak)');
ok(Math.abs(stare.facing - stareFace) < 0.05, 'lstare ends up facing the scorer');
LG.Celebration.stop();

// ---- 6. safety: no travel, no velocities, missing fallbacks ------------

console.log('== safety ==');
mk = mkMatch(roster());
scorer = mk.all[0];
var homeX = mk.all.map(function (p) { return p.x + ',' + p.z; });
c = LG.Celebration.start(scorer, 0, false);
c.type = 'slide';
play(2.0);
var moved = 0, hotV = 0;
for (var i2 = 0; i2 < mk.all.length; i2++) {
  var p2 = mk.all[i2];
  if ((p2.x + ',' + p2.z) !== homeX[i2]) moved++;
  if (p2.vx !== 0 || p2.vz !== 0) hotV++;
}
ok(moved === 0, 'nobody travels — presentation only (moved=' + moved + ')');
ok(hotV === 0, 'every velocity stays zero during the celebration (hot=' + hotV + ')');
LG.Celebration.stop();

// missing limbs / missing model degrade to no-ops
mk = mkMatch(roster());
mk.all[1].model.limbs = undefined;   // half-built model
mk.all[2].model = undefined;         // model gone entirely
scorer = mk.all[0];
var threw = false;
try {
  c = LG.Celebration.start(scorer, 0, false);
  c.type = 'huddle';
  play(1.0);
  LG.Celebration.clearPoses(mk);
  LG.Celebration.stop();
} catch (e) { threw = true; console.log('   threw: ' + e.message); }
ok(!threw, 'missing limbs / missing model: no throw, celebration continues');
ok(mk.all[1].vx === 0 && mk.all[2].vx === 0, 'broken players still velocity-free');

// ---- 7. own goal + reduced motion --------------------------------------

console.log('== fallbacks ==');
mk = mkMatch(roster());
scorer = mk.all[0];
c = LG.Celebration.start(null, 0, true);
ok(c.type === 'calm' && c.scorer === null, 'own goal: calm variant, no scorer');
threw = false;
try {
  play(1.0);
} catch (e) { threw = true; console.log('   threw: ' + e.message); }
ok(!threw, 'own goal celebration runs without a scorer');
LG.Celebration.stop();

LG.Settings.setReducedMotion(true);
c = LG.Celebration.start(scorer, 0, false);
ok(c.type === 'calm', 'reduced motion: calm variant');
LG.Settings.setReducedMotion(false);
LG.Celebration.stop();

// ---- 8. micro-motion + reset + stop + repeated cycles ------------------

console.log('== micro-motion / reset / cycles ==');
mk = mkMatch(roster());
scorer = mk.all[0];
c = LG.Celebration.start(scorer, 0, false);
c.type = 'arms';
play(1.0);
// sample across a full micro-motion period: the hold must never sit still
var armMin = 1e9, armMax = -1e9;
for (var s2 = 0; s2 < 10; s2++) {
  var a2 = scorer.model.limbs.armL.rotation.x;
  if (a2 < armMin) armMin = a2;
  if (a2 > armMax) armMax = a2;
  play(0.1);
}
ok(armMax - armMin > 0.03,
  'hold is not frozen: micro-motion range=' + (armMax - armMin).toFixed(3));
LG.Celebration.stop();

// slide dirties legs + spine + arm z — clearPoses must restore all of it
c = fresh('slide');
play(1.0);
ok(scorer.model.limbs.legL.rotation.x !== 0 || scorer.model.limbs.armL.rotation.z !== 0,
  'slide dirtied legs/arms before reset');
LG.Celebration.clearPoses(mk);
var dirty = 0;
for (var i3 = 0; i3 < mk.all.length; i3++) {
  var m3 = mk.all[i3].model;
  if (!m3) continue;
  if (m3.body.rotation.x !== 0) dirty++;
  if (m3.limbs && (m3.limbs.armL.rotation.x !== 0 || m3.limbs.armL.rotation.z !== 0 ||
      m3.limbs.armR.rotation.x !== 0 || m3.limbs.legL.rotation.x !== 0 ||
      m3.limbs.legR.rotation.x !== 0)) dirty++;
}
ok(dirty === 0, 'clearPoses restores arms + z-spread + legs + spine (dirty=' + dirty + ')');
LG.Celebration.stop();

// kickoff event kills any active celebration
mk = mkMatch(roster());
scorer = mk.all[0];
LG.Celebration.start(scorer, 0, false);
LG.eventBus.emit('kickoff', {});
ok(LG.Celebration.current === null, 'kickoff event stops a live celebration');

// five full cycles: no accumulation, no stale state
mk = mkMatch(roster());
scorer = mk.all[0];
var cycleOk = true;
try {
  for (var cyc = 0; cyc < 5; cyc++) {
    var cc = LG.Celebration.start(scorer, cyc % 2, false);
    cc.type = LG.Celebration.ACTIVE[cyc % LG.Celebration.ACTIVE.length];
    play(1.2);
    LG.Celebration.stop();
    LG.Celebration.clearPoses(mk);
  }
} catch (e) { cycleOk = false; console.log('   threw: ' + e.message); }
ok(cycleOk, '5 repeated start/update/stop/clearPoses cycles run clean');
var finalDirty = 0;
for (var i4 = 0; i4 < mk.all.length; i4++) {
  var m4 = mk.all[i4].model;
  if (m4 && m4.body.rotation.x !== 0) finalDirty++;
  if (m4 && m4.limbs && (m4.limbs.armL.rotation.x !== 0 || m4.limbs.legL.rotation.x !== 0)) finalDirty++;
}
ok(finalDirty === 0, 'no pose accumulation after the cycles (dirty=' + finalDirty + ')');
ok(LG.Celebration.current === null, 'no stale celebration after stop');

console.log('');
if (fail) {
  console.log('CELEBPROBE FAIL ' + fail + ' failed / ' + (pass + fail));
  process.exit(1);
}
console.log('CELEBPROBE PASS ' + pass + '/' + pass);
