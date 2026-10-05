// ============================================================
// CINPROBE — headless unit probe for js/goal-cinematic.js
//
// Loads the real config/util/settings/camera/goal-cinematic scripts under a
// bare window global, then drives the full cinematic lifecycle against fake
// match/camera/scorer objects. Proves: bus guards (headless / own goal /
// reduced motion / outside GOAL), the camera actually moves, the timeline
// fits inside goalDelay, the handback pose equals the very next broadcast
// frame (no snap, no stale pulse), and every abort path returns the camera
// instead of throwing into the frame loop.
//
// Run: node tools/cinprobe.js
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

['js/config.js', 'js/util.js', 'js/settings.js', 'js/camera.js', 'js/goal-cinematic.js'].forEach(load);
var LG = global.LG;
if (!LG || !LG.GoalCinematic || !LG.MatchCamera) {
  console.log('CINPROBE FAIL scripts did not load');
  process.exit(1);
}

var pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name); }
}

function fakeCam(fov) {
  return {
    fov: fov,
    position: { x: 0, y: 0, z: 0, set: function (x, y, z) { this.x = x; this.y = y; this.z = z; } },
    lookAt: function () {},
    updateProjectionMatrix: function () {},
  };
}

var camF = fakeCam(LG.Config.camera.fov);
var cam = new LG.MatchCamera(camF);
var match = {
  state: 'GOAL', camera: cam, active: { x: 2, z: 3 }, ball: { x: 2, z: 3 },
  bus: LG.eventBus, all: [], _gside: -22.5,
  enemyGoal: function () { return { x: 0, z: match._gside }; },
};
var bus = LG.eventBus;

function makeScorer() {
  return {
    x: -6, z: -16, y: 0, team: 0, facing: 0, vx: 0, vz: 0,
    model: { group: { position: { set: function () {} }, rotation: { y: 0 } } },
  };
}

// parameterised player stub (mates / keepers / opponents / wall players)
function makePlayer(x, z, opts) {
  opts = opts || {};
  var calls = { pose: 0, run: 0, sync: 0, failPose: false };
  var p = {
    x: x, z: z, y: 0, facing: 0, vx: 0, vz: 0,
    team: opts.team == null ? 0 : opts.team,
    idx: opts.idx == null ? 1 : opts.idx,
    isGoalkeeper: !!opts.gk,
    model: {
      group: { position: { set: function () { calls.sync++; } }, rotation: { y: 0 } },
      body: { rotation: { x: 0 } },
      anim: {
        pose: function (name) {
          calls.pose++;
          if (calls.failPose) return false;
          if (name === 'run') calls.run++;
          return true;
        },
        state: function () { return { cur: 'idle', durs: { run: 1.0 } }; },
      },
    },
    _calls: calls,
  };
  if (opts.noAnim) { delete p.model.anim; }
  if (opts.noModel) { delete p.model; }
  return p;
}

// scorer with an anim controller stub — exercises the scripted corner run
function makeCelebrity() {
  var calls = { pose: 0, run: 0, sync: 0, failPose: false };
  var s = makeScorer();
  s.model.body = { rotation: { x: 0 } };
  s.model.group.position.set = function () { calls.sync++; };
  s.model.anim = {
    pose: function (name) {
      calls.pose++;
      if (calls.failPose) return false;
      if (name === 'run') calls.run++;
      return true;
    },
    state: function () { return { cur: 'idle', durs: { run: 1.0 } }; },
  };
  s._calls = calls;
  return s;
}

function goalMsg(scorer) {
  return { team: 0, scorer: scorer, assist: null, isOwnGoal: false, score: [1, 0] };
}

function resetCam() {
  cam.followX = 2; cam.followZ = 3;
  cam.shakeT = 0.6; cam.shakeAmp = 0.7; cam.zoomPulse = 1.5;
  camF.position.set(0, 0, 0);
  camF.fov = LG.Config.camera.fov;
}

function step(n, dt) {
  for (var i = 0; i < n && LG.GoalCinematic.active(); i++) {
    LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  }
}

