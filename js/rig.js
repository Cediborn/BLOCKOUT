// ============================================================
// RIG — skinned humanoid players driven by AnimationMixer
//
// Phase 2 of the player-model upgrade. Builds an original BLOCKOUT
// footballer as a real bone hierarchy + SkinnedMesh parts, keeping the
// silhouette and proportions of the procedural character, and drives it
// with three's AnimationMixer so poses come from clips instead of
// per-frame limb maths. The result keeps the exact contract the rest of
// the game already consumes:
//
//     { group, body, limbs, height, anim }
//
//   group  node the game moves/rotates/scales (unchanged)
//   body   spine bone — celebrations tilt it with .rotation.x
//   limbs  hip / shoulder bones — celebrations pose them directly
//   anim   mixer controller; player.js prefers it over animateChar
//
// Purely presentation: nothing here writes a gameplay value, and
// gameplay values are only READ as animation signals (vx/vz, kickAnim).
//
// player.js keeps writing group.scale / group.rotation.y and that still
// lands exactly once: SkinnedMesh "attached" bindMode recomputes
// bindMatrixInverse = matrixWorld^-1 every frame, which cancels the
// mesh transform and leaves the bones as the single source of truth.
//
// ENABLE: LG.Config.player.rig — 1 is the shipped default (config.js).
// index.html?rig=0 / ?rig=1 overrides it for A-B comparison, and any
// environment without a real skinning-capable three.js falls back to the
// procedural body automatically.
// ============================================================
var LG = window.LG = window.LG || {};

try {
  var rigQ = /(?:[?&])rig=([01])(?:&|$)/.exec(String(typeof location !== 'undefined' ? location.search : ''));
  if (rigQ && LG.Config && LG.Config.player) LG.Config.player.rig = rigQ[1] === '1' ? 1 : 0;
} catch (e) {}

