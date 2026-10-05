// ============================================================
// CELEBRATION — lightweight goal celebration choreography (3D.6).
// Pure presentation: never touches score, timer, ball physics,
// or AI decision-making. Uses a private LCG so the gameplay
// Math.random stream (seed-pinned sim tests) stays untouched.
//
// 3D.6 variety, all decided ONCE per goal (never per frame):
//  * variant — 6 active types + the 'calm' fallback (own goals /
//    reduced motion), picked with a 2-back anti-repeat.
//  * reaction roles — assigned on the first update frame:
//    close teammates react strong, distant ones react weak and
//    stationary (never travel), keepers get their own beats, and
//    the conceding side gets four distinct disappointment roles.
//  * point target — the assist (or nearest mate) is captured as
//    {x,z} so the scorer faces the saluted player AND the goal
//    cinematic can frame them (3D.6 camera hook).
// Micro-motion is deterministic (fixed phase offsets from idx —
// no RNG after start()), cheap, and applied through the existing
// limb/pitch helpers. Every helper guards missing model/limbs, so
// a failure drops a single reaction, never the celebration.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Celebration = (function () {
  // private deterministic PRNG — celebration picks never touch Math.random
  var _s = 0xC0FFEE;
  function prand() {
    _s = (_s * 1664525 + 1013904223) >>> 0;
    return _s / 4294967296;
  }

  // arms | wide | slide | point | signature | huddle | calm (fallback)
  var TYPES = ['arms', 'wide', 'slide', 'point', 'signature', 'huddle', 'calm'];
  var ACTIVE = ['arms', 'wide', 'slide', 'point', 'signature', 'huddle'];
  // conceding-field roles: varied disappointment, idx-based (stable per player)
  var DEF_ROLES = ['ldown', 'lhips', 'lturn', 'lstare'];
  var CLOSE_D = 6;            // within 6m of the scorer => strong reaction
  var recent = [];            // 2-back history so a type never repeats close
  var current = null;         // active celebration { type, t, dur, scorer, team, ... }
  var sub = false;            // bus listeners registered once

  function pickType() {
    var pool = ACTIVE.slice();
    // drop the last two picks so neither can come back immediately
    for (var i = 0; i < recent.length && pool.length > 2; i++) {
      var idx = pool.indexOf(recent[i]);
      if (idx >= 0) pool.splice(idx, 1);
    }
    var t = pool[Math.floor(prand() * pool.length)] || 'arms';
    recent.unshift(t);
    if (recent.length > 2) recent.length = 2;
    return t;
  }

  function durFor(type) {
    if (type === 'slide') return 3.2;      // gather + slide + rise
    if (type === 'huddle') return 3.0;
    if (type === 'signature') return 2.8;
    if (type === 'wide') return 2.7;
    return 2.4;                            // arms / point / calm
  }

  // Pick the variant ONCE, here. Own goals and reduced motion always get
  // the quiet 'calm' fallback. Durations stay street-football short.
  function start(scorer, team, isOwnGoal) {
    var type = 'calm';
    if (!isOwnGoal) {
      var rm = false;
      try { rm = !!(LG.Settings && LG.Settings.reducedMotion && LG.Settings.reducedMotion()); } catch (e) {}
      type = rm ? 'calm' : pickType();
    }
    current = {
      type: type,
      t: 0,
      dur: durFor(type) + prand() * 0.6,
      scorer: scorer || null,
      team: team,
      own: !!isOwnGoal,
      assist: null,     // attached from the 'goal' event (see bind)
      pointAt: null,    // {x,z} saluted player — also read by the camera
      roles: null,      // reaction roles, assigned once on first update
    };
    return current;
  }

  function stop() { current = null; }

  // ---- pose helpers — direct limb angles, no animation graph ----

  function limbs(p) { return (p && p.model && p.model.limbs) || null; }

  // arms overhead. Optional micro-motion (deterministic phase ph) keeps the
  // hold alive; depth scales the raise for weaker distant reactions.
  function armsUp(p, raise, t, ph, depth) {
    var L = limbs(p);
    if (!L) return;
    var target = raise ? -2.6 * (depth || 1) : 0;
    if (raise && t !== undefined) target += Math.sin(t * 6.5 + (ph || 0)) * 0.07;
    L.armL.rotation.x += (target - L.armL.rotation.x) * 0.25;
    L.armR.rotation.x += (target - L.armR.rotation.x) * 0.25;
    L.armL.rotation.z = raise ? -0.35 : 0;
    L.armR.rotation.z = raise ? 0.35 : 0;
  }

  function armsDown(p) {
    var L = limbs(p);
    if (!L) return;
    L.armL.rotation.x += (0.35 - L.armL.rotation.x) * 0.2;
    L.armR.rotation.x += (0.35 - L.armR.rotation.x) * 0.2;
    L.armL.rotation.z = 0;
    L.armR.rotation.z = 0;
  }

  // both arms flung wide + a small chest lift — readable from the hero cam
  function armsWide(p, t, ph) {
    var L = limbs(p);
    if (!L) return;
    var bob = (t === undefined) ? 0 : Math.sin(t * 5.5 + (ph || 0)) * 0.08;
    L.armL.rotation.x += (-1.75 + bob - L.armL.rotation.x) * 0.25;
    L.armR.rotation.x += (-1.75 + bob - L.armR.rotation.x) * 0.25;
    L.armL.rotation.z += (0.95 - L.armL.rotation.z) * 0.25;    // elbows out
    L.armR.rotation.z += (-0.95 - L.armR.rotation.z) * 0.25;
    if (p.model.body) p.model.body.rotation.x += (-0.12 - p.model.body.rotation.x) * 0.18;
  }

  function pointArm(p) {
    var L = limbs(p);
    if (!L) return;
    L.armR.rotation.x += (-1.5 - L.armR.rotation.x) * 0.3;
    L.armL.rotation.x += (0.2 - L.armL.rotation.x) * 0.2;
    L.armR.rotation.z = 0.2;
  }

  function handsOnHead(p) {
    var L = limbs(p);
    if (!L) return;
    L.armL.rotation.x += (-2.2 - L.armL.rotation.x) * 0.22;
    L.armR.rotation.x += (-2.2 - L.armR.rotation.x) * 0.22;
    L.armL.rotation.z = -0.5;
    L.armR.rotation.z = 0.5;
  }

  // hands planted on the hips — elbows out, arms otherwise down
  function handsHips(p) {
    var L = limbs(p);
    if (!L) return;
    L.armL.rotation.x += (0.12 - L.armL.rotation.x) * 0.22;
    L.armR.rotation.x += (0.12 - L.armR.rotation.x) * 0.22;
    L.armL.rotation.z += (0.5 - L.armL.rotation.z) * 0.22;
    L.armR.rotation.z += (-0.5 - L.armR.rotation.z) * 0.22;
  }

  // spine pitch — the only body channel celebrations own (guard everywhere)
  function pitch(p, v) {
    if (!p || !p.model || !p.model.body) return;
    p.model.body.rotation.x += (v - p.model.body.rotation.x) * 0.2;
  }

  // legs: presentation-only bend/extend (knee-slide approx). Safe because
  // celebration.update runs AFTER the anim controller each GOAL frame —
  // and clearPoses resets them before kickoff.
  function legs(p, a, b) {
    var L = limbs(p);
    if (!L) return;
    if (L.legL) L.legL.rotation.x += (a - L.legL.rotation.x) * 0.2;
    if (L.legR) L.legR.rotation.x += (b - L.legR.rotation.x) * 0.2;
  }

  // tiny deterministic body bob so a hold never looks frozen
  function breathe(p, t, ph) {
    if (!p || !p.model || !p.model.body) return;
    p.model.body.rotation.x = Math.sin(t * 7 + (ph || 0)) * 0.045;
  }

  // turn toward a world point (kept subtle so players never whip around)
  function faceToward(p, tx, tz, k) {
    if (!p) return;
    var a = Math.atan2(tx - p.x, tz - p.z);
    p.facing += (a - p.facing) * k;
    if (p.model && p.model.group) p.model.group.rotation.y = p.facing;
  }

  // Travel is disabled: there is no celebration locomotion clip, so moving a
  // body only glides it under an idle/stop animation. Call sites keep their
  // choreography (gather/return points) — only the translation is dropped.
  // Belt and braces: also zeroes the presentation velocities.
  function nudgeToward(p, tx, tz, speed, dt) {
    if (!p) return;
    p.vx = 0;
    p.vz = 0;
  }

  function resetPose(p) {
    var L = limbs(p);
    if (L) {
      L.armL.rotation.x = 0; L.armR.rotation.x = 0;
      L.armL.rotation.z = 0; L.armR.rotation.z = 0;
      if (L.legL) L.legL.rotation.x = 0;
      if (L.legR) L.legR.rotation.x = 0;
    }
    if (p && p.model && p.model.body) p.model.body.rotation.x = 0;
  }

  // ---- per-goal assignment (runs once, on the first update frame) ----

  function assign(match) {
    var cur = current;
    if (!cur || cur.roles) return;
    var roles = [];
    var all = (match && match.all) || [];
    var s = cur.scorer, i, p, dx, dz;
    try {
      // point target: the assist when it is a real teammate, else the
      // nearest outfield teammate. Stored as plain {x,z} so the cinematic
      // can read it without touching player objects.
      if (cur.type === 'point' && s) {
        var tgt = null;
        if (cur.assist && cur.assist !== s && cur.assist.team === s.team &&
            !cur.assist.isGoalkeeper) tgt = cur.assist;
        if (!tgt) {
          var best = 1e9;
          for (i = 0; i < all.length; i++) {
            p = all[i];
            if (!p || p === s || p.team !== s.team || p.isGoalkeeper) continue;
            dx = p.x - s.x; dz = p.z - s.z;
            var d2 = dx * dx + dz * dz;
            if (d2 < best) { best = d2; tgt = p; }
          }
        }
        if (tgt) cur.pointAt = { x: tgt.x, z: tgt.z };
      }
      for (i = 0; i < all.length; i++) {
        p = all[i];
        if (!p) continue;
        var role = null;
        if (p.team === cur.team) {
          if (p === s) continue;                 // the scorer runs its variant
          if (p.isGoalkeeper) role = 'wkeep';    // scoring keeper: small + late
          else if (cur.own) role = 'own';        // own-goal shrug, no big choreo
          else if (s) {
            dx = p.x - s.x; dz = p.z - s.z;
            role = (dx * dx + dz * dz) <= CLOSE_D * CLOSE_D ? 'close' : 'far';
          } else role = 'far';
        } else {
          if (p.isGoalkeeper) role = 'lkeep';    // conceding keeper: strongest
          else role = DEF_ROLES[(p.idx | 0) % DEF_ROLES.length];
        }
        if (role) roles.push({ p: p, role: role });
      }
    } catch (e) { /* partial roles still beat none */ }
    cur.roles = roles;
  }

  function roleOf(p) {
    var rs = current && current.roles;
    if (!rs || !p) return null;
    for (var i = 0; i < rs.length; i++) if (rs[i].p === p) return rs[i].role;
    return null;
  }

  function syncGroup(p) {
    if (p && p.model && p.model.group) {
      p.model.group.position.set(p.x, p.y || 0, p.z);
      p.model.group.rotation.y = p.facing;
    }
  }

  // Advance the active celebration. Safe to call every frame during GOAL.
  // match.players are frozen by updatePlayers(0); this only layers poses —
  // no celebration body travels (there is no locomotion clip to play).
  function update(match, dt) {
    if (!current || !match) return;
    current.t += dt;
    if (current.t >= current.dur) { stop(); return; }
    if (!current.roles) assign(match);   // roles + point target: once per goal

    var t = current.t;
    var scorer = current.scorer;
    var winTeam = match.teamPlayers(current.team);
    var loseTeam = match.teamPlayers(1 - current.team);
    var i, p, ph;

    // ---- scorer choreography (variant picked once in start()) ----
    if (scorer && scorer.team === current.team && !current.own) {
      ph = ((scorer.idx || 0) + current.team) * 1.7;
      switch (current.type) {
        case 'arms':
          armsUp(scorer, true, t, ph);
          break;
        case 'wide':
          armsWide(scorer, t, ph);
          break;
        case 'slide': {
          // knee-slide approximation — presentation only, zero travel:
          // gather, drop into a leaning slide with the legs out, rise.
          var low = t > 0.35 && t < current.dur - 0.55;
          if (low) {
            pitch(scorer, 0.42);
            legs(scorer, -0.8, -0.55);
            var LS = limbs(scorer);
            if (LS) {
              LS.armL.rotation.x += (-1.5 - LS.armL.rotation.x) * 0.25;
              LS.armR.rotation.x += (-1.5 - LS.armR.rotation.x) * 0.25;
              LS.armL.rotation.z += (0.7 - LS.armL.rotation.z) * 0.25;
              LS.armR.rotation.z += (-0.7 - LS.armR.rotation.z) * 0.25;
            }
          } else {
            pitch(scorer, t <= 0.35 ? 0.15 : 0.04);
            legs(scorer, t <= 0.35 ? -0.3 : -0.1, t <= 0.35 ? -0.15 : -0.05);
            armsUp(scorer, t < 0.5, t, ph);
          }
          break;
        }
        case 'point': {
          var pa = current.pointAt;
          if (pa) faceToward(scorer, pa.x, pa.z, 0.12);
          pointArm(scorer);
          break;
        }
        case 'signature':
          // signature: arms-up then a little spin (the cinematic knows to
          // leave this variant's facing to us — see goal-cinematic.js)
          armsUp(scorer, true, t, ph);
          scorer.facing += 2.8 * dt;
          if (scorer.model && scorer.model.group) scorer.model.group.rotation.y = scorer.facing;
          break;
        case 'huddle':
        case 'group':
          // scorer stays central while the band gathers (travel disabled)
          armsUp(scorer, true, t, ph);
          pitch(scorer, Math.sin(t * 7.5 + ph) * 0.05);
          break;
        case 'calm':
        default:
          armsDown(scorer);
          pitch(scorer, -0.08);
          break;
      }
    }

    // ---- winning side: role-based reactions (assigned once) ----
    for (i = 0; i < winTeam.length; i++) {
      p = winTeam[i];
      if (p === scorer) continue;
      ph = ((p.idx || 0) + current.team * 3) * 1.7;
      var role = roleOf(p);
      if (role === 'wkeep') {
        // scoring keeper: a small, late raise — not part of the band
        armsUp(p, t > 0.5 && t < current.dur - 0.4, t, ph, 0.8);
        if (scorer) faceToward(p, scorer.x, scorer.z, 0.06);
      } else if (current.type === 'huddle' || current.type === 'group') {
        armsUp(p, true, t, ph);
        breathe(p, t, ph);
        if (scorer) faceToward(p, scorer.x, scorer.z, 0.1);
      } else if (current.type === 'calm' || role === 'own') {
        armsDown(p);
        if (scorer) faceToward(p, scorer.x, scorer.z, 0.08);
      } else if (role === 'close') {
        // strong + immediate; the cinematic may have run them into a slot
        var mode = (p.idx + current.team) % 3;
        if (mode === 1) {
          armsWide(p, t, ph);
          if (scorer) faceToward(p, scorer.x, scorer.z, 0.1);
        } else if (mode === 2) {
          pointArm(p);
          if (scorer) faceToward(p, scorer.x, scorer.z, 0.12);
        } else {
          armsUp(p, true, t, ph);
          if (scorer) faceToward(p, scorer.x, scorer.z, 0.1);
        }
        breathe(p, t, ph);
      } else {
        // far / stationary: weaker (depth 0.75), later, never travels
        var on = t > 0.45 && t < current.dur - 0.5;
        if ((p.idx % 2) === 0) armsUp(p, on, t, ph, 0.75);
        else if (p.model && p.model.body) p.model.body.rotation.x = on ? Math.sin(t * 5 + ph) * 0.06 : 0;
        if ((p.idx % 2) !== 0) armsDown(p);
        if (scorer) faceToward(p, scorer.x, scorer.z, 0.08);
      }
      syncGroup(p);
    }

    // ---- losing side: disappointment (four distinct roles + keeper) ----
    for (i = 0; i < loseTeam.length; i++) {
      p = loseTeam[i];
      ph = ((p.idx || 0) * 2.3 + 1.1);
      var lrole = roleOf(p);
      if (lrole === 'lkeep') {
        // conceding keeper: brief fold toward the net, then reset
        if (t < 1.3) {
          handsOnHead(p);
          pitch(p, 0.3);
          try {
            var ng = match.enemyGoal(current.team);   // the net they defend
            if (ng) faceToward(p, ng.x, ng.z, 0.07);
          } catch (e) {}
        } else {
          armsDown(p);
          pitch(p, 0);
        }
        p.vx = 0;
        p.vz = 0;
      } else if (lrole === 'ldown') {
        handsOnHead(p);
        pitch(p, 0.24);                 // head lowered
      } else if (lrole === 'lhips') {
        handsHips(p);
        pitch(p, -0.05);
      } else if (lrole === 'lturn') {
        armsDown(p);
        p.facing += 0.4 * dt;           // slowly turns away
      } else {
        armsDown(p);
        pitch(p, -0.06);
        if (scorer) faceToward(p, scorer.x, scorer.z, 0.07);  // stares at it
      }
      syncGroup(p);
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
    // the assist only exists on the emitted event — attach it once; the
    // point variant's camera + facing both read current.pointAt later
    LG.eventBus.on('goal', function (g) {
      if (current && g && g.assist && !current.assist) current.assist = g.assist;
    });
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
    ACTIVE: ACTIVE,
  };
})();