function poseDelta(a, b) {
  var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

console.log('== bind ==');
LG.GoalCinematic.bind(function () { return match; });
LG.GoalCinematic.bind(function () { return null; });
ok(bus._m['goal'] && bus._m['goal'].length === 1, 'bind is idempotent (one goal listener)');
ok(bus._m['kickoff'] && bus._m['kickoff'].length === 1, 'one kickoff listener');
ok(bus._m['matchEnd'] && bus._m['matchEnd'].length === 1, 'one matchEnd listener');

console.log('== guards ==');
resetCam();
match.state = 'PLAY';
bus.emit('goal', goalMsg(makeScorer()));
ok(!LG.GoalCinematic.active(), 'no start outside GOAL');
match.state = 'GOAL';
bus.emit('goal', { team: 1, scorer: null, isOwnGoal: true, score: [0, 1] });
ok(!LG.GoalCinematic.active(), 'own goal skipped');
bus.emit('goal', { team: 0, scorer: null, isOwnGoal: false, score: [1, 0] });
ok(!LG.GoalCinematic.active(), 'missing scorer skipped');
var savedCam = match.camera;
match.camera = null;
bus.emit('goal', goalMsg(makeScorer()));
ok(!LG.GoalCinematic.active(), 'headless (no match.camera) skipped');
match.camera = savedCam;
LG.Settings.setReducedMotion(true);
bus.emit('goal', goalMsg(makeScorer()));
ok(!LG.GoalCinematic.active(), 'reducedMotion skipped');
LG.Settings.setReducedMotion(false);
ok(cam.zoomPulse === 1.5 && cam.shakeT === 0.6, 'guards leave the broadcast camera untouched');

console.log('== happy path (landscape) ==');
resetCam();
match.state = 'GOAL';
bus.emit('goal', goalMsg(makeScorer()));
ok(LG.GoalCinematic.active(), 'goal starts the cinematic');
ok(cam.zoomPulse === 0 && cam.shakeT === 0 && cam.shakeAmp === 0, 'shake/pulse adopted on start');
var st0 = LG.GoalCinematic.state();
ok(Math.abs(st0.dur - 2.3) < 1e-9, 'duration is 2.3s');
ok(st0.dur < LG.Config.match.goalDelay, 'fits inside goalDelay (' + LG.Config.match.goalDelay + 's)');

var dt = 1 / 60;
var frames = 0, mid = null;
while (LG.GoalCinematic.active() && frames < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  frames++;
  if (frames === 60) {
    mid = { x: camF.position.x, y: camF.position.y, z: camF.position.z, w: LG.GoalCinematic.state().w };
  }
}
ok(!LG.GoalCinematic.active(), 'finishes on its own');
ok(frames >= 138 && frames <= 140, 'ran the full timeline at 60fps (' + frames + ' frames)');
ok(mid && mid.w > 0.9, 'full hero blend mid-run (w=' + (mid ? mid.w.toFixed(2) : '-') + ')');
ok(mid && poseDelta(mid, { x: cam.followX + LG.Config.camera.landscape.distance, y: LG.Config.camera.landscape.height, z: cam.followZ }) > 5,
  'hero pose is far from the broadcast pose');
ok(isFinite(cam.followX) && isFinite(cam.followZ) && Math.abs(cam.followX) <= LG.Config.camera.landscape.xClamp + 1e-9,
  'handback follow is finite and inside the xClamp');
ok(cam.zoomPulse > 0 && cam.zoomPulse < 1.5, 'goal pulse carried back and still decaying (' + cam.zoomPulse.toFixed(3) + ')');
ok(cam.shakeT <= 0 && cam.shakeAmp === 0, 'goal shake fully decayed by handback');

var poseEnd = { x: camF.position.x, y: camF.position.y, z: camF.position.z };
var fovEnd = camF.fov;
cam.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
var snap = poseDelta(poseEnd, camF.position);
ok(snap < 1e-6, 'handback pose == next broadcast frame, no snap (d=' + snap.toExponential(2) + ')');
var dFov1 = Math.abs(camF.fov - fovEnd);
var fovMid = camF.fov;
cam.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
var dFov2 = Math.abs(camF.fov - fovMid);
ok(dFov1 < 0.1 && dFov2 < 0.1, 'fov keeps gliding with the decaying pulse, no jump (Δ=' + dFov1.toFixed(4) + '/' + dFov2.toFixed(4) + ')');

console.log('== abort paths ==');
resetCam();
match.state = 'GOAL';
bus.emit('goal', goalMsg(makeScorer()));
ok(LG.GoalCinematic.active(), 'restart for abort test');
LG.GoalCinematic.update(0.3, match.active.x, match.active.z, match.ball.x, match.ball.z);
bus.emit('kickoff');
ok(!LG.GoalCinematic.active(), 'kickoff event aborts immediately');
ok(isFinite(cam.followX) && isFinite(cam.followZ), 'abort still seeds a finite follow');

resetCam();
match.state = 'GOAL';
bus.emit('goal', goalMsg(makeScorer()));
LG.GoalCinematic.update(0.1, match.active.x, match.active.z, match.ball.x, match.ball.z);
match.state = 'KICKOFF';
LG.GoalCinematic.update(0.1, match.active.x, match.active.z, match.ball.x, match.ball.z);
ok(!LG.GoalCinematic.active(), 'state leaving GOAL hands back with no event');
match.state = 'GOAL';

resetCam();
bus.emit('goal', goalMsg(makeScorer()));
LG.GoalCinematic.update(0.1, match.active.x, match.active.z, match.ball.x, match.ball.z);
var origSet = camF.position.set;
camF.position.set = function () { throw new Error('boom'); };
LG.GoalCinematic.update(0.1, match.active.x, match.active.z, match.ball.x, match.ball.z);
camF.position.set = origSet;
ok(!LG.GoalCinematic.active(), 'exceptions abort instead of breaking the frame loop');

resetCam();
match.state = 'GOAL';
bus.emit('goal', goalMsg(makeScorer()));
ok(LG.GoalCinematic.active(), 'double goal restarts cleanly');
bus.emit('goal', goalMsg(makeScorer()));
ok(LG.GoalCinematic.active(), 'still active after restart');
bus.emit('matchEnd');
ok(!LG.GoalCinematic.active(), 'matchEnd hands back');

console.log('== scorer presentation (3D.2) ==');
var C = LG.Config.court;
var halfW = C.width / 2, halfL = C.length / 2;
var CORNER = 1.4;
var tx = -(halfW - CORNER);          // nearest target corner for (-6,-16)
var tz = -(halfL - CORNER);
resetCam();
match.state = 'GOAL';
match._gside = -22.5;
var s1 = makeCelebrity();
match.all = [s1];
bus.emit('goal', goalMsg(s1));
ok(LG.GoalCinematic.active(), 'cinematic starts with animated scorer');
ok(s1.x === -6 && s1.z === -16, 'no movement before RUN_START (0.25s)');
var runFace1 = Math.atan2(tx - s1.x, tz - s1.z);
var fr = 0, maxV = 0, mid = null, hold = null, holdCamX = 0, holdCamZ = 0, runAtHold = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++;
  var vv = Math.sqrt(s1.vx * s1.vx + s1.vz * s1.vz);
  if (vv > maxV) maxV = vv;
  if (fr === 42) { // t = 0.70, mid-run
    mid = { x: s1.x, z: s1.z, face: s1.facing, run: s1._calls.run, sync: s1._calls.sync };
  }
  if (fr === 78) { // t = 1.30, celebration hold
    hold = { face: s1.facing, x: s1.x, z: s1.z, run: s1._calls.run };
    holdCamX = camF.position.x; holdCamZ = camF.position.z;
  }
}
var runEnd = s1._calls.run;
ok(!LG.GoalCinematic.active(), 'celebrated cinematic finishes on its own');
ok(fr >= 138 && fr <= 140, 'full timeline kept (' + fr + ' frames)');
ok(maxV === 0, 'velocity NEVER nonzero during the whole run (max=' + maxV + ')');
ok(mid && Math.abs(mid.x - (-6 + (tx + 6) * 0.5)) < 0.01, 'interpolates to midpoint at t=0.70 (x=' + (mid ? mid.x.toFixed(3) : '-') + ')');
ok(mid && Math.abs(mid.z - (-16 + (tz + 16) * 0.5)) < 0.01, 'interpolates on z too (z=' + (mid ? mid.z.toFixed(3) : '-') + ')');
ok(mid && Math.abs(mid.face - runFace1) < 1e-9, 'faces along the run path during the run');
ok(mid && mid.run > 0, 'run clip pinned per frame (' + (mid ? mid.run : 0) + ' pose calls)');
ok(mid && mid.sync > 0, 'group position/rotation synced with the writes');
ok(hold && Math.abs(hold.x - tx) < 1e-9 && Math.abs(hold.z - tz) < 1e-9, 'landed exactly on the celebration target');
ok(hold && hold.run === runEnd, 'run pin stops at RUN_END (t=1.15), no pose calls after');
ok(hold && Math.abs(hold.face - Math.atan2(holdCamX - hold.x, holdCamZ - hold.z)) < 0.15, 'faces the camera once landed (face=' + (hold ? hold.face.toFixed(3) : '-') + ')');
ok(hold && s1.facing === hold.face, 'facing held steady through the celebration window');
ok(s1.x === tx && s1.z === tz, 'still on target after release (no glide)');
ok(s1.vx === 0 && s1.vz === 0, 'released with zero velocity (no PLAY leak)');
ok(s1.model.group.position && s1._calls.sync > 10, 'sync kept up with the movement');

