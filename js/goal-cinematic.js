// ============================================================
// GOAL CINEMATIC — a one-shot camera feature over the GOAL freeze.
//
// Owns the camera AND the celebration presentation while active:
// match.update still freezes the game (vx/vz zeroed by updatePlayers),
// Celebration still poses the limbs and crowd/audio still fire off the
// same 'goal' event. The scorer gets a scripted corner run + celebration
// hold; up to MAX_CELEBRATING_TEAMMATES nearby mates get a short run to
// flanking slots (3D.3) so the group moment reads as a team celebration.
// Everything is direct position interpolation + anim.pose('run') pinning
// — gameplay velocities are never written (only zeroed), so there is no
// leak when PLAY resumes. Every guard / failure path degrades toward the
// broadcast follow camera + the untouched celebration (camera-only mode).
// The main loop swaps camCtrl.update for update() for the duration
// (js/main.js).
//
// The pose and follow maths mirror js/camera.js (keep in sync): handback
// re-seeds camCtrl.followX/followZ with the simulated follow and hands back
// the adopted shake/pulse, so the next camCtrl.update frame continues
// exactly where this one left off — no snap, no stale zoom punch.
// ============================================================
var LG = window.LG = window.LG || {};

LG.GoalCinematic = (function () {
  var SWOOP = 0.6;          // gameplay pose -> hero pose
  var BACK = 0.5;           // hero pose -> gameplay pose (holds the group
                            // a beat longer than the scorer-only cut)
  var T = 2.3;              // total, must stay under Config.match.goalDelay (2.6)
  var HERO_FOV = 6;         // fov punch while framing the scorer
  var HERO_H = 7.2;         // eye height of the hero shot
  var HERO_RISE = 0.5;      // slow crane up across the hold
  var HERO_DRIFT = 13.5;    // standoff distance from the scorer
  var HERO_SWAY = 1.6;      // gentle lateral sway across the hold
  var HERO_SWAY_HZ = 0.4;
  // scorer presentation timeline (inside T): 0.10 camera, 0.25 run start,
  // 0.25-1.15 run to the celebration corner, 1.15-2.05 celebration pose
  // (run pin released -> controller fades to idle, celebration.js layers
  // the limbs), 2.05-2.30 hold, 2.30 release in handback() before kickoff.
  var RUN_START = 0.25;
  var RUN_END = 1.15;
  var CELEB_END = 2.05;
  var END_CLEAR = 1.6;      // centre distance from any other player at the target
  var PATH_CLEAR = 1.05;    // centre distance from any other player along the path
  var MIN_RUN = 1.6;        // too short to bother moving
  var MAX_RUN = 8;          // window is 0.9s: 8m ~= 8.9 m/s average, eased
  var CORNER_PAD = 1.4;     // inset from the sidelines/goal line
  // teammate reactions (3D.3) — a small, controlled group only
  var TM_MAX = 2;           // MAX_CELEBRATING_TEAMMATES
  var TM_DIST = 12;         // MAX_REACTION_DISTANCE from the scorer (prefilter)
  var TM_START = 0.55;      // first mate leaves once the scorer is moving
  var TM_STAG = 0.10;       // start stagger so they don't break step
  var TM_END = 1.55;        // all mates landed before the group framing peaks
  var TM_MIN_RUN = 1.5;     // closer: celebrate in place (no run-in-place)
  var TM_MAX_RUN = 9.1;     // never drag a mate across the pitch
  var SLOT_R = 2.4;         // celebration slot radius around the scorer's spot
  var PATH_CLEAR_TM = 1.0;  // mate path clearance vs other players
  var PATH_CLEAR_SC = 1.15; // mate path vs the scorer's run path (no crossing)
  // group framing (3D.5) — widen from the scorer to the group smoothly
  var GROUP_START = 1.2;    // begins while the mates are landing
  var GROUP_DUR = 0.5;      // full group frame at 1.70
  var GROUP_PULL = 2.5;     // extra standoff once the group forms
  var LOOK_MATE = 0.4;      // look = scorer*(1-a) + mateCentre*a at full

  var bound = false, getMatch = null;
  var active = false, t = 0, w = 0, scorer = null, cam = null;
  var ours = null, fSim = null;
  var scorerFx = null;      // planned run: {from,to,speed,runFace,clipDur,holdFace}
  var tmFx = null;          // planned mate runs: [{p,from,to,start,end,...}]
  var lastLook = null;      // last lookAt target, for probes

  function ease(x) { return LG.Util.easeInOut(LG.Util.clamp(x, 0, 1)); }

  function warn(msg) {
    if (typeof console !== 'undefined' && console.warn) console.warn('[CIN] ' + msg);
  }

  // Hand the camera back to MatchCamera: seed the simulated follow and
  // return the adopted shake/pulse so camCtrl.update resumes seamlessly.
  // Also releases the scorer: velocities zeroed (never nonzero during the
  // freeze, belt and braces) and the scripted run dropped, so the player
  // is fully back under normal gameplay control before PLAY resumes.
  function handback() {
    if (!active) return;
    releaseScorer();
    releaseTeammates();
    if (cam && ours && fSim) {
      cam.followX = fSim.x;
      cam.followZ = fSim.z;
      cam.shakeT = ours.shakeT;
      cam.shakeAmp = ours.shakeAmp;
      cam.zoomPulse = ours.zoomPulse;
    }
    active = false;
    scorer = null; cam = null; ours = null; fSim = null;
    t = 0; w = 0; lastLook = null;
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
      // Plan the corner run (null => camera-only mode, celebration intact)
      scorerFx = planScorer(m, s);
      // Plan up to TM_MAX teammate runs to flanking slots. Failures inside
      // degrade to fewer mates / none — never blocks the goal (3D.3).
      tmFx = planTeammates(m, s, scorerFx);
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

      // scorer + mate presentation BEFORE the pose blend so the hero shot
      // frames the moving group in the same frame (camera already tracks
      // scorer.x/z live — no camera-side hook needed)
      presentScorer(dt);
      presentTeammates(dt);

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
        // group framing (3D.5): ease the look/standoff from the scorer to
        // the group centre once the mates are landing (GROUP_START..1.70),
        // blended by LOOK_MATE so the scorer stays the anchor.
        var scX = scorer.x, scZ = scorer.z;
        var gw = 0;
        if (tmFx && tmFx.length) {
          var mcx = 0, mcz = 0, mn = 0;
          for (var gi = 0; gi < tmFx.length; gi++) {
            var q = tmFx[gi];
            if (q.dead) continue;
            mcx += q.p.x; mcz += q.p.z; mn++;
          }
          if (mn) {
            gw = ease((t - GROUP_START) / GROUP_DUR);
            mcx /= mn; mcz /= mn;
            scX += (mcx - scX) * (LOOK_MATE * gw);
            scZ += (mcz - scZ) * (LOOK_MATE * gw);
          }
        }
        var widen = GROUP_PULL * gw;
        var hpx, hpz;
        if (land) {
          hpx = scX + HERO_DRIFT + widen - 0.3 * t;
          hpz = scZ + Math.sin(t * HERO_SWAY_HZ) * HERO_SWAY;
        } else {
          hpx = scX + Math.sin(t * HERO_SWAY_HZ) * HERO_SWAY;
          hpz = scZ + HERO_DRIFT + widen - 0.3 * t;
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
      lastLook = { x: lx, y: ly, z: lz };

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

  // ---- scorer presentation (3D.2) -------------------------------------

  // Distance from point (px,pz) to segment a->b (used for path clearance).
  function segDist(px, pz, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az;
    var L2 = dx * dx + dz * dz;
    var f = L2 < 1e-9 ? 0 : LG.Util.clamp(((px - ax) * dx + (pz - az) * dz) / L2, 0, 1);
    var qx = ax + dx * f - px, qz = az + dz * f - pz;
    return Math.sqrt(qx * qx + qz * qz);
  }

  // Distance between two 2D segments (0 if they cross) — used so a mate's
  // run path never intersects the scorer's run path.
  function segSeg(ax, az, bx, bz, cx, cz, dx, dz) {
    function o(px, pz, qx, qz, rx, rz) { return (qx - px) * (rz - pz) - (qz - pz) * (rx - px); }
    var o1 = o(ax, az, bx, bz, cx, cz), o2 = o(ax, az, bx, bz, dx, dz);
    var o3 = o(cx, cz, dx, dz, ax, az), o4 = o(cx, cz, dx, dz, bx, bz);
    if (((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) &&
        ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0))) return 0;
    return Math.min(
      segDist(cx, cz, ax, az, bx, bz), segDist(dx, dz, ax, az, bx, bz),
      segDist(ax, az, cx, cz, dx, dz), segDist(bx, bz, cx, cz, dx, dz));
  }

  // The run clip length of the scorer's own controller (GLB retarget bank
  // or procedural rig). realplayer.state() exposes durs; the procedural
  // rig does not, so recover the clip length from a pinned pose and put
  // the player straight back on idle (one frame, self-heals in update).
  function runClipDur(anim) {
    var st = anim.state();
    if (st && st.durs && st.durs.run > 0) return st.durs.run;
    if (!anim.pose('run', 1e6)) return 0;
    st = anim.state();
    var dur = st && st.time > 0.05 ? st.time + 0.001 : 0;
    anim.pose('idle', 0);
    return dur > 0.05 ? dur : 0;
  }

  // Pick a celebration target: the nearest corner of the goal end we just
  // scored on, aimed at but clamped to the distance the 0.9s window can
  // cover, stepping back until the endpoint and path are clear. Any
  // failure => null => camera-only (the spec'd failsafe: no target, no
  // pose API, no movement).
  function planScorer(m, s) {
    try {
      var anim = s.model && s.model.anim;
      if (!anim || typeof anim.pose !== 'function' || typeof anim.state !== 'function') return null;
      var clipDur = runClipDur(anim);
      if (!clipDur) return null;
      var C = LG.Config.court;
      var halfW = C.width / 2, halfL = C.length / 2;
      var g = typeof m.enemyGoal === 'function' ? m.enemyGoal(s.team) : null;
      if (!g) return null;
      var side = g.z >= 0 ? 1 : -1;
      var cands = [
        { x: -(halfW - CORNER_PAD), z: side * (halfL - CORNER_PAD) },
        { x: (halfW - CORNER_PAD), z: side * (halfL - CORNER_PAD) },
      ];
      cands.sort(function (a, b) {
        var da = (a.x - s.x) * (a.x - s.x) + (a.z - s.z) * (a.z - s.z);
        var db = (b.x - s.x) * (b.x - s.x) + (b.z - s.z) * (b.z - s.z);
        return da - db;
      });
      var all = m.all || [];
      function clearAt(px, pz) {
        for (var j = 0; j < all.length; j++) {
          var o = all[j];
          if (!o || o === s) continue;
          var ox = o.x - px, oz = o.z - pz;
          if (ox * ox + oz * oz < END_CLEAR * END_CLEAR) return false;
          if (segDist(o.x, o.z, s.x, s.z, px, pz) < PATH_CLEAR) return false;
        }
        return true;
      }
      var pick = null;
      for (var i = 0; i < cands.length && !pick; i++) {
        var c = cands[i];
        var dx0 = c.x - s.x, dz0 = c.z - s.z;
        var cd = Math.sqrt(dx0 * dx0 + dz0 * dz0);
        if (cd < MIN_RUN) continue;           // already at the corner
        var dirx = dx0 / cd, dirz = dz0 / cd;
        var tryDist = Math.min(cd, MAX_RUN);  // aim at the corner, stop short
        var d = tryDist;
        while (d >= MIN_RUN && !pick) {
          var px = s.x + dirx * d, pz = s.z + dirz * d;
          if (clearAt(px, pz)) pick = { x: px, z: pz };
          d -= 0.5;
        }
        if (!pick && tryDist >= MIN_RUN && clearAt(s.x + dirx * MIN_RUN, s.z + dirz * MIN_RUN)) {
          pick = { x: s.x + dirx * MIN_RUN, z: s.z + dirz * MIN_RUN };
        }
      }
      if (!pick) return null;
      var dx = pick.x - s.x, dz = pick.z - s.z;
      var dist = Math.sqrt(dx * dx + dz * dz);
      return {
        fromX: s.x, fromZ: s.z, toX: pick.x, toZ: pick.z,
        dist: dist,
        speed: dist / (RUN_END - RUN_START),   // average run speed
        runFace: Math.atan2(dx, dz),  // model faces +Z at rot 0
        clipDur: clipDur,
        holdFace: 0,
        holdFaceSet: false,
      };
    } catch (e) {
      return null;
    }
  }

  // Keep the group in sync with the position/facing writes — kickoff does
  // this in the same frame (js/match.js:428-436).
  function syncScorer() {
    if (!scorer.model || !scorer.model.group) return;
    scorer.model.group.position.set(scorer.x, scorer.y || 0, scorer.z);
    scorer.model.group.rotation.y = scorer.facing;
  }

  // Release the scripted run: zero velocities (never wrote nonzero anyway)
  // and drop the plan. Called from handback() and the internal failsafe.
  function releaseScorer() {
    if (scorer) {
      try { scorer.vx = 0; scorer.vz = 0; } catch (e) {}
    }
    scorerFx = null;
  }

  // Per-frame scorer control. Phases: hold position before RUN_START,
  // ease to the corner across RUN_START-RUN_END with the run cycle pinned
  // every frame (frame-rate independent: time derived from t, not
  // accumulated), then pin the spot and own the facing through the
  // celebration/hold until handback releases us. Any failure (pose API
  // gone, model fell back) releases movement but keeps the camera.
  function presentScorer(dt) {
    var fx = scorerFx;
    if (!fx || !scorer || !scorer.model || t < RUN_START) return;
    try {
      if (t < RUN_END) {
        var u = (t - RUN_START) / (RUN_END - RUN_START);
        // smoothstep: gentler accel than quad easeInOut (peak = 1.5x avg)
        var e = u * u * (3 - 2 * u);
        scorer.x = fx.fromX + (fx.toX - fx.fromX) * e;
        scorer.z = fx.fromZ + (fx.toZ - fx.fromZ) * e;
        scorer.facing = fx.runFace;
        // neutralise celebration body pitch (e.g. 'slide') during the run;
        // celebration.js re-applies it after us and we stop at RUN_END
        if (scorer.model.body) scorer.model.body.rotation.x = 0;
        // footfall cadence: 1.8 steps/s standing -> ~4.6 at a full sprint
        var cyc = (1.8 + fx.speed * 0.35) / 2;   // cycles (2 steps) per second
        var pt = ((t - RUN_START) * cyc * fx.clipDur) % fx.clipDur;
        if (scorer.model.anim.pose('run', pt) === false) throw new Error('run pose unavailable');
      } else {
        if (!fx.holdFaceSet) {
          // face the camera once, at the moment the run lands
          fx.holdFaceSet = true;
          var cp = cam && cam.camera && cam.camera.position;
          fx.holdFace = cp ? Math.atan2(cp.x - scorer.x, cp.z - scorer.z) : fx.runFace;
        }
        // pin the celebration spot until release; own facing over
        // celebration.js's point/signature facing writes (we run after it)
        scorer.x = fx.toX;
        scorer.z = fx.toZ;
        scorer.facing = fx.holdFace;
      }
      scorer.vx = 0;
      scorer.vz = 0;
      syncScorer();
    } catch (err) {
      warn('scorer presentation off: ' + (err && err.message));
      releaseScorer();
    }
  }

  // ---- teammate reactions (3D.3) --------------------------------------

  // Pick up to TM_MAX celebrating teammates: same team, not the keeper,
  // within TM_DIST of the scorer, with an anim API. Each gets a flanking
  // SLOT_R slot around the scorer's celebration spot — chosen from a small
  // deterministic arc aimed at the open pitch (never the wall), checked
  // against walls, players, the other mates' slots/paths and (segment vs
  // segment) the scorer's own run, so nobody runs through anybody. Any
  // failure just yields fewer mates — camera/scorer-only never blocked.
  function planTeammates(m, s, fx) {
    try {
      if (!fx) return [];
      var all = m.all || [], i, j, p;
      var cands = [];
      for (i = 0; i < all.length; i++) {
        p = all[i];
        if (!p || p === s || p.team !== s.team || p.isGoalkeeper) continue;
        var pm = p.model;
        if (!pm || !pm.group || !pm.anim ||
            typeof pm.anim.pose !== 'function' || typeof pm.anim.state !== 'function') continue;
        var ddx = p.x - s.x, ddz = p.z - s.z;
        var d = Math.sqrt(ddx * ddx + ddz * ddz);
        if (d > TM_DIST) continue;
        cands.push({ p: p, d: d, idx: p.idx || 0 });
      }
      cands.sort(function (a, b) { return a.d - b.d || a.idx - b.idx; });
      if (!cands.length) return [];

      var C = LG.Config.court, halfW = C.width / 2, halfL = C.length / 2;
      var base = Math.atan2(-fx.toX, -fx.toZ);   // ring direction toward open pitch
      var Rs = [SLOT_R, 2.9, 2.0, 3.4];          // tight ring first, 3.4 = last resort
      var As = [0.85, -0.85, 1.3, -1.3, 0.45, -0.45, 0.2, -0.2, 0.6, -0.6];
      var out = [];
      for (i = 0; i < cands.length && out.length < TM_MAX; i++) {
        var c = cands[i];
        var need = Math.sqrt((fx.toX - c.p.x) * (fx.toX - c.p.x) +
                             (fx.toZ - c.p.z) * (fx.toZ - c.p.z));
        if (need > TM_MAX_RUN + 3.4) continue;   // hopeless reach, prefilter
        var slot = null, ri, ai;
        for (ri = 0; ri < Rs.length && !slot; ri++) {
          for (ai = 0; ai < As.length && !slot; ai++) {
            var ang = base + As[ai];
            var px = fx.toX + Math.sin(ang) * Rs[ri];
            var pz = fx.toZ + Math.cos(ang) * Rs[ri];
            if (Math.abs(px) > halfW - 0.9 || Math.abs(pz) > halfL - 0.9) continue;
            // 1.6 from every frozen player; already-planned mates count at
            // their SLOTS (they vacate their start spots) — slots sit as a
            // tight huddle, 1.15 shoulder spacing (players ~0.55 wide)
            var busy = false;
            for (j = 0; j < all.length && !busy; j++) {
              var o = all[j];
              if (!o || o === c.p) continue;
              var mate = null;
              for (var k = 0; k < out.length; k++) if (out[k].p === o) { mate = out[k]; break; }
              var ox = mate ? mate.toX : o.x, oz = mate ? mate.toZ : o.z;
              if ((ox - px) * (ox - px) + (oz - pz) * (oz - pz) <
                  (mate ? 1.15 : 1.6) * (mate ? 1.15 : 1.6)) busy = true;
            }
            if (busy) continue;
            var runX = px - c.p.x, runZ = pz - c.p.z;
            var runD = Math.sqrt(runX * runX + runZ * runZ);
            if (runD < TM_MIN_RUN || runD > TM_MAX_RUN) continue;
            // path: static clearance vs frozen players (vacating mates
            // checked against their future slot), no crossing of the
            // scorer's own run
            var ok = true;
            for (j = 0; j < all.length && ok; j++) {
              var q = all[j];
              if (!q || q === c.p) continue;
              var mateQ = null;
              for (var k2 = 0; k2 < out.length; k2++) if (out[k2].p === q) { mateQ = out[k2]; break; }
              var clear = mateQ ? 0.85 : PATH_CLEAR_TM;
              if (segDist(mateQ ? mateQ.toX : q.x, mateQ ? mateQ.toZ : q.z,
                          c.p.x, c.p.z, px, pz) < clear) ok = false;
            }
            if (ok && segSeg(c.p.x, c.p.z, px, pz, fx.fromX, fx.fromZ, fx.toX, fx.toZ) < PATH_CLEAR_SC) ok = false;
            if (!ok) continue;
            slot = { x: px, z: pz, d: runD };
          }
        }
        if (!slot) continue;
        // clip probe last: accepted mates only disturb their own controller
        var dur = runClipDur(c.p.model.anim);
        if (!dur) continue;
        var start = TM_START + out.length * TM_STAG;
        out.push({
          p: c.p,
          fromX: c.p.x, fromZ: c.p.z,
          toX: slot.x, toZ: slot.z,
          dist: slot.d,
          clipDur: dur,
          start: start,
          end: TM_END,
          speed: slot.d / (TM_END - start),
          runFace: Math.atan2(slot.x - c.p.x, slot.z - c.p.z),
          faceSlot: Math.atan2(fx.toX - slot.x, fx.toZ - slot.z),
          dead: false,
        });
      }
      return out;
    } catch (e) {
      warn('plan mates: ' + (e && e.message));
      return [];
    }
  }

  // Per-frame mate control, mirrors presentScorer: ease to the slot with
  // the run cycle pinned every frame, then pin spot + face the scorer.
  // Any per-mate failure releases only that mate (camera + scorer intact).
  function presentTeammates(dt) {
    var fx = tmFx;
    if (!fx || !fx.length) return;
    for (var i = 0; i < fx.length; i++) {
      var tm = fx[i];
      if (tm.dead || t < tm.start) continue;
      try {
        var p = tm.p;
        if (!p.model || !p.model.group) { tm.dead = true; continue; }
        if (t < tm.end) {
          var u = (t - tm.start) / (tm.end - tm.start);
          var e = u * u * (3 - 2 * u);
          p.x = tm.fromX + (tm.toX - tm.fromX) * e;
          p.z = tm.fromZ + (tm.toZ - tm.fromZ) * e;
          p.facing = tm.runFace;
          if (p.model.body) p.model.body.rotation.x = 0;
          var cyc = (1.8 + tm.speed * 0.35) / 2;
          var pt = ((t - tm.start) * cyc * tm.clipDur) % tm.clipDur;
          if (p.model.anim.pose('run', pt) === false) throw new Error('run pose unavailable');
        } else {
          p.x = tm.toX;
          p.z = tm.toZ;
          p.facing = tm.faceSlot;
        }
        p.vx = 0;
        p.vz = 0;
        p.model.group.position.set(p.x, p.y || 0, p.z);
        p.model.group.rotation.y = p.facing;
      } catch (err) {
        warn('mate presentation off: ' + (err && err.message));
        tm.dead = true;
        try { tm.p.vx = 0; tm.p.vz = 0; } catch (e2) {}
      }
    }
  }

  // Release every mate: velocities zeroed (belt and braces), plan dropped.
  function releaseTeammates() {
    if (tmFx) {
      for (var i = 0; i < tmFx.length; i++) {
        try { tmFx[i].p.vx = 0; tmFx[i].p.vz = 0; } catch (e) {}
      }
    }
    tmFx = null;
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

  function state() {
    var mp = [];
    if (tmFx) {
      for (var i = 0; i < tmFx.length; i++) {
        if (!tmFx[i].dead) mp.push({ x: tmFx[i].p.x, z: tmFx[i].p.z });
      }
    }
    return {
      active: active, t: t, dur: T, w: w,
      mates: tmFx ? tmFx.length : 0,
      matePos: mp,
      look: lastLook,
    };
  }

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
