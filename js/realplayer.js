// ============================================================
// REALPLAYER — PHASE 2: one imported GLB footballer
// (3d/soap_soccer_player.glb) driven by REAL AnimationMixer clips
// that are retargeted from the BLOCKOUT animation data.
//
// SCOPE / RULES
//   - exactly ONE player uses it (home team, slot 0); every other
//     player keeps the BLOCKOUT procedural body
//   - the procedural body (LG.Models.buildCharacter) stays as the
//     fallback for this player too: if the GLB is not loaded yet,
//     the bake fails, or the mixer throws repeatedly, nothing
//     changes from today's build
//   - no gameplay / physics / AI / camera / lighting changes
//   - no LG.Models.animateChar limb maths touches this skeleton:
//     player.js still calls it ONLY for procedural bodies, and the
//     harness proves that with shimCalls === 0
//
// WHAT DRIVES THIS SKELETON (PHASE 2)
//   The asset ships five authored clips (Kick, Push, Tackle,
//   StandUpBack, StandUpFront) but no idle and no run cycle, and its
//   48-joint FBX skeleton (ArmL_012, CalfL_037, Hips_035 ...) has a
//   relaxed bind pose that matches neither the names nor the pose of
//   the 18-bone BLOCKOUT rig. So the BLOCKOUT clips are TRANSFERRED
//   onto this skeleton at build time, by direction:
//
//     for every mapped bone, take the source bone's segment direction
//     in the character frame at that key (source FK; the source binds
//     with identity rotations, so it is EulerXYZ(pose) composed down
//     the parent chain), then rotate the target bone's own segment
//     from wherever its bind pose puts it onto that direction with the
//     minimal swing (Quaternion.setFromUnitVectors). Every bone is
//     solved parent-first, so the parent's motion is already in place
//     and the swing is exactly the local correction that bone needs.
//
//   That keeps the segment-to-segment geometry of the BLOCKOUT pose
//   (thigh/shin/foot, upper arm/forearm, spine/chest/neck/head) while
//   letting each skeleton keep its own bind orientation. What is NOT
//   transferred: twist about a segment (the minimal swing keeps it),
//   clavicles, ankles, fingers and the IK chain - those stay at bind,
//   which is what the source rig does too.
//
//   The result is five real clips - idle, jog, run, sprint, stop -
//   plus the asset's own authored kick, all played through one
//   AnimationMixer with crossfades. The procedural swing and the
//   "held Push pose" shim from Phase 1 are gone.
//
//   Grounding: each clip's lowest boot over all of its keys is baked
//   into the clip (a static lift on the body bob), and a per-frame
//   lock keeps the lowest boot on the deck during the authored kick,
//   which leaves both feet in the air.
// ============================================================
var LG = window.LG = window.LG || {};