console.log('== scorer failsafes ==');
// no anim API => camera-only, scorer untouched
resetCam();
match.state = 'GOAL';
var s2 = makeScorer();
match.all = [s2];
bus.emit('goal', goalMsg(s2));
fr = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++;
}
ok(!LG.GoalCinematic.active(), 'no-anim scorer: camera-only still finishes');
ok(s2.x === -6 && s2.z === -16, 'no-anim scorer never moves');
ok(fr >= 138 && fr <= 140, 'no-anim keeps the full camera timeline (' + fr + ')');

// pose() failing mid-run => release movement, camera continues
resetCam();
match.state = 'GOAL';
var s3 = makeCelebrity();
s3._calls.failPose = true;
match.all = [s3];
bus.emit('goal', goalMsg(s3));
fr = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++;
}
ok(!LG.GoalCinematic.active(), 'pose failure: camera-only still finishes');
ok(Math.abs(s3.x - (-6)) < 0.1 && Math.abs(s3.z - (-16)) < 0.1, 'pose failure released before meaningful movement (d=' + Math.sqrt(Math.pow(s3.x + 6, 2) + Math.pow(s3.z + 16, 2)).toFixed(3) + ')');
ok(s3.vx === 0 && s3.vz === 0, 'pose failure still releases with zero velocity');

