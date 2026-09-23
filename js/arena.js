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
  var cheerT = 0;            // goal-reaction window (event-driven, not per-specator)
  var cheerDur = 2.8;
  var boundGoal = false;

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

    // asphalt road (the outermost surface — city streets)
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
    asphaltT.repeat.set(8, 8);
    var asphalt = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshLambertMaterial({ map: asphaltT }));
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.position.y = -0.03;
    asphalt.receiveShadow = true;
    g.add(asphalt);

    // concrete sidewalk — continuous ring around the court
    // Built from 4 panels: 2 long sides + 2 end sides, forming a border
    // between the court fence and the road zone
    var walkT = LG.Util.makeCanvasTexture(function (c, w, h) {
      c.fillStyle = '#505862';
      c.fillRect(0, 0, w, h);
      // slab joint lines
      c.strokeStyle = 'rgba(0,0,0,0.25)';
      c.lineWidth = 2;
      var step = w / 6;
      for (var i = 1; i < 6; i++) {
        c.beginPath(); c.moveTo(i * step, 0); c.lineTo(i * step, h); c.stroke();
      }
      var step2 = h / 4;
      for (var j = 1; j < 4; j++) {
        c.beginPath(); c.moveTo(0, j * step2); c.lineTo(w, j * step2); c.stroke();
      }
      // surface noise — small cracks and grime
      for (var n = 0; n < 60; n++) {
        c.fillStyle = 'rgba(0,0,0,' + (0.04 + Math.random() * 0.08) + ')';
        c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 1);
      }
    });

    // south sidewalk (court fence z=22 to road z=35)
    var southW = 26, southD = 13;
    var walkS = new THREE.Mesh(new THREE.PlaneGeometry(southW + 2, southD), new THREE.MeshLambertMaterial({ map: walkT }));
    walkS.rotation.x = -Math.PI / 2;
    walkS.position.set(0, 0.005, C.length / 2 + southD / 2);
    walkS.receiveShadow = true;
    g.add(walkS);

    // north sidewalk
    var walkN = walkS.clone();
    walkN.position.z = -(C.length / 2 + southD / 2);
    g.add(walkN);

    // east sidewalk (court fence x=13 to road x=30)
    var sideW = 17, sideL = C.length + southD * 2;
    var walkE = new THREE.Mesh(new THREE.PlaneGeometry(sideW, sideL), new THREE.MeshLambertMaterial({ map: walkT }));
    walkE.rotation.x = -Math.PI / 2;
    walkE.position.set(C.width / 2 + sideW / 2, 0.005, 0);
    walkE.receiveShadow = true;
    g.add(walkE);

    // west sidewalk
    var walkW = walkE.clone();
    walkW.position.x = -(C.width / 2 + sideW / 2);
    g.add(walkW);

    // curb edges (thin raised concrete strips at sidewalk/road boundary)
    var curbM = new THREE.MeshStandardMaterial({ color: 0x6a7080, roughness: 0.9 });
    var curbH = 0.08, curbW = 0.18;
    // south curb
    var curbS = new THREE.Mesh(new THREE.BoxGeometry(southW + 2, curbH, curbW), curbM);
    curbS.position.set(0, curbH / 2, C.length / 2 + southD);
    g.add(curbS);
    // north curb
    var curbN = curbS.clone(); curbN.position.z = -(C.length / 2 + southD); g.add(curbN);
    // east curb
    var curbE = new THREE.Mesh(new THREE.BoxGeometry(curbW, curbH, sideL), curbM);
    curbE.position.set(C.width / 2 + sideW, curbH / 2, 0);
    g.add(curbE);
    // west curb
    var curbW = curbE.clone(); curbW.position.x = -(C.width / 2 + sideW); g.add(curbW);

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
      c.fillText('BLACKOUT', w / 2, h / 2);
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
  // Dense city blocks wrap the court on all sides.  Ground floors are shops
  // with awnings; upper floors are apartments with coloured facades.  The
  // buildings sit OUTSIDE the buffer zone (court fence ±13/±22 + ~17 units
  // clear space) so the gameplay camera always has an unobstructed view of
  // the pitch, players and ball.
  function buildings() {
    var g = new THREE.Group();
    var dark = new THREE.MeshStandardMaterial({ color: 0x222a34, roughness: 0.9 });

    // facade palette — warm, saturated tones matching the reference art
    var facades = [
      { hex: '#b83c2c', cols: 3, rows: 5 },   // red brick
      { hex: '#c98830', cols: 3, rows: 4 },   // warm ochre
      { hex: '#2a6b8a', cols: 3, rows: 5 },   // teal blue
      { hex: '#d4a853', cols: 4, rows: 4 },   // sandy beige
      { hex: '#7a4a2e', cols: 3, rows: 5 },   // brown brick
      { hex: '#3a7a5a', cols: 3, rows: 4 },   // deep green
      { hex: '#9a3a3a', cols: 4, rows: 5 },   // crimson
      { hex: '#4a5a8a', cols: 3, rows: 5 },   // slate blue
      { hex: '#c47a30', cols: 3, rows: 4 },   // orange
      { hex: '#6a4a7a', cols: 3, rows: 5 },   // purple
    ];
    var fi = 0;
    function facade() { var f = facades[fi % facades.length]; fi++; return f; }

    // shop sign names — short street-food / urban names
    var shopNames = [
      'THE CORNER CAFE', 'GROCERY', 'BURGER JOINT', 'BIKE SHOP',
      'RESIDENCY', 'BARBERSHOP', 'PIZZA PLACE', 'LAUNDROMAT',
      'TACO SHOP', 'NEWSSTAND', 'COFFEE HOUSE', 'RECORD STORE',
      'BAKERY', 'FISH MARKET', 'NAIL SALON', 'FLOWER SHOP',
    ];
    var si = 0;
    function shopName() { var s = shopNames[si % shopNames.length]; si++; return s; }

    // awning colours — alternating warm stripes
    var awningPairs = [
      ['#cc3333', '#ffffff'], ['#2288cc', '#ffffff'],
      ['#33aa55', '#ffffff'], ['#dd8822', '#ffffff'],
      ['#8844aa', '#ffffff'], ['#cc5588', '#ffffff'],
    ];
    var aii = 0;
    function awningPair() { var p = awningPairs[aii % awningPairs.length]; aii++; return p; }

    // ---- addBlock: a coloured building with windows + optional shop front ----
    function addBlock(x, z, w, h, d, fc, hasShop, shopZ) {
      // building body
      var tex = LG.Models.cityBuildingTex(fc.hex, fc.cols, fc.rows);
      var mat = new THREE.MeshLambertMaterial({ map: tex });
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, h / 2, z);
      m.receiveShadow = true; m.castShadow = true;
      g.add(m);

      // roof slab (flat, slightly wider)
      var roofM = new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.9 });
      var roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.22, d + 0.3), roofM);
      roof.position.set(x, h + 0.11, z);
      roof.receiveShadow = true;
      g.add(roof);

      // shop front (ground floor facing the court)
      if (hasShop) {
        var sz = shopZ != null ? shopZ : (z > 0 ? z + d / 2 + 0.02 : z - d / 2 - 0.02);
        var shopFace = z > 0 ? 1 : -1;
        // shop awning
        var ap = awningPair();
        var awnTex = LG.Models.awningTex(ap[0], ap[1]);
        var awn = new THREE.Mesh(
          new THREE.PlaneGeometry(w * 0.9, 0.8),
          new THREE.MeshLambertMaterial({ map: awnTex, side: THREE.DoubleSide })
        );
        awn.position.set(x, 3.2, sz);
        awn.rotation.x = shopFace > 0 ? -0.25 : 0.25;
        g.add(awn);
        // shop sign
        var signTex = LG.Models.shopSignTex(shopName(), '#1a2233', '#ffd23f');
        var sign = new THREE.Mesh(
          new THREE.PlaneGeometry(w * 0.75, 0.6),
          new THREE.MeshBasicMaterial({ map: signTex })
        );
        sign.position.set(x, 2.8, sz);
        sign.rotation.y = shopFace > 0 ? 0 : Math.PI;
        g.add(sign);
        // shop door (dark recess)
        var doorM = new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.9 });
        var door = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.2, 0.15), doorM);
        door.position.set(x, 1.1, sz);
        g.add(door);
        // shop window (lighter panel beside door)
        var shopWinM = new THREE.MeshBasicMaterial({ color: 0x88aacc, transparent: true, opacity: 0.35 });
        var shopWin = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.4, 1.4), shopWinM);
        shopWin.position.set(x + (w * 0.25), 1.5, sz + shopFace * 0.01);
        g.add(shopWin);
      }

      // window details on side faces (x-direction)
      if (w > 6) {
        var winSide = new THREE.MeshBasicMaterial({ color: 0x5577aa, transparent: true, opacity: 0.25 });
        var ws = new THREE.Mesh(new THREE.PlaneGeometry(d * 0.8, h * 0.7), winSide);
        ws.position.set(x + w / 2 + 0.01, h * 0.55, z);
        ws.rotation.y = Math.PI / 2;
        g.add(ws);
      }
    }

    // ================================================================
    // SOUTH SIDE (z = +38..+48) — shops facing the court
    // ================================================================
    addBlock(-12, 40, 10, 12, 8, facade(), true);
    addBlock(0,   40, 8,  16, 7, facade(), true);
    addBlock(10,  40, 10, 10, 8, facade(), true);
    addBlock(-12, 48, 8,  18, 7, facade(), false);
    addBlock(0,   49, 10, 14, 8, facade(), false);
    addBlock(12,  48, 9,  20, 7, facade(), false);

    // ================================================================
    // NORTH SIDE (z = -38..-48) — shops facing the court
    // ================================================================
    addBlock(-10, -40, 10, 14, 8, facade(), true);
    addBlock(2,   -40, 8,  12, 7, facade(), true);
    addBlock(12,  -40, 10, 16, 8, facade(), true);
    addBlock(-12, -49, 9,  20, 7, facade(), false);
    addBlock(0,   -49, 8,  15, 8, facade(), false);
    addBlock(12,  -49, 10, 18, 7, facade(), false);

    // ================================================================
    // EAST SIDE (x = +30..+48) — along the touchline
    // ================================================================
    addBlock(32, -12, 8, 15, 9, facade(), true);
    addBlock(32,  0,  9, 12, 8, facade(), true);
    addBlock(32,  12, 8, 18, 9, facade(), true);
    addBlock(42, -10, 7, 22, 7, facade(), false);
    addBlock(42,  4,  8, 16, 8, facade(), false);
    addBlock(48, -4,  7, 24, 8, facade(), false);
    addBlock(48,  12, 6, 14, 7, facade(), false);

    // ================================================================
    // WEST SIDE (x = -30..-48) — along the touchline
    // ================================================================
    addBlock(-32, -10, 8, 16, 9, facade(), true);
    addBlock(-32,  4,  9, 12, 8, facade(), true);
    addBlock(-32,  14, 8, 20, 9, facade(), true);
    addBlock(-42, -8,  7, 18, 7, facade(), false);
    addBlock(-42,  6,  8, 14, 8, facade(), false);
    addBlock(-48,  0,  7, 22, 8, facade(), false);
    addBlock(-48,  14, 6, 12, 7, facade(), false);

    // ================================================================
    // CORNER BUILDINGS — denser corners like the reference
    // ================================================================
    addBlock(-30, -30, 7, 14, 7, facade(), false);
    addBlock( 30, -30, 7, 12, 7, facade(), false);
    addBlock(-30,  30, 7, 16, 7, facade(), false);
    addBlock( 30,  30, 7, 10, 7, facade(), false);

    // ================================================================
    // ROOFTOP DETAILS — water tanks, AC units, railings
    // ================================================================
    var tankM = new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.85 });
    var acM = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, roughness: 0.7, metalness: 0.4 });
    var railM = new THREE.MeshStandardMaterial({ color: 0x3a4050, roughness: 0.7, metalness: 0.3 });
    var tankSpots = [
      [-12, 12.1, 40], [0, 16.1, 40], [32, 15.1, -12], [-32, 16.1, 14],
      [42, 22.1, -10], [-42, 18.1, 6], [-12, 20.1, -40], [12, 16.1, -40],
    ];
    for (var t = 0; t < tankSpots.length; t++) {
      var tp = tankSpots[t];
      var tank = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.65, 1.2, 10), tankM);
      tank.position.set(tp[0], tp[1], tp[2]);
      tank.castShadow = true;
      g.add(tank);
    }
    var acSpots = [
      [8.5, 10.1, 40], [-6, 14.1, 40], [36.5, 12.1, 0],
      [-36.5, 14.1, 4], [44.5, 20.1, -4], [-44.5, 16.1, 0],
    ];
    for (var a = 0; a < acSpots.length; a++) {
      var ap2 = acSpots[a];
      var ac = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.45, 0.8), acM);
      ac.position.set(ap2[0], ap2[1], ap2[2]);
      ac.castShadow = true;
      g.add(ac);
    }

    // ================================================================
    // BILLBOARDS — larger, on building faces
    // ================================================================
    var bb1 = new THREE.Mesh(
      new THREE.BoxGeometry(7, 3.2, 0.3),
      new THREE.MeshLambertMaterial({ map: LG.Models.billboardTex('BLACKOUT CUP') })
    );
    bb1.position.set(8, 6.5, -46.2); bb1.castShadow = true; g.add(bb1);

    var bb2 = new THREE.Mesh(
      new THREE.BoxGeometry(6, 2.8, 0.3),
      new THREE.MeshLambertMaterial({ map: LG.Models.billboardTex('STREET LEAGUE') })
    );
    bb2.position.set(-10, 5.6, 45.8); g.add(bb2);

    // additional shop signs on building sides (facing the streets)
    var sideSign1 = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 1.2),
      new THREE.MeshBasicMaterial({ map: LG.Models.shopSignTex('GROCERY', '#2a5530', '#ffffff') })
    );
    sideSign1.position.set(36.1, 3.5, 0);
    sideSign1.rotation.y = Math.PI / 2;
    g.add(sideSign1);

    var sideSign2 = new THREE.Mesh(
      new THREE.PlaneGeometry(3.5, 1.2),
      new THREE.MeshBasicMaterial({ map: LG.Models.shopSignTex('PIZZA', '#cc3333', '#ffffff') })
    );
    sideSign2.position.set(-36.1, 3.5, 4);
    sideSign2.rotation.y = -Math.PI / 2;
    g.add(sideSign2);

    return g;
  }

  // ---------------- props ----------------
  function props() {
    var g = new THREE.Group();

    // corner floodlight poles (at the goal ends)
    var poleM = new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.6 });
    var lampM = new THREE.MeshStandardMaterial({ color: 0xfff2c9, emissive: 0xfff6d8, emissiveIntensity: 1.4 });
    var poles = [[-C.width / 2 - 2, -C.length / 2 - 1.4], [C.width / 2 + 2, C.length / 2 + 1.4]];
    for (var p = 0; p < poles.length; p++) {
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 9, 8), poleM);
      pole.position.set(poles[p][0], 4.5, poles[p][1]);
      pole.castShadow = false; g.add(pole);
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
      { x: 16.4, z: 10.5, rot: -0.12, tex: tagTex('BLACKOUT', '#35e0ff') },
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

  // ---------------- crosswalks & road markings ----------------
  function crosswalks() {
    var g = new THREE.Group();
    var whiteM = new THREE.MeshBasicMaterial({ color: 0xf0f0f0 });
    // zebra stripe crosswalk: rows of white bars on a road surface
    function addCrosswalk(cx, cz, rot, width, depth) {
      var barCount = 5;
      var barW = width / (barCount * 2 - 1);
      var barD = depth;
      for (var b = 0; b < barCount; b++) {
        var bar = new THREE.Mesh(new THREE.BoxGeometry(barW * 0.85, 0.02, barD), whiteM);
        bar.position.set(cx + (b - (barCount - 1) / 2) * barW * 2, 0.035, cz);
        bar.rotation.y = rot;
        g.add(bar);
      }
    }
    // four crosswalks at the corners of the court zone
    addCrosswalk(-6,  34, 0, 12, 3);
    addCrosswalk( 6,  34, 0, 12, 3);
    addCrosswalk(-6, -34, 0, 12, 3);
    addCrosswalk( 6, -34, 0, 12, 3);
    // road edge lines (yellow centre lines)
    var yellowM = new THREE.MeshBasicMaterial({ color: 0xddaa33 });
    var edgeLines = [
      { x: 0, z: 37, w: 52, d: 0.15 },
      { x: 0, z: -37, w: 52, d: 0.15 },
      { x: 35, z: 0, w: 0.15, d: 50 },
      { x: -35, z: 0, w: 0.15, d: 50 },
    ];
    for (var i = 0; i < edgeLines.length; i++) {
      var el = edgeLines[i];
      var line = new THREE.Mesh(new THREE.BoxGeometry(el.w, 0.02, el.d), yellowM);
      line.position.set(el.x, 0.032, el.z);
      g.add(line);
    }
    return g;
  }

  // ---------------- short court railing ----------------
  // A low waist-height metal railing that marks the court boundary — just
  // enough to say "this is the pitch" without blocking the camera.
  function barriers() {
    var g = new THREE.Group();
    var railM = new THREE.MeshStandardMaterial({ color: 0x4a5565, roughness: 0.65, metalness: 0.4 });
    var postM = new THREE.MeshStandardMaterial({ color: 0x3a4050, roughness: 0.7, metalness: 0.5 });

    // railing runs along all four sides of the court, just outside the fence
    // with gaps at the goal mouths
    var halfW = C.width / 2 + 0.8;
    var halfL = C.length / 2 + 0.8;
    var railH = 0.65;  // waist height — low, not blocking
    var postH = 0.85;
    var railR = 0.04;
    var postR = 0.06;

    // south railing (z = +halfL), gap at the goal mouth
    addRailSegment(-halfW, halfL, halfW, halfL, railM, postM, railH, postH, railR, postR, g);
    // north railing (z = -halfL), gap at the goal mouth
    addRailSegment(-halfW, -halfL, halfW, -halfL, railM, postM, railH, postH, railR, postR, g);
    // east railing (x = +halfW)
    addRailSegment(halfW, -halfL + 6, halfW, halfL - 6, railM, postM, railH, postH, railR, postR, g);
    // west railing (x = -halfW)
    addRailSegment(-halfW, -halfL + 6, -halfW, halfL - 6, railM, postM, railH, postH, railR, postR, g);

    return g;
  }

  // helper: a single railing segment (horizontal bar + evenly-spaced posts)
  function addRailSegment(x1, z1, x2, z2, railM, postM, railH, postH, railR, postR, parent) {
    var dx = x2 - x1, dz = z2 - z1;
    var len = Math.sqrt(dx * dx + dz * dz);
    var yaw = Math.atan2(dx, dz);
    var cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;

    // horizontal bar
    var bar = new THREE.Mesh(new THREE.CylinderGeometry(railR, railR, len, 6), railM);
    bar.rotation.x = Math.PI / 2;
    bar.rotation.z = yaw;
    bar.position.set(cx, railH, cz);
    bar.castShadow = true;
    parent.add(bar);

    // second lower bar
    var bar2 = bar.clone();
    bar2.position.y = railH * 0.45;
    parent.add(bar2);

    // posts every ~3 units
    var postCount = Math.max(2, Math.ceil(len / 3));
    for (var i = 0; i < postCount; i++) {
      var t = i / (postCount - 1);
      var px = x1 + dx * t;
      var pz = z1 + dz * t;
      var post = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, postH, 6), postM);
      post.position.set(px, postH / 2, pz);
      post.castShadow = true;
      parent.add(post);
    }
  }

  // ---------------- street lamps (behind the end lines) ----------------
  function lamps() {
    var g = new THREE.Group();
    var poleM = new THREE.MeshStandardMaterial({ color: 0x20242b, roughness: 0.6, metalness: 0.5 });
    var headM = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c9, emissiveIntensity: 1.5 });
    var spots = [
      { x: 9.2, z: -26 }, { x: -9.2, z: 26 },
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
      { x: 11.6, z: 25, rot: 0 },
      { x: -11.6, z: -25, rot: Math.PI },
      { x: 11.6, z: -25, rot: Math.PI },
      { x: -11.6, z: 25, rot: 0 },
      { x: 25, z: 10, rot: -Math.PI / 2 },
      { x: 25, z: -6, rot: -Math.PI / 2 },
      { x: -25, z: 10, rot: Math.PI / 2 },
      { x: -25, z: -6, rot: Math.PI / 2 },
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
    var leafM3 = new THREE.MeshStandardMaterial({ color: 0x4a8a50, roughness: 0.85 });
    var spots = [
      { x: -38, z: -36, s: 1.0 }, { x: 40, z: -32, s: 0.85 },
      { x: -40, z: 28, s: 0.95 }, { x: 38, z: 36, s: 1.1 },
      { x: -24, z: -40, s: 0.7 }, { x: 24, z: 40, s: 0.8 },
      { x: -50, z: -8, s: 0.9 }, { x: 50, z: 8, s: 0.75 },
      { x: -36, z: 44, s: 1.05 }, { x: 36, z: -44, s: 0.9 },
      // closer trees — at sidewalk / street corners
      { x: -22, z: 30, s: 0.65 }, { x: 22, z: 30, s: 0.6 },
      { x: -22, z: -30, s: 0.6 }, { x: 22, z: -30, s: 0.65 },
      { x: 30, z: -20, s: 0.55 }, { x: 30, z: 20, s: 0.55 },
      { x: -30, z: -20, s: 0.55 }, { x: -30, z: 20, s: 0.55 },
    ];
    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var tree = new THREE.Group();
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * s.s, 0.22 * s.s, 2.5 * s.s, 6), trunkM);
      trunk.position.y = 1.25 * s.s;
      trunk.castShadow = true;
      tree.add(trunk);
      var leafMat = [leafM, leafM2, leafM3][i % 3];
      var crown = new THREE.Mesh(new THREE.SphereGeometry(1.2 * s.s, 8, 6), leafMat);
      crown.position.y = 3.2 * s.s;
      crown.castShadow = true;
      tree.add(crown);
      var crown2 = new THREE.Mesh(new THREE.SphereGeometry(0.8 * s.s, 6, 5), leafMat);
      crown2.position.set(0.4 * s.s, 2.8 * s.s, 0.3 * s.s);
      crown2.castShadow = true;
      tree.add(crown2);
      tree.position.set(s.x, 0, s.z);
      tree.rotation.y = Math.random() * 6.28;
      g.add(tree);
      anims.push({ g: crown, t: Math.random() * 6, amp: 0.03 + Math.random() * 0.02, sway: true });
    }
    return g;
  }

  // ---------------- parked vehicles ----------------
  function vehicles() {
    var g = new THREE.Group();
    var wheelM = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.95 });
    var glassM = new THREE.MeshStandardMaterial({ color: 0x5588aa, roughness: 0.3, metalness: 0.4, transparent: true, opacity: 0.5 });
    // car body colour palette — bright, visible from gameplay camera
    var colours = [
      0x3a4455, 0x8a2222, 0x2a5530, 0xccaa22,
      0x2244aa, 0xaa4488, 0xdd6622, 0x556688,
      0x227744, 0x993333,
    ];
    var mats = colours.map(function(c) {
      return new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.3 });
    });
    function addCar(x, z, rot, col) {
      var car = new THREE.Group();
      var body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.6), col);
      body.position.y = 0.55;
      car.add(body);
      var roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.8), col);
      roof.position.set(0, 1.1, -0.2);
      car.add(roof);
      var win = new THREE.Mesh(new THREE.BoxGeometry(1.52, 0.4, 0.05), glassM);
      win.position.set(0, 1.1, 0.65);
      car.add(win);
      var win2 = win.clone(); win2.position.z = -1.1; car.add(win2);
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
    // south street (z ~ +38)
    addCar(-10, 39, 0.1, mats[0]);
    addCar(2, 39.5, -0.05, mats[3]);
    addCar(10, 39, 0.15, mats[4]);
    // north street (z ~ -38)
    addCar(-8, -39, Math.PI + 0.1, mats[1]);
    addCar(5, -39.5, Math.PI - 0.08, mats[5]);
    // east street (x ~ +34)
    addCar(35, -10, Math.PI / 2, mats[2]);
    addCar(35.5, 4, -Math.PI / 2, mats[6]);
    addCar(35, 14, Math.PI / 2, mats[7]);
    // west street (x ~ -34)
    addCar(-35, -8, -Math.PI / 2, mats[8]);
    addCar(-35.5, 6, Math.PI / 2, mats[9]);
    addCar(-35, 16, -Math.PI / 2, mats[0]);
    return g;
  }

  // ---------------- additional street furniture ----------------
  function streetFurniture() {
    var g = new THREE.Group();
    var poleM = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.6, metalness: 0.4 });
    var lampHeadM = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff2c9, emissiveIntensity: 1.2 });
    // ---- street lamps (visual only, no point lights) ----
    var lampSpots = [
      { x: -30, z: -38 }, { x: 30, z: -38 },
      { x: -30, z: 38 }, { x: 30, z: 38 },
      { x: -44, z: 0 }, { x: 44, z: 0 },
    ];
    for (var i = 0; i < lampSpots.length; i++) {
      var s = lampSpots[i];
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 7.5, 6), poleM);
      pole.position.set(s.x, 3.75, s.z);
      pole.castShadow = false;
      g.add(pole);
      var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 4), lampHeadM);
      lamp.position.set(s.x, 7.6, s.z);
      g.add(lamp);
    }
    // ---- fire hydrants ----
    var hydrM = new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.6, metalness: 0.3 });
    var hydrSpots = [
      { x: -28, z: 34 }, { x: 28, z: -34 },
      { x: 34, z: 28 }, { x: -34, z: -28 },
    ];
    for (var h = 0; h < hydrSpots.length; h++) {
      var hs = hydrSpots[h];
      var hydr = new THREE.Group();
      var body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.6, 8), hydrM);
      body.position.y = 0.3;
      hydr.add(body);
      var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.12, 8), hydrM);
      cap.position.y = 0.66;
      hydr.add(cap);
      // side nozzles
      for (var n = 0; n < 2; n++) {
        var nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.18, 6), hydrM);
        nozzle.position.set(n === 0 ? 0.16 : -0.16, 0.4, 0);
        nozzle.rotation.z = Math.PI / 2;
        hydr.add(nozzle);
      }
      hydr.position.set(hs.x, 0, hs.z);
      hydr.traverse(function(o) { if (o.isMesh) o.castShadow = true; });
      g.add(hydr);
    }
    // ---- trash bins ----
    var binM = new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.85 });
    var binSpots = [
      { x: -26, z: 34.5 }, { x: 26, z: 34.5 },
      { x: -26, z: -34.5 }, { x: 26, z: -34.5 },
      { x: 34.5, z: -6 }, { x: -34.5, z: 6 },
    ];
    for (var b = 0; b < binSpots.length; b++) {
      var bs = binSpots[b];
      var bin = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.28, 0.8, 8), binM);
      bin.position.set(bs.x, 0.4, bs.z);
      bin.castShadow = true;
      g.add(bin);
    }
    // ---- bike racks (U-shaped bars) ----
    var rackM = new THREE.MeshStandardMaterial({ color: 0x4a5060, roughness: 0.7, metalness: 0.5 });
    var rackSpots = [
      { x: -28, z: 32.5, r: 0 },
      { x: 28, z: 32.5, r: 0 },
      { x: 32, z: -26, r: Math.PI / 2 },
      { x: -32, z: 26, r: Math.PI / 2 },
    ];
    for (var r = 0; r < rackSpots.length; r++) {
      var rs = rackSpots[r];
      var rack = new THREE.Group();
      for (var ri = 0; ri < 3; ri++) {
        var loop = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.04, 6, 8, Math.PI), rackM);
        loop.position.set(ri * 0.6 - 0.6, 0.35, 0);
        loop.rotation.x = Math.PI / 2;
        loop.castShadow = true;
        rack.add(loop);
      }
      rack.position.set(rs.x, 0, rs.z);
      rack.rotation.y = rs.r;
      g.add(rack);
    }
    // ---- bollards (short posts along sidewalks) ----
    var bollM = new THREE.MeshStandardMaterial({ color: 0x5a6070, roughness: 0.7, metalness: 0.3 });
    var bollSpots = [
      [-24, 33], [-20, 33], [-16, 33], [16, 33], [20, 33], [24, 33],
      [-24, -33], [-20, -33], [-16, -33], [16, -33], [20, -33], [24, -33],
      [33, -14], [33, -4], [33, 4], [33, 14],
      [-33, -14], [-33, -4], [-33, 4], [-33, 14],
    ];
    for (var bi = 0; bi < bollSpots.length; bi++) {
      var bs2 = bollSpots[bi];
      var boll = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.65, 6), bollM);
      boll.position.set(bs2[0], 0.325, bs2[1]);
      boll.castShadow = true;
      g.add(boll);
    }
    // ---- planters (concrete boxes with small shrubs) ----
    var planterM = new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.9 });
    var shrubM = new THREE.MeshStandardMaterial({ color: 0x3a7a3a, roughness: 0.9 });
    var planterSpots = [
      { x: -22, z: 32.5 }, { x: 22, z: 32.5 },
      { x: -22, z: -32.5 }, { x: 22, z: -32.5 },
    ];
    for (var p = 0; p < planterSpots.length; p++) {
      var ps = planterSpots[p];
      var planter = new THREE.Group();
      var box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 1.2), planterM);
      box.position.y = 0.25;
      planter.add(box);
      var shrub = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 5), shrubM);
      shrub.position.y = 0.8;
      shrub.castShadow = true;
      planter.add(shrub);
      planter.position.set(ps.x, 0, ps.z);
      g.add(planter);
    }
    // ---- chain-link fence posts around the outer perimeter ----
    var fencePostM = new THREE.MeshStandardMaterial({ color: 0x3a4050, roughness: 0.7, metalness: 0.5 });
    var fencePositions = [
      { x: -52, z: -15, r: 0 }, { x: -52, z: 15, r: 0 },
      { x: 52, z: -15, r: 0 }, { x: 52, z: 15, r: 0 },
      { x: -15, z: -52, r: Math.PI / 2 }, { x: 15, z: -52, r: Math.PI / 2 },
      { x: -15, z: 52, r: Math.PI / 2 }, { x: 15, z: 52, r: Math.PI / 2 },
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

  // ---------------- perimeter spectators ----------------
  // Static crowd standing just outside the court railing, watching the game.
  // Uses the existing spectator model with simple idle animations.
  function perimeterSpectators() {
    var g = new THREE.Group();
    var halfW = C.width / 2 + 1.5;
    var halfL = C.length / 2 + 1.5;

    // spectator positions around the court — groups on the long sides,
    // sparser on the ends (behind the goals where bleachers already are)
    var spots = [];

    // south side (z = +halfL + a bit) — denser pack, two depth rows
    for (var i = 0; i < 12; i++) {
      var x = -halfW + 2 + i * ((halfW * 2 - 4) / 11);
      var row = i % 2;
      spots.push({ x: x, z: halfL + 1.1 + row * 0.9 + Math.random() * 0.5, rot: Math.PI });
    }
    // north side (z = -halfL - a bit)
    for (var i = 0; i < 12; i++) {
      var x = -halfW + 2 + i * ((halfW * 2 - 4) / 11);
      var row = i % 2;
      spots.push({ x: x, z: -(halfL + 1.1 + row * 0.9 + Math.random() * 0.5), rot: 0 });
    }
    // east side (x = +halfW + a bit)
    for (var i = 0; i < 8; i++) {
      var z = -halfL + 5 + i * ((halfL * 2 - 10) / 7);
      spots.push({ x: halfW + 1.1 + Math.random() * 1.1, z: z, rot: -Math.PI / 2 });
    }
    // west side (x = -halfW - a bit)
    for (var i = 0; i < 8; i++) {
      var z = -halfL + 5 + i * ((halfL * 2 - 10) / 7);
      spots.push({ x: -(halfW + 1.1 + Math.random() * 1.1), z: z, rot: Math.PI / 2 });
    }

    for (var i = 0; i < spots.length; i++) {
      var s = spots[i];
      var spec = LG.Models.spectator(i);
      if (!spec) continue;
      spec.position.set(s.x, 0, s.z);
      spec.rotation.y = s.rot + (Math.random() - 0.5) * 0.3;
      spec.scale.setScalar(0.92 + Math.random() * 0.18);
      g.add(spec);

      // idle animation — staggered phase so the block never bobs in lockstep
      var phase = Math.random() * 10;
      var animKind = Math.random();
      if (animKind < 0.35) {
        anims.push({ g: spec, t: phase, amp: 0.04, cheer: true });
      } else {
        anims.push({ g: spec, t: phase, amp: 0.02, bob: true });
      }
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
    root.add(crosswalks());
    root.add(barriers());
    root.add(lamps());
    root.add(benches());
    root.add(trees());
    root.add(vehicles());
    root.add(streetFurniture());
    root.add(perimeterSpectators());

    var halfW = C.width / 2, halfL = C.length / 2;
    var gw = C.goalWidth / 2;

    // fences around the court (goals leave open mouths)
    root.add(fenceH([[ -halfW, halfW]], -halfL, [-gw - 0.15, gw + 0.15]));
    root.add(fenceH([[ -halfW, halfW]], halfL, [-gw - 0.15, gw + 0.15]));
    root.add(fenceV([[-halfL, halfL]], -halfW, null));
    root.add(fenceV([[-halfL, halfL]], halfW, null));

    scene.add(root);

    // one goal listener for the whole crowd — event-driven, no per-spectator bus
    if (!boundGoal && LG.eventBus && LG.eventBus.on) {
      LG.eventBus.on('goal', function () { cheerT = cheerDur; });
      boundGoal = true;
    }

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
        // low-frequency staggered crowd — one pass, no per-spectator listeners
        cheerT = Math.max(0, cheerT - dt);
        var boost = cheerT > 0 ? (cheerT / cheerDur) : 0;
        for (var i = 0; i < anims.length; i++) {
          var a = anims[i];
          a.t += dt;
          if (a.sway) {
            a.g.rotation.z = Math.sin(a.t * 0.7) * a.amp * 2;
            a.g.rotation.x = Math.cos(a.t * 0.5) * a.amp;
          } else if (a.cheer) {
            // spectator arm-raise: periodic raise-and-lower (staggered phase)
            var v = Math.sin(a.t * 1.8) * 0.5 + 0.5;
            a.g.position.y = v * (0.08 + boost * 0.12);
            raiseArms(a.g, v * (0.4 + boost * 1.4));
          } else if (a.bob) {
            // spectator idle sway + goal-reaction hop
            a.g.rotation.y += Math.sin(a.t * 1.2) * 0.0003;
            a.g.position.y = Math.sin(a.t * 1.5) * 0.015 + boost * (Math.sin(a.t * 9) * 0.04 + 0.04);
            if (boost > 0) raiseArms(a.g, boost * 1.6);
          } else {
            a.g.position.y += Math.sin(a.t * 6) * a.amp * 0.1;
          }
        }
      },
    };
  }

  // lift both arm pivots on a spectator model (cheap — two rotations)
  function raiseArms(g, amount) {
    var u = g && g.userData;
    if (!u || !u.armL || !u.armR) return;
    var target = -amount * 1.1;
    u.armL.rotation.x += (target - u.armL.rotation.x) * 0.2;
    u.armR.rotation.x += (target - u.armR.rotation.x) * 0.2;
    u.armL.rotation.z = amount > 0.2 ? -0.3 : 0;
    u.armR.rotation.z = amount > 0.2 ? 0.3 : 0;
  }

  return { build: build };
})();