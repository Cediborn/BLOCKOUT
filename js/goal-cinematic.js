// ============================================================
// GOAL CINEMATIC — a one-shot camera feature over the GOAL freeze.
//
// Owns ONLY the camera while active: match.update still freezes the game,
// Celebration still poses the limbs and crowd/audio still fire off the same
// 'goal' event. The main loop swaps camCtrl.update for update() for the
// duration (js/main.js), so every guard / failure path degrades to the
// existing broadcast follow camera with no code left half-applied.
//
// The pose and follow maths mirror js/camera.js (keep in sync): handback
// re-seeds camCtrl.followX/followZ with the simulated follow and hands back
// the adopted shake/pulse, so the next camCtrl.update frame continues
// exactly where this one left off — no snap, no stale zoom punch.
// ============================================================
var LG = window.LG = window.LG || {};

LG.GoalCinematic = (function () {
  var SWOOP = 0.6;          // gameplay pose -> hero pose
  var BACK = 0.6;           // hero pose -> gameplay pose
  var T = 2.3;              // total, must stay under Config.match.goalDelay (2.6)
  var HERO_FOV = 6;         // fov punch while framing the scorer
  var HERO_H = 7.2;         // eye height of the hero shot
  var HERO_RISE = 0.5;      // slow crane up across the hold
  var HERO_DRIFT = 13.5;    // standoff distance from the scorer
  var HERO_SWAY = 1.6;      // gentle lateral sway across the hold
  var HERO_SWAY_HZ = 0.4;

  var bound = false, getMatch = null;
  var active = false, t = 0, w = 0, scorer = null, cam = null;
  var ours = null, fSim = null;

  function ease(x) { return LG.Util.easeInOut(LG.Util.clamp(x, 0, 1)); }

  function warn(msg) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[CIN] ' + msg);
  }

  // Hand the camera back to MatchCamera: seed the simulated follow and
  // return the adopted shake/pulse so camCtrl.update resumes seamlessly.
  function handback() {
    if (!active) return;
    if (cam && ours && fSim) {
      cam.followX = fSim.x;
      cam.followZ = fSim.z;
      cam.shakeT = ours.shakeT;
      cam.shakeAmp = ours.shakeAmp;
      cam.zoomPulse = ours.zoomPulse;
    }
    active = false;
    scorer = null; cam = null; ours = null; fSim = null;
    t = 0; w = 0;
  }

  // Idempotent: registers the bus hooks once (LG.Events has on/off/emit,
  // no once). Pause deliberately does NOT abort — the loop simply stops
  // calling update while paused, so the cinematic freezes and resumes.
  function bind(matchGetter) {
    if (bound) return;
    bound = true;
    getMatch = matchGetter;
    var bus = LG.eventBus;
    if (!bus || !bus.on) return;
    bus.on('goal', function (g) { start(g); });
    bus.on('kickoff', function () { handback(); });
    bus.on('matchStart', function () { handback(); });
    bus.on('matchEnd', function () { handback(); });
  }

  // Guards everything: headless sim (no match.camera), own goals and
  // deflections (scorer null), reduced-motion, missing model. Returning
  // false leaves the broadcast camera untouched — byte-identical to the
  // flow before this module existed.
  function start(g) {
    if (active) handback();
    try {
      if (!getMatch) return false;
      var m = getMatch();
      if (!m || m.state !== 'GOAL') return false;
      if (!g || g.isOwnGoal || !g.scorer) return false;
      if (LG.Settings && LG.Settings.reducedMotion && LG.Settings.reducedMotion()) return false;
      var c = m.camera;
      if (!c || !c.camera || typeof c.cfg !== 'function') return false;
      var s = g.scorer;
      if (!s.model || !s.model.group) return false;
      cam = c;
      scorer = s;
      ours = { shakeT: c.shakeT, shakeAmp: c.shakeAmp, zoomPulse: c.zoomPulse };
      fSim = { x: c.followX, z: c.followZ };
      c.shakeT = 0;
      c.shakeAmp = 0;
      c.zoomPulse = 0;
      t = 0;
      w = 0;
      active = true;
      return true;
    } catch (e) {
      warn('start: ' + (e && e.message));
      handback();
      return false;
    }
  }

  // Called from the main loop INSTEAD of camCtrl.update while active.
  // Order per frame: advance follow + timers, blend gameplay pose with the
  // hero pose framing the scorer, apply the adopted shake, write camera.
  function update(dt, targetX, targetZ, ballX, ballZ) {
    if (!active) return;
    try {
      var m = getMatch ? getMatch() : null;
      if (!m || m.state !== 'GOAL' || !cam) { handback(); return; }
      if (!scorer || !scorer.model || !scorer.model.group) { handback(); return; }
      dt = LG.Util.clamp(dt || 0, 0, 0.1);
      t += dt;

      var C = cam.cfg();
      var land = cam.isLandscape();

      // follow simulation — js/camera.js:77-107, so handback lands exactly
      // where the broadcast camera would have been
      var tx = LG.Util.lerp(targetX, ballX, 0.42);
      var tz = LG.Util.lerp(targetZ, ballZ, 0.42);
      var k = Math.min(1, dt * 6.5);
      fSim.x = LG.Util.lerp(fSim.x, tx, k);
      fSim.z = LG.Util.lerp(fSim.z, tz, k);
      fSim.x = LG.Util.clamp(fSim.x, -C.xClamp, C.xClamp);
      fSim.z = LG.Util.clamp(fSim.z, -C.zClamp, C.zClamp);
      if (land) {
        fSim.x = LG.Util.clamp(fSim.x, targetX - 20, targetX + 20);
        fSim.z = LG.Util.clamp(fSim.z, targetZ - 20, targetZ + 20);
      } else {
        fSim.x = LG.Util.clamp(fSim.x, targetX - 13, targetX + 13);
        fSim.z = LG.Util.clamp(fSim.z, targetZ - 15, targetZ + 30);
      }

      // adopted shake / pulse decay — js/camera.js:111-117, :132
      var sx = 0, sy = 0;
      if (ours.shakeT > 0) {
        ours.shakeT -= dt;
        var a = ours.shakeAmp * Math.max(0, ours.shakeT);
        sx = (Math.random() - 0.5) * 2 * a;
        sy = (Math.random() - 0.5) * 2 * a;
        if (ours.shakeT <= 0) ours.shakeAmp = 0;
      }
      ours.zoomPulse = Math.max(0, ours.zoomPulse - dt * 0.5);

      // blend weight: 0 = gameplay pose, 1 = hero pose
      if (t >= T) w = 0;
      else if (t < SWOOP) w = ease(t / SWOOP);
      else if (t > T - BACK) w = 1 - ease((t - (T - BACK)) / BACK);
      else w = 1;

      // gameplay pose from the simulated follow — js/camera.js:119-129
      var gpx = land ? fSim.x + C.distance : fSim.x;
      var gpy = C.height;
      var gpz = land ? fSim.z : fSim.z + C.distance;
      var glx = fSim.x, gly = 1.0, glz = land ? fSim.z : fSim.z - 2.5;
      var gfov = C.fov - ours.zoomPulse * 7;

      var px = gpx, py = gpy, pz = gpz;
      var lx = glx, ly = gly, lz = glz;
      var fov = gfov;
      if (w > 0) {
        var scX = scorer.x, scZ = scorer.z;
        var hpx, hpz;
        if (land) {
          hpx = scX + HERO_DRIFT - 0.3 * t;
          hpz = scZ + Math.sin(t * HERO_SWAY_HZ) * HERO_SWAY;
        } else {
          hpx = scX + Math.sin(t * HERO_SWAY_HZ) * HERO_SWAY;
          hpz = scZ + HERO_DRIFT - 0.3 * t;
        }
        var hpy = HERO_H + HERO_RISE * t;
        px = LG.Util.lerp(gpx, hpx, w);
        py = LG.Util.lerp(gpy, hpy, w);
        pz = LG.Util.lerp(gpz, hpz, w);
        lx = LG.Util.lerp(glx, scX, w);
        ly = LG.Util.lerp(gly, 1.4, w);
        lz = LG.Util.lerp(glz, scZ, w);
        fov = LG.Util.lerp(gfov, C.fov - HERO_FOV, w);
      }

      // shake offsets — same axes as js/camera.js:122-128
      cam.camera.position.set(px + sx, py + sy * 0.6, pz + sx * 0.4);
      cam.camera.lookAt(lx, ly, lz);
      if (Math.abs(fov - cam.camera.fov) > 0.01) {
        cam.camera.fov = fov;
        cam.camera.updateProjectionMatrix();
      }

      if (t >= T) handback();
    } catch (e) {
      warn('abort: ' + (e && e.message));
      handback();
    }
  }

  // Public lifecycle: finish() = normal handback, abort(reason) = the same
  // immediate handback used by the bus hooks, active() / state() for the
  // loop guard and probes.
  function finish() { handback(); }

  function abort(reason) {
    if (active && LG.DBG && LG.DBG.on) LG.DBG.log('[CIN] abort: ' + reason);
    handback();
  }

  function isActive() { return active; }

  function state() { return { active: active, t: t, dur: T, w: w }; }

  return {
    bind: bind,
    start: start,
    update: update,
    finish: finish,
    abort: abort,
    active: isActive,
    state: state,
  };
})();