// both celebration directions blocked right at the start => no run planned
resetCam();
match.state = 'GOAL';
var s4 = makeCelebrity();
var d1x = tx - s4.x, d1z = tz - s4.z;
var d1l = Math.sqrt(d1x * d1x + d1z * d1z);
var d2x = (halfW - CORNER) - s4.x, d2z = tz - s4.z;
var d2l = Math.sqrt(d2x * d2x + d2z * d2z);
var b1 = { x: s4.x + (d1x / d1l) * 1.4, z: s4.z + (d1z / d1l) * 1.4, vx: 0, vz: 0 };
var b2 = { x: s4.x + (d2x / d2l) * 1.4, z: s4.z + (d2z / d2l) * 1.4, vx: 0, vz: 0 };
match.all = [s4, b1, b2];
bus.emit('goal', goalMsg(s4));
fr = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++;
}
ok(!LG.GoalCinematic.active(), 'blocked paths: cinematic still finishes');
ok(s4.x === -6 && s4.z === -16, 'blocked paths: no movement planned');

// opposite direction (scoring into the +z end): clamped to the run window
resetCam();
match.state = 'GOAL';
match._gside = 22.5;
var s5 = makeCelebrity();
s5.x = 0; s5.z = 16;
match.all = [s5];
bus.emit('goal', goalMsg(s5));
fr = 0;
var midZ = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++;
  if (fr === 42) midZ = s5.z;
}
ok(!LG.GoalCinematic.active(), 'opposite direction: finishes');
ok(midZ > 16 + 1, 'runs toward the +z goal end (mid z=' + midZ.toFixed(2) + ')');
var s5travel = Math.sqrt(s5.x * s5.x + (s5.z - 16) * (s5.z - 16));
ok(Math.abs(s5travel - 8) < 1e-6, 'travels the full clamped window toward the corner (' + s5travel.toFixed(2) + 'm)');
ok(s5.z > 16 + 2 && s5.x < 0, 'lands toward the +z left corner (x=' + s5.x.toFixed(2) + ' z=' + s5.z.toFixed(2) + ')');
ok(s5.vx === 0 && s5.vz === 0, 'opposite direction releases with zero velocity');
match._gside = -22.5;
match.all = [];

