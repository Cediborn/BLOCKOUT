// ============================================================
// PARTICLES + VFX (points shader, rings, auras)
// ============================================================
var LG = window.LG = window.LG || {};

LG.Particles = (function () {
  var MAX = 900;
  var geo, pos, col, alpha, sizeA;
  var pool = [];
  var cursor = 0;
  var material = null;
  var rings = [];
  var RING_MAX = 10;

  function Sys(scene) {
    geo = new THREE.BufferGeometry();
    pos = new Float32Array(MAX * 3);
    col = new Float32Array(MAX * 3);
    alpha = new Float32Array(MAX);
    sizeA = new Float32Array(MAX);
    var i;
    for (i = 0; i < MAX; i++) { alpha[i] = 0; sizeA[i] = 1; }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizeA, 1));

    material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: [
        'attribute float aAlpha;',
        'attribute float aSize;',
        'varying float vA;',
        'void main(){',
        '  vA = aAlpha;',
        '  vec4 mv = modelViewMatrix * vec4(position,1.0);',
        '  gl_PointSize = aSize * (220.0 / max(1.0, -mv.z));',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'varying float vA;',
        'void main(){',
        '  vec2 c = gl_PointCoord - vec2(0.5);',
        '  float d = length(c);',
        '  if (d > 0.5) discard;',
        '  float a = smoothstep(0.5, 0.05, d) * vA;',
        '  gl_FragColor = vec4(1.0, 1.0, 1.0, a);',
        '}',
      ].join('\n'),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    var points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    scene.add(points);

    var k;
    for (k = 0; k < RING_MAX; k++) {
      var ring = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 0.99, 36),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      scene.add(ring);
      rings.push({ mesh: ring, t: 1 });
    }
  }

  function emit(p) {
    if (!pool[cursor]) {
      pool[cursor] = {
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, maxLife: 1, r: 1, g: 1, b: 1, size: 1, grav: 0, drag: 1,
      };
    }
    var s = pool[cursor];
    cursor = (cursor + 1) % MAX;
    s.x = p.x; s.y = p.y; s.z = p.z;
    s.vx = p.vx || 0; s.vy = p.vy || 0; s.vz = p.vz || 0;
    s.life = 1; s.maxLife = p.life || 0.6;
    var c = THREE.Color && p.color !== undefined ? new THREE.Color(p.color) : { r: 1, g: 1, b: 1 };
    s.r = c.r; s.g = c.g; s.b = c.b;
    s.size = p.size || 1.2;
    s.grav = p.grav != null ? p.grav : 0;
    s.drag = p.drag || 1;
    return s;
  }

  function update(dt) {
    var i, s, k;
    for (i = 0; i < pool.length; i++) {
      s = pool[i];
      if (!s || s.life <= 0) continue;
      s.life -= dt / s.maxLife;
      if (s.life <= 0) { alpha[i] = 0; continue; }
      s.vy += s.grav * dt;
      var d = Math.pow(s.drag, dt * 60);
      s.vx *= d; s.vy *= d; s.vz *= d;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      if (s.y < 0.02) { s.y = 0.02; if (s.vy < 0) s.vy *= -0.35; }
      pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z;
      col[i * 3] = s.r; col[i * 3 + 1] = s.g; col[i * 3 + 2] = s.b;
      var a = Math.min(1, s.life * 2) * Math.min(1, s.life * 2);
      alpha[i] = a * 0.9;
      sizeA[i] = s.size;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;

    for (k = 0; k < rings.length; k++) {
      var r = rings[k];
      if (r.t >= 1) { if (r.mesh.visible) r.mesh.visible = false; continue; }
      r.t += dt / 0.5;
      var t2 = Math.min(1, r.t);
      var sc = 0.6 + t2 * r.maxScale;
      r.mesh.scale.set(sc, sc, 1);
      r.mesh.material.opacity = (1 - t2) * r.opacity;
    }
  }

  function ring(x, z, color, maxScale, opacity) {
    for (var i = 0; i < rings.length; i++) {
      var r = rings[i];
      if (r.t < 1) continue;
      r.mesh.position.set(x, 0.05, z);
      r.mesh.material.color.setHex(color);
      r.mesh.visible = true;
      r.t = 0;
      r.maxScale = maxScale || 8;
      r.opacity = opacity || 0.7;
      return;
    }
  }

  // convenience bursts
  function dust(x, z, strength) {
    var n = 12;
    for (var i = 0; i < n; i++) {
      emit({
        x: x, y: 0.1, z: z,
        vx: (Math.random() - 0.5) * strength, vy: 1 + Math.random() * 2, vz: (Math.random() - 0.5) * strength,
        life: 0.4 + Math.random() * 0.3, color: 0xb7a58e, size: 1.6, grav: -6, drag: 0.86,
      });
    }
  }

  function confetti(x, y, z, color, n) {
    n = n || 60;
    var palette = [color, 0xfff3c0, 0x35e0ff, 0xffb62e, 0x62ff8a];
    for (var i = 0; i < n; i++) {
      var cl = palette[i % palette.length];
      var a = Math.random() * Math.PI * 2;
      var sp = 3 + Math.random() * 7;
      emit({
        x: x, y: y, z: z,
        vx: Math.cos(a) * sp, vy: 4 + Math.random() * 7, vz: Math.sin(a) * sp,
        life: 0.9 + Math.random() * 0.8, color: cl, size: 2.2, grav: -10, drag: 0.9,
      });
    }
  }

  function burst(x, y, z, color, n, speed, up) {
    n = n || 26; speed = speed || 6; up = up || 4;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = speed * (0.4 + Math.random() * 0.7);
      emit({
        x: x, y: y, z: z,
        vx: Math.cos(a) * sp, vy: up * (0.5 + Math.random() * 0.8), vz: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.4, color: color, size: 1.8, grav: -4, drag: 0.93,
      });
    }
  }

  function trail(px, py, pz, vx, vz, color) {
    emit({
      x: px + (Math.random() - 0.5) * 0.3, y: py, z: pz + (Math.random() - 0.5) * 0.3,
      vx: -vx * 0.12 + (Math.random() - 0.5) * 0.5, vy: 0.6, vz: -vz * 0.12 + (Math.random() - 0.5) * 0.5,
      life: 0.3, color: color, size: 1.1, grav: -2,
    });
  }

  // screen-space flash handled in HUD; this handles "speed lines" at a position
  function speedLines(px, py, pz, dirX, dirZ, color, count) {
    count = count || 14;
    for (var i = 0; i < count; i++) {
      var back = 0.5 + Math.random() * 1.2;
      emit({
        x: px - dirX * back, y: py + 0.3 * (Math.random() - 0.5), z: pz - dirZ * back,
        vx: dirX * 6, vy: 0, vz: dirZ * 6,
        life: 0.28, color: color, size: 1.4, drag: 0.8,
      });
    }
  }

  function clear() {
    for (var i = 0; i < MAX; i++) alpha[i] = 0;
  }

  return {
    init: Sys,
    emit: emit, update: update, ring: ring, dust: dust, confetti: confetti,
    burst: burst, trail: trail, speedLines: speedLines, clear: clear,
  };
})();