LG.RealPlayer = (function () {
  var SRC = '3d/soap_soccer_player.glb';

  // PHASE 3A — visible size. The imported footballer is a realistic build
  // (narrow torso, small head, long legs) against the chunky BLOCKOUT
  // bodies, so at the nominal 1.62 height it read visibly smaller on the
  // pitch even though its head-top already matched. One UNIFORM factor —
  // measured live: the mean head-top of the other seven players in a match
  // is ~2.51 world vs this model's 2.23 — puts its head, shoulders and
  // torso onto theirs without touching proportions or gameplay (collision
  // radius and player.height still come from LG.Player.visualScale).
  var VISUAL = 1.12;

  var src = null;            // { scene, clips, box, tris, meshes, bones, height }
  var phase = 'idle';        // 'idle' -> 'loading' -> 'ready' | 'error'
  var errMsg = '';
  var silent = true;
  var enabled = true;      // harness can force the fallback (?glb=0)
  var loadT0 = 0;

  function log() {
    if (!silent && window.console && console.log) console.log.apply(console, arguments);
  }
  function warn() {
    if (window.console && console.warn) console.warn.apply(console, arguments);
  }
  function setLogging(on) { silent = !on; }

  // ------------------------------------------------------------
  // preload — kicked off at parse time, long before a match starts
  // ------------------------------------------------------------
  function preload() {
    if (phase !== 'idle') return;
    if (typeof fetch !== 'function' || !window.THREE || !THREE.GLTFLoader) {
      phase = 'error';
      errMsg = 'no THREE.GLTFLoader / fetch in this browser';
      warn('[GLB] FALLBACK: ' + errMsg);
      return;
    }
    phase = 'loading';
    loadT0 = (window.performance && performance.now) ? performance.now() : Date.now();
    fetch(SRC)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (buf) {
        return new Promise(function (resolve, reject) {
          new THREE.GLTFLoader().parse(buf, '', resolve, reject);
        });
      })
      .then(function (g) { accept(g); })
      .catch(function (e) {
        phase = 'error';
        errMsg = (e && e.message) || String(e);
        warn('[GLB] FALLBACK: could not load ' + SRC + ' -> ' + errMsg);
      });
  }

  function accept(g) {
    var scene = g.scene;
    if (!scene) { phase = 'error'; errMsg = 'no scene in glb'; warn('[GLB] FALLBACK: ' + errMsg); return; }
    // bones are siblings of the meshes: refresh the whole tree once, so the
    // per-part skinned boxes below measure real body positions
    scene.updateMatrixWorld(true);

    var tris = 0, meshes = 0, bones = 0, seen = {}, parts = [];
    scene.traverse(function (o) {
      if (o.isMesh) {
        meshes++;
        // part/material names are what the kit tint keys off, so they go in
        // the load log — one glance at the console proves the tint target
        parts.push(o.name + ':' + (o.material && o.material.name || '?') +
          '(' + (o.material && o.material.color ? '#' + o.material.color.getHexString() : '?') +
          (o.material && o.material.map ? '+map' : '') + ')');
        // where does this part actually sit on the body? the skinned y-range
        // is what tells shirt from shorts from helmet for the kit tint
        try {
          var pb = skinnedBox(o, true);
          if (pb && isFinite(pb.min.y)) {
            parts[parts.length - 1] += '[' + pb.min.y.toFixed(2) + '..' + pb.max.y.toFixed(2) +
              ' x' + pb.min.x.toFixed(2) + '..' + pb.max.x.toFixed(2) + ']';
          }
        } catch (e) {}
        // same contract as the procedural body, plus self-receiving so the
        // fence / night floodlights can land on the player
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;   // skinned bounds are only approximate
        var gm = o.geometry;
        if (gm) {
          if (gm.index) tris += gm.index.count / 3;
          else if (gm.attributes && gm.attributes.position) tris += gm.attributes.position.count / 3;
        }
        if (o.isSkinnedMesh && o.skeleton) {
          for (var i = 0; i < o.skeleton.bones.length; i++) {
            var b = o.skeleton.bones[i];
            if (!seen[b.uuid]) { seen[b.uuid] = 1; bones++; }
          }
        }
      }
    });

    // --- kit-tint survey: which material is shirt / shorts / helmet, and
    // where the jersey panel has to stop so the hands and head are skipped.
    // Names come from the asset itself (pt-BR material names).
    // NOTE: the bones live beside the meshes, not under them — the scene
    // root refresh at the top of accept() is what makes these numbers real.
    try {
      var mbox = {};
      scene.traverse(function (o) {
        if (!o.isMesh || !o.material) return;
        var nm = o.material.name || '?';
        (mbox[nm] = mbox[nm] || []).push({ o: o, b: skinnedBox(o, true) });
      });
      var skinL = mbox['Begue'] && mbox['Begue'][0];
      var redL = mbox['Vermelho'] || [];
      var shortsL = null, helmL = null;
      for (var ri = 0; ri < redL.length; ri++) {
        if (!redL[ri].b) continue;
        if (!shortsL || redL[ri].b.max.y < shortsL.b.max.y) shortsL = redL[ri];
        if (!helmL || redL[ri].b.max.y > helmL.b.max.y) helmL = redL[ri];
      }
      if (skinL && skinL.b) {
        // silhouette profile of the skin/beige mesh: per 0.1 y-slice how far
        // the surface reaches in x. That is the map the jersey split reads —
        // it shows where the torso ends and the arms / hands begin.
        // geometry is authored in cm; the mesh node is identity and the
        // 0.01 lives in the skin bind, so model units come from
        // boneTransform at bind pose + matrixWorld (same as skinnedBox)
        var spos = skinL.o.geometry.attributes.position;
        var mw = skinL.o.matrixWorld, gv = new THREE.Vector3();
        var prof = [];
        for (var s = 0; s < 15; s++) prof.push({ n: 0, mx: 0, out: 0 });
        for (var si = 0; si < spos.count; si++) {
          gv.fromBufferAttribute(spos, si);
          if (skinL.o.boneTransform) skinL.o.boneTransform(si, gv);
          gv.applyMatrix4(mw);
          var sl = Math.floor(gv.y / 0.1);
          if (sl < 0 || sl >= 15) continue;
          var ax = Math.abs(gv.x);
          var e = prof[sl];
          e.n++;
          if (ax > e.mx) e.mx = ax;
          if (ax > 0.25) e.out++;
        }
        if (!skinL.o.geometry.boundingBox) skinL.o.geometry.computeBoundingBox();
        log('[GLB] kit survey: skin mesh y=' + skinL.b.min.y.toFixed(2) + '..' + skinL.b.max.y.toFixed(2) +
          ' x=' + skinL.b.min.x.toFixed(2) + '..' + skinL.b.max.x.toFixed(2) +
          ' geomY=[' + (skinL.o.geometry.boundingBox ? skinL.o.geometry.boundingBox.min.y.toFixed(2) + ',' +
            skinL.o.geometry.boundingBox.max.y.toFixed(2) : '?') + ']');
        log('[GLB] kit profile (y: verts, max|x|, |x|>0.25): ' +
          prof.map(function (e, i) {
            return (i * 0.1).toFixed(1) + ':' + e.n + '/' + e.mx.toFixed(2) + '/' + e.out;
          }).join(' '));
        // where exactly do the arms leave the torso? bucket |x| for the
        // chest band only — the gap between torso and arm is the tint cut
        var buckets = {};
        for (si = 0; si < spos.count; si++) {
          gv.fromBufferAttribute(spos, si);
          if (skinL.o.boneTransform) skinL.o.boneTransform(si, gv);
          gv.applyMatrix4(mw);
          if (gv.y < 0.60 || gv.y > 1.12) continue;
          var b2 = (Math.floor(Math.abs(gv.x) / 0.02) * 0.02).toFixed(2);
          buckets[b2] = (buckets[b2] || 0) + 1;
        }
        log('[GLB] kit torso-band |x| buckets(0.02): ' +
          Object.keys(buckets).sort(function (a, b) { return Number(a) - Number(b); })
            .map(function (k) { return k + ':' + buckets[k]; }).join(' '));
        if (shortsL && shortsL.b && helmL && helmL.b) {
          log('[GLB] kit survey: shorts y=' + shortsL.b.min.y.toFixed(2) + '..' + shortsL.b.max.y.toFixed(2) +
            ' helm y=' + helmL.b.min.y.toFixed(2) + '..' + helmL.b.max.y.toFixed(2));
        }

        // --- mark the meshes the kit tint owns, then cut the beige mesh's
        // torso out as a jersey panel (see splitShirt)
        var pi, branco = (mbox['Branco'] || [])[0];
        var marrom = (mbox['Marrom'] || [])[0];
        var preto = mbox['Preto'] || [], gloveL = null;
        for (pi = 0; pi < preto.length; pi++) {
          if (!preto[pi].b) continue;
          if (!gloveL || preto[pi].b.min.y < gloveL.b.min.y) gloveL = preto[pi];
        }
        if (shortsL && shortsL.o) shortsL.o.userData.kit = 'shorts';
        if (helmL && helmL.o) helmL.o.userData.kit = 'helmet';
        if (branco && branco.o) branco.o.userData.kit = 'socks';
        if (gloveL && gloveL.o) gloveL.o.userData.kit = 'gloves';
        if (marrom && marrom.o) marrom.o.userData.kit = 'hair';
        var splitOk = skinL.o ? splitShirt(skinL.o) : false;
        if (skinL.o && splitOk) {
          skinL.o.userData.kit = 'shirt';
          // material index 0 = jersey panel, 1 = skin (both render as the
          // skin colour until tintKit clones index 0 per player)
          if (!Array.isArray(skinL.o.material)) skinL.o.material = [skinL.o.material, skinL.o.material];
        }
        log('[GLB] kit parts: ' + ['shirt', 'shorts', 'helmet', 'socks', 'gloves', 'hair'].map(function (key) {
          var hit = '';
          scene.traverse(function (o) { if (!hit && o.userData && o.userData.kit === key) hit = o.name; });
          return key + '=' + (hit || '-');
        }).join(' ') + (splitOk ? '' : ' (no jersey split)'));
      }
    } catch (e) { warn('[GLB] kit survey failed: ' + ((e && e.message) || e)); }

    var clips = g.animations || [];
    src = {
      scene: scene, clips: clips, box: null, tris: Math.round(tris),
      meshes: meshes, bones: bones, height: 1.62, groundY: 0
    };
    // height must come from the SKINNED result: Box3.setFromObject here
    // reports the bind-pose mesh bounds (~9x too large for this rig)
    var sb = null;
    try { sb = skinnedBox(scene, true); } catch (e) { }
    if (sb && isFinite(sb.min.y) && sb.max.y > sb.min.y) {
      src.height = sb.max.y - sb.min.y;
      src.groundY = sb.min.y;
      src.box = sb;
    }
    phase = 'ready';
    var ms = Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - loadT0);
    log('[GLB] loaded ' + SRC + ' in ' + ms + 'ms: meshes=' + meshes + ' tris=' + Math.round(tris) +
      ' bones=' + bones + ' height=' + src.height.toFixed(3) + ' groundY=' + src.groundY.toFixed(3) +
      ' clips=' + (clips.length ? clips.map(function (c) { return c.name; }).join(',') : 'none') +
      ' parts=[' + parts.join(' ') + ']');
  }

  // true skinned extents: every vertex pushed through the real bone
  // transforms, so the numbers are what actually gets drawn.
  function skinnedBox(root, worldSpace) {
    var v = new THREE.Vector3(), out = new THREE.Box3(), any = false;
    root.updateMatrixWorld(true);
    root.traverse(function (o) {
      if (!o.isSkinnedMesh) return;
      var pos = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
      if (!pos) return;
      var step = Math.max(1, Math.ceil(pos.count / 6000));
      for (var i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i);
        if (o.boneTransform) o.boneTransform(i, v);
        if (worldSpace) v.applyMatrix4(o.matrixWorld);
        out.expandByPoint(v);
        any = true;
      }
    });
    return any ? out : null;
  }

  function ready() { return enabled && phase === 'ready' && !!src; }
  function setEnabled(on) { enabled = !!on; }
  function status() {
    return { phase: phase, error: errMsg, ready: ready(), enabled: enabled, src: SRC, visual: VISUAL };
  }

  function box(worldSpace) {
    return ready() ? skinnedBox(src.scene, worldSpace) : null;
  }

  // ------------------------------------------------------------
  // PHASE 3A — jersey panel split + per-player instances
  // ------------------------------------------------------------
  // The asset ships one beige "skin" mesh that also draws the chest, so
  // there is no jersey to recolour. Cut that mesh in two by material
  // group: a torso panel (measured from the model: waist -> shoulder
  // line, inside the arm line) and the rest. Vertex attributes are left
  // untouched, only the index buffer + groups change, so skinning keeps
  // working. Call once, on the master, at load.
  var SHIRT_Y = [0.60, 1.10], SHIRT_X = 0.20;
  function splitShirt(mesh) {
    try {
      var geo = mesh.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) return false;
      if (geo.groups && geo.groups.length > 1) return true;   // already split
      var pos = geo.attributes.position, idx = geo.index;
      var n = idx ? idx.count / 3 : pos.count / 3;
      var mw = mesh.matrixWorld, v = new THREE.Vector3();
      var shirt = [], rest = [], t, a, b, c, cx, cy;
      for (t = 0; t < n; t++) {
        a = idx ? idx.getX(t * 3) : t * 3;
        b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        cx = 0; cy = 0;
        for (var q = 0; q < 3; q++) {
          v.fromBufferAttribute(pos, q === 0 ? a : q === 1 ? b : c);
          if (mesh.boneTransform) mesh.boneTransform(q === 0 ? a : q === 1 ? b : c, v);
          v.applyMatrix4(mw);
          cx += v.x; cy += v.y;
        }
        cx /= 3; cy /= 3;
        if (cy >= SHIRT_Y[0] && cy <= SHIRT_Y[1] && Math.abs(cx) <= SHIRT_X) shirt.push(a, b, c);
        else rest.push(a, b, c);
      }
      if (!shirt.length || !rest.length) return false;
      geo.setIndex(shirt.concat(rest));
      geo.clearGroups();
      geo.addGroup(0, shirt.length, 0);          // 0 = jersey panel
      geo.addGroup(shirt.length, rest.length, 1); // 1 = skin (face/arms/hands/feet)
      return true;
    } catch (e) {
      warn('[GLB] shirt split failed: ' + ((e && e.message) || e));
      return false;
    }
  }

  // one GLB = one skeleton: clone it per player (SkeletonUtils.clone
  // algorithm, core three r147 ships no copy of it) so every player gets
  // its own bone hierarchy + skeleton while geometry stays shared.
  function cloneRig(scene) {
    var clone = scene.clone(true);
    var cloneOf = {}, origOf = {};          // original uuid -> clone, clone uuid -> original
    (function map(a, b) {
      cloneOf[a.uuid] = b;
      origOf[b.uuid] = a;
      for (var i = 0; i < a.children.length; i++) map(a.children[i], b.children[i]);
    })(scene, clone);
    clone.traverse(function (node) {
      var orig = origOf[node.uuid];
      if (!node.isSkinnedMesh || !orig || !orig.skeleton) return;
      // the copied skeleton still points at the MASTER bones: rebuild it
      // on this clone's own bones (same order -> skinIndex stays valid)
      node.skeleton = orig.skeleton.clone();
      node.skeleton.bones = orig.skeleton.bones.map(function (bo) {
        return cloneOf[bo.uuid] || bo;
      });
      node.bindMatrix.copy(orig.bindMatrix);
      node.bind(node.skeleton, node.bindMatrix);
      node.frustumCulled = false;
    });
    return clone;
  }

  // per-player kit colours: materials are shared across clones, so only
  // the parts that get a team colour are cloned per instance.  Player
  // variety pass: the split beige mesh also owns skin (index 1) and the
  // separate hair mesh takes palette.hair, so two players of the same
  // team can differ in skin/hair, not just kit.
  function tintKit(scene, def) {
    var pal = (def && def.palette) || {};
    var want = {
      shirt: pal.shirt, helmet: pal.shirt,
      shorts: pal.pants, socks: pal.shoe,
      gloves: def && def.body && def.body.gloves,
      hair: pal.hair
    };
    scene.traverse(function (o) {
      var kit = o.userData && o.userData.kit;
      if (!kit || !o.material) return;
      var col = want[kit];
      if (col == null) return;
      try {
        if (kit === 'shirt' && Array.isArray(o.material)) {
          // clones share the master's array object — replace it, then tint
          // index 0 (the jersey group) and index 1 (this player's skin)
          var arr = o.material.slice();
          arr[0] = arr[0].clone();
          arr[0].color = new THREE.Color(col);
          if (pal.skin != null && arr.length > 1) {
            arr[1] = arr[1].clone();
            arr[1].color = new THREE.Color(pal.skin);
          }
          o.material = arr;
        } else {
          o.material = (Array.isArray(o.material) ? o.material[0] : o.material).clone();
          o.material.color = new THREE.Color(col);
        }
      } catch (e) { warn('[GLB] kit tint failed for ' + kit + ': ' + ((e && e.message) || e)); }
    });
  }

  // ------------------------------------------------------------
  // helpers
  // ------------------------------------------------------------
  // GLTFLoader sanitises node names (dots/brackets/colons/slashes are
  // stripped: "Leg.L_036" -> "LegL_036"), so find bones by pattern.
  function findBone(scene, re) {
    var hit = null;
    scene.traverse(function (o) {
      if (!hit && o.isBone && re.test(o.name)) hit = o;
    });
    return hit;
  }

  // ============================================================
  // PHASE 2 — RETARGETING THE BLOCKOUT ANIMATION ONTO THIS RIG
  // ============================================================

  // ---- source (BLOCKOUT) data, read once, treated as read-only ----
  // LG.Rig.sourceData() hands over the 18-bone layout (parent +
  // parent-relative offset per bone) and the CLIP_DEFS pose tables.
  var SD = undefined;   // undefined = not tried yet, null = unavailable

  function sourceData() {
    if (SD !== undefined) return SD;
    SD = null;
    try {
      if (!LG.Rig || typeof LG.Rig.sourceData !== 'function') return SD;
      var d = LG.Rig.sourceData();
      if (!d || !d.layout || !d.defs || !d.defs.idle || !d.defs.run) return SD;
      var parent = {}, pos = {}, order = [], i, j;
      for (i = 0; i < d.layout.length; i++) {
        var row = d.layout[i];
        parent[row[0]] = row[1];
        pos[row[0]] = [row[2] || 0, row[3] || 0, row[4] || 0];
        order.push(row[0]);
      }
      // segment direction of each source bone, in its own local frame.
      // Layout rows are parent-relative, so a bone's child offset IS its
      // local segment; end bones (head) have none and keep +Y.
      var dir = {}, first = {};
      for (i = 0; i < order.length; i++) {
        var n = order[i];
        first[n] = null;
        for (j = 0; j < order.length; j++) {
          if (parent[order[j]] === n) { first[n] = order[j]; break; }
        }
        var c = first[n] ? pos[first[n]] : null;
        var v = new THREE.Vector3(c ? c[0] : 0, c ? c[1] : 1, c ? c[2] : 0);
        dir[n] = (v.lengthSq() < 1e-12) ? new THREE.Vector3(0, 1, 0) : v.normalize();
      }
      SD = { defs: d.defs, order: order, parent: parent, pos: pos, dir: dir, first: first };
    } catch (e) {
      SD = null;
    }
    return SD;
  }

  // source bone -> target bone (target names are GLTFLoader-sanitised)
  var BONE_MAP = [
    ['spine', /^Chest_/],
    ['chest', /^Traps_/],
    ['neck', /^Neck_/],
    ['head', /^Head_/],
    ['armL', /^ArmL/], ['forearmL', /^ForearmL/],
    ['armR', /^ArmR/], ['forearmR', /^ForearmR/],
    ['legL', /^LegL/], ['shinL', /^CalfL/],
    ['legR', /^LegR/], ['shinR', /^CalfR/]
  ];

  function eulerQ(a) {
    if (!a) return new THREE.Quaternion();
    return new THREE.Quaternion().setFromEuler(
      new THREE.Euler(a[0] || 0, a[1] || 0, a[2] || 0, 'XYZ'));
  }

  // ---- clip variants: every one derived from CLIP_DEFS ------------
  // amp  = how wide the limb cycle swings (stride)
  // durS = how long one cycle takes
  // bobS = how much the hips bob
  // lean = extra forward pitch (sprint)
  var VAR_TUNE = {
    idle: { def: 'idle', amp: 1.00, durS: 1.00, bobS: 1.00, lean: null },
    jog: { def: 'run', amp: 0.70, durS: 1.30, bobS: 0.75, lean: null },
    run: { def: 'run', amp: 1.00, durS: 1.00, bobS: 1.00, lean: null },
    sprint: { def: 'run', amp: 1.15, durS: 0.85, bobS: 1.25, lean: { spine: 0.10, chest: 0.05, head: -0.08 } },
    stop: { def: null, amp: 1.00, durS: 1.00, bobS: 1.00, lean: null }
  };

  // the stop cycle is authored in BLOCKOUT pose space from the run's
  // contact key and the idle standing key, so both hand-offs are
  // pose-continuous and the crossfade can do the rest.
  var BRAKE = {
    legR: [-0.55, 0, 0], shinR: [0.35, 0, 0],
    legL: [0.42, 0, 0], shinL: [0.55, 0, 0],
    armL: [-0.35, 0, 0.18], armR: [-0.35, 0, -0.18],
    forearmL: [-0.55, 0, 0], forearmR: [-0.55, 0, 0],
    spine: [-0.10, 0, 0], chest: [-0.04, 0, 0], head: [0.06, 0, 0]
  };
  var SETTLE = {
    legR: [-0.14, 0, 0], shinR: [0.20, 0, 0],
    legL: [0.10, 0, 0], shinL: [0.22, 0, 0],
    armL: [-0.08, 0, 0.13], armR: [-0.08, 0, -0.13],
    forearmL: [-0.30, 0, 0], forearmR: [-0.30, 0, 0],
    spine: [0.04, 0, 0], chest: [0.02, 0, 0], head: [0.01, 0, 0]
  };
  var STOP_DUR = 0.62;

  function scalePose(p, amp, lean) {
    var out = {}, b;
    if (p) {
      for (b in p) {
        var v = p[b];
        out[b] = [(v[0] || 0) * amp, (v[1] || 0) * amp, (v[2] || 0) * amp];
      }
    }
    if (lean) {
      for (b in lean) {
        if (!out[b]) out[b] = [0, 0, 0];
        out[b][0] = (out[b][0] || 0) + lean[b];
      }
    }
    return out;
  }

  function scaleBob(y, s) {
    var h = (y && y.hips) ? y.hips : [0, 0, 0];
    return { hips: [(h[0] || 0) * s, (h[1] || 0) * s, (h[2] || 0) * s] };
  }

  function variantDef(name, defs) {
    var t = VAR_TUNE[name];
    if (!t) return null;
    if (name === 'stop') {
      var r0 = defs.run.keys[0], i0 = defs.idle.keys[0];
      return {
        dur: STOP_DUR,
        keys: [
          { t: 0, p: scalePose(r0.p, 1, null), y: scaleBob(r0.y, 1) },
          { t: 0.16, p: scalePose(BRAKE, 1, null), y: scaleBob({ hips: [0, -0.03, 0] }, 1) },
          { t: 0.36, p: scalePose(SETTLE, 1, null), y: scaleBob({ hips: [0, -0.01, 0] }, 1) },
          { t: STOP_DUR, p: scalePose(i0.p, 1, null), y: scaleBob(i0.y, 1) }
        ]
      };
    }
    var base = defs[t.def];
    if (!base) return null;
    return {
      dur: base.dur * t.durS,
      keys: base.keys.map(function (k) {
        return { t: k.t * t.durS, p: scalePose(k.p, t.amp, t.lean), y: scaleBob(k.y, t.bobS) };
      })
    };
  }

  // ---- target skeleton description ------------------------------
  function resolveTarget(scene) {
    var sd = sourceData();
    if (!sd) return null;
    var list = [], nodes = [], srcOf = {}, i, j;
    scene.traverse(function (o) {
      nodes.push(o);
      if (o.isBone) list.push(o);
    });
    var map = [];
    for (i = 0; i < BONE_MAP.length; i++) {
      var sn = BONE_MAP[i][0], re = BONE_MAP[i][1], bone = null;
      for (j = 0; j < list.length; j++) {
        if (re.test(list[j].name)) { bone = list[j]; break; }
      }
      if (!bone) continue;
      srcOf[bone.name] = sn;
      map.push({ src: sn, name: bone.name, bone: bone });
    }
    // bind quaternion + the bone's own segment direction (local frame).
    // Pick the child that continues the source chain; fall back to any
    // child that actually has an offset.
    for (i = 0; i < map.length; i++) {
      var m = map[i], b = m.bone;
      m.restQ = b.quaternion.clone();
      m.dirLocal = null;
      var want = sd.first[m.src], pick = null, alt = null;
      for (j = 0; j < b.children.length; j++) {
        var c = b.children[j];
        if (!c.position || c.position.lengthSq() < 1e-12) continue;
        if (!alt) alt = c;
        if (want && srcOf[c.name] === want) { pick = c; break; }
      }
      var use = pick || alt;
      if (use) m.dirLocal = use.position.clone().normalize();
    }
    var byName = {};
    for (i = 0; i < map.length; i++) byName[map[i].name] = map[i];
    return { map: map, byName: byName, sd: sd, nodes: nodes };
  }

  // lowest boot (foot + toes of both sides), measured in GROUP space
  // so gameplay lifts on the group never leak into the number.
  function measureFeet(model) {
    var g = model.group;
    if (!g) return Infinity;
    g.updateMatrixWorld(true);
    var min = Infinity, v = new THREE.Vector3();
    var pts = model.footPts || [];
    for (var i = 0; i < pts.length; i++) {
      if (!pts[i]) continue;
      pts[i].getWorldPosition(v);
      g.worldToLocal(v);
      if (v.y < min) min = v.y;
    }
    return min;
  }

  // ---- one variant -> local quaternions per key + the body bob ----
  // k = anchor.scale (scene units per game unit), used to convert the
  // source's hips offset into this skeleton's units.
  function bakeVariant(def, tgt, scene, bob, bobRest, k) {
    var sd = tgt.sd, keys = [], ki, i;
    for (ki = 0; ki < def.keys.length; ki++) {
      var key = def.keys[ki];

      // --- source forward kinematics (rotation only; the source binds
      // with identity rotations, so local = EulerXYZ(pose))
      var srcW = {};
      for (i = 0; i < sd.order.length; i++) {
        var n = sd.order[i], p = sd.parent[n];
        var q = eulerQ(key.p ? key.p[n] : null);
        srcW[n] = (p && srcW[p]) ? srcW[p].clone().multiply(q) : q;
      }

      // --- target walk, parent first: mapped bones get the swing,
      // everything else keeps its bind rotation
      var W = {};
      W[scene.uuid] = scene.quaternion.clone();
      var local = {}, solved = {};
      for (i = 0; i < tgt.nodes.length; i++) {
        var o = tgt.nodes[i];
        var pw = (o.parent && W[o.parent.uuid]) ? W[o.parent.uuid] : new THREE.Quaternion();
        var mm = tgt.byName[o.name];
        if (mm && mm.dirLocal) {
          var F = new THREE.Quaternion().multiplyQuaternions(pw, mm.restQ);
          var dCur = mm.dirLocal.clone().applyQuaternion(F);
          var dDes = sd.dir[mm.src].clone().applyQuaternion(srcW[mm.src]);
          var Q = new THREE.Quaternion().setFromUnitVectors(dCur, dDes);
          var Wt = new THREE.Quaternion().multiplyQuaternions(Q, F);
          W[o.uuid] = Wt;
          solved[o.name] = Wt.clone().premultiply(pw.clone().invert());
        } else if (mm) {
          // no segment direction: follow the bind pose
          var Wf = new THREE.Quaternion().multiplyQuaternions(pw, mm.restQ);
          W[o.uuid] = Wf;
          solved[o.name] = mm.restQ.clone();
        } else {
          W[o.uuid] = new THREE.Quaternion().multiplyQuaternions(pw, o.quaternion);
        }
      }
      for (i = 0; i < tgt.map.length; i++) {
        var e = tgt.map[i];
        local[e.name] = solved[e.name] || e.restQ;
      }

      // --- body bob: the source moves its hips in the character frame
      var bobLocal = null;
      if (bob) {
        var bp = W[bob.parent ? bob.parent.uuid : null] || new THREE.Quaternion();
        var off = new THREE.Vector3();
        if (key.y && key.y.hips) off.set(key.y.hips[0] || 0, key.y.hips[1] || 0, key.y.hips[2] || 0);
        if (k) off.multiplyScalar(1 / k);
        off.applyQuaternion(bp.clone().invert());
        bobLocal = bobRest.clone().add(off);
      }

      keys.push({ t: key.t, local: local, bob: bobLocal });
    }
    return keys;
  }

  function applyKey(tgt, scene, key, bob) {
    for (var n in key.local) {
      var m = tgt.byName[n];
      if (m) m.bone.quaternion.copy(key.local[n]);
    }
    if (key.bob && bob) bob.position.copy(key.bob);
  }

  function restoreBind(tgt, bob, bobRest) {
    for (var i = 0; i < tgt.map.length; i++) {
      tgt.map[i].bone.quaternion.copy(tgt.map[i].restQ);
    }
    if (bob && bobRest) bob.position.copy(bobRest);
  }

  function makeClip(name, keys, dur, bobName) {
    var times = [], ki;
    for (ki = 0; ki < keys.length; ki++) times.push(keys[ki].t);
    var used = {};
    for (ki = 0; ki < keys.length; ki++) {
      for (var n in keys[ki].local) used[n] = 1;
    }
    var tracks = [];
    Object.keys(used).forEach(function (n) {
      var vals = [];
      for (var i = 0; i < keys.length; i++) {
        var q = keys[i].local[n] || keys[0].local[n];
        vals.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(n + '.quaternion', times.slice(), vals));
    });
    var anyBob = false;
    for (ki = 0; ki < keys.length; ki++) if (keys[ki].bob) { anyBob = true; break; }
    if (anyBob && bobName) {
      var pvals = [];
      for (ki = 0; ki < keys.length; ki++) {
        var v = keys[ki].bob;
        pvals.push(v ? v.x : 0, v ? v.y : 0, v ? v.z : 0);
      }
      tracks.push(new THREE.VectorKeyframeTrack(bobName + '.position', times.slice(), pvals));
    }
    return new THREE.AnimationClip(name, dur, tracks);
  }

  // The asset's authored kick, re-timed: its keys are dense only in
  // [t0, t0+span] (a 2s strike) and then trail off for two minutes of
  // settle. Keep the strike, drop the trail, and start at the action.
  function buildKickClip() {
    if (!src || !src.clips || !src.clips.length) return null;
    var clip = null, i;
    for (i = 0; i < src.clips.length && !clip; i++) {
      if (/kick|shoot|strike/i.test(src.clips[i].name)) clip = src.clips[i];
    }
    if (!clip || !clip.tracks || !clip.tracks.length) return null;
    var all = [];
    for (i = 0; i < clip.tracks.length; i++) {
      var tr = clip.tracks[i];
      for (var j = 0; j < tr.times.length; j++) all.push(tr.times[j]);
    }
    if (!all.length) return null;
    all.sort(function (a, b) { return a - b; });
    var t0 = all[0], end = all[all.length - 1];
    for (i = 1; i < all.length; i++) {
      if (all[i] - all[i - 1] > 0.5) { end = all[i - 1]; break; }   // first big gap
    }
    var span = end - t0;
    if (!(span > 0.01)) return null;
    var tracks = [];
    for (i = 0; i < clip.tracks.length; i++) {
      var t = clip.tracks[i], vs = t.getValueSize(), times = [], vals = [], c;
      for (var n = 0; n < t.times.length; n++) {
        var tt = t.times[n] - t0;
        if (tt < -1e-4 || tt > span + 1e-4) continue;
        times.push(tt);
        for (c = 0; c < vs; c++) vals.push(t.values[n * vs + c]);
      }
      if (!times.length) continue;
      if (times[0] > 1e-4) {                       // pad the start
        times.unshift(0);
        var head = vals.slice(0, vs);
        for (c = head.length - 1; c >= 0; c--) vals.unshift(head[c]);
      }
      if (times[times.length - 1] < span - 1e-4) { // pad the end
        times.push(span);
        var tail = vals.slice(vals.length - vs);
        for (c = 0; c < vs; c++) vals.push(tail[c]);
      }
      tracks.push(new t.constructor(t.name, times, vals));
    }
    if (!tracks.length) return null;
    return { clip: new THREE.AnimationClip('kick', span, tracks), span: span };
  }

  // ---- kick contact: probe the authored clip and find the frame where
  // the boot is furthest forward (model forward = +z) ----
  var KICK_LEN = 0.8;       // gameplay window the authored strike runs in
  var KICK_LEAD = 0.12;    // wind-up shown before the strike, in seconds

  function snapshotSkeleton(scene) {
    var snap = [];
    scene.traverse(function (o) { snap.push({ o: o, q: o.quaternion.clone(), p: o.position.clone() }); });
    return snap;
  }

  function applySnapshot(snap) {
    for (var i = 0; i < snap.length; i++) {
      snap[i].o.quaternion.copy(snap[i].q);
      snap[i].o.position.copy(snap[i].p);
    }
  }

  function findStrike(kick, scene) {
    var mixer = new THREE.AnimationMixer(scene);
    var act = mixer.clipAction(kick.clip);
    act.play();
    var pts = [];
    scene.traverse(function (o) {
      if (o.isBone && /^(Foot|Toes)/i.test(o.name)) pts.push(o);
    });
    if (!pts.length) { mixer.stopAllAction(); return 0; }
    var v = new THREE.Vector3(), zs = [], maxZ = -Infinity;
    var step = 0.02;
    for (var t = 0; t <= kick.span + 1e-6; t += step) {
      mixer.setTime(t);
      scene.updateMatrixWorld(true);
      var mz = -Infinity;
      for (var i = 0; i < pts.length; i++) {
        pts[i].getWorldPosition(v);
        if (v.z > mz) mz = v.z;
      }
      zs.push(mz);
      if (mz > maxZ) maxZ = mz;
    }
    mixer.stopAllAction();
    var strike = 0;
    for (var j = 0; j < zs.length; j++) {
      if (zs[j] >= maxZ - 0.02) { strike = j * step; break; }   // first frame at full reach
    }
    return strike;
  }

  // ------------------------------------------------------------
  // build the clip bank for one model instance
  // ------------------------------------------------------------
  // The baked bank (per-clip local quaternions, grounding bias, the re-timed
  // kick, the created AnimationClips) is pure data: same source clips, same
  // skeleton layout, same scale -> same output. Clones only differ by which
  // bone objects they own, so bake it once per anchor scale (1.226 outfield,
  // 1.300 keeper) and hand every later player the cached clips. Clips address
  // bones by NAME, so one AnimationClip drives every clone's mixer. Each
  // instance still gets its own resolveTarget/bob/rest measurement below.
  var bankCache = {};

  function buildBank(model) {
    var sd = sourceData();
    if (!sd) throw new Error('no BLOCKOUT source data (LG.Rig.sourceData)');
    var tb0 = nowMs();
    var tgt = resolveTarget(model.scene);
    if (!tgt) throw new Error('source data unavailable');
    if (tgt.map.length < 10) throw new Error('target skeleton incomplete (mapped=' + tgt.map.length + ')');
    var tb1 = nowMs();

    var k = model.anchor && model.anchor.scale.x ? model.anchor.scale.x : 1;
    var cacheKey = k.toFixed(4);
    var hit = bankCache[cacheKey];

    // body bob node = lowest common ancestor of the spine and leg
    // targets (MASTER_06 here): moving it translates the whole body.
    var spineT = null, legT = null;
    for (var i = 0; i < tgt.map.length; i++) {
      if (tgt.map[i].src === 'spine') spineT = tgt.map[i].bone;
      if (tgt.map[i].src === 'legL') legT = tgt.map[i].bone;
    }
    var bob = null;
    if (spineT && legT) {
      var seen = {}, n = spineT;
      while (n) { seen[n.uuid] = 1; n = n.parent; }
      n = legT;
      while (n && !bob) { if (seen[n.uuid]) bob = n; n = n.parent; }
    }
    var bobRest = bob ? bob.position.clone() : null;

    // a previous instance may have left this shared skeleton mid-pose:
    // snap back to bind before the foot reference is measured
    restoreBind(tgt, bob, bobRest);
    var restFootY = measureFeet(model);
    if (!isFinite(restFootY)) restFootY = 0;

    if (hit) {
      // reuse the baked clips; only this instance's bone map was needed
      var th = nowMs();
      log('[GLB] bank ms: resolve=' + (tb1 - tb0).toFixed(1) +
        ' bake=0.0(cached) kick=0.0(cached) bind=' + (th - tb1).toFixed(1) +
        ' k=' + k.toFixed(3));
      return {
        tgt: tgt, clips: hit.clips, kick: hit.kick, restFootY: restFootY,
        bias: hit.bias, bobName: hit.bobName, scaledBy: k,
        clipNames: hit.clipNames
      };
    }

    var names = ['idle', 'jog', 'run', 'sprint', 'stop'];
    var clips = {}, baked = {}, bias = {};
    for (i = 0; i < names.length; i++) {
      var nm = names[i];
      var def = variantDef(nm, sd.defs);
      if (!def) throw new Error('missing source clip for ' + nm);
      var keys = bakeVariant(def, tgt, model.scene, bob, bobRest, k);

      // grounding: how far the lowest boot dips under its rest height
      // anywhere in this clip (static, so the cycle never penetrates)
      var min = Infinity;
      for (var j = 0; j < keys.length; j++) {
        applyKey(tgt, model.scene, keys[j], bob);
        var m = measureFeet(model);
        if (m < min) min = m;
      }
      var lift = Math.max(0, restFootY - min);
      restoreBind(tgt, bob, bobRest);
      bias[nm] = Math.round(lift * 10000) / 10000;

      var sceneLift = k ? lift / k : lift;
      if (sceneLift > 0) {
        for (j = 0; j < keys.length; j++) {
          if (!keys[j].bob) continue;
          keys[j].bob = new THREE.Vector3(keys[j].bob.x, keys[j].bob.y + sceneLift, keys[j].bob.z);
        }
      }
      baked[nm] = keys;
      clips[nm] = makeClip(nm, keys, def.dur, bob ? bob.name : null);
    }

    restoreBind(tgt, bob, bobRest);

    var tb2 = nowMs();
    var kick = null;
    try { kick = buildKickClip(); } catch (e) { kick = null; }
    if (!kick) warn('[GLB] no authored kick clip found in the asset');
    else {
      // where does the boot swing through the ball? gameplay kicks the
      // ball on the very frame the window opens, so the clip is started
      // just before that frame instead of at its wind-up.
      var snap = snapshotSkeleton(model.scene);
      try { kick.strike = findStrike(kick, model.scene); } catch (e) { kick.strike = 0; }
      applySnapshot(snap);
      var ts = kick.span / KICK_LEN;
      kick.start = Math.max(0, kick.strike - KICK_LEAD * ts);
    }
    var tb3 = nowMs();
    log('[GLB] bank ms: resolve=' + (tb1 - tb0).toFixed(1) +
      ' bake=' + (tb2 - tb1).toFixed(1) + ' kick=' + (tb3 - tb2).toFixed(1) +
      ' k=' + (model.anchor && model.anchor.scale.x ? model.anchor.scale.x.toFixed(3) : '?'));

    var bobName = bob ? bob.name : null;
    bankCache[cacheKey] = {
      clips: clips, kick: kick, bias: bias, bobName: bobName,
      clipNames: names.concat(kick ? ['kick'] : [])
    };

    return {
      tgt: tgt, clips: clips, kick: kick, restFootY: restFootY,
      bias: bias, bobName: bobName, scaledBy: k,
      clipNames: names.concat(kick ? ['kick'] : [])
    };
  }

  // ------------------------------------------------------------
  // controller — same public contract as LG.Rig's animation controller
  // ------------------------------------------------------------
  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  var MIN_DWELL = 0.15;      // stops jog<->run chatter from re-cutting fades

  function controller(model) {
    var bank = buildBank(model);
    var clips = bank.clips;
    var mixer = new THREE.AnimationMixer(model.group);
    var actions = {};
    Object.keys(clips).forEach(function (nm) {
      var a = mixer.clipAction(clips[nm]);
      a.enabled = false;
      a.setEffectiveWeight(0);
      actions[nm] = a;
    });
    var kick = null;
    if (bank.kick) {
      kick = mixer.clipAction(bank.kick.clip);
      kick.enabled = false;
      kick.setEffectiveWeight(0);
      actions.kick = kick;
    }

    var cur = null, kickT = 0, wasKick = false, last = 0, fails = 0;
    var stopT = 0, peak = 0, since = 99, lastSpd = 0, lastError = '';
    var seen = {}, lift = 0, ground = 0, primed = false;
    var baseY = model.anchor ? model.anchor.position.y : 0;

    // LOCOMOTION cadence follows the game's own rhythm: player.js
    // advances phase by (2.2 + speed^2 * 0.55) rad/s, which is
    // (2.2 + speed^2 * 0.55) / 2PI cycles per second. Driving the clip
    // clock the same way keeps this body in step with the procedural
    // ones and costs nothing when standing still (0.35 cycles/s of
    // breathing).
    function cyclesPerSec(sp2) {
      return (2.2 + sp2 * 0.55) / (Math.PI * 2);
    }

    function fadeFor(from, to) {
      if (to === 'kick' || from === 'kick') return 0.10;
      if (to === 'stop' || from === 'stop') return 0.14;
      return 0.16;
    }

    // start `next`, fade everything else out from ITS CURRENT weight
    // (three's fadeOut() always schedules 1 -> 0, which would flash a
    // clip that is still fading in)
    function fadeOut(o, dt) {
      if (!o) return;
      var w = o.getEffectiveWeight();
      if (dt <= 0 || w <= 0) { o.setEffectiveWeight(0); return; }
      if (typeof o._scheduleFading === 'function') o._scheduleFading(dt, w, 0);
      else o.fadeOut(dt);
    }

    function transition(next) {
      var a = actions[next];
      if (!a) return;
      // the very first action starts at weight 0, so fading it in would
      // leave the skeleton at bind for the whole fade — start it hard
      var fade = primed ? fadeFor(cur, next) : 0;
      primed = true;
      cur = next;
      a.enabled = true;
      a.reset();
      if (next === 'kick' || next === 'stop') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      } else {
        a.setLoop(THREE.LoopRepeat, Infinity);
        a.clampWhenFinished = false;
      }
      a.setEffectiveWeight(1);
      a.play();
      // start the strike just before the boot reaches the ball (the ball
      // leaves on the first frame of the window)
      if (next === 'kick' && bank.kick) a.time = bank.kick.start || 0;
      if (fade > 0) a.fadeIn(fade);
      Object.keys(actions).forEach(function (nm) {
        if (nm === next) return;
        var o = actions[nm];
        if (o.enabled && o.getEffectiveWeight() > 0) fadeOut(o, fade);
      });
      if (!seen[next]) { seen[next] = 1; log('[GLB] state: ' + next); }
    }

    // keep the lowest boot on the pitch. During the kick window the
    // authored pose leaves both feet in the air, so the lock is allowed to
    // PULL the body down; anywhere else it only lifts out of the deck (a
    // running figure is allowed to be airborne).
    // The error is measured against the pose WITHOUT the lift that is
    // already applied (feet = pose + lift) — feeding the shifted number
    // back in would flip the sign every frame and bob the whole body.
    function groundLock(dt, force) {
      var a = model.anchor;
      if (!a) return;
      var min = measureFeet(model);
      if (!isFinite(min)) return;
      var err = bank.restFootY - min + lift;
      var want = force ? err : Math.max(0, err);
      var kk = dt > 0 ? Math.min(1, dt * 30) : 1;
      lift += (want - lift) * kk;
      if (Math.abs(want - lift) < 1e-4) lift = want;
      a.position.y = baseY + lift;
      ground = a.position.y;
    }

    function onFail(e) {
      fails++;
      lastError = (e && e.message) || String(e);
      if (fails === 1) warn('[GLB] animation update error: ' + lastError);
      if (fails > 3) return false;
      return true;
    }

    function setTimeScales(sp2, cyc) {
      Object.keys(actions).forEach(function (nm) {
        var a = actions[nm];
        if (nm === 'kick') {
          a.setEffectiveTimeScale(bank.kick ? bank.kick.span / KICK_LEN : 1);
        } else if (nm === 'stop') {
          a.setEffectiveTimeScale(1);            // plays its 0.62s in 0.62s
        } else {
          a.setEffectiveTimeScale(Math.max(0.05, cyc * clips[nm].duration));
        }
      });
    }

    function advance(rdt, p) {
      var vx = p.vx || 0, vz = p.vz || 0;
      var sp2 = vx * vx + vz * vz;
      var spd = Math.sqrt(sp2);
      var maxS = p.maxSpeed || 5;
      var spd01 = Math.min(1, spd / maxS);
      lastSpd = spd01;

      // gameplay kick window: the whole authored strike runs inside it
      var kicking = p.kickAnim > 0;
      if (kicking && !wasKick) kickT = KICK_LEN;
      wasKick = kicking;
      if (kickT > 0) { kickT -= rdt; if (kickT < 0) kickT = 0; }

      // deceleration bookkeeping: a one-shot stop when a sprint/run
      // bleeds off, cancelled if the player is moving again
      if (spd01 >= 0.32) { peak = spd01; if (spd01 > 0.30) stopT = 0; }
      else if (peak > 0.32 && stopT === 0) { stopT = STOP_DUR; peak = 0; }
      if (stopT > 0) { stopT -= rdt; if (stopT < 0) stopT = 0; }

      var want;
      if (kickT > 0 && kick) want = 'kick';
      else if (stopT > 0 && actions.stop) want = 'stop';
      else if (spd01 < 0.14) want = 'idle';
      // hysteresis on the jog/run boundary so a hovering speed cannot
      // re-cut the crossfade every frame
      else if (spd01 < (cur === 'jog' ? 0.50 : 0.44)) want = 'jog';
      else if (p.sprinting && spd01 > 0.35) want = 'sprint';
      else want = 'run';

      since += rdt;
      if (want !== cur) {
        var urgent = (want === 'kick' || want === 'stop' || cur === 'kick');
        if (urgent || since >= MIN_DWELL) transition(want);
      }

      setTimeScales(sp2, cyclesPerSec(sp2));
      mixer.update(rdt);
      groundLock(rdt, kickT > 0);
      return true;
    }

    // prime the skeleton with the idle clip so the mixer paints a real
    // pose (and snapshots every bone) on the very first frame
    transition('idle');
    setTimeScales(0, cyclesPerSec(0));
    mixer.update(0);
    groundLock(0, false);

    return {
      state: function () {
        var a = actions[cur];
        var durs = {};
        Object.keys(actions).forEach(function (nm) { durs[nm] = actions[nm].getClip().duration; });
        return {
          cur: cur, fails: fails, time: mixer.time, kick: kickT,
          weight: a ? a.getEffectiveWeight() : 0,
          base: a ? a.weight : 0,
          lastError: lastError,
          ground: Math.round(ground * 1000) / 1000,
          restFoot: Math.round(bank.restFootY * 1000) / 1000,
          bobY: (function () {
            var bn = bank.bobName ? model.group.getObjectByName(bank.bobName) : null;
            return bn ? Math.round(bn.position.y * 1000) / 1000 : null;
          })(),
          // PHASE 2: real clips, no limb-maths shim anywhere
          retarget: 1, shim: 0,
          clips: bank.clipNames.join(','),
          durs: durs,
          mapped: bank.tgt.map.length,
          bob: bank.bobName,
          spd: Math.round(lastSpd * 100) / 100,
          ts: a ? Math.round(a.getEffectiveTimeScale() * 100) / 100 : 0,
          stopT: Math.round(stopT * 100) / 100,
          lift: Math.round(lift * 1000) / 1000,
          bias: bank.bias,
          kickClip: bank.kick ? bank.kick.clip.name : null,
          kickSpan: bank.kick ? Math.round(bank.kick.span * 100) / 100 : 0,
          kickStrike: bank.kick ? Math.round((bank.kick.strike || 0) * 100) / 100 : 0,
          kickStart: bank.kick ? Math.round((bank.kick.start || 0) * 100) / 100 : 0,
          kickLen: KICK_LEN
        };
      },
      // pin a pose at an exact clip time — frame-rate independent, for
      // the screenshot harness (same idea as LG.Rig's pose())
      pose: function (name, t) {
        try {
          var a = actions[name];
          if (!a) return false;
          // stop the others first, so whatever this clip does not write
          // is snapshotted from a clean bind pose
          Object.keys(actions).forEach(function (nm) {
            if (nm !== name && actions[nm].enabled) actions[nm].stop();
          });
          var once = (name === 'kick' || name === 'stop');
          a.enabled = true;
          a.reset();
          a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
          a.clampWhenFinished = true;
          a.setEffectiveWeight(1);
          a.play();
          var dur = a.getClip().duration;
          a.time = Math.min(Math.max(0, t || 0), Math.max(0, dur - 1e-3));
          mixer.update(0);
          cur = name;
          if (name === 'kick') { kickT = KICK_LEN; stopT = 0; }
          else { kickT = 0; stopT = (name === 'stop') ? STOP_DUR : 0; peak = 0; }
          groundLock(0, name === 'kick');
          last = nowMs();
          return true;
        } catch (e) { return onFail(e); }
      },
      step: function (rdt, p) {
        try { return advance(rdt, p); } catch (e) { return onFail(e); }
      },
      update: function (dt, p) {
        try {
          var t = nowMs();
          // Match passes dt=0 outside PLAY, so drive from a real clock
          // exactly like LG.Rig does
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
  // build — one model instance per player. The loaded GLB master
  // (`src.scene`) is never reparented: every player gets its own
  // skeleton-safe clone, so bones/mixers never fight while the
  // geometry (and its jersey split) stays shared.
  // ------------------------------------------------------------
  function build(def) {
    if (!ready()) return null;
    try {
      if (LG.Cosmetics && LG.Cosmetics.resolve) def = LG.Cosmetics.resolve(def);
      var w0 = nowMs();
      var scene = cloneRig(src.scene);
      var w1 = nowMs();

      var group = new THREE.Group();     // player.js sets scale/pos/rotation.y
      var body = new THREE.Group();      // holder
      var anchor = new THREE.Group();    // height match + ground lock live here
      group.add(body);
      body.add(anchor);
      anchor.add(scene);
      tintKit(scene, def);
      var w2 = nowMs();

      var limbs = {
        legL: findBone(scene, /^LegL/i),
        legR: findBone(scene, /^LegR/i),
        armL: findBone(scene, /^ArmL/i),
        armR: findBone(scene, /^ArmR/i)
      };
      var feet = {
        footL: findBone(scene, /^FootL/i),
        footR: findBone(scene, /^FootR/i)
      };
      // lowest points of both boots: foot + toes
      var footPts = [
        feet.footL, feet.footR,
        findBone(scene, /^ToesL/i), findBone(scene, /^ToesR/i)
      ].filter(Boolean);
      if (!footPts.length) warn('[GLB] no foot bones found for the ground lock');
      if (!limbs.legL || !limbs.legR || !limbs.armL || !limbs.armR) {
        warn('[GLB] limb bones not found');
      }

      // match the BLOCKOUT player height (player.js markers/heights are
      // built from 1.62 * body.tall, not from this model), scaled by the
      // Phase-3A uniform visible-size factor
      var want = 1.62 * (def && def.body && def.body.tall ? def.body.tall : 1) * VISUAL;
      var k = src.height > 0 ? want / src.height : 1;
      anchor.scale.set(k, k, k);
      group.updateMatrixWorld(true);

      var m = {
        group: group, body: body, anchor: anchor, scene: scene,
        limbs: limbs, feet: feet, footPts: footPts,
        height: src.height,
        skinned: true,
        glb: true
      };
      if (LG.Cosmetics && LG.Cosmetics.decorate) {
        try { LG.Cosmetics.decorate(m, def); }
        catch (e) { warn('[GLB] cosmetics: ' + ((e && e.message) || e)); }
      }
      m.anim = controller(m);
      var w3 = nowMs();
      log('[GLB] build ms: clone=' + (w1 - w0).toFixed(1) +
        ' tint=' + (w2 - w1).toFixed(1) + ' bank+ctrl=' + (w3 - w2).toFixed(1) +
        ' total=' + (w3 - w0).toFixed(1));
      log('[GLB] player built: tris=' + src.tris + ' bones=' + src.bones +
        ' modelHeight=' + src.height.toFixed(3) + ' scaledBy=' + k.toFixed(3) +
        ' kit=' + (def && def.palette ? '#' + (def.palette.shirt >>> 0).toString(16) : '?') +
        ' clips=' + (m.anim.state().clips || '?') +
        ' mapped=' + m.anim.state().mapped +
        ' limbs=' + ['legL', 'legR', 'armL', 'armR'].map(function (key) {
          return key + (limbs[key] ? '=' + limbs[key].name : '?');
        }).join(' '));
      return m;
    } catch (e) {
      warn('[GLB] FALLBACK: build failed -> ' + ((e && e.message) || e));
      return null;
    }
  }

  // called by player.js for the single test slot; never throws
  function buildForTest(def) {
    if (ready()) {
      var m = build(def);
      if (m) return m;
    } else if (phase === 'loading') {
      log('[GLB] test player skipped (still ' + phase + '), using procedural body');
    }
    return null;
  }

  preload();   // start the download immediately

  return {
    preload: preload,
    ready: ready,
    status: status,
    build: build,
    buildForTest: buildForTest,
    box: box,
    setEnabled: setEnabled,
    setLogging: setLogging,
    sourceData: function () { return sourceData(); },
    SRC: SRC
  };
})();
