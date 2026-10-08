// ============================================================
// REACTIONS — Phase 8: light, event-driven player reactions.
//
// A presentation-only layer sitting ON TOP of the existing player
// pipeline. The AnimationMixer still owns locomotion; reactions layer
// a short deterministic pose over it using the same write-after-
// `player.update` contract celebration.js uses during GOAL, then hand
// back by releasing to the pre-reaction rest and letting the mixer
// take over again (no sticky bones, no second animation architecture).
//
// Layer contract (Phase 8):
//  * EVENT-DRIVEN — bus hooks decide what starts; update() only
//    advances timers and poses. No per-frame gameplay polling.
//  * priority + duration + per-player cooldowns — no reaction spam;
//    a stronger reaction may interrupt a weaker one, never reverse.
//  * never overrides gameplay — zero writes to velocity/position/
//    physics/AI; nothing starts while a kick is in progress
//    (kickAnim) and an active reaction drops the instant a kick
//    begins; the layer stands down entirely during GOAL
//    (celebration owns the frame) and hard-clears on kickoff /
//    matchStart / goal / KICKOFF state.
//  * deterministic variation from an idx hash — no random draws
//    anywhere, the seed-pinned sim stream stays untouched.
//  * reduced motion: shorter + weaker, never disabled.
//  * every helper guards missing model/limbs — a failure drops the
//    single reaction, never the frame.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Reactions = (function () {
  // per-kind tuning: pri = interruption priority, dur = hold seconds,
  // cd = per-player cooldown after the reaction starts
  var KINDS = {
    fatigue:    { pri: 20, dur: 1.6,  cd: 8.0 },   // exhausted, standing still
    possession: { pri: 30, dur: 0.6,  cd: 1.2 },   // won / lost the ball
    miss:       { pri: 40, dur: 1.3,  cd: 3.0 },   // shot off target
    matchEnd:   { pri: 45, dur: 1.9,  cd: 9.0 },   // full-time reactions
    hit:        { pri: 50, dur: 0.5,  cd: 1.4 },   // knocked by a tackle
    tackle:     { pri: 55, dur: 0.55, cd: 1.6 },   // won a tackle
    save:       { pri: 60, dur: 0.85, cd: 2.0 },   // goalkeeper save
    release:    { pri: 1,  dur: 0.3,  cd: 0 }      // hand back to the mixer
  };
  var RELEASE_K = 13;          // smoothing rate of the hand-back
  var ABORT_SPD2 = 1.3 * 1.3;  // a player this mobile drops a weak reaction

  var _sub = false;
  var _m = null;               // the live match (attach() keeps it fresh)
  var _now = 0;                // layer clock, advanced inside update()
  var _shot = null;            // pending shot awaiting a miss resolution
  var _shotBy = null;          // shooter of the current/last shot
  var _shotAt = -99;
  var _carrier = null;         // player of the previous possession event
  var _carrierTeam = -1;
  var _fatT = 0;

  // ---- small deterministic helpers (no random draws, ever) ----

  function hash(i) {
    var h = ((i | 0) * 2654435761) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0;
    return (h % 997) / 997;
  }

  function reduced() {
    try {
      return !!(LG.Settings && LG.Settings.reducedMotion && LG.Settings.reducedMotion());
    } catch (e) { return false; }
  }

  function limbs(p) { return (p && p.model && p.model.limbs) || null; }
  function bodyOf(p) { return (p && p.model && p.model.body) || null; }

  // frame-rate independent smoothing (headless browsers run 1-3 fps —
  // a fixed per-frame lerp would never converge there)
  function sm(cur, target, k, dt) {
    return cur + (target - cur) * (1 - Math.exp(-k * dt));
  }

  function speed2(p) {
    var vx = p.vx || 0, vz = p.vz || 0;
    return vx * vx + vz * vz;
  }

  // ---- rest capture / release -----------------------------------
  // The rest is grabbed BEFORE the first pose write of a reaction, so a
  // channel the mixer does not drive (the GLB body group) still lands
  // back exactly where it started when the reaction clears.

  function grabRest(p) {
    var L = limbs(p), b = bodyOf(p);
    var r = { ok: false, armLx: 0, armLz: 0, armRx: 0, armRz: 0, legLx: 0, legRx: 0, pitch: 0 };
    if (L && L.armL && L.armR) {
      r.ok = true;
      r.armLx = L.armL.rotation.x;
      r.armLz = L.armL.rotation.z;
      r.armRx = L.armR.rotation.x;
      r.armRz = L.armR.rotation.z;
      r.legLx = L.legL ? L.legL.rotation.x : 0;
      r.legRx = L.legR ? L.legR.rotation.x : 0;
    }
    if (b) r.pitch = b.rotation.x;
    return r;
  }

  function applyRest(p, r) {
    if (!r || !r.ok) return;
    var L = limbs(p), b = bodyOf(p);
    if (L && L.armL && L.armR) {
      L.armL.rotation.x = r.armLx;
      L.armL.rotation.z = r.armLz;
      L.armR.rotation.x = r.armRx;
      L.armR.rotation.z = r.armRz;
      if (L.legL) L.legL.rotation.x = r.legLx;
      if (L.legR) L.legR.rotation.x = r.legRx;
    }
    if (b) b.rotation.x = r.pitch;
  }

  function beginRelease(p) {
    var rx = p._rx;
    var rel = {
      kind: 'release', t: 0, dur: KINDS.release.dur, pri: KINDS.release.pri,
      delay: 0, amp: 1, data: null,
      rest: (rx && rx.rest) || grabRest(p)
    };
    p._rx = rel;
    return rel;
  }

  function hardClear(p) {
    if (!p || !p._rx) return;
    if (p._rx.rest) applyRest(p, p._rx.rest);
    p._rx = null;
  }

  function clearAll() {
    if (_m && _m.all) {
      for (var i = 0; i < _m.all.length; i++) hardClear(_m.all[i]);
    }
    _shot = null;
    _shotBy = null;
    _shotAt = -99;
    _carrier = null;
    _carrierTeam = -1;
  }

  // ---- starting a reaction --------------------------------------

  function start(p, kind, opts) {
    try {
      var K = KINDS[kind];
      if (!K || !p || !p.model) return false;
      if (p.kickAnim > 0) return false;              // the kick owns the body
      opts = opts || null;
      var rx = p._rx;
      if (rx && rx.kind !== 'release') {
        if (K.pri < rx.pri) return false;            // stronger holds the body
        if (K.pri === rx.pri && rx.t < rx.dur * 0.55) return false;
      }
      if (!p._rxcd) p._rxcd = {};
      if (_now < (p._rxcd[kind] || 0)) return false; // per-player cooldown
      p._rxcd[kind] = _now + K.cd;
      var slow = reduced();
      var dur = opts && opts.dur ? Math.min(6, opts.dur) : K.dur * (slow ? 0.6 : 1);
      p._rx = {
        kind: kind,
        t: 0,
        dur: dur,
        delay: (opts && opts.delay) || 0,
        pri: K.pri,
        amp: ((opts && opts.amp != null) ? opts.amp : 1) * (slow ? 0.55 : 1),
        data: (opts && opts.data) || null,
        // keep the ORIGINAL pre-reaction rest across interrupts — recapturing
        // mid-pose would strand the GLB body group on a stale pitch
        rest: (rx && rx.rest) ? rx.rest : null
      };
      return true;
    } catch (e) { return false; }
  }

  // ---- pose helpers (celebration conventions, dt-smoothed) ------

  function armRaise(L, x, zl, zr, k, dt) {
    L.armL.rotation.x = sm(L.armL.rotation.x, x, k, dt);
    L.armR.rotation.x = sm(L.armR.rotation.x, x, k, dt);
    L.armL.rotation.z = sm(L.armL.rotation.z, zl, k, dt);
    L.armR.rotation.z = sm(L.armR.rotation.z, zr, k, dt);
  }

  function armsX(L, x, k, dt) {
    L.armL.rotation.x = sm(L.armL.rotation.x, x, k, dt);
    L.armR.rotation.x = sm(L.armR.rotation.x, x, k, dt);
  }

  function handsHead(L, A, k, dt) {
    armRaise(L, -2.2 * A, -0.5 * A, 0.5 * A, k, dt);
  }

  function handsHips(L, A, k, dt) {
    L.armL.rotation.x = sm(L.armL.rotation.x, 0.12 * A, k, dt);
    L.armR.rotation.x = sm(L.armR.rotation.x, 0.12 * A, k, dt);
    L.armL.rotation.z = sm(L.armL.rotation.z, 0.5 * A, k, dt);
    L.armR.rotation.z = sm(L.armR.rotation.z, -0.5 * A, k, dt);
  }

  function armsWide(L, A, k, dt) {
    L.armL.rotation.x = sm(L.armL.rotation.x, -1.75 * A, k, dt);
    L.armR.rotation.x = sm(L.armR.rotation.x, -1.75 * A, k, dt);
    L.armL.rotation.z = sm(L.armL.rotation.z, 0.95 * A, k, dt);
    L.armR.rotation.z = sm(L.armR.rotation.z, -0.95 * A, k, dt);
  }

  function pointArm(L, A, k, dt) {
    L.armR.rotation.x = sm(L.armR.rotation.x, -1.5 * A, k, dt);
    L.armR.rotation.z = sm(L.armR.rotation.z, 0.2, k, dt);
    L.armL.rotation.x = sm(L.armL.rotation.x, 0.22, k, dt);
  }

  function pitch(p, b, v, k, dt) {
    if (b) b.rotation.x = sm(b.rotation.x, v, k, dt);
  }

  function legs(L, a, b2, k, dt) {
    if (L.legL) L.legL.rotation.x = sm(L.legL.rotation.x, a, k, dt);
    if (L.legR) L.legR.rotation.x = sm(L.legR.rotation.x, b2, k, dt);
  }

  function poseRelease(p, rx, dt) {
    var r = rx.rest;
    if (!r || !r.ok) return;
    var L = limbs(p), b = bodyOf(p);
    if (L && L.armL && L.armR) {
      L.armL.rotation.x = sm(L.armL.rotation.x, r.armLx, RELEASE_K, dt);
      L.armL.rotation.z = sm(L.armL.rotation.z, r.armLz, RELEASE_K, dt);
      L.armR.rotation.x = sm(L.armR.rotation.x, r.armRx, RELEASE_K, dt);
      L.armR.rotation.z = sm(L.armR.rotation.z, r.armRz, RELEASE_K, dt);
      if (L.legL) L.legL.rotation.x = sm(L.legL.rotation.x, r.legLx, RELEASE_K, dt);
      if (L.legR) L.legR.rotation.x = sm(L.legR.rotation.x, r.legRx, RELEASE_K, dt);
    }
    if (b) b.rotation.x = sm(b.rotation.x, r.pitch, RELEASE_K, dt);
  }

  // ---- per-kind choreography ------------------------------------

  function pose(p, rx, dt) {
    try {
      if (rx.kind === 'release') { poseRelease(p, rx, dt); return; }
      var L = limbs(p), b = bodyOf(p);
      if (!L || !L.armL || !L.armR) return;
      if (!rx.rest) rx.rest = grabRest(p);   // pre-reaction frame, before writes
      var t = rx.t - (rx.delay || 0);
      if (t < 0) return;                      // staggered: not my turn yet
      var A = rx.amp || 1;
      var k = 16;
      var d = rx.data || {};
      var ph = ((p.idx || 0) * 1.73 + (p.team || 0) * 0.61);
      switch (rx.kind) {
        case 'fatigue': {
          // hands toward the knees: sag forward, arms hang ahead, knees soften
          pitch(p, b, 0.40 * A + Math.sin(t * 4.2 + ph) * 0.03, 10, dt);
          armsX(L, -0.85 * A, k, dt);
          L.armL.rotation.z = sm(L.armL.rotation.z, 0.10 * A, k, dt);
          L.armR.rotation.z = sm(L.armR.rotation.z, -0.10 * A, k, dt);
          legs(L, -0.20 * A, -0.13 * A, 12, dt);
          break;
        }
        case 'possession': {
          if (d.lose) {
            var lv = ((p.idx || 0) % 3 + 3) % 3;
            if (lv === 0) {
              handsHead(L, A, k, dt);
              pitch(p, b, 0.18 * A, k, dt);
            } else if (lv === 1) {
              armsX(L, 0.35 * A, k, dt);
              L.armL.rotation.z = sm(L.armL.rotation.z, 0.05, k, dt);
              L.armR.rotation.z = sm(L.armR.rotation.z, -0.05, k, dt);
              pitch(p, b, 0.26 * A, 12, dt);
            } else {
              handsHips(L, A, k, dt);
              pitch(p, b, 0.08 * A, k, dt);
            }
          } else {
            var w = hash((p.idx || 0) + (p.team || 0) * 7);
            if (w < 0.34) {
              var pump = (-1.75 + Math.sin(t * 11 + ph) * 0.16) * A;
              armRaise(L, pump, -0.3, 0.3, 20, dt);
            } else if (w < 0.67) {
              pointArm(L, A, 20, dt);
            } else {
              var bend = (-1.15 + Math.sin(t * 9 + ph) * 0.12) * A;
              armRaise(L, bend, 0.55, -0.55, 20, dt);
            }
          }
          break;
        }
        case 'miss': {
          if (d.close) {
            var mv = ((p.idx || 0) % 3 + 3) % 3;
            if (mv === 0) {
              handsHead(L, A, k, dt);
              pitch(p, b, 0.20 * A, k, dt);
            } else if (mv === 1) {
              armsX(L, 0.35 * A, k, dt);
              L.armL.rotation.z = sm(L.armL.rotation.z, 0.12 * A, k, dt);
              L.armR.rotation.z = sm(L.armR.rotation.z, -0.12 * A, k, dt);
              pitch(p, b, 0.30 * A, 12, dt);
            } else {
              handsHips(L, A, k, dt);
              pitch(p, b, 0.12 * A, k, dt);
              if (speed2(p) < 0.02) p.facing += 0.45 * dt * A;   // turns away
            }
          } else {
            armsX(L, 0.40 * A, 12, dt);
            pitch(p, b, 0.14 * A, 12, dt);
          }
          break;
        }
        case 'matchEnd': {
          if (d.side === 'win') {
            if (d.gk) {
              var late = -2.1 * A + Math.sin(t * 6 + ph) * 0.06;
              armRaise(L, late, -0.35, 0.35, k, dt);
            } else if (hash((p.idx || 0) * 3 + 5) < 0.5) {
              armRaise(L, (-2.6 + Math.sin(t * 7 + ph) * 0.07) * A, -0.35, 0.35, k, dt);
            } else {
              armsWide(L, A, k, dt);
              pitch(p, b, -0.10 * A, 12, dt);
            }
          } else if (d.side === 'lose') {
            if (d.gk) {
              handsHead(L, A, k, dt);
              pitch(p, b, 0.28 * A, k, dt);
            } else {
              var xv = ((p.idx || 0) % 3 + 3) % 3;
              if (xv === 0) {
                handsHead(L, A, k, dt);
                pitch(p, b, 0.22 * A, k, dt);
              } else               if (xv === 1) {
                armsX(L, 0.35 * A, k, dt);
                pitch(p, b, 0.30 * A, 12, dt);
              } else {
                handsHips(L, A, k, dt);
                pitch(p, b, 0.06, k, dt);
              }
            }
          } else {
            armsX(L, 0.35, 12, dt);
            pitch(p, b, Math.sin(t * 5 + ph) * 0.05 - 0.02, 12, dt);   // small nod
          }
          break;
        }
        case 'hit': {
          // asymmetric knock: snappy flail, torso folds, one leg trails
          var hk = 24;
          L.armL.rotation.x = sm(L.armL.rotation.x, -0.85 * A, hk, dt);
          L.armL.rotation.z = sm(L.armL.rotation.z, 0.30 * A, hk, dt);
          L.armR.rotation.x = sm(L.armR.rotation.x, -1.35 * A, hk, dt);
          L.armR.rotation.z = sm(L.armR.rotation.z, -0.15 * A, hk, dt);
          pitch(p, b, 0.30 * A, 20, dt);
          legs(L, -0.35 * A, -0.08, 18, dt);
          break;
        }
        case 'tackle': {
          var tv = hash((p.idx || 0) * 3 + 11);
          if (tv < 0.4) {
            armRaise(L, -2.3 * A, -0.35, 0.35, 20, dt);
          } else if (tv < 0.7) {
            pointArm(L, A, 20, dt);
          } else {
            armsWide(L, A, 20, dt);
            pitch(p, b, -0.10 * A, 14, dt);
          }
          break;
        }
        case 'save': {
          if (d.parry) {
            // punch out: right arm high + out, chest opens
            L.armR.rotation.x = sm(L.armR.rotation.x, -2.05 * A, 22, dt);
            L.armR.rotation.z = sm(L.armR.rotation.z, -0.45 * A, 22, dt);
            L.armL.rotation.x = sm(L.armL.rotation.x, -0.7 * A, 18, dt);
            L.armL.rotation.z = sm(L.armL.rotation.z, 0.15, 18, dt);
            pitch(p, b, -0.05, 14, dt);
          } else {
            // claim: both arms curl in around the ball
            L.armL.rotation.x = sm(L.armL.rotation.x, -0.5 * A, 20, dt);
            L.armL.rotation.z = sm(L.armL.rotation.z, 0.4 * A, 20, dt);
            L.armR.rotation.x = sm(L.armR.rotation.x, -0.5 * A, 20, dt);
            L.armR.rotation.z = sm(L.armR.rotation.z, -0.4 * A, 20, dt);
            pitch(p, b, 0.16 * A + Math.sin(t * 8 + ph) * 0.03, 16, dt);
          }
          break;
        }
      }
    } catch (e) { /* one bad pose, never a bad frame */ }
  }

  // ---- shot → miss resolution -----------------------------------

  function resolveMiss(match, forced) {
    var s = _shot;
    _shot = null;
    if (!s || !s.shooter || !match || match.state !== 'PLAY') return;
    var sh = s.shooter;
    if (sh.hasBall) return;               // play carried on — nothing to rue
    var close = !!forced;
    var g = null;
    try { g = match.enemyGoal(sh.team); } catch (e) {}
    var b = match.ball;
    if (!close && g && b) {
      var C = LG.Config.court;
      var dx = Math.abs(b.x - g.x), dz = Math.abs(b.z - g.z);
      close = dx < C.goalWidth * 0.5 + 1.2 && dz < 2.5;
    }
    start(sh, 'miss', { data: { close: close }, amp: close ? 1 : 0.7 });
    if (close && match.all) {
      var mates = [], i, p, mx, mz;
      for (i = 0; i < match.all.length; i++) {
        p = match.all[i];
        if (!p || p === sh || p.team !== sh.team || p.isGoalkeeper) continue;
        mx = p.x - sh.x; mz = p.z - sh.z;
        var d2 = mx * mx + mz * mz;
        if (d2 < 49) mates.push({ p: p, d2: d2 });
      }
      mates.sort(function (a, b2) { return a.d2 - b2.d2; });
      for (i = 0; i < mates.length && i < 2; i++) {
        start(mates[i].p, 'miss', {
          delay: 0.14 * (i + 1), amp: 0.75,
          data: { close: true, mate: true }
        });
      }
    }
  }

  function stepShot(match, dt) {
    if (!_shot) return;
    _shot.t += dt;
    var b = match.ball;
    if (!b) { _shot = null; return; }
    var spd = b.speed();
    var taken = b.owner && b.owner !== _shot.shooter;
    var dead = spd < 1.8 && !b.owner;
    if (taken || dead || _shot.t > 3.0) resolveMiss(match, false);
  }

  // ---- fatigue scan (PLAY only, throttled) ----

  function scanFatigue(match) {
    var all = match.all;
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (!p || p.isGoalkeeper || p.hasBall) continue;
      if ((p.stamina || 0) >= 0.12) continue;
      if (speed2(p) > 0.15 * 0.15) continue;
      start(p, 'fatigue', {});
    }
  }

  // ---- bus hooks ------------------------------------------------

  function bind() {
    if (_sub || !LG.eventBus || !LG.eventBus.on) return;
    var bus = LG.eventBus;

    // emergency clears — nothing may survive a restart
    bus.on('matchStart', clearAll);
    bus.on('kickoff', clearAll);
    bus.on('goal', clearAll);
    bus.on('state', function (s) {
      if (s && (s.state === 'KICKOFF' || s.state === 'GOAL')) clearAll();
    });

    // shot tracking → miss resolution
    bus.on('shoot', function (e) {
      if (!e || !e.player) return;
      _shot = { shooter: e.player, t: 0 };
      _shotBy = e.player;
      _shotAt = _now;
    });
    bus.on('postHit', function () {
      if (_shot) resolveMiss(_m, true);   // off the woodwork: as close as it gets
    });
    bus.on('keeperSave', function (e) {
      _shot = null;
      if (e && e.gk) start(e.gk, 'save', { data: { parry: !!e.parry } });
    });

    // tackles: winner pumps, victim stumbles (priority beats a loss beat)
    bus.on('tackleWin', function (e) {
      if (!e) return;
      if (e.victim) start(e.victim, 'hit', {});
      if (e.src) start(e.src, 'tackle', {});
    });

    // possession change: the side that lost it reacts, the new carrier
    // gets a short beat — suppressed when a shot/save already owns it
    bus.on('possession', function (e) {
      var p = e && e.player;
      if (!p) return;
      var prev = _carrier, prevTeam = _carrierTeam;
      _carrier = p;
      _carrierTeam = p.team;
      if (!prev || prev === p || prevTeam === p.team || prevTeam < 0) return;
      if (prev.kickAnim > 0) return;
      if (prev === _shotBy && _now - _shotAt < 1.6) return;
      start(prev, 'possession', { data: { lose: true } });
      start(p, 'possession', { data: { lose: false }, amp: 0.85 });
    });

    // full-time: everyone reacts, staggered by idx, keepers their own beats
    bus.on('matchEnd', function (r) {
      clearAll();
      if (!_m || !_m.all) return;
      var winT = -1;
      if (r && r.won === 1) winT = 0;
      else if (r && r.won === -1) winT = 1;
      for (var i = 0; i < _m.all.length; i++) {
        var p = _m.all[i];
        if (!p) continue;
        var side = winT < 0 ? 'draw' : (p.team === winT ? 'win' : 'lose');
        start(p, 'matchEnd', {
          delay: 0.05 + ((p.idx || 0) % 6) * 0.07 + (p.isGoalkeeper ? 0.3 : 0),
          amp: side === 'draw' ? 0.7 : 1,
          data: { side: side, gk: !!p.isGoalkeeper }
        });
      }
    });

    _sub = true;
  }

  // ---- per-frame advance (called last in Match.update) ----

  function update(match, dt) {
    if (!match || !match.all || match.state === 'GOAL') return;
    try {
      _now += dt;
      if (match.state === 'PLAY') {
        stepShot(match, dt);
        _fatT -= dt;
        if (_fatT <= 0) { _fatT = 0.3; scanFatigue(match); }
      }
      for (var i = 0; i < match.all.length; i++) {
        var p = match.all[i];
        if (!p || !p._rx) continue;
        var rx = p._rx;
        // a kick owns the body outright: hand back instantly instead of
        // letting any pose (or its release) fight the kick clip
        if (p.kickAnim > 0) {
          applyRest(p, rx.rest);
          p._rx = null;
          continue;
        }
        if (rx.kind !== 'release' && rx.pri < 50 && speed2(p) > ABORT_SPD2) {
          rx = beginRelease(p);   // live movement outranks a weak reaction
        }
        rx.t += dt;
        if (rx.t >= rx.dur) {
          if (rx.kind === 'release') { applyRest(p, rx.rest); p._rx = null; continue; }
          rx = beginRelease(p);
        }
        pose(p, p._rx, dt);
      }
    } catch (e) { /* the layer never breaks a frame */ }
  }

  return {
    // MatchManager calls this once per constructed match: keeps the live
    // reference fresh and registers the (idempotent) bus hooks
    attach: function (match) { if (match) _m = match; bind(); },
    bind: bind,
    update: update,
    start: start,
    clearAll: clearAll,
    // introspection for probes / the shot harness
    state: function () {
      return { now: _now, shot: _shot ? { t: _shot.t } : null, bound: _sub };
    },
    KINDS: KINDS
  };
})();
