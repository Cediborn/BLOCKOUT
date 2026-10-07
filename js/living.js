// ============================================================
// LIVING — the block's "living layer": traffic on the road ring,
// bikes on the quiet outer loop, pedestrians walking the sidewalk
// ring and watchers stood at the fence, purely cosmetic (never in
// the game's collision/goal/particles lists) and court-agnostic.
//
// Pedestrians/watchers render as ONE set of InstancedMeshes (6
// draws for all 24 figures, same architecture as LG.Crowd) — the
// old path asked LG.Models.buildCharacter for a {team}-only figure,
// which has always thrown to its own try/catch, so the sidewalks
// were empty. On a goal the figures do a little cheer pulse via
// the shared LG.eventBus.
// ============================================================

var LG = window.LG = window.LG || {};

LG.Living = (function () {
  var LG = window.LG;
  var scene = null;
  var movers = [];          // cars/bikes: { kind, g, ... } — figures: data only
  var fig = null;           // instanced figure set { root, parts }
  var watcherSpots = [];    // static placements (also handed to tests)
  var pulse = 0;            // seconds left in the cheer pulse
  var clock = 0;            // shared idle clock for watchers
  var sub = false;          // eventBus subscription guard

  var CARS = 12, BIKES = 8, PEDS = 14, WATCHERS = 10;
  // sidewalk ring: every point stays inside the S/N (z<=35) and E/W
  // (x<=30) sidewalk bands, clear of benches, bollards and the crowd
  var WALK = 28;
  // traffic lane of the road ring (parked cars hug the kerb at z+-36.4 /
  // x+-31.4, so the moving lane takes the outer half)
  var CAR_RX = 34.2, CAR_RZ = 39.5;
  // quiet outer loop, just outside the back building rows
  var BIKE_R = 61;
  var HIP = 0.74;           // hip height so feet land on the ground

  // ---- rect ring path: perimeter |x| = Rx or |z| = Rz (t in [0,1)) ----
  function ringPos(Rx, Rz, t) {
    var L = 4 * (Rx + Rz);         // perimeter
    var s = (t * L) % L;
    if (s < 0) s += L;
    var p = { x: 0, z: 0, dx: 0, dz: 0 };
    if (s < 2 * Rz) { p.x = Rx; p.z = -Rz + s; p.dx = 0; p.dz = 1; }
    else if ((s -= 2 * Rz) < 2 * Rx) { p.x = Rx - s; p.z = Rz; p.dx = -1; p.dz = 0; }
    else if ((s -= 2 * Rx) < 2 * Rz) { p.x = -Rx; p.z = Rz - s; p.dx = 0; p.dz = -1; }
    else { s -= 2 * Rz; p.x = -Rx + s; p.z = -Rz; p.dx = 1; p.dz = 0; }
    return p;
  }

  function mesh(color) {
    var m = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ color: color })
    );
    m.castShadow = true;
    return m;
  }

  // ---- little car ----
  function makeCar(color) {
    var g = new THREE.Group();
    var body = mesh(color || 0xe74c3c);
    body.scale.set(2.2, 0.8, 1.0);
    body.position.y = 0.55;
    var roof = mesh(0xffffff);
    roof.scale.set(1.2, 0.5, 0.9);
    roof.position.set(0, 1.0, 0);
    var w1 = mesh(0x222222), w2 = mesh(0x222222),
        w3 = mesh(0x222222), w4 = mesh(0x222222);
    w1.scale.set(0.4, 0.4, 0.4); w1.position.set(-0.9, 0.2, -0.7);
    w2.scale.set(0.4, 0.4, 0.4); w2.position.set(0.9, 0.2, -0.7);
    w3.scale.set(0.4, 0.4, 0.4); w3.position.set(-0.9, 0.2, 0.7);
    w4.scale.set(0.4, 0.4, 0.4); w4.position.set(0.9, 0.2, 0.7);
    g.add(body, roof, w1, w2, w3, w4);
    return g;
  }

  // ---- little bike: two wheel rings + frame (torus optional) ----
  function makeBike() {
    var g = new THREE.Group();
    var wheelGeo = null;
    try { wheelGeo = new THREE.TorusGeometry(0.34, 0.08, 6, 10); } catch (e) { wheelGeo = null; }
    if (!wheelGeo) {
      // stub-safe fallback (headless THREE may lack TorusGeometry)
      var wd = mesh(0x2c3e50); wd.scale.set(0.75, 0.1, 0.75);
      var wd2 = mesh(0x2c3e50); wd2.scale.set(0.75, 0.1, 0.75);
      var ex = mesh(0x34495e); ex.scale.set(0.08, 0.5, 1.15);
      wd.position.set(0, 0.30, -0.6); wd2.position.set(0, 0.30, 0.6);
      ex.position.y = 0.4;
      g.add(wd, wd2, ex);
      return g;
    }
    var wm = new THREE.MeshLambertMaterial({ color: 0x2c3e50 });
    var w1 = new THREE.Mesh(wheelGeo, wm);
    var w2 = new THREE.Mesh(wheelGeo, wm);
    w1.rotation.x = Math.PI / 2; w1.position.set(0, 0.34, -0.55);
    w2.rotation.x = Math.PI / 2; w2.position.set(0, 0.34, 0.55);
    var frame = mesh(0x34495e);
    frame.scale.set(0.08, 0.3, 1.1);
    frame.position.y = 0.45;
    g.add(w1, w2, frame);
    return g;
  }

  function cheer() {
    pulse = 0.65;   // kick the figure bob on a real goal (safe: sets the
                    // *pulse timer*, never the function binding — historical
                    // "cheer = 0.65" reassigned this function-name's binding
                    // to a Number and that Number landed in the goal-listener
                    // array via bus.on('goal', cheer), throwing
                    // "l[i] is not a function" on the very first goal emit.
  }

  // ================================================================
  // instanced bystander figures — one set of InstancedMeshes for all
  // walkers + watchers (6 draws total, mirroring LG.Crowd)
  // ================================================================
  function box(w, h, d, x, y, z) {
    var g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  }
  // minimal merge for Box/Sphere pieces (three r147 ships no
  // BufferGeometryUtils) — concatenates non-indexed position/normal/uv
  function merge(list) {
    var pos = [], nor = [], uv = [], idx = [], off = 0;
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      var ng = g.index ? g.toNonIndexed() : g;
      var p = ng.attributes.position, n = ng.attributes.normal, u = ng.attributes.uv;
      for (var k = 0; k < p.count; k++) {
        pos.push(p.getX(k), p.getY(k), p.getZ(k));
        nor.push(n.getX(k), n.getY(k), n.getZ(k));
        uv.push(u ? u.getX(k) : 0, u ? u.getY(k) : 0);
        idx.push(off + k);
      }
      off += p.count;
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.setIndex(idx);
    return out;
  }

  function figureGeos() {
    // body space: hip pivot at origin, +Y up, feet at -0.74
    var leg = merge([
      box(0.115, 0.70, 0.14, 0, -0.36, 0.012),
      box(0.125, 0.075, 0.21, 0, -0.70, 0.045),
    ]);
    var torso = new THREE.CapsuleGeometry(0.16, 0.42, 3, 7);
    torso.translate(0, 0.36, 0);            // origin at the waist
    var head = new THREE.SphereGeometry(0.115, 8, 6);
    head.translate(0, 0.12, 0.012);
    // top-cap sphere (thetaLength) instead of scaling a full sphere: the
    // headless THREE stub exposes geometry.scale as a vec3 property
    var hair = new THREE.SphereGeometry(0.124, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55);
    hair.translate(0, 0.125, 0.006);        // cap over the head top
    var arm = box(0.085, 0.30, 0.085, 0, -0.15, 0);   // origin -> shoulder
    var hand = new THREE.SphereGeometry(0.055, 5, 4);
    hand.translate(0, -0.33, 0);            // origin -> shoulder
    return { leg: leg, torso: torso, head: head, hair: hair, arm: arm, hand: hand };
  }

  // street-clothes pools (fixed order — stable per boot)
  var SHIRTS = [0x3d4a63, 0x6b3d66, 0x3d6b50, 0x6b603d, 0x8b4a3a, 0x3a6b8b,
                0x7a5a2b, 0x5a3d7a, 0x2f6b6b, 0x8b5a2f, 0x4a5a2f, 0x7a3d4a,
                0xa94a3a, 0x4a6a8a];
  var PANTS = [0x2a2e38, 0x3a3038, 0x2e3a2e, 0x3a3a3a, 0x4a3a2a, 0x22262e];
  var SKINS = [0xc99a76, 0xe0b48f, 0x8d5a3b, 0x6b4229, 0xa9744f, 0xd8a778];
  var HAIRS = [0x1d1d22, 0x3a2a1a, 0x6b4a2a, 0x171a20, 0x55504a, 0x7a5a2b];

  function makeFigureSet(n) {
    var geos = figureGeos();
    var white = function () { return new THREE.MeshLambertMaterial({ color: 0xffffff }); };
    var mk = function (geo, count, shadow) {
      var m = new THREE.InstancedMesh(geo, white(), count);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = !!shadow;
      return m;
    };
    var parts = {
      leg: mk(geos.leg, n * 2, false),
      torso: mk(geos.torso, n, true),
      head: mk(geos.head, n, false),
      hair: mk(geos.hair, n, false),
      arm: mk(geos.arm, n * 2, false),
      hand: mk(geos.hand, n * 2, false),
    };
    var root = new THREE.Group();
    root.name = 'livingFigures';
    var names = ['leg', 'torso', 'head', 'hair', 'arm', 'hand'];
    for (var i = 0; i < names.length; i++) root.add(parts[names[i]]);
    return { root: root, parts: parts };
  }

  function colourFigures(set, offset, shirt, pants, skin, hair) {
    var c = new THREE.Color();
    var p = set.parts;
    c.setHex(pants);
    p.leg.setColorAt(offset * 2, c); p.leg.setColorAt(offset * 2 + 1, c);
    c.setHex(shirt);
    p.torso.setColorAt(offset, c);
    p.arm.setColorAt(offset * 2, c); p.arm.setColorAt(offset * 2 + 1, c);
    c.setHex(skin);
    p.head.setColorAt(offset, c);
    p.hand.setColorAt(offset * 2, c); p.hand.setColorAt(offset * 2 + 1, c);
    c.setHex(hair);
    p.hair.setColorAt(offset, c);
  }

  // static per-figure anchors (hip-space -> part pivots)
  var _A = {
    legL: null, legR: null, torso: null, neck: null, shL: null, shR: null,
  };
  function anchors() {
    if (_A.legL) return;
    var T = function (x, y, z) {
      return new THREE.Matrix4().makeTranslation ? new THREE.Matrix4().makeTranslation(x, y, z)
        : new THREE.Matrix4().compose(
            new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    };
    _A.legL = T(0.105, 0, 0);
    _A.legR = T(-0.105, 0, 0);
    _A.torso = T(0, 0.10, 0);
    _A.neck = T(0, 0.68, 0);
    _A.shL = T(0.215, 0.60, 0);
    _A.shR = T(-0.215, 0.60, 0);
  }

  // pre-allocated scratch (hot path — no per-frame allocation)
  var _B = new THREE.Matrix4(), _T = new THREE.Matrix4(), _R = new THREE.Matrix4();
  var _P = new THREE.Vector3(), _S = new THREE.Vector3(1, 1, 1), _Q = new THREE.Quaternion();
  var _E = new THREE.Euler(0, 0, 0, 'YXZ');
  var _swing = new THREE.Vector3();

  function writeFigure(set, i, x, y, z, yaw, legSwing, armSwing, lean, headYaw) {
    var p = set.parts;
    _P.set(x, y, z);
    _E.set(0, yaw, 0);
    _Q.setFromEuler(_E);
    _B.compose(_P, _Q, _S);

    _E.set(legSwing, 0, 0);
    _R.makeRotationFromEuler(_E);
    _T.multiplyMatrices(_B, _A.legL);
    _T.multiply(_R);
    p.leg.setMatrixAt(i * 2, _T);
    _E.set(-legSwing, 0, 0);
    _R.makeRotationFromEuler(_E);
    _T.multiplyMatrices(_B, _A.legR);
    _T.multiply(_R);
    p.leg.setMatrixAt(i * 2 + 1, _T);

    _E.set(lean, 0, 0);
    _R.makeRotationFromEuler(_E);
    _T.multiplyMatrices(_B, _A.torso);
    _T.multiply(_R);
    p.torso.setMatrixAt(i, _T);

    _E.set(0, headYaw, 0);
    _R.makeRotationFromEuler(_E);
    _T.multiplyMatrices(_B, _A.neck);
    _T.multiply(_R);
    p.head.setMatrixAt(i, _T);
    p.hair.setMatrixAt(i, _T);

    _E.set(armSwing, 0, 0);
    _R.makeRotationFromEuler(_E);
    _T.multiplyMatrices(_B, _A.shL);
    _T.multiply(_R);
    p.arm.setMatrixAt(i * 2, _T);
    p.hand.setMatrixAt(i * 2, _T);
    _E.set(-armSwing, 0, 0);
    _R.makeRotationFromEuler(_E);
    _T.multiplyMatrices(_B, _A.shR);
    _T.multiply(_R);
    p.arm.setMatrixAt(i * 2 + 1, _T);
    p.hand.setMatrixAt(i * 2 + 1, _T);
  }

  function flushFigures(set) {
    var names = ['leg', 'torso', 'head', 'hair', 'arm', 'hand'];
    for (var i = 0; i < names.length; i++) {
      var pm = set.parts[names[i]];
      if (pm.instanceMatrix) pm.instanceMatrix.needsUpdate = true;
    }
  }

  function build(ctx) {
    if (!ctx || !ctx.scene) return;
    if (movers.length) return;          // build once
    scene = ctx.scene;

    var i, p, m;

    // ---- cars: traffic on the road ring's outer lane ----
    var carCols = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xe67e22,
                   0x1abc9c, 0xd35400, 0x34495e, 0xc0392b, 0x2980b9, 0x27ae60];
    for (i = 0; i < CARS; i++) {
      var car = makeCar(carCols[i % carCols.length]);
      p = ringPos(CAR_RX, CAR_RZ, (i / CARS) % 1);
      car.position.set(p.x, 0, p.z);
      scene.add(car);
      movers.push({ kind: 'car', g: car, t: (i / CARS) % 1, speed: 0.04 + Math.random() * 0.015, Rx: CAR_RX, Rz: CAR_RZ, dir: i % 3 === 0 ? -1 : 1 });
    }

    // ---- bikes: quiet outer loop ----
    for (i = 0; i < BIKES; i++) {
      var bike = makeBike();
      p = ringPos(BIKE_R, BIKE_R, (i / BIKES) % 1);
      bike.position.set(p.x, 0, p.z);
      scene.add(bike);
      movers.push({ kind: 'bike', g: bike, t: (i / BIKES) % 1, speed: 0.07 + Math.random() * 0.03, Rx: BIKE_R, Rz: BIKE_R, dir: i % 2 === 0 ? -1 : 1 });
    }

    // ---- figures: instanced walkers + watchers (6 draws for all) ----
    fig = makeFigureSet(PEDS + WATCHERS);
    anchors();
    for (i = 0; i < PEDS; i++) {
      colourFigures(fig, i,
        SHIRTS[i % SHIRTS.length], PANTS[i % PANTS.length],
        SKINS[i % SKINS.length], HAIRS[i % HAIRS.length]);
      movers.push({
        kind: 'ped', idx: i, t: (i / PEDS) % 1,
        speed: 0.025 + Math.random() * 0.015, Rx: WALK, Rz: WALK,
        dir: 1, phase: Math.random() * 6.283,
      });
    }
    // watchers: standing just outside the fence on the sidewalk, facing the
    // court — east/west touchline clusters + one pair per end behind the
    // bleacher flanks (never inside the caged court)
    watcherSpots = [
      { x: 18, z: 0 }, { x: 22, z: 17 }, { x: 22, z: -17 },
      { x: -18, z: 0 }, { x: -22, z: 17 }, { x: -22, z: -17 },
      { x: 11.5, z: 30 }, { x: -11.5, z: 30 },
      { x: 11.5, z: -29 }, { x: -11.5, z: -29 },
    ];
    for (i = 0; i < WATCHERS && i < watcherSpots.length; i++) {
      var wi = PEDS + i;
      colourFigures(fig, wi,
        SHIRTS[(i + 5) % SHIRTS.length], PANTS[(i + 2) % PANTS.length],
        SKINS[(i + 3) % SKINS.length], HAIRS[(i + 1) % HAIRS.length]);
      var ws = watcherSpots[i];
      movers.push({
        kind: 'watcher', idx: wi, x: ws.x, z: ws.z,
        yaw: Math.atan2(-ws.x, -ws.z), phase: Math.random() * 6.283,
      });
    }
    scene.add(fig.root);
    flushFigures(fig);

    if (!sub && LG.eventBus && LG.eventBus.on) {
      LG.eventBus.on('goal', cheer);
      sub = true;
    }
  }

  function update(dt) {
    var i, m2, p;
    if (!movers.length) return;
    dt = dt || 0.016;
    var step = dt * 60;                 // seconds -> 60fps frames

    // ---- wheeled movers follow their rings ----
    for (i = 0; i < movers.length; i++) {
      m2 = movers[i];
      if (m2.kind !== 'car' && m2.kind !== 'bike') continue;
      m2.t = (m2.t + (m2.dir * m2.speed * step * 0.02)) % 1;
      if (m2.t < 0) m2.t += 1;
      p = ringPos(m2.Rx, m2.Rz, m2.t);
      m2.g.position.set(p.x, 0, p.z);
      m2.g.rotation.y = Math.atan2(p.dx, p.dz);
    }

    // ---- figures: walk the ring / idle at the fence ----
    clock += dt;
    var pulseBob = 0;
    if (pulse > 0) {
      pulse = Math.max(0, pulse - dt);
      pulseBob = Math.sin(pulse * 40) * 0.12;
    }
    for (i = 0; i < movers.length; i++) {
      m2 = movers[i];
      if (m2.kind === 'ped') {
        m2.phase += dt * (1.7 + m2.speed * 10) * 6.283;
        m2.t = (m2.t + (m2.dir * m2.speed * step * 0.02)) % 1;
        if (m2.t < 0) m2.t += 1;
        p = ringPos(m2.Rx, m2.Rz, m2.t);
        var yaw = Math.atan2(p.dx, p.dz);
        var sw = Math.sin(m2.phase);
        var bob = Math.abs(sw) * 0.03;
        writeFigure(fig, m2.idx, p.x, HIP + bob + pulseBob, p.z,
          yaw, sw * 0.55, -sw * 0.42, 0.07 + Math.sin(m2.phase * 0.5) * 0.02, 0);
      } else if (m2.kind === 'watcher') {
        var sway = Math.sin(clock * 0.7 + m2.phase) * 0.06;
        var wbob = Math.sin(clock * 1.4 + m2.phase) * 0.02;
        writeFigure(fig, m2.idx, m2.x, HIP + wbob + pulseBob, m2.z,
          m2.yaw + sway, 0, Math.sin(clock * 1.1 + m2.phase) * 0.12, 0.02, sway * 0.8);
      }
    }
    flushFigures(fig);
  }

  // read-only placement snapshot for the headless boot harness
  function info() {
    var w = [];
    for (var i = 0; i < watcherSpots.length; i++) w.push({ x: watcherSpots[i].x, z: watcherSpots[i].z });
    return {
      walk: WALK, car: { rx: CAR_RX, rz: CAR_RZ }, bike: BIKE_R,
      peds: PEDS, watchers: w,
    };
  }

  return { build: build, update: update, cheer: cheer, info: info };
})();
