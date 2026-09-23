// ============================================================
// CELEBRATION — lightweight goal celebration choreography.
// Pure presentation: never touches score, timer, ball physics,
// or AI decision-making. Uses a private LCG so the gameplay
// Math.random stream (seed-pinned sim tests) stays untouched.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Celebration = (function () {
  // private deterministic PRNG — celebration picks never touch Math.random
  var _s = 0xC0FFEE;
  function prand() {
    _s = (_s * 1664525 + 1013904223) >>> 0;
    return _s / 4294967296;
  }

  // A arms-up | B huddle | C slide | D point | E signature | F group | G calm
  var TYPES = ['arms', 'huddle', 'slide', 'point', 'signature', 'group', 'calm'];
  var recent = [];          // short history so the same type never repeats back-to-back
  var current = null;       // active celebration { type, t, dur, scorer, team }
  var sub = false;

  function pickType() {
    var pool = TYPES.slice();
    // drop the last pick (and the one before if pool allows) so no immediate repeat
    for (var i = 0; i < recent.length && pool.length > 1; i++) {
      var idx = pool.indexOf(recent[i]);
      if (idx >= 0 && pool.length > 2) pool.splice(idx, 1);
    }
    var t = pool[Math.floor(prand() * pool.length)] || 'arms';
    recent.unshift(t);
    if (recent.length > 2) recent.length = 2;
    return t;
  }

  function start(scorer, team, isOwnGoal) {
    // own goals: the conceding side still reacts, but no big choreography
    var type = isOwnGoal ? 'calm' : pickType();
    current = {
      type: type,
      t: 0,
      // street-football energy: short, never a cutscene
      dur: type === 'slide' ? 3.2 : (type === 'huddle' || type === 'group' ? 3.0 : 2.4) + prand() * 0.6,
      scorer: scorer || null,
      team: team,
      own: !!isOwnGoal,
    };
    return current;
  }

  function stop() { current = null; }

  // arm pose helpers — direct limb angles, no animation graph
  function armsUp(p, raise) {
    if (!p || !p.model || !p.model.limbs) return;
    var L = p.model.limbs;
    var target = raise ? -2.6 : 0;   // -2.6 rad ≈ arms overhead
    L.armL.rotation.x += (target - L.armL.rotation.x) * 0.25;
    L.armR.rotation.x += (target - L.armR.rotation.x) * 0.25;
    L.armL.rotation.z = raise ? -0.35 : 0;
    L.armR.rotation.z = raise ? 0.35 : 0;
  }

  function armsDown(p) {
    if (!p || !p.model || !p.model.limbs) return;
    var L = p.model.limbs;
    L.armL.rotation.x += (0.35 - L.armL.rotation.x) * 0.2;
    L.armR.rotation.x += (0.35 - L.armR.rotation.x) * 0.2;
    L.armL.rotation.z = 0; L.armR.rotation.z = 0;
  }

  function pointArm(p) {
    if (!p || !p.model || !p.model.limbs) return;
    var L = p.model.limbs;
    L.armR.rotation.x += (-1.5 - L.armR.rotation.x) * 0.3;
    L.armL.rotation.x += (0.2 - L.armL.rotation.x) * 0.2;
    L.armR.rotation.z = 0.2;
  }

  function handsOnHead(p) {
    if (!p || !p.model || !p.model.limbs) return;
    var L = p.model.limbs;
    L.armL.rotation.x += (-2.2 - L.armL.rotation.x) * 0.22;
    L.armR.rotation.x += (-2.2 - L.armR.rotation.x) * 0.22;
    L.armL.rotation.z = -0.5;
    L.armR.rotation.z = 0.5;
  }

  function nudgeToward(p, tx, tz, speed, dt) {
    if (!p) return;
    var dx = tx - p.x, dz = tz - p.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.15) { p.vx *= 0.8; p.vz *= 0.8; return; }
    var sp = Math.min(speed, d / Math.max(dt, 0.001));
    // set want so the normal integrate path moves them (no physics rewrite)
    p.want.x = (dx / d);
    p.want.z = (dz / d);
    p.vx = (dx / d) * Math.min(p.maxSpeed, sp);
    p.vz = (dz / d) * Math.min(p.maxSpeed, sp);
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.facing = Math.atan2(p.vx, p.vz);
    if (p.model && p.model.group) p.model.group.position.set(p.x, p.y || 0, p.z);
  }

  function resetPose(p) {
    if (!p || !p.model || !p.model.limbs) return;
    var L = p.model.limbs;
    L.armL.rotation.x = 0; L.armR.rotation.x = 0;
    L.armL.rotation.z = 0; L.armR.rotation.z = 0;
    if (p.model.body) p.model.body.rotation.x = 0;
  }

  // Advance the active celebration. Safe to call every frame during GOAL.
  // match.players are frozen by updatePlayers(0); this only layers poses/moves.
  function update(match, dt) {
    if (!current || !match) return;
    current.t += dt;
    if (current.t >= current.dur) { stop(); return; }

    var t = current.t;
    var scorer = current.scorer;
    var winTeam = match.teamPlayers(current.team);
    var loseTeam = match.teamPlayers(1 - current.team);
    var i, p;

    // ---- scorer choreography ----
    if (scorer && scorer.team === current.team && !current.own) {
      switch (current.type) {
        case 'arms':
          armsUp(scorer, true);
          break;
        case 'slide':
          // short knee-slide: drop body pitch + travel forward a touch
          if (scorer.model && scorer.model.body) scorer.model.body.rotation.x = 0.45;
          if (t < 1.2) {
            var sdir = scorer.facing;
            scorer.x += Math.sin(sdir) * 2.4 * dt;
            scorer.z += Math.cos(sdir) * 2.4 * dt;
            if (scorer.model && scorer.model.group) scorer.model.group.position.set(scorer.x, 0, scorer.z);
          }
          armsUp(scorer, t < 1.8);
          break;
        case 'point':
          pointArm(scorer);
          // turn toward the nearest crowd side (away from pitch centre)
          scorer.facing += (Math.PI * 0.5 - scorer.facing) * 0.08;
          break;
        case 'signature':
          // signature: arms-up then a little spin
          armsUp(scorer, true);
          scorer.facing += 2.8 * dt;
          if (scorer.model && scorer.model.group) scorer.model.group.rotation.y = scorer.facing;
          break;
        case 'group':
        case 'huddle':
          // move toward the average of nearby mates
          {
            var cx = 0, cz = 0, n = 0;
            for (i = 0; i < winTeam.length; i++) {
              p = winTeam[i];
              if (p === scorer || p.isGoalkeeper) continue;
              cx += p.x; cz += p.z; n++;
            }
            if (n > 0) {
              cx /= n; cz /= n;
              nudgeToward(scorer, cx, cz, 3.2, dt);
            }
            armsUp(scorer, true);
          }
          break;
        case 'calm':
        default:
          armsDown(scorer);
          // subtle head-lift via body pitch
          if (scorer.model && scorer.model.body) scorer.model.body.rotation.x = -0.08;
          break;
      }
    }

    // ---- teammates ----
    for (i = 0; i < winTeam.length; i++) {
      p = winTeam[i];
      if (p === scorer) continue;
      if (p.isGoalkeeper) { armsUp(p, t > 0.3 && t < current.dur - 0.4); continue; }
      if (current.type === 'huddle' || current.type === 'group') {
        if (scorer) nudgeToward(p, scorer.x + (p.idx - 1) * 0.9, scorer.z + 0.6, 3.0, dt);
        armsUp(p, true);
      } else if (current.type === 'calm') {
        armsDown(p);
        p.facing = scorer ? Math.atan2(scorer.x - p.x, scorer.z - p.z) : p.facing;
      } else {
        armsUp(p, t > 0.25 && t < current.dur - 0.3);
        // face the scorer / action
        if (scorer) p.facing += (Math.atan2(scorer.x - p.x, scorer.z - p.z) - p.facing) * 0.1;
      }
      if (p.model && p.model.group) {
        p.model.group.position.set(p.x, p.y || 0, p.z);
        p.model.group.rotation.y = p.facing;
      }
    }

    // ---- losing side: disappointment (varied, not identical) ----
    for (i = 0; i < loseTeam.length; i++) {
      p = loseTeam[i];
      if (p.isGoalkeeper) {
        // keeper who conceded: crouch then stand — no running off
        if (t < 1.4) {
          if (p.model && p.model.body) p.model.body.rotation.x = 0.35;
          armsDown(p);
        } else {
          if (p.model && p.model.body) p.model.body.rotation.x = 0;
          // walk back toward own goal
          var gkHome = match.myGoal(p.team);
          nudgeToward(p, gkHome.x * 0.3, gkHome.z * 0.85, 2.0, dt);
        }
      } else {
        var mode = (p.idx + current.team) % 3;
        if (mode === 0) handsOnHead(p);
        else if (mode === 1) armsDown(p);
        else {
          // turn away briefly
          armsDown(p);
          p.facing += 0.4 * dt;
        }
        if (p.model && p.model.group) {
          p.model.group.position.set(p.x, p.y || 0, p.z);
          p.model.group.rotation.y = p.facing;
        }
      }
    }
  }

  function clearPoses(match) {
    if (!match || !match.all) return;
    for (var i = 0; i < match.all.length; i++) resetPose(match.all[i]);
  }

  function bind() {
    if (sub || !LG.eventBus || !LG.eventBus.on) return;
    // stop cleanly when the match restarts / ends so no stale pose survives
    LG.eventBus.on('kickoff', function () { stop(); });
    LG.eventBus.on('matchStart', function () { stop(); });
    LG.eventBus.on('matchEnd', function () { stop(); });
    sub = true;
  }

  return {
    start: start,
    stop: stop,
    update: update,
    clearPoses: clearPoses,
    bind: bind,
    get current() { return current; },
    TYPES: TYPES,
  };
})();