LG.Rig = (function () {

  // Real-three capability test. The headless harnesses (tools/boot.js,
  // tools/sim.js) hand back a permissive fake THREE whose constructors
  // accept anything, so testing for the API by name would report skinning
  // support that does not exist — ask the constructed objects instead.
  // A failed test simply means "build the procedural body", which is the
  // fallback the game has always had.
  var skinSupport = null;
  function hasSkins() {
    if (skinSupport !== null) return skinSupport;
    skinSupport = false;
    var T = window.THREE;
    if (!T || typeof T.Bone !== 'function' || typeof T.SkinnedMesh !== 'function') return skinSupport;
    try {
      var b = new T.Bone();
      var m = new T.SkinnedMesh(new T.BufferGeometry(), new T.MeshBasicMaterial());
      skinSupport = !!(b && b.isObject3D === true &&
        m && m.isSkinnedMesh === true && typeof m.bind === 'function' &&
        T.Skeleton && T.AnimationMixer && T.AnimationClip &&
        T.QuaternionKeyframeTrack && T.VectorKeyframeTrack &&
        T.Uint16BufferAttribute && T.Float32BufferAttribute);
    } catch (e) { skinSupport = false; }
    return skinSupport;
  }

  function enabled() {
    var cfg = (LG.Config && LG.Config.player) || {};
    return !!cfg.rig && hasSkins();
  }

  // ------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------
  function smooth(t) { return t * t * (3 - 2 * t); }
  function clamp01(t) { return t < 0 ? 0 : (t > 1 ? 1 : t); }

  function box(w, h, d, x, y, z) {
    return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
  }
  function sph(r, ws, hs, x, y, z) {
    return new THREE.SphereGeometry(r, ws, hs).translate(x, y, z);
  }

  // bind functions return [[boneIdx x4], [weight x4]]
  function rigid(i) {
    return function () { return [[i, 0, 0, 0], [1, 0, 0, 0]]; };
  }
  // weight of `b` grows as y falls from yHi to yLo (a lower joint)
  function blendDown(a, b, yHi, yLo) {
    return function (x, y) {
      var t = smooth(clamp01((yHi - y) / (yHi - yLo)));
      return [[a, b, 0, 0], [1 - t, t, 0, 0]];
    };
  }
  // torso: hips -> spine (waist) -> chest (shoulders), so the shoulder
  // line moves with the chest while the waist keeps its own bend
  function bindTorso(iHips, iSpine, iChest, t) {
    var yA = 0.62 * t, yB = 0.86 * t, yC = 1.10 * t;
    return function (x, y) {
      if (y <= yA) return [[iHips, 0, 0, 0], [1, 0, 0, 0]];
      if (y <= yB) {
        var a = smooth(clamp01((y - yA) / (yB - yA)));
        return [[iHips, iSpine, 0, 0], [1 - a, a, 0, 0]];
      }
      var b = smooth(clamp01((y - yB) / (yC - yB)));
      return [[iSpine, iChest, 0, 0], [1 - b, b, 0, 0]];
    };
  }
  // thigh: hips -> hip joint -> legL -> knee joint -> shinL
  function bindThigh(iHips, iLeg, iShin, t) {
    var hipHi = 0.50 * t, hipLo = 0.44 * t;
    var kneeHi = 0.28 * t, kneeLo = 0.16 * t;
    return function (x, y) {
      if (y <= kneeHi) {
        var s = smooth(clamp01((kneeHi - y) / (kneeHi - kneeLo)));
        return [[iLeg, iShin, 0, 0], [1 - s, s, 0, 0]];
      }
      var h = smooth(clamp01((hipHi - y) / (hipHi - hipLo)));
      return [[iHips, iLeg, 0, 0], [1 - h, h, 0, 0]];
    };
  }

  // ------------------------------------------------------------
  // skeleton — parent-first order, array index doubles as skinIndex
  // ------------------------------------------------------------
  function layout(d) {
    var t = d.t, w = d.w;
    return [
      ['root', null, 0, 0, 0],
      ['hips', 'root', 0, 0.70 * t, 0],
      ['spine', 'hips', 0, 0.16 * t, 0],
      ['chest', 'spine', 0, 0.16 * t, 0],
      ['neck', 'chest', 0, 0.10 * t, 0],
      ['head', 'neck', 0, 0.12 * t, 0],
      ['armL', 'chest', 0.32 * w, 0, 0],
      ['forearmL', 'armL', 0, -0.26, 0],
      ['handL', 'forearmL', 0, -0.24, 0],
      ['armR', 'chest', -0.32 * w, 0, 0],
      ['forearmR', 'armR', 0, -0.26, 0],
      ['handR', 'forearmR', 0, -0.24, 0],
      ['legL', 'hips', 0.14 * w, -0.24 * t, 0],
      ['shinL', 'legL', 0, -0.24 * t, 0],
      ['footL', 'shinL', 0, -0.20 * t, 0],
      ['legR', 'hips', -0.14 * w, -0.24 * t, 0],
      ['shinR', 'legR', 0, -0.24 * t, 0],
      ['footR', 'shinR', 0, -0.20 * t, 0]
    ];
  }

  // ------------------------------------------------------------
  // clip authoring
  // ------------------------------------------------------------
  var IDQ = [0, 0, 0, 1];

  function toQuat(v) {
    if (!v) return IDQ;
    if (v.length === 4) return v;
    var q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(v[0] || 0, v[1] || 0, v[2] || 0, 'XYZ'));
    return [q.x, q.y, q.z, q.w];
  }

  // left<->right mirror: swap L/R bones, negate the quaternion's y/z
  // (exact conjugation by the x-flip reflection)
  function mirrorPose(p) {
    var out = {};
    for (var n in p) {
      var m = /^(.*)([LR])$/.exec(n);
      var target = m ? m[1] + (m[2] === 'L' ? 'R' : 'L') : n;
      var q = toQuat(p[n]);
      out[target] = [q[0], -q[1], -q[2], q[3]];
    }
    return out;
  }

  function mirrorKey(k) {
    var y = {};
    if (k.y) for (var n in k.y) y[n] = [-k.y[n][0], k.y[n][1], k.y[n][2]];
    return { t: k.t, p: mirrorPose(k.p || {}), y: y };
  }

  // Every clip writes every bone in BONES (identity when a pose omits
  // one) so a clip that stops animating a bone can never leave it
  // frozen in the previous clip's pose.
  var CLIP_DEFS = {
    idle: { dur: 3.2, keys: [
      { t: 0, p: {
        spine: [0.03, 0, 0], chest: [0.01, 0, 0], head: [0, 0, 0],
        armL: [0, 0, 0.10], armR: [0, 0, -0.10],
        forearmL: [-0.12, 0, 0], forearmR: [-0.12, 0, 0],
        legL: [0.01, 0, 0.03], legR: [0.01, 0, -0.03],
        shinL: [0.02, 0, 0], shinR: [0.02, 0, 0]
      }, y: { hips: [0.004, 0, 0] } },
      { t: 0.8, p: {
        spine: [0.07, 0, 0], chest: [0.03, 0, 0], head: [0.03, 0, 0],
        armL: [0.02, 0, 0.15], armR: [0.02, 0, -0.15],
        forearmL: [-0.18, 0, 0], forearmR: [-0.18, 0, 0],
        legL: [-0.01, 0, 0.03], legR: [-0.01, 0, -0.03],
        shinL: [0.03, 0, 0], shinR: [0.03, 0, 0]
      }, y: { hips: [-0.004, 0.014, 0] } },
      { t: 1.6, p: {
        spine: [0.03, 0, 0], chest: [0.01, 0, 0], head: [0, 0, 0],
        armL: [0, 0, 0.10], armR: [0, 0, -0.10],
        forearmL: [-0.12, 0, 0], forearmR: [-0.12, 0, 0],
        legL: [0.01, 0, 0.03], legR: [0.01, 0, -0.03],
        shinL: [0.02, 0, 0], shinR: [0.02, 0, 0]
      }, y: { hips: [0.004, 0, 0] } },
      { t: 2.4, p: {
        spine: [0.07, 0, 0], chest: [0.03, 0, 0], head: [0.03, 0, 0],
        armL: [0.02, 0, 0.15], armR: [0.02, 0, -0.15],
        forearmL: [-0.18, 0, 0], forearmR: [-0.18, 0, 0],
        legL: [-0.01, 0, 0.03], legR: [-0.01, 0, -0.03],
        shinL: [0.03, 0, 0], shinR: [0.03, 0, 0]
      }, y: { hips: [-0.004, 0.014, 0] } },
      { t: 3.2, p: {
        spine: [0.03, 0, 0], chest: [0.01, 0, 0], head: [0, 0, 0],
        armL: [0, 0, 0.10], armR: [0, 0, -0.10],
        forearmL: [-0.12, 0, 0], forearmR: [-0.12, 0, 0],
        legL: [0.01, 0, 0.03], legR: [0.01, 0, -0.03],
        shinL: [0.02, 0, 0], shinR: [0.02, 0, 0]
      }, y: { hips: [0.004, 0, 0] } }
    ]},

    run: { dur: 0.62, keys: (function () {
      // foot contact with the right leg forward
      var contact = { t: 0, p: {
        legR: [-0.75, 0, 0], shinR: [0.35, 0, 0],
        legL: [0.55, 0, 0], shinL: [0.85, 0, 0],
        armL: [-0.65, 0, 0], armR: [0.55, 0, 0],
        forearmL: [-0.70, 0, 0], forearmR: [-0.70, 0, 0],
        spine: [0.16, 0, 0], chest: [0.04, 0, 0], head: [-0.06, 0, 0]
      }, y: { hips: [0, -0.015, 0] } };
      // passing / flight — right leg planting, left folding through
      var pass = { t: 0.155, p: {
        legR: [-0.05, 0, 0], shinR: [0.12, 0, 0],
        legL: [-0.35, 0, 0], shinL: [1.15, 0, 0],
        armL: [-0.30, 0, 0], armR: [0.30, 0, 0],
        forearmL: [-0.75, 0, 0], forearmR: [-0.75, 0, 0],
        spine: [0.16, 0, 0], chest: [0.04, 0, 0], head: [-0.06, 0, 0]
      }, y: { hips: [0, 0.025, 0] } };
      var contact2 = mirrorKey(contact); contact2.t = 0.31;
      var pass2 = mirrorKey(pass); pass2.t = 0.465;
      var end = { t: 0.62, p: contact.p, y: { hips: [0, -0.015, 0] } };
      return [contact, pass, contact2, pass2, end];
    })()},

    kick: { dur: 0.50, keys: [
      { t: 0, p: {
        legR: [-0.05, 0, 0], shinR: [0.15, 0, 0],
        legL: [-0.05, 0, 0], shinL: [0.15, 0, 0],
        armL: [-0.15, 0, 0], armR: [0.15, 0, 0],
        forearmL: [-0.50, 0, 0], forearmR: [-0.50, 0, 0],
        spine: [0.06, 0, 0], head: [-0.02, 0, 0]
      }, y: { hips: [0, 0, 0] } },
      { t: 0.14, p: {
        legR: [0.85, 0, 0], shinR: [1.15, 0, 0],
        legL: [-0.30, 0, 0], shinL: [0.35, 0, 0],
        armL: [-0.70, 0, 0], armR: [0.80, 0, 0],
        forearmL: [-0.90, 0, 0], forearmR: [-0.60, 0, 0],
        spine: [-0.10, 0, 0], head: [0.06, 0, 0]
      }, y: { hips: [0, -0.02, 0] } },
      { t: 0.26, p: {
        legR: [-1.05, 0, 0], shinR: [0.30, 0, 0],
        legL: [-0.25, 0, 0], shinL: [0.30, 0, 0],
        armL: [0.75, 0, 0], armR: [-0.75, 0, 0],
        forearmL: [-0.60, 0, 0], forearmR: [-0.90, 0, 0],
        spine: [0.24, 0, 0], head: [-0.10, 0, 0]
      }, y: { hips: [0, -0.01, 0] } },
      { t: 0.38, p: {
        legR: [-1.25, 0, 0], shinR: [0.10, 0, 0],
        legL: [-0.15, 0, 0], shinL: [0.25, 0, 0],
        armL: [0.95, 0, 0], armR: [-0.90, 0, 0],
        forearmL: [-0.50, 0, 0], forearmR: [-1.00, 0, 0],
        spine: [0.30, 0, 0], head: [-0.12, 0, 0]
      }, y: { hips: [0, 0, 0] } },
      { t: 0.50, p: {
        legR: [-0.30, 0, 0], shinR: [0.30, 0, 0],
        legL: [-0.10, 0, 0], shinL: [0.20, 0, 0],
        armL: [0.20, 0, 0], armR: [-0.20, 0, 0],
        forearmL: [-0.55, 0, 0], forearmR: [-0.55, 0, 0],
        spine: [0.12, 0, 0], head: [-0.04, 0, 0]
      }, y: { hips: [0, 0, 0] } }
    ]}
  };

  var CLIPS = null;

  function boneSet() {
    var set = {};
    for (var n in CLIP_DEFS) {
      var ks = CLIP_DEFS[n].keys;
      for (var i = 0; i < ks.length; i++) {
        for (var b in (ks[i].p || {})) set[b] = 1;
      }
    }
    return Object.keys(set);
  }

  function buildClip(name, def, bones, restPos) {
    var tracks = [];
    var times = [];
    var i, j;
    for (i = 0; i < def.keys.length; i++) times.push(def.keys[i].t);

    for (j = 0; j < bones.length; j++) {
      var b = bones[j], vals = [];
      for (i = 0; i < def.keys.length; i++) {
        var q = toQuat((def.keys[i].p || {})[b]);
        vals.push(q[0], q[1], q[2], q[3]);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(b + '.quaternion', times.slice(), vals));
    }

    // every clip also writes hips.position, so a clip with no bob cannot
    // leave the hips where the previous clip parked them
    var ptimes = [], pvals = [], rest = restPos.hips || [0, 0, 0];
    for (i = 0; i < def.keys.length; i++) {
      var y = (def.keys[i].y && def.keys[i].y.hips) || [0, 0, 0];
      ptimes.push(def.keys[i].t);
      pvals.push(rest[0] + y[0], rest[1] + y[1], rest[2] + y[2]);
    }
    tracks.push(new THREE.VectorKeyframeTrack('hips.position', ptimes, pvals));

    return new THREE.AnimationClip(name, def.dur, tracks);
  }

  function clips(restPos) {
    if (CLIPS) return CLIPS;
    var bones = boneSet();
    CLIPS = {};
    for (var n in CLIP_DEFS) CLIPS[n] = buildClip(n, CLIP_DEFS[n], bones, restPos);
    return CLIPS;
  }

  // ------------------------------------------------------------
  // controller — state selection + crossfades, on a REAL clock
  // ------------------------------------------------------------
  function nowMs() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function controller(model) {
    var mixer = new THREE.AnimationMixer(model.group);
    var bank = clips(model.restPos);
    var actions = {};
    for (var n in bank) actions[n] = mixer.clipAction(bank[n]);
    actions.kick.setLoop(THREE.LoopOnce, 1);
    actions.kick.clampWhenFinished = true;

    var cur = null, kickT = 0, wasKick = false, last = 0, fails = 0;

    function play(name, fade) {
      var a = actions[name];
      if (!a) return;
      a.enabled = true;
      a.reset();
      a.play();
      if (fade > 0) { a.setEffectiveWeight(0); a.fadeIn(fade); }
      else a.setEffectiveWeight(1);
      if (cur && cur !== name && actions[cur]) {
        if (fade > 0) actions[cur].fadeOut(fade);
        else actions[cur].setEffectiveWeight(0);
      }
      cur = name;
    }

    function onFail(e) {
      fails++;
      if (fails === 1 && window.console && console.warn) {
        console.warn('[Rig] animation update failed:', e && e.message);
      }
      if (fails > 3) return false;   // player.js falls back to animateChar
      return true;
    }

    // one time step: pick the state, then let the mixer interpolate it
    function advance(rdt, p) {
      var vx = p.vx || 0, vz = p.vz || 0;
      var spd = Math.sqrt(vx * vx + vz * vz) / (p.maxSpeed || 5);
      if (spd > 1) spd = 1;

      // a kick is the rising edge of kickAnim; the clip then plays once
      var kicking = p.kickAnim > 0;
      if (kicking && !wasKick) kickT = bank.kick.duration;
      wasKick = kicking;
      if (kickT > 0) { kickT -= rdt; if (kickT < 0) kickT = 0; }

      var want = kickT > 0 ? 'kick' : (spd > 0.06 ? 'run' : 'idle');
      if (want !== cur) {
        var oneShot = (want === 'kick' || cur === 'kick');
        play(want, cur === null ? 0 : (oneShot ? 0.10 : 0.18));
      }
      if (cur === 'run') actions.run.setEffectiveTimeScale(0.85 + spd * 0.75);

      mixer.update(rdt);
      return true;
    }

    return {
      // diagnostics for the harness
      state: function () {
        return {
          cur: cur, fails: fails, time: mixer.time, kick: kickT
        };
      },
      // pin one clip at an exact time — frame-rate independent, so the
      // screenshot harness can judge a specific pose
      pose: function (name, t) {
        try {
          for (var n in actions) {
            if (n === name) continue;
            actions[n].stop();
            actions[n].setEffectiveWeight(0);
          }
          var a = actions[name];
          if (!a) return false;
          a.enabled = true;
          a.reset();
          a.play();
          a.setEffectiveWeight(1);
          a.time = Math.min(Math.max(0, t), Math.max(0, a.getClip().duration - 1e-3));
          cur = name;
          last = nowMs();
          mixer.update(0);
          return true;
        } catch (e) { return onFail(e); }
      },
      // advance by an explicit step (harness / tests)
      step: function (rdt, p) {
        try { return advance(rdt, p); } catch (e) { return onFail(e); }
      },
      update: function (dt, p) {
        try {
          var t = nowMs();
          // real-time step: Match.updatePlayers passes dt=0 during
          // KICKOFF/GOAL/END, which would otherwise freeze the mixer
          var rdt = last ? (t - last) / 1000 : 0;
          last = t;
          if (rdt > 0.1) rdt = 0.1;
          if (rdt < 0) rdt = 0;
          return advance(rdt, p);
        } catch (e) { return onFail(e); }
      }
    };
  }

  // ------------------------------------------------------------
  // build — one character
  // ------------------------------------------------------------
  function build(def) {
    if (!hasSkins()) throw new Error('three build lacks skinning support');
    if (!LG.Models || !LG.Models.mat) throw new Error('LG.Models.mat unavailable');

    var pal = def.palette || {};
    var cfg = def.body || {};
    var t = cfg.tall || 1;
    var w = cfg.wide || 1;

    var group = new THREE.Group();
    var rows = layout({ t: t, w: w });
    var idx = {}, restPos = {}, byName = {};
    var i, r;

    // bones (parent-first, so the array index is the skinIndex slot)
    var bones = [];
    for (i = 0; i < rows.length; i++) idx[rows[i][0]] = i;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      var b = new THREE.Bone();
      b.name = r[0];
      b.position.set(r[2], r[3], r[4]);
      restPos[r[0]] = [r[2], r[3], r[4]];
      if (r[1]) byName[r[1]].add(b); else group.add(b);
      bones.push(b);
      byName[r[0]] = b;
    }

    // materials
    var mat = LG.Models.mat;
    var skinM = mat(pal.skin, 'skin');
    var shirtM = mat(pal.shirt, 'shirt');
    var trimM = mat(pal.trim, 'trim');
    var pantsM = mat(pal.pants, 'pants');
    var shoeM = mat(pal.shoe, 'shoe');
    var armM = cfg.gloves ? mat(cfg.gloves, 'gloves') : skinM;
    var eyeM = mat(0x16181f, 'eye');

    var A = 1.02 * t;                 // shoulder line
    var elbowY = A - 0.26;
    var hipY = 0.46 * t;
    var kneeY = 0.22 * t;
    var headR = 0.31 * (t > 1.05 ? 1.05 : 1);

    // ---- skinned parts, collected per material so each material
    // ---- becomes exactly one SkinnedMesh ----
    var groups = [];
    function push(m, geo, bind) {
      var g = null;
      for (var n = 0; n < groups.length; n++) if (groups[n].m === m) g = groups[n];
      if (!g) { g = { m: m, geo: [] }; groups.push(g); }
      g.geo.push({ geo: geo, bind: bind });
    }

    // torso, waist stripe (wide builds), shorts
    push(shirtM, box(0.42 * w, 0.48 * t, 0.26, 0, 0.86 * t, 0),
      bindTorso(idx.hips, idx.spine, idx.chest, t));
    if (w > 1.08) push(trimM, box(0.44 * w, 0.10, 0.28, 0, 0.70 * t, 0.001), rigid(idx.spine));
    push(pantsM, box(0.42 * w, 0.26 * t, 0.25, 0, 0.53 * t, 0), rigid(idx.hips));

    // sleeves ride the chest so the arm pivots inside them
    push(shirtM, box(0.13 * w, 0.16, 0.13, 0.32 * w, A - 0.05, 0), rigid(idx.chest));
    push(shirtM, box(0.13 * w, 0.16, 0.13, -0.32 * w, A - 0.05, 0), rigid(idx.chest));

    // arms — smooth blend across the elbow joint
    var armBindL = blendDown(idx.armL, idx.forearmL, elbowY + 0.05, elbowY - 0.05);
    var armBindR = blendDown(idx.armR, idx.forearmR, elbowY + 0.05, elbowY - 0.05);
    push(armM, box(0.11 * w, 0.26, 0.11, 0.32 * w, A - 0.13, 0), armBindL);
    push(armM, box(0.11 * w, 0.24, 0.11, 0.32 * w, elbowY - 0.12, 0), armBindL);
    push(armM, sph(0.10 * w, 6, 6, 0.32 * w, A - 0.52, 0), rigid(idx.handL));
    push(armM, box(0.11 * w, 0.26, 0.11, -0.32 * w, A - 0.13, 0), armBindR);
    push(armM, box(0.11 * w, 0.24, 0.11, -0.32 * w, elbowY - 0.12, 0), armBindR);
    push(armM, sph(0.10 * w, 6, 6, -0.32 * w, A - 0.52, 0), rigid(idx.handR));

    // legs — hip blend on the thigh, knee blend across thigh/shin
    var thighBindL = bindThigh(idx.hips, idx.legL, idx.shinL, t);
    var thighBindR = bindThigh(idx.hips, idx.legR, idx.shinR, t);
    var shinBindL = blendDown(idx.legL, idx.shinL, kneeY + 0.06 * t, kneeY - 0.06 * t);
    var shinBindR = blendDown(idx.legR, idx.shinR, kneeY + 0.06 * t, kneeY - 0.06 * t);
    push(pantsM, box(0.17 * w, 0.24 * t, 0.18, 0.14 * w, hipY - 0.12 * t, 0), thighBindL);
    push(pantsM, box(0.17 * w, 0.16 * t, 0.18, 0.14 * w, kneeY - 0.08 * t, 0), shinBindL);
    push(shoeM, box(0.20 * w, 0.11, 0.34, 0.14 * w, 0.055, 0.06), rigid(idx.footL));
    push(pantsM, box(0.17 * w, 0.24 * t, 0.18, -0.14 * w, hipY - 0.12 * t, 0), thighBindR);
    push(pantsM, box(0.17 * w, 0.16 * t, 0.18, -0.14 * w, kneeY - 0.08 * t, 0), shinBindR);
    push(shoeM, box(0.20 * w, 0.11, 0.34, -0.14 * w, 0.055, 0.06), rigid(idx.footR));

    // neck + head
    push(skinM, box(0.12, 0.10, 0.12, 0, 1.145 * t, 0), rigid(idx.neck));
    push(skinM, sph(headR, 12, 10, 0, 1.32 * t, 0), rigid(idx.head));

    // ---- one SkinnedMesh per material, all sharing one skeleton ----
    group.updateMatrixWorld(true);
    var skeleton = new THREE.Skeleton(bones);

    for (i = 0; i < groups.length; i++) {
      var g = groups[i];
      var posA = [], norA = [], uvA = [], siA = [], swA = [];
      for (var k = 0; k < g.geo.length; k++) {
        var entry = g.geo[k];
        var src = entry.geo.index ? entry.geo.toNonIndexed() : entry.geo;
        var pa = src.attributes.position, na = src.attributes.normal, ua = src.attributes.uv;
        for (var v = 0; v < pa.count; v++) {
          var px = pa.getX(v), py = pa.getY(v), pz = pa.getZ(v);
          posA.push(px, py, pz);
          if (na) norA.push(na.getX(v), na.getY(v), na.getZ(v));
          if (ua) uvA.push(ua.getX(v), ua.getY(v));
          var res = entry.bind(px, py, pz);
          siA.push(res[0][0], res[0][1], res[0][2], res[0][3]);
          swA.push(res[1][0], res[1][1], res[1][2], res[1][3]);
        }
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(posA, 3));
      if (norA.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(norA, 3));
      if (uvA.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvA, 2));
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(siA, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(swA, 4));
      geo.computeBoundingSphere();

      var mesh = new THREE.SkinnedMesh(geo, g.m);
      mesh.name = 'rigpart';
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      group.add(mesh);
      mesh.bind(skeleton);
    }

    // ---- face + hair ride the head bone as ordinary (unskinned) children
    var headB = byName.head;
    var eyeY = 1.34 * t - 1.24 * t;
    var ez = Math.sqrt(Math.max(0.02, headR * headR - (0.11 * w) * (0.11 * w) - 0.001));
    function feature(geo, material) {
      var mm = new THREE.Mesh(geo, material);
      mm.castShadow = false;
      headB.add(mm);
      return mm;
    }
    feature(sph(0.045, 8, 6, 0.11 * w, eyeY, ez), eyeM);
    feature(sph(0.045, 8, 6, -0.11 * w, eyeY, ez), eyeM);
    feature(box(0.085, 0.022, 0.03, 0.11 * w, eyeY + 0.075, ez * 0.97), eyeM);
    feature(box(0.085, 0.022, 0.03, -0.11 * w, eyeY + 0.075, ez * 0.97), eyeM);

    var hairHolder = new THREE.Group();
    hairHolder.position.y = 1.32 * t - 1.24 * t;
    headB.add(hairHolder);
    if (LG.Models.attachHair) LG.Models.attachHair(hairHolder, def);

    group.updateMatrixWorld(true);

    var model = {
      group: group,
      body: byName.spine,                 // celebrations lean this
      limbs: {
        legL: byName.legL, legR: byName.legR,
        armL: byName.armL, armR: byName.armR
      },
      height: 1.62 * t,
      skinned: true,
      bones: bones,
      restPos: restPos
    };
    model.anim = controller(model);
    return model;
  }

  return {
    enabled: enabled,
    supported: hasSkins,
    build: build
  };
})();