console.log('== teammate reactions (3D.3) + group framing (3D.5) ==');
resetCam();
match.state = 'GOAL';
match._gside = -22.5;
var sc = makeCelebrity(); sc.idx = 0;
var m1 = makePlayer(-4, -12, { idx: 1 });
var m2 = makePlayer(-8, -14, { idx: 2 });
var gkP = makePlayer(-2, -15, { idx: 3, gk: true });
var farP = makePlayer(20, 10, { idx: 4 });
var oppP = makePlayer(-1, -18, { idx: 5, team: 1 });
var startM1 = { x: m1.x, z: m1.z }, startM2 = { x: m2.x, z: m2.z };
match.all = [sc, m1, m2, gkP, farP, oppP];
bus.emit('goal', goalMsg(sc));
var stT = LG.GoalCinematic.state();
ok(stT.mates === 2, 'selects 2 mates, keeper/distant/opponent excluded (got ' + stT.mates + ')');
ok(stT.matePos.length === 2, 'matePos exposes live mate positions');
var tA = 0, frG = null, frL48 = null, frM42 = null, frE = null, allV = 0, fr = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++; tA += dt;
  var allP = match.all, mv = 0;
  for (var q = 0; q < allP.length; q++) {
    var vq = Math.sqrt(allP[q].vx * allP[q].vx + allP[q].vz * allP[q].vz);
    if (vq > mv) mv = vq;
  }
  if (mv > allV) allV = mv;
  var stq = LG.GoalCinematic.state();
  if (fr === 42) frM42 = { x: m1.x, z: m1.z, run: m1._calls.run };
  if (fr === 48) frL48 = { look: stq.look, w: stq.w, sx: sc.x, sz: sc.z };
  if (fr === 95) { frM42.runEnd = m1._calls.run; }
  if (fr === 102) frG = { look: stq.look, x: camF.position.x, mates: stq.matePos, t: tA };
  if (fr === 120) frE = { x1: m1.x, z1: m1.z, x2: m2.x, z2: m2.z, run: m1._calls.run };
}
ok(!LG.GoalCinematic.active(), 'group cinematic finishes on its own');
ok(allV === 0, 'NEVER nonzero velocity for any player, mates included (max=' + allV + ')');
ok(fr >= 138 && fr <= 140, 'timeline kept with mates (' + fr + ' frames)');
var movedM1 = Math.sqrt(Math.pow(m1.x - startM1.x, 2) + Math.pow(m1.z - startM1.z, 2));
ok(movedM1 > 0.5 && frM42.run > 0, 'mate runs into frame with the run clip pinned (d=' + movedM1.toFixed(2) + 'm, runs=' + frM42.run + ')');
ok(gkP.x === -2 && gkP.z === -15 && farP.x === 20 && farP.z === 10 && oppP.x === -1 && oppP.z === -18,
  'keeper, distant mate and opponent never moved');
// t = 0.80: full hero blend, group widen not started => look == scorer exactly
ok(frL48 && frL48.w > 0.9, 'hero blend full at t=0.80 (w=' + (frL48 ? frL48.w.toFixed(3) : '-') + ')');
ok(frL48 && Math.abs(frL48.look.x - frL48.sx) < 1e-6 && Math.abs(frL48.look.z - frL48.sz) < 1e-6,
  'pre-group look is exactly the scorer (x=' + (frL48 ? frL48.look.x.toFixed(3) : '-') + ')');
// t = 1.70: mates landed, look blended 60/40 scorer/mateCentre, +2.5m pullback
var mx = 0, mz = 0;
for (var q2 = 0; q2 < frG.mates.length; q2++) { mx += frG.mates[q2].x; mz += frG.mates[q2].z; }
mx /= frG.mates.length; mz /= frG.mates.length;
var expX = sc.x + (mx - sc.x) * 0.4, expZ = sc.z + (mz - sc.z) * 0.4;
ok(Math.abs(frG.look.x - expX) < 1e-9 && Math.abs(frG.look.z - expZ) < 1e-9,
  'group look = 0.6*scorer + 0.4*mateCentre (x=' + frG.look.x.toFixed(3) + ')');
var expPx = expX + 13.5 + 2.5 - 0.3 * frG.t;
ok(Math.abs(frG.x - expPx) < 1e-6, 'hero standoff pulled back +2.5m for the group (x=' + frG.x.toFixed(3) + ')');
for (var q3 = 0; q3 < frG.mates.length; q3++) {
  var band = Math.sqrt(Math.pow(frG.mates[q3].x - sc.x, 2) + Math.pow(frG.mates[q3].z - sc.z, 2));
  ok(band >= 1.9 && band <= 3.5, 'mate slot in the celebration band (' + q3 + ': ' + band.toFixed(2) + 'm from scorer)');
  ok(Math.abs(frG.mates[q3].x) <= LG.Config.court.width / 2 - 0.9 &&
     Math.abs(frG.mates[q3].z) <= LG.Config.court.length / 2 - 0.9, 'mate slot inside the court (' + q3 + ')');
}
var faceExp = Math.atan2(sc.x - m1.x, sc.z - m1.z);
ok(Math.abs(m1.facing - faceExp) < 1e-9, 'landed mate faces the scorer');
ok(m1.x === frG.mates[0].x || m1.x === frG.mates[1].x, 'mate pinned on its slot');
ok(Math.abs(m1.x - frE.x1) < 1e-12 && Math.abs(m1.z - frE.z1) < 1e-12 &&
   Math.abs(m2.x - frE.x2) < 1e-12 && Math.abs(m2.z - frE.z2) < 1e-12,
  'mates hold the exact slot through the celebration (no glide)');
