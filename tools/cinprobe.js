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
var match = { state: 'GOAL', camera: cam, active: { x: 2, z: 3 }, ball: { x: 2, z: 3 }, bus: LG.eventBus };
var bus = LG.eventBus;

function makeScorer() {
  return {
    x: -6, z: -16, y: 0, team: 0, facing: 0, vx: 0, vz: 0,
    model: { group: { position: { set: function () {} }, rotation: { y: 0 } } },
  };
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
