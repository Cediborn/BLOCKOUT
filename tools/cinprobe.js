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

console.log('');
if (fail) {
  console.log('CINPROBE FAIL ' + fail + ' failed / ' + (pass + fail));
  process.exit(1);
}
console.log('CINPROBE PASS ' + pass + '/' + pass);