ok(frE.run === frM42.runEnd, 'mate run pin stops at TM_END (t=1.55)');
ok(m1.vx === 0 && m1.vz === 0 && m2.vx === 0 && m2.vz === 0 && sc.vx === 0 && sc.vz === 0,
  'release: everyone zero velocity');
ok(LG.GoalCinematic.state().look === null, 'look ref cleared on handback');

// re-entry: pull the band back out, second goal plans fresh mate runs
sc.x = -6; sc.z = -16;
m1.x = startM1.x; m1.z = startM1.z;
m2.x = startM2.x; m2.z = startM2.z;
match.all = [sc, m1, m2, gkP, farP, oppP];
var runsBefore = m1._calls.run;
bus.emit('goal', goalMsg(sc));
ok(LG.GoalCinematic.state().mates === 2, 'second goal re-plans the mates');
fr = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++;
}
ok(m1._calls.run > runsBefore, 're-entry mates actually ran again (pose delta=' + (m1._calls.run - runsBefore) + ')');
ok(m1.vx === 0 && m2.vx === 0 && sc.vx === 0, 're-entry releases with zero velocity');
var dRe = Math.sqrt(Math.pow(m1.x - sc.x, 2) + Math.pow(m1.z - sc.z, 2));
ok(dRe > 1.5, 're-entry mates landed away from the scorer (d=' + dRe.toFixed(2) + ')');

// pose failure on a mate: that mate releases, the rest continues
resetCam();
sc.x = -6; sc.z = -16;
m1.x = startM1.x; m1.z = startM1.z;
m2.x = startM2.x; m2.z = startM2.z;
m1._calls.failPose = true;
match.all = [sc, m1, m2, gkP, farP, oppP];
bus.emit('goal', goalMsg(sc));
fr = 0;
var scEndX = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++;
  scEndX = sc.x;
}
m1._calls.failPose = false;
ok(!LG.GoalCinematic.active(), 'mate pose failure: cinematic still finishes');
ok(Math.abs(scEndX - sc.x) < 1e-9 && Math.abs(sc.x - tx) < 1e-9, 'scorer still lands its corner target');
ok(m1.vx === 0 && m1.vz === 0, 'failed mate released with zero velocity');

// no animated scorer => camera-only, nobody runs (mates included)
resetCam();
var plainS = makeScorer();
var m3 = makePlayer(-4, -12, { idx: 1 });
match.all = [plainS, m3];
bus.emit('goal', goalMsg(plainS));
ok(LG.GoalCinematic.state().mates === 0, 'camera-only: no mates planned');
fr = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++;
}
ok(m3.x === -4 && m3.z === -12, 'camera-only: teammate never moved');

// scorer-only framing: no group widen (+2.5) when no mates
resetCam();
var solo = makeCelebrity();
match.all = [solo];
bus.emit('goal', goalMsg(solo));
fr = 0; tA = 0;
var soloX = null, soloT = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++; tA += dt;
  if (fr === 102) { soloX = camF.position.x; soloT = tA; }
}
ok(soloX !== null, 'solo cinematic reached the group-frame timestamp');
// solo: look == scorer (scX + 13.5 - 0.3t) — no +2.5 group pullback
ok(Math.abs(soloX - (solo.x + 13.5 - 0.3 * soloT)) < 1e-6,
  'scorer-only keeps the tight standoff, no group pullback (x=' + soloX.toFixed(3) + ')');

