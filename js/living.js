// ============================================================
// LIVING — a quiet decorative "living layer" for the block:
// a ring road of little cars, a bike lane, and a sidewalk of
// walkers orbit the court, purely cosmetic (never in the game's
// collision/goal/particles lists) and court-agnostic (rings are
// placed on the same clear square-corridors the arena probe
// already proved empty: cars 52 / bikes 48 / pedestrians 27).
// Pedestrians step off the court; on a goal the crowd (spectator
// clones) does a little cheer pulse via the shared LG.eventBus.
// ============================================================

var LG = window.LG = window.LG || {};

LG.Living = (function () {
  var LG = window.LG;
  var scene = null;
  var movers = [];          // { kind, g, t, speed, R, y, phase }
  var pulse = 0;            // seconds left in the crowd cheer pulse
  var sub = false;          // eventBus subscription guard

  function v3(x, y, z) {
    return { x: x, y: y, z: z };
  }

  // ---- square ring path: perimeter |x| = R or |z| = R (t in [0,1)) ----
  function ringPos(R, t) {
    var L = 8 * R;          // perimeter
    var s = (t * L) % L;
    var side = Math.floor(s / (2 * R));
    var u = (s % (2 * R)) / (2 * R);   // 0..1 along this side
    var p = { x: 0, z: 0, dx: 0, dz: 0 };
    if (side === 0) { p.x = R; p.z = -R + 2 * R * u; p.dx = 0; p.dz = 1; }
    else if (side === 1) { p.x = R - 2 * R * u; p.z = R; p.dx = -1; p.dz = 0; }
    else if (side === 2) { p.x = -R; p.z = R - 2 * R * u; p.dx = 0; p.dz = -1; }
    else { p.x = -R + 2 * R * u; p.z = -R; p.dx = 1; p.dz = 0; }
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
  function makeCar() {
    var g = new THREE.Group();
    var body = mesh(0xe74c3c);
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
    pulse = 0.65;   // kick the crowd bob on a real goal (safe: sets the
                    // *pulse timer*, never the function binding — historical
                    // "cheer = 0.65" reassigned this function-name's binding
                    // to a Number and that Number landed in the goal-listener
                    // array via bus.on('goal', cheer), throwing
                    // "l[i] is not a function" on the very first goal emit.
  }

  function build(ctx) {
    if (!ctx || !ctx.scene) return;
    if (movers.length) return;          // build once
    scene = ctx.scenemode || ctx.scene;

    var CARS = 6, BIKES = 5, PEDS = 7, i, k, m, p;

    var carCols = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xe67e22];
    for (i = 0; i < CARS; i++) {
      var car = makeCar();
      car.rotation.y = Math.random() * Math.PI;
      p = ringPos(52, (i / CARS) % 1);
      car.position.set(p.x, 0, p.z);
      scene.add(car);
      movers.push({ kind: 'car', g: car, t: (i / CARS) % 1, speed: 0.045, R: 52, dir: 1 });
    }
    for (i = 0; i < BIKES; i++) {
      var bike = makeBike();
      p = ringPos(48, (i / BIKES) % 1);
      bike.position.set(p.x, 0, p.z);
      scene.add(bike);
      movers.push({ kind: 'bike', g: bike, t: (i / BIKES) % 1, speed: 0.085, R: 48, dir: -1 });
    }
    for (i = 0; i < PEDS; i++) {
      var ped = null;
      try { ped = LG.Models.buildCharacter({ team: 'visitor' }); } catch (e) { ped = null; }
      if (!ped) continue;
      p = ringPos(27, (i / PEDS) % 1);
      ped.position.set(p.x, 0, p.z);
      scene.add(ped);
      movers.push({ kind: 'ped', g: ped, t: (i / PEDS) % 1, speed: 0.03, R: 27, dir: 1, phase: Math.random() * 10 });
    }

    if (!sub && LG.eventBus && LG.eventBus.on) {
      LG.eventBus.on('goal', cheer);
      sub = true;
    }
  }

  function update(dt) {
    var i, m2, p;
    if (!movers.length) return;
    var step = (dt || 0.016) * 60;      // seconds -> 60fps frames
    for (i = 0; i < movers.length; i++) {
      m2 = movers[i];
      m2.prev = (m2.prev || 0) + 1+ 1;
      m2.t = (m2.t + (m2.dir * m2.speed * step * 0.02)) % 1;
      if (m2.t < 0) m2.t += 1;
      p = ringPos(m2.R, m2.t);
      m2.g.position.set(p.x, 0, p.z);
      var yaw = Math.atan2(p.dx, p.dz);
      m2.g.rotation.y = yaw;
      if (m2.kind === 'ped') {
        m2.g.position.y = 0;
        try { LG.Models.animateChar(m2.g, true, m2.phase, m2.speed, 0); } catch (e) { }
      }
    }
    if (pulse > 0) {
      pulse -= dt;
      // quick pulse: gently bob everyone so the block feels alive
      for (i = 0; i < movers.length; i++) {
        if (movers[i].kind === 'ped') {
          movers[i].g.position.y = Math.sin((pulse * 40)) * 0.12;
        }
      }
    }
  }

  return { build: build, update: update, cheer: cheer };
})();
