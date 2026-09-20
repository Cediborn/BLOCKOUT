// ============================================================
// ARENA — "THE BLOCK": a caged street court
// Reusable: Arena.build(scene, def) where def describes theme.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Arena = (function () {
  var C = LG.Config.court;
  var U = LG.Util;
  var root = null;
  var anims = [];
  var surfaceGroup = null;   // the pitch slab + lines + logo, rebuilt on court change
  var goalGroup = null;      // cosmetic 3D goal frame/net (built once; see goals())

  function skyBox() {
    var g = new THREE.SphereGeometry(70, 16, 12);
    var t = LG.Util.makeCanvasTexture(function (c, w, h) {
      var grd = c.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#0b0f18');
      grd.addColorStop(0.45, '#141b2b');
      grd.addColorStop(0.62, '#2a2f3f');
      grd.addColorStop(0.75, '#3a2a24');
      grd.addColorStop(1, '#0e0b0a');
      c.fillStyle = grd;
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(255,255,255,0.85)';
      for (var i = 0; i < 40; i++) {
        var x = Math.random() * w, y = Math.random() * h * 0.5;
        var r = Math.random() * 1.6 + 0.4;
        c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
      }
      c.fillStyle = 'rgba(255,220,120,0.7)';
      c.beginPath();
      c.arc(w * 0.78, h * 0.42, 26, 0, 7); c.fill();
    }, 512, 256);
    var m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false }));
    m.position.set(0, 6, 0);
    return m;
  }

  function ground() {
    var g = new THREE.Group();

    // asphalt surroundings
    var asphaltT = LG.Util.makeCanvasTexture(function (c, w, h) {
      c.fillStyle = '#2b2f37';
      c.fillRect(0, 0, w, h);
      for (var i = 0; i < 220; i++) {
        c.fillStyle = 'rgba(0,0,0,' + (0.05 + Math.random() * 0.12) + ')';
        c.fillRect(Math.random() * w, Math.random() * h, 3, 2);
        c.fillStyle = 'rgba(255,255,255,' + (0.02 + Math.random() * 0.05) + ')';
        c.fillRect(Math.random() * w, Math.random() * h, 2, 1);
      }
    }, 256, 256);
    asphaltT.repeat.set(6, 6);
    var asphalt = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), new THREE.MeshLambertMaterial({ map: asphaltT }));
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.y = -0.03;
    asphalt.receiveShadow = true;
    g.add(asphalt);

    // surrounding sidewalk ring
    var walkT = LG.Util.makeCanvasTexture(function (c, w, h) {
      c.fillStyle = '#454b56';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(0,0,0,0.3)';
      c.lineWidth = 4;
      for (var i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * w / 4, 0); c.lineTo(i * w / 4, h); c.stroke(); }
      for (var j = 0; j <= 4; j++) { c.beginPath(); c.moveTo(0, j * h / 4); c.lineTo(w, j * h / 4); c.stroke(); }
    });
    var ringL = 30, ringW = 12;
    var walk = new THREE.Mesh(new THREE.PlaneGeometry(ringL + ringW * 2, ringW), new THREE.MeshLambertMaterial({ map: walkT }));
    walk.rotation.x = -Math.PI / 2; walk.position.z = C.length / 2 + ringW / 2 - 1; walk.receiveShadow = true;
    g.add(walk);
    var walk2 = walk.clone(); walk2.position.z = -C.length / 2 - ringW / 2 + 1; g.add(walk2);
    var walk3 = new THREE.Mesh(new THREE.PlaneGeometry(ringW, C.length + ringW * 2), new THREE.MeshLambertMaterial({ map: walkT }));
    walk3.rotation.x = -Math.PI / 2; walk3.position.x = C.width / 2 + ringW / 2 - 1; walk3.receiveShadow = true; g.add(walk3);
    var walk4 = walk3.clone(); walk4.position.x = -C.width / 2 - ringW / 2 + 1; g.add(walk4);

    return g;
  }

  // The playable slab mesh (procedural worn asphalt).  Kept separate so the
  // surface can be swapped for a custom court texture without touching the
  // surrounding environment.
  function courtSlab() {
    var courtT = LG.Util.makeCanvasTexture(function (c, w, h) {
      c.fillStyle = '#4d5a68';
      c.fillRect(0, 0, w, h);
      // mottled patches + grime
      var i;
      for (i = 0; i < 240; i++) {
        c.fillStyle = 'rgba(15,20,28,' + (0.06 + Math.random() * 0.14) + ')';
        var px = Math.random() * w, py = Math.random() * h;
        c.beginPath(); c.ellipse(px, py, 2 + Math.random() * 6, 2 + Math.random() * 4, Math.random() * 3.14, 0, 7); c.fill();
      }
      // scuffs / faded wear
      for (i = 0; i < 80; i++) {
        c.fillStyle = 'rgba(198,208,220,' + (0.05 + Math.random() * 0.10) + ')';
        c.beginPath(); c.ellipse(Math.random() * w, Math.random() * h, 1.5 + Math.random() * 5, 1 + Math.random() * 3, Math.random() * 3.14, 0, 7); c.fill();
      }
      // cracks
      c.strokeStyle = 'rgba(8,12,18,0.55)'; c.lineWidth = 1;
      for (i = 0; i < 9; i++) {
        c.beginPath();
        var x = Math.random() * w, y = Math.random() * h;
        c.moveTo(x, y);
        var segs = 3 + Math.floor(Math.random() * 4);
        for (var s = 0; s < segs; s++) { x += (Math.random() - 0.5) * 22; y += (Math.random() - 0.5) * 22; c.lineTo(x, y); }
        c.stroke();
      }
    }, 256, 256);
    courtT.repeat.set(2, 3);
    var court = new THREE.Mesh(new THREE.PlaneGeometry(C.width, C.length), new THREE.MeshLambertMaterial({ map: courtT }));
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.02;
    court.receiveShadow = true;
    return court;
  }

  // A custom court image drawn across the pitch slab as the real ground.
  // The texture loads asynchronously and pops in on load; gameplay geometry
  // (posts collision list, goal detection, keeper, net-pocket) is untouched.
  //
  // ALIGNMENT = the whole playable area IS the slab, so every gameplay
  // coordinate always lands on the artwork: image TOP -> the NORTH goal at
  // z = -C.length/2, image BOTTOM -> the SOUTH goal at z = +C.length/2, and
  // the painted goals in the art sit exactly under the invisible functional
  // goals.  The art's OWN markings are used as-is (no synthetic lines on top
  // — see buildSurface), and painted-goal courts hide the cosmetic 3D goal
  // frame (see goals / applyGoalVisibility) so there is never a double net.
  function courtSlabCustom(custom) {
    var mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    var court = new THREE.Mesh(new THREE.PlaneGeometry(C.width, C.length), mat);
    court.rotation.x = -Math.PI / 2;
    court.position.y = 0.02;
    court.receiveShadow = true;
    var ready = function (tex) {
      mat.map = tex;
      mat.needsUpdate = true;
      applyCourtFit(tex, custom);
    };
    if (LG.Courts) {
      var tex = LG.Courts.texture(custom.id, ready);
      if (tex) { mat.map = tex; mat.needsUpdate = true; }
    }
    return court;
  }

  // Pins the artwork onto the slab WITHOUT distorting it.  The vertical (z)
  // axis always keeps the whole image end-to-end, so the painted goals stay
  // exactly on the invisible goal lines.  Horizontally:
  //   'cover'   art wider than the pitch -> sample the CENTRAL strip of the
  //             image (proportions intact, a little cropped off the sides).
  //   else     narrower-than-pitch art -> fill the width fully (the mild
  //             pull keeps the goals from being cut off).
  // The per-court fit comes from the single metadata table in courts.js.
  function applyCourtFit(tex, custom) {
    if (!tex || !tex.image || !custom) return;
    var can = LG.Courts && LG.Courts.fitCalc;
    var info = can ? LG.Courts.fitCalc(custom.id, w, h, C.width, C.length) : null;
    if (!info) { tex.repeat.set(1, 1); tex.offset.set(0, 0); return; }
    if (info.mode !== 'cover' || info.strip >= 1) { tex.repeat.set(1, 1); tex.offset.set(0, 0); return; }
    tex.repeat.set(info.strip, 1);
    tex.offset.set(info.offsetX, 0);
  }

  // Painted lines are drawn onto a canvas whose pixel-resolution mirrors the
  // court slab 1:1 (identical pixels-per-world-unit on both axes, so the
  // canvas aspect == the pitch aspect). Every coordinate is derived from the
  // real court dimensions:
  //   - pitch length  = C.length (44)  -> goal lines at z = +-22
  //   - pitch width   = C.width  (26)
  //   - world center  = (0, 0)         -> the exact midpoint between goal lines
  // A world-space circle drawn here is a true circle on the pitch (no stretch),
  // and the halfway line lands EXACTLY at z = 0 under the kickoff spot.
  function courtLines(opacity) {
    opacity = opacity === undefined ? 0.82 : opacity;
    var ps = 16; // pixels per world unit (16px == 1 world unit, both axes)
    var w = Math.round(C.width * ps), h = Math.round(C.length * ps);
    var halfW = C.width / 2, halfL = C.length / 2;
    var lineColor = 'rgba(224,226,220,' + opacity + ')';
    var tl = LG.Util.makeCanvasTexture(function (c, cw, ch) {
      c.clearRect(0, 0, cw, ch);
      // world -> canvas.  Canvas row 0 is the NORTH goal (z = -halfL) and
      // row h is the SOUTH goal (z = +halfL) matching the court slab UVs.
      var px = function (x) { return (x + halfW) * ps; };
      var py = function (z) { return (halfL + z) * ps; };
      var midX = px(0), midY = py(0); // true world center (0,0)
      var ins = 2.0 * ps;             // keep paint just inside the slab edge

      c.strokeStyle = lineColor;
      c.lineWidth = 3;

      // outer boundary == the two goal lines at z = +-halfL
      c.strokeRect(ins, ins, cw - ins * 2, ch - ins * 2);
      // halfway line: world z == 0 -> exactly between the goal lines
      c.beginPath(); c.moveTo(ins, midY); c.lineTo(cw - ins, midY); c.stroke();

      // center circle + spot, dead-center on the halfway line
      c.beginPath(); c.arc(midX, midY, 3.2 * ps, 0, 7); c.stroke();
      c.beginPath(); c.arc(midX, midY, 0.42 * ps, 0, 7);
      c.fillStyle = lineColor; c.fill();

      // goal-area boxes, symmetric on both ends against the real goal lines
      var gb = { w: 5.2, d: 4.0 };
      c.strokeRect(px(-gb.w / 2), py(-halfL), gb.w * ps, gb.d * ps);            // north
      c.strokeRect(px(-gb.w / 2), py(halfL) - gb.d * ps, gb.w * ps, gb.d * ps); // south

      if (opacity > 0.4) {
        // worn paint: chip random notches along the halfway line & circle rim
        for (var i = 0; i < 42; i++) {
          var cwx, cwz, chipA;
          if (Math.random() < 0.5) {
            cwx = (Math.random() * 2 - 1) * (halfW - ins / ps - 2);
            cwz = 0;
          } else {
            chipA = Math.random() * 6.283;
            var rr = 3.2 * (0.75 + Math.random() * 0.4);
            cwx = Math.cos(chipA) * rr;
            cwz = Math.sin(chipA) * rr;
          }
          var chcx = px(cwx), chcy = py(cwz);
          c.clearRect(chcx - 5, chcy - 2, 10, 4);
          if (Math.random() < 0.3) c.clearRect(chcx - 2, chcy - 5, 4, 10);
        }
      }
    }, w, h);
    tl.repeat.set(1, 1);
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(C.width, C.length), new THREE.MeshBasicMaterial({ map: tl, transparent: true, depthWrite: false }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.035;
    return plane;
  }

  function centerLogo() {
    var tl2 = LG.Util.makeCanvasTexture(function (c, w, h) {
      c.clearRect(0, 0, w, h);
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(26,30,38,0.5)';
      c.font = 'bold ' + h * 0.6 + 'px Arial Black';
      c.fillText('BLOCK OUT', w / 2, h / 2);
      c.font = 'bold ' + h * 0.16 + 'px Arial';
      c.fillText('STREET FOOTBALL', w / 2, h * 0.72);
    }, 256, 256);
    var logo = new THREE.Mesh(new THREE.PlaneGeometry(C.width * 0.4, C.width * 0.26), new THREE.MeshBasicMaterial({ map: tl2, transparent: true, depthWrite: false, opacity: 0.55 }));
    logo.rotation.x = -Math.PI / 2;
    logo.position.y = 0.04;
    return logo;
  }

  // ---------------- fences ----------------
  function fenceH(segments, z, skip) {
    // horizontal note: fence along x at fixed z; skip = [min,max] x-range to leave open
    var postM = new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.7, metalness: 0.4 });
    var g = new THREE.Group();
    var panel = LG.Models.fencePanel;
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      var x0 = s[0], x1 = s[1];
      if (skip && x1 > skip[0] && x0 < skip[1]) continue;
      var w = x1 - x0;
      g.add(LG.Models.bar(postM, x0, C.fenceHeight / 2, z, C.fenceHeight - 1, 0.12));
      g.add(LG.Models.bar(postM, x1, C.fenceHeight / 2, z, C.fenceHeight - 1, 0.12));
      var p = panel(w, C.fenceHeight - 1);
      p.position.set(x0 + w / 2, C.fenceHeight / 2, z);
      g.add(p);
      g.add(LG.Models.bar(postM, x0 + w / 2, C.fenceHeight - 0.45, z, 0.09, w));
    }
    return g;
  }

  function fenceV(segments, x, skip) {
    var postM = new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.7, metalness: 0.4 });
    var g = new THREE.Group();
    var panel = LG.Models.fencePanel;
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      var z0 = s[0], z1 = s[1];
      if (skip && z1 > skip[0] && z0 < skip[1]) continue;
      var w = z1 - z0;
      g.add(LG.Models.bar(postM, x, C.fenceHeight / 2, z0, C.fenceHeight - 1, 0.12));
      g.add(LG.Models.bar(postM, x, C.fenceHeight / 2, z1, C.fenceHeight - 1, 0.12));
      var p = panel(w, C.fenceHeight - 1);
      p.rotation.y = Math.PI / 2;
      p.position.set(x, C.fenceHeight / 2, z0 + w / 2);
      g.add(p);
      g.add(LG.Models.bar(postM, x, C.fenceHeight - 0.45, z0 + w / 2, 0.09, w));
    }
    return g;
  }

  // ---------------- goals ----------------
  function goals() {
    var g = new THREE.Group();
    // home team defends the SOUTH goal (z = +length/2, near the camera side);
    // away team defends the NORTH goal (z = -length/2). Each net hangs BEHIND
    // its own frame — opening faces the field, nets extend away from the pitch.
    var south = LG.Models.buildGoal(0x35e0ff);   // HOME frame at +z
    south.position.set(0, 0, C.length / 2);
    south.rotation.y = Math.PI;
    g.add(south);
    var north = LG.Models.buildGoal(0xff4d5e);   // AWAY frame at -z
    north.position.set(0, 0, -C.length / 2);
    g.add(north);
    return g;
  }

  // The 3D goal frame must ALWAYS be visible: a court that bakes a painted
  // goal mouth into its art is a flat backing behind the posts — it is not a
  // replacement for the real 3D net with depth.  Keeping the 3D frame + net
  // (goalGroup) visible on every court guarantees nets are never invisible or
  // flat-texture-only.  The painted mouth sits behind the net plane, so posts,
  // net-pocket and keeper stay exactly where the art shows them (functional
  // goal geometry is authored in the 3D frame, never in the paint).
  function applyGoalVisibility() {
    if (!goalGroup) return;
    goalGroup.visible = true;
  }

  // ---------------- bleachers + spectators ----------------
  function bleacher(zSign) {
    var g = new THREE.Group();
    var stepM = new THREE.MeshStandardMaterial({ color: 0x333a47, roughness: 0.9 });
    var steps = 3;
    for (var i = 0; i < steps; i++) {
      var step = new THREE.Mesh(new THREE.BoxGeometry(C.goalWidth * 2.4, 0.8, 1.4), stepM);
      step.position.set(0, 0.4 + i * 0.66, zSign * (C.length / 2 + 2.6 + i * 0.55));
      step.receiveShadow = true;
      g.add(step);
    }
    for (var row = 0; row < steps; row++) {
      var n = 5;
      for (var i = 0; i < n; i++) {
        var sx = -C.goalWidth * 0.9 + i * (C.goalWidth * 1.8) / (n - 1);
        for (var j = 0; j < 2; j++) {
          var sp = LG.Models.spectator(row * 2 + i + j);
          sp.position.set(sx + (j - 0.5) * 0.5, 0.15 + row * 0.66, zSign * (C.length / 2 + 3.2 + row * 0.55));
          var a = { g: sp, t: Math.random() * 6, amp: 0.02 + Math.random() * 0.02 };
          anims.push(a);
          g.add(sp);
        }
      }
    }
    return g;
  }

  function sideSpectators(xSign) {
    var g = new THREE.Group();
    var n = 4;
    for (var i = 0; i < n; i++) {
      var sp = LG.Models.spectator(i);
      sp.position.set(xSign * (C.width / 2 + 1.2), 0.1, -C.length * 0.28 + i * 4.2);
      sp.rotation.y = xSign > 0 ? -Math.PI / 2 : Math.PI / 2;
      var a = { g: sp, t: Math.random() * 6, amp: 0.03 + Math.random() * 0.02 };
      anims.push(a);
      g.add(sp);
    }
    return g;
  }

  // ---------------- buildings & billboards ----------------
  function buildings() {
    var g = new THREE.Group();
    var brick = LG.Models.buildingTex();
    var dark = new THREE.MeshStandardMaterial({ color: 0x222a34, roughness: 0.9 });
    function addBlock(x, z, w, h, d, tex) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), tex ? new THREE.MeshLambertMaterial({ map: tex }) : new THREE.MeshStandardMaterial({ color: 0x232a34, roughness: 0.9 }));
      m.position.set(x, h / 2, z);
      m.receiveShadow = true; m.castShadow = true;
      g.add(m);
      return m;
    }
    // main block buildings (original 4 + new ones for a denser city feel)
    addBlock(-27, -34, 18, 26, 16, brick);
    addBlock(26, -30, 16, 18, 14);
    addBlock(-28, 34, 16, 22, 15);
    addBlock(27, 30, 20, 30, 18, brick);
    // additional smaller buildings for city density
    addBlock(-38, -20, 10, 14, 10, brick);
    addBlock(38, -18, 12, 20, 11);
    addBlock(-36, 22, 11, 16, 12, brick);
    addBlock(36, 24, 9, 12, 9);
    addBlock(-20, -40, 14, 10, 10);
    addBlock(20, 40, 12, 8, 8, brick);
    addBlock(-40, 0, 8, 18, 10, brick);
    addBlock(40, 0, 10, 14, 12);
    // windows on buildings via emissive plane textures
    function addWindows(bx, bz, bw, bh, bd, cols, rows) {
      var winT = LG.Util.makeCanvasTexture(function(c, w, h) {
        c.fillStyle = '#11161e'; c.fillRect(0, 0, w, h);
        var cw = w / cols, ch = h / rows;
        for (var r = 0; r < rows; r++) {
          for (var c2 = 0; c2 < cols; c2++) {
            var lit = Math.random() > 0.55;
            c.fillStyle = lit ? 'rgba(255,230,150,0.7)' : 'rgba(40,50,65,0.8)';
            c.fillRect(c2 * cw + cw * 0.15, r * ch + ch * 0.15, cw * 0.7, ch * 0.65);
          }
        }
      }, cols * 8, rows * 8);
      var side1 = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: winT }));
      side1.position.set(bx, bh / 2, bz + bd / 2 + 0.01);
      g.add(side1);
      var side2 = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: winT }));
      side2.position.set(bx, bh / 2, bz - bd / 2 - 0.01);
      side2.rotation.y = Math.PI;
      g.add(side2);
      var side3 = new THREE.Mesh(new THREE.PlaneGeometry(bd, bh), new THREE.MeshBasicMaterial({ map: winT }));
      side3.position.set(bx + bw / 2 + 0.01, bh / 2, bz);
      side3.rotation.y = Math.PI / 2;
      g.add(side3);
    }
    addWindows(-27, -34, 18, 26, 16, 4, 6);
    addWindows(26, -30, 16, 18, 14, 3, 4);
    addWindows(-28, 34, 16, 22, 15, 3, 5);
    addWindows(27, 30, 20, 30, 18, 4, 7);
    addWindows(-38, -20, 10, 14, 10, 2, 3);
    addWindows(38, -18, 12, 20, 11, 2, 4);
    // rooftop details: water tanks + AC units
    var tankM = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.85 });
    var tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.05, 1.5, 12), tankM);
    tank.position.set(-27, 27.7, -32);
    tank.castShadow = true;
    g.add(tank);
    var tank2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.2, 10), tankM);
    tank2.position.set(38, 21.6, -16);
    tank2.castShadow = true;
    g.add(tank2);
    var acM = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.7, metalness: 0.4 });
    var ac1 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), acM);
    ac1.position.set(28.6, 16.6, -27);
    ac1.castShadow = true;
    g.add(ac1);
    var ac2 = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 1.1), acM);
    ac2.position.set(-26, 23.2, 33);
    ac2.castShadow = true;
    g.add(ac2);
    g.add(LG.Models.bar(dark, -27, 27, -36, 2.4, 4));
    // billboards
    var bb = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 0.3), new THREE.MeshLambertMaterial({ map: LG.Models.billboardTex('BLOCK OUT CUP') }));
    bb.position.set(8, 5.5, -34.2); bb.castShadow = true; g.add(bb);
    var bb2 = new THREE.Mesh(new THREE.BoxGeometry(6, 2.8, 0.3), new THREE.MeshLambertMaterial({ map: LG.Models.billboardTex('STREET LEAGUE') }));
    bb2.position.set(-10, 4.6, 33.8); g.add(bb2);
    return g;
  }

  // ---------------- props ----------------
  function props() {
    var g = new THREE.Group();
    var darkM = new THREE.MeshStandardMaterial({ color: 0x2f3540, roughness: 0.85 });
    var redM = new THREE.MeshStandardMaterial({ color: 0x8a3f3f, roughness: 0.7 });

    // dumpster
    var dump = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.2, 1.3), darkM);
    dump.position.set(C.width / 2 + 3.4, 0.6, 2.1);
    dump.castShadow = true;
    g.add(dump);

    // crates
    var crateM = new THREE.MeshStandardMaterial({ color: 0x8a6a3f, roughness: 0.9 });
    for (var i = 0; i < 3; i++) {
      var crate = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.9, 0.9), crateM);
      crate.position.set(-C.width / 2 - 2.8 + i * 1.1, 0.45, -3 + i * 0.9);
      crate.castShadow = true; g.add(crate);
    }

    // tire stack
    var tireM = new THREE.MeshStandardMaterial({ color: 0x1d1d22, roughness: 1 });
    for (var j = 0; j < 3; j++) {
      var tire = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.3, 14), tireM);
      tire.position.set(C.width / 2 + 3.6, 0.15 + j * 0.28, -4.4);
      tire.castShadow = true; g.add(tire);
    }

    // corner floodlight poles
    var poleM = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.6 });
    var lampM = new THREE.MeshStandardMaterial({ color: 0xfff2c9, emissive: 0xfff6d8, emissiveIntensity: 1.4 });
    var poles = [[-C.width / 2 - 2, -C.length / 2 - 1.4], [C.width / 2 + 2, C.length / 2 + 1.4]];
    for (var p = 0; p < poles.length; p++) {
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 9, 8), poleM);
      pole.position.set(poles[p][0], 4.5, poles[p][1]);
      pole.castShadow = true; g.add(pole);
      var lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), lampM);
      lamp.position.set(poles[p][0], 9.2, poles[p][1]);
      g.add(lamp);
      var pl = new THREE.PointLight(0xffd9a0, 0.5, 26, 1.8);
      pl.position.set(poles[p][0], 8.6, poles[p][1]);
      g.add(pl);
    }
    return g;
  }

  // ---------------- street-art graffiti ----------------
  function tagTex(text, color) {
    return LG.Util.makeCanvasTexture(function (c, w, h) {
      c.clearRect(0, 0, w, h);
      c.fillStyle = 'rgba(28,32,44,0.6)';
      c.beginPath(); c.arc(w / 2, h / 2, Math.min(w, h) * 0.46, 0, 7); c.fill();
      c.strokeStyle = color; c.lineWidth = 4;
      c.beginPath(); c.arc(w / 2, h / 2, Math.min(w, h) * 0.46, 0, 7); c.stroke();
      c.fillStyle = color;
      c.font = 'italic 900 ' + Math.floor(h * 0.5) + 'px Arial Black';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(text, w / 2, h * 0.55);
      // paint drips
      for (var i = 0; i < 4; i++) {
        var x = w / 2 + (i - 1.5) * h * 0.12;
        c.fillRect(x - 1, h * 0.62, 2, h * (0.08 + Math.random() * 0.2));
      }
    }, 256, 128);
  }

  function graffiti() {
    var g = new THREE.Group();
    var spots = [
      { x: -15.6, z: -8.5, rot: 0.16, tex: tagTex('BO ☆', '#ff4d5e') },
      { x: 16.4, z: 10.5, rot: -0.12, tex: tagTex('BLOCK OUT', '#35e0ff') },
      { x: -17.4, z: 16.2, rot: 0.06, tex: tagTex('STREET KINGS', '#62ff8a') },
      { x: 15.6, z: -16.9, rot: -0.2, tex: tagTex('★ 3v3 ★', '#ffb62e') },
    ];
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, 1.9),
        new THREE.MeshBasicMaterial({ map: s.tex, transparent: true, depthWrite: false })
      );
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = s.rot;
      m.position.set(s.x, 0.05, s.z);
      g.add(m);
    }
    return g;
  }

  // ---------------- concrete Jersey barriers ----------------
  function barriers() {
    var g = new THREE.Group();
    var conM = new THREE.MeshStandardMaterial({ color: 0x7d838f, roughness: 0.95 });
    var stripeM = new THREE.MeshStandardMaterial({ color: 0x343b47, roughness: 0.9 });
    var spots = [
      { x: 14.9, z: -14.4, rot: 0.7 }, { x: -14.9, z: -14.7, rot: -0.7 },
      { x: 14.9, z: 14.6, rot: -0.7 }, { x: -14.9, z: 14.5, rot: 0.7 },
    ];
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var grp = new THREE.Group();
      grp.add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.72, 2.6), conM).translateY(0.36));
      grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.5, 2.6), conM).translateY(0.9));
      grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.16, 2.7), stripeM).translateY(0.7));
      grp.position.set(s.x, 0, s.z);
      grp.rotation.y = s.rot;
      grp.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(grp);
    }
    return g;
  }

  // ---------------- street lamps (behind the end lines) ----------------
  function lamps() {
    var g = new THREE.Group();
    var poleM = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.6, metalness: 0.5 });
    var headM = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c9, emissiveIntensity: 1.5 });
    var spots = [
      { x: 9.2, z: -28.8 }, { x: -9.2, z: 28.8 },
    ];
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 9.6, 8), poleM);
      pole.position.set(s.x, 4.8, s.z);
      pole.castShadow = true;
      g.add(pole);
      var arm = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.1, 0.1), poleM);
      arm.position.set(s.x + (s.z < 0 ? -1 : 1), 9.5, s.z);
      g.add(arm);
      var head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.9), headM);
      head.position.set(s.x + (s.z < 0 ? -2 : 2), 9.5, s.z);
      g.add(head);
      var pl = new THREE.PointLight(0xffe0a8, 0.55, 22, 1.6);
      pl.position.set(s.x + (s.z < 0 ? -2 : 2), 8.8, s.z);
      g.add(pl);
    }
    return g;
  }

  // ---------------- benches ----------------
  function benches() {
    var g = new THREE.Group();
    var woodM = new THREE.MeshStandardMaterial({ color: 0x6d4a2c, roughness: 0.9 });
    var legM = new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.8 });
    var spots = [
      { x: 11.6, z: -27.4, rot: 0 }, { x: -11.6, z: 27.4, rot: Math.PI },
    ];
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var grp = new THREE.Group();
      var seat = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.55), woodM);
      seat.position.y = 0.5;
      var back = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.6, 0.1), woodM);
      back.position.set(0, 0.85, -0.24);
      grp.add(seat); grp.add(back);
      for (var j = 0; j < 2; j++) {
        var leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.5), legM);
        leg.position.set(-0.8 + j * 1.6, 0.26, 0.05);
        grp.add(leg);
      }
      grp.position.set(s.x, 0, s.z);
      grp.rotation.y = s.rot;
      grp.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(grp);
    }
    return g;
  }

  // ---------------- trees ----------------
  function trees() {
    var g = new THREE.Group();
    var trunkM = new THREE.MeshStandardMaterial({ color: 0x4a3520, roughness: 0.95 });
    var leafM = new THREE.MeshStandardMaterial({ color: 0x2d6b35, roughness: 0.85 });
    var leafM2 = new THREE.MeshStandardMaterial({ color: 0x3a7d42, roughness: 0.85 });
    var spots = [
      { x: -32, z: -28, s: 1.0 }, { x: 34, z: -24, s: 0.85 },
      { x: -34, z: 20, s: 0.95 }, { x: 32, z: 28, s: 1.1 },
      { x: -18, z: -32, s: 0.7 }, { x: 18, z: 32, s: 0.8 },
      { x: -42, z: -8, s: 0.9 }, { x: 42, z: 8, s: 0.75 },
      { x: -30, z: 36, s: 1.05 }, { x: 30, z: -36, s: 0.9 },
    ];
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var tree = new THREE.Group();
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s.s, 0.22 * s.s, 2.5 * s.s, 6), trunkM);
      trunk.position.y = 1.25 * s.s;
      trunk.castShadow = true;
      tree.add(trunk);
      var leafMat = Math.random() > 0.5 ? leafM : leafM2;
      var crown = new THREE.Mesh(new THREE.SphereGeometry(1.2 * s.s, 8, 6), leafMat);
      crown.position.y = 3.2 * s.s;
      crown.castShadow = true;
      tree.add(crown);
      // smaller secondary crown for fullness
      var crown2 = new THREE.Mesh(new THREE.SphereGeometry(0.8 * s.s, 6, 5), leafMat);
      crown2.position.set(0.4 * s.s, 2.8 * s.s, 0.3 * s.s);
      crown2.castShadow = true;
      tree.add(crown2);
      tree.position.set(s.x, 0, s.z);
      tree.rotation.y = Math.random() * 6.28;
      g.add(tree);
      // gentle sway animation
      anims.push({ g: crown, t: Math.random() * 6, amp: 0.03 + Math.random() * 0.02, sway: true });
    }
    return g;
  }

  // ---------------- parked vehicles ----------------
  function vehicles() {
    var g = new THREE.Group();
    var bodyM = new THREE.MeshStandardMaterial({ color: 0x3a4455, roughness: 0.6, metalness: 0.3 });
    var bodyM2 = new THREE.MeshStandardMaterial({ color: 0x8a2222, roughness: 0.6, metalness: 0.3 });
    var bodyM3 = new THREE.MeshStandardMaterial({ color: 0x2a5530, roughness: 0.6, metalness: 0.3 });
    var wheelM = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.95 });
    var glassM = new THREE.MeshStandardMaterial({ color: 0x5588aa, roughness: 0.3, metalness: 0.4, transparent: true, opacity: 0.5 });
    function addCar(x, z, rot, col) {
      var car = new THREE.Group();
      // body
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6), col);
      body.position.y = 0.55;
      car.add(body);
      // roof
      var roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.8), col);
      roof.position.set(0, 1.1, -0.2);
      car.add(roof);
      // windows
      var win = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.4, 0.05), glassM);
      win.position.set(0, 1.1, 0.65);
      car.add(win);
      var win2 = win.clone(); win2.position.z = -1.1; car.add(win2);
      // wheels
      var wGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.15, 8);
      var wPos = [[-0.85, 0.22, 1.0], [0.85, 0.22, 1.0], [-0.85, 0.22, -1.0], [0.85, 0.22, -1.0]];
      for (var w = 0; w < wPos.length; w++) {
        var wheel = new THREE.Mesh(wGeo, wheelM);
        wheel.position.set(wPos[w][0], wPos[w][1], wPos[w][2]);
        wheel.rotation.z = Math.PI / 2;
        car.add(wheel);
      }
      car.position.set(x, 0, z);
      car.rotation.y = rot;
      car.traverse(function(o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      g.add(car);
    }
    addCar(-33, -10, 0.15, bodyM);
    addCar(35, 12, -0.2, bodyM2);
    addCar(-35, 8, 0.1, bodyM3);
    addCar(33, -12, -0.15, bodyM);
    return g;
  }

  // ---------------- additional street furniture ----------------
  function streetFurniture() {
    var g = new THREE.Group();
    var poleM = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6, metalness: 0.4 });
    var signM = new THREE.MeshStandardMaterial({ color: 0x3388cc, roughness: 0.7 });
    // additional street lamps around the perimeter
    var lampSpots = [
      { x: -20, z: -28 }, { x: 20, z: -28 },
      { x: -20, z: 28 }, { x: 20, z: 28 },
      { x: -34, z: 0 }, { x: 34, z: 0 },
    ];
    var lampHeadM = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c9, emissiveIntensity: 1.2 });
    for (var i = 0; i < lampSpots.length; i++) {
      var s = lampSpots[i];
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 7.5, 6), poleM);
      pole.position.set(s.x, 3.75, s.z);
      pole.castShadow = true;
      g.add(pole);
      var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), lampHeadM);
      lamp.position.set(s.x, 7.6, s.z);
      g.add(lamp);
      var pl = new THREE.PointLight(0xffe8b0, 0.35, 16, 2);
      pl.position.set(s.x, 7.2, s.z);
      g.add(pl);
    }
    // small chain-link fence sections around the outer perimeter
    var fencePostM = new THREE.MeshStandardMaterial({ color: 0x3a4050, roughness: 0.7, metalness: 0.5 });
    var fencePositions = [
      { x: -44, z: -15, r: 0 }, { x: -44, z: 15, r: 0 },
      { x: 44, z: -15, r: 0 }, { x: 44, z: 15, r: 0 },
      { x: -15, z: -44, r: Math.PI / 2 }, { x: 15, z: -44, r: Math.PI / 2 },
      { x: -15, z: 44, r: Math.PI / 2 }, { x: 15, z: 44, r: Math.PI / 2 },
    ];
    for (var f = 0; f < fencePositions.length; f++) {
      var fp = fencePositions[f];
      var fpole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 4), fencePostM);
      fpole.position.set(fp.x, 1.1, fp.z);
      fpole.castShadow = true;
      g.add(fpole);
    }
    return g;
  }

  // ---------------- assemble ----------------
  // The pitch surface group holds ONLY what changes with the selected court:
  // the slab texture + its painted lines/logo. Swapping a court rebuilds this
  // single group; the environment and props stay put.
  function buildSurface() {
    var g = new THREE.Group();
    var custom = LG.Courts ? LG.Courts.active() : null;
    if (custom) {
      // The artwork IS the court — it carries its own markings.  Drawing any
      // procedural line overlay or center logo on top is exactly the "picture
      // behind the game" look the court art was meant to replace, so a custom
      // surface is JUST the artwork slab (aspect-correct; see courtSlabCustom).
      g.add(courtSlabCustom(custom));
    } else {
      g.add(courtSlab());
      g.add(courtLines(0.82));
      g.add(centerLogo());
    }
    return g;
  }

  function build(scene) {
    root = new THREE.Group();
    anims.length = 0;

    root.add(skyBox());
    root.add(ground());

    surfaceGroup = buildSurface();
    root.add(surfaceGroup);

    // The 3D goal frame/net is purely cosmetic (functional goal geometry —
    // posts collision list, goal detection, keeper, net-pocket — lives in
    // coordinate arrays, NOT this mesh).  Court artwork that already paints
    // its own goal mouth + net (paintedGoal) must not be doubled by it, so
    // the frame is hidden for those courts — without touching gameplay.
    goalGroup = goals();
    root.add(goalGroup);
    applyGoalVisibility();
    root.add(bleacher(-1));
    root.add(bleacher(1));
    root.add(sideSpectators(1));
    root.add(sideSpectators(-1));
    root.add(buildings());
    root.add(props());
    root.add(graffiti());
    root.add(barriers());
    root.add(lamps());
    root.add(benches());
    root.add(trees());
    root.add(vehicles());
    root.add(streetFurniture());

    var halfW = C.width / 2, halfL = C.length / 2;
    var gw = C.goalWidth / 2;

    // fences around the court (goals leave open mouths)
    root.add(fenceH([[ -halfW, halfW]], -halfL, [-gw - 0.15, gw + 0.15]));
    root.add(fenceH([[ -halfW, halfW]], halfL, [-gw - 0.15, gw + 0.15]));
    root.add(fenceV([[-halfL, halfL]], -halfW, null));
    root.add(fenceV([[-halfL, halfL]], halfW, null));

    scene.add(root);

    var posts = [];
    posts.push({ x: -gw, z: -halfL }, { x: gw, z: -halfL }, { x: -gw, z: halfL }, { x: gw, z: halfL });

    return {
      root: root,
      posts: posts,
      // swap the pitch surface to the currently selected court (no reload)
      refreshCourt: function () {
        if (!root || !surfaceGroup) return;
        root.remove(surfaceGroup);
        surfaceGroup = buildSurface();
        root.add(surfaceGroup);
        // court art may paint its own goal -> re-check cosmetic frame visibility
        applyGoalVisibility();
      },
      update: function (dt) {
        for (var i = 0; i < anims.length; i++) {
          var a = anims[i];
          a.t += dt;
          if (a.sway) {
            // tree sway: gentle side-to-side + vertical bob
            a.g.rotation.z = Math.sin(a.t * 0.7) * a.amp * 2;
            a.g.rotation.x = Math.cos(a.t * 0.5) * a.amp;
          } else {
            a.g.position.y += Math.sin(a.t * 6) * a.amp * 0.1;
          }
        }
      },
    };
  }

  return { build: build };
})();