// opposite direction (+z end): mates select and land too
resetCam();
match._gside = 22.5;
var scB = makeCelebrity(); scB.idx = 0; scB.x = 0; scB.z = 16;
var mB1 = makePlayer(0, 14, { idx: 1 });
var mB2 = makePlayer(-3, 14, { idx: 2 });
match.all = [scB, mB1, mB2];
bus.emit('goal', goalMsg(scB));
ok(LG.GoalCinematic.state().mates === 2, 'opposite direction: mates planned (got ' + LG.GoalCinematic.state().mates + ')');
fr = 0;
var bandB = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++;
  if (fr === 120) bandB = Math.sqrt(Math.pow(mB1.x - scB.x, 2) + Math.pow(mB1.z - scB.z, 2));
}
ok(fr >= 138 && fr <= 140, 'opposite direction: timeline kept (' + fr + ' frames)');
ok(bandB >= 1.9 && bandB <= 3.5, 'opposite direction: mate landed in the band (' + bandB.toFixed(2) + 'm)');
ok(scB.z > 16 + 2 && mB1.vx === 0 && mB2.vz === 0, 'opposite direction: scorer advanced, all released at zero');
match._gside = -22.5;
match.all = [];

console.log('== portrait ==');
LG.Settings.setView('portrait');
resetCam();
match.state = 'GOAL';
bus.emit('goal', goalMsg(makeScorer()));
ok(LG.GoalCinematic.active(), 'portrait start');
frames = 0;
while (LG.GoalCinematic.active() && frames < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  frames++;
}
ok(!LG.GoalCinematic.active(), 'portrait finishes on its own');
var poseEndP = { x: camF.position.x, y: camF.position.y, z: camF.position.z };
cam.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
var snapP = poseDelta(poseEndP, camF.position);
ok(snapP < 1e-6, 'portrait handback == next broadcast frame (d=' + snapP.toExponential(2) + ')');
LG.Settings.setView('landscape');

console.log('== celebration variant hooks (3D.6) ==');
// celebration.js is boot/browser-only — stub exactly the surface the
// cinematic reads (current.{type,own,scorer,pointAt}) so every variant
// path runs against the real camera maths. Removed again at the end.
LG.Celebration = { current: null };
resetCam();
match.state = 'GOAL';
bus.emit('goal', goalMsg(makeScorer()));
ok(LG.GoalCinematic.state().variant === null, 'current=null => null variant (base maths)');
frames = 0;
while (LG.GoalCinematic.active() && frames < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  frames++;
}

// solo 'arms': closer hero framing (HERO_DRIFT - 1.0)
resetCam();
match.state = 'GOAL';
var scA = makeCelebrity(); scA.idx = 0;
LG.Celebration.current = { type: 'arms', own: false, scorer: scA, pointAt: null };
bus.emit('goal', goalMsg(scA));
ok(LG.GoalCinematic.state().variant === 'arms', 'variant surfaced in state()');
fr = 0; var tV = 0, camXA = 0, tSA = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++; tV += dt;
  if (fr === 102) { camXA = camF.position.x; tSA = tV; }
}
ok(Math.abs(camXA - (scA.x + 12.5 - 0.3 * tSA)) < 1e-6,
  'solo arms: tighter standoff 12.5m (x=' + camXA.toFixed(3) + ')');

// arms still owns the scorer's facing after the run lands
resetCam();
match.state = 'GOAL';
var scF = makeCelebrity(); scF.idx = 0;
LG.Celebration.current = { type: 'arms', own: false, scorer: scF, pointAt: null };
bus.emit('goal', goalMsg(scF));
frames = 0;
while (LG.GoalCinematic.active() && frames < 400 && LG.GoalCinematic.state().t < 1.3) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  frames++;
}
ok(LG.GoalCinematic.active(), 'arms variant reached t=1.3 past the run');
scF.facing = 1.2345;
LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
ok(Math.abs(scF.facing - 1.2345) > 1e-9, 'arms: cinematic forces the hold facing');
while (LG.GoalCinematic.active() && frames < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  frames++;
}

// 'signature' spins on purpose: the cinematic must NOT overwrite facing
resetCam();
match.state = 'GOAL';
var scS1 = makeCelebrity(); scS1.idx = 0;
LG.Celebration.current = { type: 'signature', own: false, scorer: scS1, pointAt: null };
bus.emit('goal', goalMsg(scS1));
ok(LG.GoalCinematic.state().variant === 'signature', 'signature variant captured');
frames = 0;
while (LG.GoalCinematic.active() && frames < 400 && LG.GoalCinematic.state().t < 1.3) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  frames++;
}
ok(LG.GoalCinematic.active(), 'signature variant reached t=1.3 past the run');
scS1.facing = 1.2345;
LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
ok(Math.abs(scS1.facing - 1.2345) < 1e-9, 'signature: facing left to celebration.js');
ok(scS1.vx === 0 && scS1.vz === 0, 'signature: still pinned with zero velocity');
while (LG.GoalCinematic.active() && frames < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  frames++;
}

