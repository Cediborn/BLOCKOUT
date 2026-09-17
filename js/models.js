// ============================================================
// MODELS — low-poly stylized characters, ball, goals, props
// All original geometry built from primitives.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Models = (function () {

  var matCache = {};
  function mat(color, name, spec) {
    var key = name + '_' + (color ? color.toString(16) : 'x') + (spec && spec.flat ? 'f' : '');
    if (matCache[key]) return matCache[key];
    var m = new THREE.MeshLambertMaterial({ color: color !== undefined ? color : 0xffffff });
    if (spec && spec.flat) m.flatShading = true;
    matCache[key] = m;
    return m;
  }

  function boxO(material, w, h, d, x, y, z, rotX, rotZ) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    if (rotX) m.rotation.x = rotX;
    if (rotZ) m.rotation.z = rotZ;
    m.castShadow = true;
    return m;
  }

  // ------------------------------------------------------------
  // CHARACTER
  // ------------------------------------------------------------
  var HAIR = {
    spiky: function (g, pal) {
      var hs = mat(pal.hair, 'hair');
      var base = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), hs);
      base.scale.y = 0.8;
      base.position.y = 0.08;
      g.add(base);
      var c = pal.hair;
      for (var i = 0; i < 7; i++) {
        var a = (i / 7) * Math.PI * 2 + 0.4;
        var spike = boxO(hs, 0.08, 0.26 + Math.random() * 0.1, 0.08,
          Math.cos(a) * 0.22, 0.4, Math.sin(a) * 0.18, 0.5, -a);
        g.add(spike);
      }
    },
    cap: function (g, pal) {
      var hs = mat(pal.hair, 'hair');
      var dome = new THREE.Mesh(new THREE.SphereGeometry(0.31, 10, 8), hs);
      dome.scale.y = 0.7; dome.position.y = 0.1;
      g.add(dome);
      var brim = boxO(mat(pal.trim, 'hair'), 0.34, 0.05, 0.42, 0, 0.24, 0.32);
      brim.castShadow = true;
      g.add(brim);
    },
    mohawk: function (g, pal) {
      var hs = mat(pal.hair, 'hair');
      var base = boxO(hs, 0.4, 0.18, 0.44, 0, 0.22, 0);
      g.add(base);
      var crest = boxO(hs, 0.12, 0.5, 0.4, 0, 0.5, 0);
      g.add(crest);
    },
    short: function (g, pal) {
      var hs = mat(pal.hair, 'hair');
      var base = new THREE.Mesh(new THREE.SphereGeometry(0.315, 10, 8), hs);
      base.scale.y = 0.72; base.position.y = 0.06;
      base.rotation.z = 0.12;
      g.add(base);
    },
    afro: function (g, pal) {
      var hs = mat(pal.hair, 'hair');
      var a = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 10), hs);
      a.position.y = 0.12;
      g.add(a);
      var b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), hs);
      b.position.set(0.1, 0.06, 0.18);
      g.add(b);
      var c = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), hs);
      c.position.set(-0.14, 0.04, -0.16);
      g.add(c);
    },
    curly: function (g, pal) {
      var hs = mat(pal.hair, 'hair');
      var base = boxO(hs, 0.44, 0.16, 0.44, 0, 0.2, 0);
      g.add(base);
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2;
        var tuft = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), hs);
        tuft.position.set(Math.cos(a) * 0.22, 0.26, Math.sin(a) * 0.22);
        g.add(tuft);
      }
    },
    ponytail: function (g, pal) {
      var hs = mat(pal.hair, 'hair');
      var base = new THREE.Mesh(new THREE.SphereGeometry(0.31, 10, 8), hs);
      base.scale.y = 0.75; base.position.y = 0.08; base.rotation.z = 0.1;
      g.add(base);
      g.add(boxO(hs, 0.09, 0.5, 0.09, 0, 0.36, -0.28, 0.5));
      var tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), hs);
      tip.position.set(0, 0.56, -0.33);
      g.add(tip);
    },
    buzz: function (g, pal) {
      var hs = mat(pal.hair, 'hair');
      var base = new THREE.Mesh(new THREE.SphereGeometry(0.315, 10, 8), hs);
      base.scale.y = 0.62; base.position.y = 0.04;
      g.add(base);
      var sides = mat(pal.skin, 'hair');
      var st = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), sides);
      st.scale.y = 0.4; st.position.y = -0.02;
      g.add(st);
    },
  };

  var HAIR_STYLE = ['spiky', 'cap', 'mohawk', 'short', 'afro', 'curly', 'ponytail', 'buzz'];

  function buildCharacter(def) {
    var pal = def.palette;
    var g = new THREE.Group();
    var body = new THREE.Group();

    // body proportions from role/body config
    var cfg = def.body || {};
    var tall = cfg.tall || 1.0;           // vertical scale
    var wide = cfg.wide || 1.0;           // horizontal scale
    var hgt = 1.62 * tall;

    var skinM = mat(pal.skin, 'skin');
    var shirtM = mat(pal.shirt, 'shirt');
    var trimM = mat(pal.trim, 'trim');
    var pantsM = mat(pal.pants, 'pants');
    var shoeM = mat(pal.shoe, 'shoe');

    // legs (pivot at hip)
    var legLg = new THREE.Group();
    legLg.position.set(0.14 * wide, 0.46 * tall, 0);
    legLg.add(boxO(pantsM, 0.17 * wide, 0.46 * tall, 0.18, 0, -0.2 * tall, 0));
    var shoeL = boxO(shoeM, 0.2 * wide, 0.12, 0.34, 0, -0.48 * tall, 0.06);
    shoeL.castShadow = true;
    legLg.add(shoeL);
    body.add(legLg);

    var legRg = new THREE.Group();
    legRg.position.set(-0.14 * wide, 0.46 * tall, 0);
    legRg.add(boxO(pantsM, 0.17 * wide, 0.46 * tall, 0.18, 0, -0.2 * tall, 0));
    var shoeR = boxO(shoeM, 0.2 * wide, 0.12, 0.34, 0, -0.48 * tall, 0.06);
    shoeR.castShadow = true;
    legRg.add(shoeR);
    body.add(legRg);

    // torso
    var torso = boxO(shirtM, 0.42 * wide, 0.6 * tall, 0.26, 0, 0.8 * tall, 0);
    torso.castShadow = true;
    body.add(torso);

    // torso trim stripe (chest)
    if (wide > 1.08) {
      var strap = boxO(trimM, 0.44 * wide, 0.1, 0.28, 0, 0.7 * tall, 0.001);
      body.add(strap);
    }

    // shoulders / sleeves
    var sleeveL = boxO(shirtM, 0.12, 0.16, 0.12, 0.28 * wide, 1.02 * tall, 0);
    body.add(sleeveL);
    var sleeveR = boxO(shirtM, 0.12, 0.16, 0.12, -0.28 * wide, 1.02 * tall, 0);
    body.add(sleeveR);

    // arms (pivots at shoulder)
    var armLg = new THREE.Group();
    armLg.position.set(0.32 * wide, 1.0 * tall, 0);
    armLg.add(boxO(skinM, 0.11 * wide, 0.46, 0.11, 0, -0.26, 0));
    var fistL = new THREE.Mesh(new THREE.SphereGeometry(0.1 * wide, 6, 6), skinM);
    fistL.position.set(0, -0.52, 0);
    armLg.add(fistL);
    body.add(armLg);

    var armRg = new THREE.Group();
    armRg.position.set(-0.32 * wide, 1.0 * tall, 0);
    armRg.add(boxO(skinM, 0.11 * wide, 0.46, 0.11, 0, -0.26, 0));
    var fistR = new THREE.Mesh(new THREE.SphereGeometry(0.1 * wide, 6, 6), skinM);
    fistR.position.set(0, -0.52, 0);
    armRg.add(fistR);
    body.add(armRg);

    // neck + head
    var neck = boxO(skinM, 0.12, 0.09, 0.12, 0, 1.14 * tall, 0);
    body.add(neck);
    var headR = 0.31 * (tall > 1.05 ? 1.05 : 1);
    var head = new THREE.Mesh(new THREE.SphereGeometry(headR, 12, 10), skinM);
    head.position.y = 1.32 * tall;
    head.castShadow = true;
    body.add(head);

    // hair style — pick by roster index or explicit
    var hsIdx = def.hairStyle;
    if (hsIdx == null) {
      for (var k = 0; k < LG.Roster.length; k++) if (LG.Roster[k].id === def.id) hsIdx = k;
      if (hsIdx == null) hsIdx = 0;
    }
    var style = (HAIR_STYLE[hsIdx] || 'short');
    var hairHolder = new THREE.Group();
    hairHolder.position.y = 1.32 * tall;
    body.add(hairHolder);
    (HAIR[style] || HAIR.short)(hairHolder, pal);

    g.add(body);
    g.traverse(function (o) { if (o.isMesh) o.castShadow = true; });

    return {
      group: g, body: body,
      limbs: { legL: legLg, legR: legRg, armL: armLg, armR: armRg },
      height: hgt,
    };
  }

  function animateChar(m, running, phase, speed01) {
    if (!m.limbs) return;
    var legSwing = running ? 1 : 0;
    var amp = 0.55 * legSwing * (0.5 + 0.5 * speed01);
    m.limbs.legL.rotation.x = Math.sin(phase) * amp;
    m.limbs.legR.rotation.x = -Math.sin(phase) * amp;
    m.limbs.armL.rotation.x = -Math.sin(phase) * amp * 0.8;
    m.limbs.armR.rotation.x = Math.sin(phase) * amp * 0.8;
    m.body.position.y = running ? Math.abs(Math.sin(phase)) * 0.03 : 0;
  }

  // ------------------------------------------------------------
  // BALL
  // ------------------------------------------------------------
  function buildBall() {
    var g = new THREE.Group();
    var tex = (function () {
      var c = document.createElement('canvas');
      c.width = 128; c.height = 128;
      var x = c.getContext('2d');
      x.fillStyle = '#f4f4f4';
      x.fillRect(0, 0, 128, 128);
      x.fillStyle = '#191d26';
      // tessellation-ish patches
      x.beginPath(); x.arc(32, 32, 16, 0, 7); x.fill();
      x.beginPath(); x.arc(96, 40, 18, 0, 7); x.fill();
      x.beginPath(); x.arc(48, 96, 14, 0, 7); x.fill();
      x.beginPath(); x.arc(104, 100, 10, 0, 7); x.fill();
      x.beginPath(); x.arc(12, 100, 12, 0, 7); x.fill();
      x.strokeStyle = '#b9bdc7'; x.lineWidth = 3;
      for (var i = 0; i < 6; i++) {
        x.beginPath(); x.arc(64, 64, 40, i * Math.PI / 3, i * Math.PI / 3 + Math.PI / 3 + 0.1); x.stroke();
      }
      var t = new THREE.CanvasTexture(c);
      t.anisotropy = 4;
      return t;
    })();
    var ball = new THREE.Mesh(new THREE.SphereGeometry(LG.Config.court.ballRadius, 20, 16), new THREE.MeshLambertMaterial({ map: tex }));
    ball.castShadow = true;
    g.add(ball);
    g.userData = {};
    return g;
  }

  // ------------------------------------------------------------
  // GOAL (small street goals with wire nets)
  // The frame sits ON the goal line (local z=0) and every net panel hangs
  // BEHIND it (negative local z) so the opening always faces the field.
  // ------------------------------------------------------------
  function buildGoal(color) {
    var C = LG.Config.court;
    var g = new THREE.Group();
    var gw = C.goalWidth / 2;      // 2.6 half … full 5.2
    var gh = C.goalHeight;
    var gd = C.goalDepth;
    var postM = new THREE.MeshStandardMaterial({ color: 0xd9dee6, metalness: 0.75, roughness: 0.35 });
    var netM = new THREE.MeshBasicMaterial({ color: 0x8c8fa0, transparent: true, opacity: 0.5, side: THREE.DoubleSide, wireframe: true });
    var baseM = new THREE.MeshStandardMaterial({ color: 0x1b2027, roughness: 0.9 });

    var mk = function (w, h, d, x, y, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), postM);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
    };
    mk(0.12, gh, 0.12, -gw, gh / 2, 0);
    mk(0.12, gh, 0.12, gw, gh / 2, 0);
    mk(0.12, 0.12, 0.12, -gw, gh, 0);
    mk(0.12, 0.12, 0.12, gw, gh, 0);
    mk(gw * 2 + 0.12, 0.14, 0.12, 0, gh, 0); // crossbar
    // ground base plates make the goal-line and pocket read from the street view
    var baseL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, gd), baseM);
    baseL.position.set(-gw + 0.06, 0.03, -gd / 2); g.add(baseL);
    var baseR = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, gd), baseM);
    baseR.position.set(gw - 0.06, 0.03, -gd / 2); g.add(baseR);

    // net panels — all pinned to the frame line (z=0) and reaching back to z=-gd
    var netGeoX = new THREE.BoxGeometry(gw * 2, gh, gd);
    var netGeoZ = new THREE.BoxGeometry(gd, gh, gh);
    var back = new THREE.Mesh(netGeoX, netM);
    back.position.set(0, gh / 2, -gd / 2);
    g.add(back);
    var sideL = new THREE.Mesh(netGeoZ, netM);
    sideL.position.set(-gw, gh / 2, -gd / 2);
    g.add(sideL);
    var sideR = new THREE.Mesh(netGeoZ, netM);
    sideR.position.set(gw, gh / 2, -gd / 2);
    g.add(sideR);
    var top = new THREE.Mesh(new THREE.PlaneGeometry(gw * 2, gd), netM);
    top.rotation.x = Math.PI / 2;
    top.position.set(0, gh, -gd / 2);
    g.add(top);

    return g;
  }

  // ------------------------------------------------------------
  // fences / props helpers (assembled by arena.js)
  // ------------------------------------------------------------
  function bar(postM, x, y, z, h, w) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w || 0.09, h, 0.09), postM);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }

  function meshPanel() {
    // vertical-bars fence panel: one big box with stripes? use lines
    var segs = [];
    var matLine = new THREE.LineBasicMaterial({ color: 0x333a48, transparent: true, opacity: 0.55 });
    function panel(w, h) {
      var pts = [];
      var vCount = Math.floor(w / 0.22);
      for (var i = 0; i <= vCount; i++) {
        var px = -w / 2 + i * (w / vCount);
        pts.push(new THREE.Vector3(px, 0, 0), new THREE.Vector3(px, h, 0));
      }
      // horizontals
      pts.push(new THREE.Vector3(-w / 2, h * 0.35, 0), new THREE.Vector3(w / 2, h * 0.35, 0));
      pts.push(new THREE.Vector3(-w / 2, h * 0.7, 0), new THREE.Vector3(w / 2, h * 0.7, 0));
      var g = new THREE.BufferGeometry().setFromPoints(pts);
      return new THREE.LineSegments(g, matLine);
    }
    return panel;
  }

  function spectator(colorVariant) {
    var g = new THREE.Group();
    var skin = mat(0xc99a76, 'spec');
    var shirt = mat([0x3d4a63, 0x6b3d66, 0x3d6b50, 0x6b603d][colorVariant % 4], 'spec');
    var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.22, 3, 6), shirt);
    torso.position.y = 0.36;
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), skin);
    head.position.y = 0.74;
    head.castShadow = true;
    g.add(torso); g.add(head);
    return g;
  }

  function billboardTex(text) {
    return LG.Util.makeCanvasTexture(function (g, w, h) {
      g.fillStyle = '#14202e';
      g.fillRect(0, 0, w, h);
      g.font = 'bold ' + Math.floor(h * 0.34) + 'px Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffd23f';
      g.fillText(text, w / 2, h / 2 - 8);
      g.font = 'bold ' + Math.floor(h * 0.16) + 'px Arial';
      g.fillStyle = '#35e0ff';
      g.fillText('STREET LEAGUE', w / 2, h / 2 + 34);
      g.strokeStyle = '#ffd23f'; g.lineWidth = 8;
      g.strokeRect(6, 6, w - 12, h - 12);
    }, 256, 128);
  }

  function buildingTex(windowsOn) {
    return LG.Util.makeCanvasTexture(function (g, w, h) {
      g.fillStyle = '#2a3038';
      g.fillRect(0, 0, w, h);
var bw = w / 5, bh = h / 7;
      for (var i = 0; i < 5; i++) {
        for (var j = 0; j < 7; j++) {
          var lit = Math.random() > 0.4;
          g.fillStyle = lit ? '#ffd67a' : '#1b2027';
          g.fillRect(4 + i * bw, 4 + j * bh, bw - 8, bh - 8);
        }
      }
    }, 160, 224);
  }

  return {
    buildCharacter: buildCharacter,
    animateChar: animateChar,
    buildBall: buildBall,
    buildGoal: buildGoal,
    bar: bar,
    fencePanel: meshPanel(),
    spectator: spectator,
    billboardTex: billboardTex,
    buildingTex: buildingTex,
  };
})();