// 'slide': lower hero angle (HERO_H - 1.5)
resetCam();
match.state = 'GOAL';
var scSL = makeCelebrity(); scSL.idx = 0;
LG.Celebration.current = { type: 'slide', own: false, scorer: scSL, pointAt: null };
bus.emit('goal', goalMsg(scSL));
fr = 0; tV = 0; var camYV = 0, tSS = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++; tV += dt;
  if (fr === 102) { camYV = camF.position.y; tSS = tV; }
}
ok(Math.abs(camYV - (5.7 + 0.5 * tSS)) < 1e-6,
  'slide: lower hero angle 5.7 + rise (y=' + camYV.toFixed(3) + ')');

// 'point': look blends toward the saluted player, scorer faces them
resetCam();
match.state = 'GOAL';
var scPT = makeCelebrity(); scPT.idx = 0;
var tgtPT = makePlayer(-4, -12, { idx: 1 });
LG.Celebration.current = { type: 'point', own: false, scorer: scPT, pointAt: { x: tgtPT.x, z: tgtPT.z } };
bus.emit('goal', goalMsg(scPT));
ok(LG.GoalCinematic.state().variant === 'point', 'point variant captured');
fr = 0; var lookV = null;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++;
  if (fr === 102) lookV = LG.GoalCinematic.state().look;
}
var expLX = scPT.x + (tgtPT.x - scPT.x) * 0.4;
var expLZ = scPT.z + (tgtPT.z - scPT.z) * 0.4;
ok(lookV && Math.abs(lookV.x - expLX) < 1e-9 && Math.abs(lookV.z - expLZ) < 1e-9,
  'point: look = 60% scorer + 40% target (x=' + (lookV ? lookV.x.toFixed(3) : '-') + ')');
var expFacePT = Math.atan2(tgtPT.x - scPT.x, tgtPT.z - scPT.z);
ok(Math.abs(scPT.facing - expFacePT) < 0.01,
  'point: scorer ends facing the saluted player (d=' +
  Math.abs(scPT.facing - expFacePT).toFixed(4) + 'rad)');

// 'huddle': wider group frame (LOOK_MATE*1.3, GROUP_PULL*1.35)
resetCam();
match.state = 'GOAL';
var scH = makeCelebrity(); scH.idx = 0;
var mH1 = makePlayer(-4, -12, { idx: 1 });
var mH2 = makePlayer(-8, -14, { idx: 2 });
match.all = [scH, mH1, mH2];
LG.Celebration.current = { type: 'huddle', own: false, scorer: scH, pointAt: null };
bus.emit('goal', goalMsg(scH));
ok(LG.GoalCinematic.state().mates === 2, 'huddle: mates planned for the group frame');
fr = 0; tV = 0; var camXH = 0, lookH = null, mpH = null, tH = 0;
while (LG.GoalCinematic.active() && fr < 400) {
  LG.GoalCinematic.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
  fr++; tV += dt;
  if (fr === 102) {
    camXH = camF.position.x;
    lookH = LG.GoalCinematic.state().look;
    mpH = LG.GoalCinematic.state().matePos;   // live — handback would clear it
    tH = tV;
  }
}
var mcxH = 0, mczH = 0;
for (var qi = 0; qi < mpH.length; qi++) { mcxH += mpH[qi].x; mczH += mpH[qi].z; }
mcxH /= mpH.length; mczH /= mpH.length;
var expLookH = scH.x + (mcxH - scH.x) * (0.4 * 1.3);
ok(lookH && Math.abs(lookH.x - expLookH) < 1e-9,
  'huddle: wider look blend 0.52 (x=' + (lookH ? lookH.x.toFixed(3) : '-') + ')');
var expCamH = expLookH + 13.5 + 2.5 * 1.35 - 0.3 * tH;
ok(Math.abs(camXH - expCamH) < 1e-6,
  'huddle: wider pullback 3.375 (x=' + camXH.toFixed(3) + ')');
match.all = [];

ok(LG.GoalCinematic.state().variant === null, 'variant cleared on handback');
delete LG.Celebration;   // restore the real probe baseline (module not loaded)

console.log('');
if (fail) {
  console.log('CINPROBE FAIL ' + fail + ' failed / ' + (pass + fail));
  process.exit(1);
}
console.log('CINPROBE PASS ' + pass + '/' + pass);
