var LG = window.LG = window.LG || {};

LG.Cosmetics = (function () {
  var KEY = 'blockout.cosmetics.v1';

  var OUTFITS = [
    { id: 'hoody', label: 'HOODIE', hood: true },
    { id: 'hoodydown', label: 'HOOD DOWN', hood: false },
    { id: 'track', label: 'TRACK TOP', hood: false },
    { id: 'jersey', label: 'JERSEY', hood: false },
    { id: 'pinnie', label: 'PINNIE', hood: false },
    { id: 'longsleeve', label: 'LONG SLEEVE', hood: false },
    { id: 'windbreaker', label: 'WINDBREAKER', hood: false },
    { id: 'baggy', label: 'BAGGY KIT', hood: false }
  ];

  var HAIRS = [
    { id: 'natural', label: 'NATURAL', idx: -1 },
    { id: 'buzz', label: 'BUZZ', idx: 7 },
    { id: 'short', label: 'SHORT', idx: 3 },
    { id: 'spiky', label: 'SPIKY', idx: 0 },
    { id: 'afro', label: 'AFRO', idx: 4 },
    { id: 'curly', label: 'CURLY', idx: 5 },
    { id: 'ponytail', label: 'PONYTAIL', idx: 6 },
    { id: 'mohawk', label: 'MOHAWK', idx: 2 }
  ];

  var ACCESSORIES = [
    { id: 'none', label: 'NONE' },
    { id: 'headband', label: 'HEADBAND' },
    { id: 'cap', label: 'CAP' },
    { id: 'wristband', label: 'WRISTBANDS' },
    { id: 'armband', label: 'ARM BAND' },
    { id: 'glasses', label: 'SHADES' }
  ];

  var SKINS = [
    { id: 'default', label: 'DEFAULT', color: null },
    { id: 'tone1', label: 'PORCELAIN', color: 0xf2c9a0 },
    { id: 'tone2', label: 'SAND', color: 0xe0a878 },
    { id: 'tone3', label: 'HONEY', color: 0xc98d5e },
    { id: 'tone4', label: 'AMBER', color: 0xa9713f },
    { id: 'tone5', label: 'COCOA', color: 0x7a5a42 },
    { id: 'tone6', label: 'ESPRESSO', color: 0x4f3826 }
  ];

  var DEFAULTS = {
    blaze: { outfit: 'hoody', hair: 'natural', accessory: 'headband', skin: 'default' },
    cannon: { outfit: 'jersey', hair: 'buzz', accessory: 'none', skin: 'default' },
    frenzy: { outfit: 'pinnie', hair: 'spiky', accessory: 'wristband', skin: 'default' },
    stone: { outfit: 'windbreaker', hair: 'short', accessory: 'none', skin: 'default' },
    echo: { outfit: 'track', hair: 'ponytail', accessory: 'glasses', skin: 'default' },
    pulse: { outfit: 'longsleeve', hair: 'afro', accessory: 'armband', skin: 'default' },
    volt: { outfit: 'hoodydown', hair: 'mohawk', accessory: 'none', skin: 'default' },
    brute: { outfit: 'baggy', hair: 'buzz', accessory: 'wristband', skin: 'default' }
  };

  var KEYS = ['outfit', 'hair', 'accessory', 'skin'];
  var saved = null;

  function hashId(id) {
    var s = String(id == null ? '' : id), h = 0;
    for (var i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) | 0;
    return h < 0 ? -h : h;
  }

  function pick(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function load() {
    if (saved) return saved;
    saved = {};
    try {
      if (typeof localStorage !== 'undefined') {
        var raw = localStorage.getItem(KEY);
        if (raw) {
          var o = JSON.parse(raw);
          if (o && typeof o === 'object') saved = o;
        }
      }
    } catch (e) { }
    return saved;
  }

  function save() {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(KEY, JSON.stringify(saved || {}));
      }
    } catch (e) { }
  }

  function fallback(id) {
    var h = hashId(id);
    return {
      outfit: OUTFITS[h % OUTFITS.length].id,
      hair: HAIRS[1 + ((h >> 3) % (HAIRS.length - 1))].id,
      accessory: ACCESSORIES[(h >> 6) % ACCESSORIES.length].id,
      skin: 'default'
    };
  }

  function get(id) {
    var base = (id && DEFAULTS[id]) || fallback(id);
    var over = (id && load()[id]) || {};
    var out = {};
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      out[k] = over[k] != null ? over[k] : base[k];
    }
    if (!pick(OUTFITS, out.outfit)) out.outfit = base.outfit;
    if (!pick(HAIRS, out.hair)) out.hair = base.hair;
    if (!pick(ACCESSORIES, out.accessory)) out.accessory = base.accessory;
    if (out.skin !== 'default' && !pick(SKINS, out.skin)) out.skin = 'default';
    return out;
  }

  function set(id, patch) {
    if (!id || !patch) return get(id);
    var all = load();
    var cur = all[id] || {};
    var next = {};
    for (var i = 0; i < KEYS.length; i++) {
      var k = KEYS[i];
      next[k] = patch[k] != null ? patch[k] : cur[k];
    }
    if (!pick(OUTFITS, next.outfit)) delete next.outfit;
    if (!pick(HAIRS, next.hair)) delete next.hair;
    if (!pick(ACCESSORIES, next.accessory)) delete next.accessory;
    if (next.skin && next.skin !== 'default' && !pick(SKINS, next.skin)) delete next.skin;
    all[id] = next;
    save();
    return get(id);
  }

  function reset(id) {
    var all = load();
    if (id) delete all[id];
    else saved = {};
    save();
  }

  function catalog() {
    return { outfits: OUTFITS, hairs: HAIRS, accessories: ACCESSORIES, skins: SKINS };
  }

  function labelOf(list, id) {
    var hit = pick(list, id);
    return hit ? hit.label : '';
  }

  function resolve(def) {
    try {
      if (!def || typeof def !== 'object' || def.__cos || !def.id) return def;
      var c = get(def.id);
      var out = {}, k;
      for (k in def) if (Object.prototype.hasOwnProperty.call(def, k)) out[k] = def[k];
      out.__cos = c;
      var hair = pick(HAIRS, c.hair);
      if (hair && hair.idx >= 0) out.hairStyle = hair.idx;
      if (c.skin && c.skin !== 'default' && def.palette) {
        var tone = pick(SKINS, c.skin);
        if (tone && tone.color != null) {
          out.palette = {};
          for (k in def.palette) {
            if (Object.prototype.hasOwnProperty.call(def.palette, k)) out.palette[k] = def.palette[k];
          }
          out.palette.skin = tone.color;
        }
      }
      return out;
    } catch (e) {
      return def;
    }
  }

  var _box = null;
  function unitBox() {
    if (!_box) _box = new THREE.BoxGeometry(1, 1, 1);
    return _box;
  }

  function ball(r) {
    return new THREE.SphereGeometry(r, 8, 6);
  }

  function concat(list) {
    var total = 0, i;
    for (i = 0; i < list.length; i++) {
      var pa = list[i].attributes && list[i].attributes.position;
      if (!pa) return null;
      total += pa.count;
    }
    if (!total) return null;
    var pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), off = 0;
    for (i = 0; i < list.length; i++) {
      var g = list[i];
      pos.set(g.attributes.position.array, off * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
      off += g.attributes.position.count;
    }
    var out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return out;
  }

  function Painter(bone) {
    this.bone = bone;
    this.groups = {};
    this.order = [];
  }

  Painter.prototype._push = function (m, g) {
    var key = m.uuid;
    if (!this.groups[key]) {
      this.groups[key] = { mat: m, geos: [] };
      this.order.push(key);
    }
    this.groups[key].geos.push(g);
  };

  Painter.prototype.put = function (m, geo, pos, rot, scale) {
    try {
      var g = geo.index ? geo.toNonIndexed() : geo;
      var q;
      if (rot && rot.isQuaternion) q = rot;
      else if (rot && rot.isEuler) q = new THREE.Quaternion().setFromEuler(rot);
      else q = new THREE.Quaternion();
      var mtx = new THREE.Matrix4().compose(
        pos || new THREE.Vector3(),
        q,
        scale || new THREE.Vector3(1, 1, 1)
      );
      g.applyMatrix4(mtx);
      this._push(m, g);
    } catch (e) { }
  };

  Painter.prototype.putGeo = function (m, g) {
    try { this._push(m, g); } catch (e) { }
  };

  Painter.prototype.flush = function () {
    if (!this.bone) return 0;
    var inv = new THREE.Matrix4();
    try {
      if (!this.bone.matrixWorld) return 0;
      inv.copy(this.bone.matrixWorld).invert();
    } catch (e) { return 0; }
    var n = 0;
    for (var i = 0; i < this.order.length; i++) {
      var grp = this.groups[this.order[i]];
      var geo = concat(grp.geos);
      if (!geo) continue;
      var mesh = new THREE.Mesh(geo, grp.mat);
      inv.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.castShadow = true;
      this.bone.add(mesh);
      n++;
    }
    this.groups = {};
    this.order = [];
    return n;
  };

  function findBone(root, re) {
    var hit = null;
    root.traverse(function (o) {
      if (!hit && o.isBone && re.test(o.name)) hit = o;
    });
    return hit;
  }

  function meshBox(o) {
    var v = new THREE.Vector3(), out = new THREE.Box3(), any = false;
    var pos = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
    if (!pos) return null;
    var mw = o.matrixWorld;
    var step = Math.max(1, Math.ceil(pos.count / 4000));
    for (var i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i);
      if (o.boneTransform) o.boneTransform(i, v);
      v.applyMatrix4(mw);
      out.expandByPoint(v);
      any = true;
    }
    return any ? out : null;
  }

  function axisOf(a, b) {
    if (!a || !b) return null;
    var fa = new THREE.Vector3(), fb = new THREE.Vector3();
    a.getWorldPosition(fa);
    b.getWorldPosition(fb);
    var d = new THREE.Vector3().subVectors(fb, fa);
    var len = d.length();
    if (len < 1e-5) return null;
    d.multiplyScalar(1 / len);
    var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    return { a: fa, b: fb, q: q, len: len };
  }

  function axisOrFall(ax, fb, B, drop) {
    if (ax) return ax;
    if (!fb) return null;
    var fa = new THREE.Vector3();
    fb.getWorldPosition(fa);
    var b2 = new THREE.Vector3(fa.x, fa.y - (drop || 0.4) * B, fa.z);
    var d = new THREE.Vector3().subVectors(b2, fa);
    var len = d.length();
    if (len < 1e-5) return null;
    d.multiplyScalar(1 / len);
    var q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    return { a: fa, b: b2, q: q, len: len };
  }

  function axisAt(ax, t) {
    return new THREE.Vector3().lerpVectors(ax.a, ax.b, t);
  }

  function bandPut(p, mtl, ax, t, len, cross) {
    if (!p || !ax) return;
    p.put(mtl, unitBox(), axisAt(ax, t), ax.q, new THREE.Vector3(cross, len, cross));
  }

  function wpos(b) {
    var w = new THREE.Vector3();
    if (b && b.getWorldPosition) b.getWorldPosition(w);
    return w;
  }

  function measure(skin, skinBox, groundY, bones) {
    var pos = skin.geometry.attributes.position;
    var mw = skin.matrixWorld;
    var v = new THREE.Vector3();
    var topY = skinBox.max.y;
    var bodyH = Math.max(0.001, topY - Math.min(groundY, skinBox.min.y));
    var headTop = topY - 0.19 * bodyH;
    var armY = 0, armN = 0;
    if (bones && bones.armL) { armY += wpos(bones.armL).y; armN++; }
    if (bones && bones.armR) { armY += wpos(bones.armR).y; armN++; }
    var hipsP = wpos(bones && bones.hips);
    var shoulderY = armN ? armY / armN : topY - 0.45 * bodyH;
    var bandLo, bandHi;
    if (armN && bones && bones.hips) {
      bandLo = hipsP.y - 0.03 * bodyH;
      bandHi = shoulderY + 0.02 * bodyH;
    } else {
      bandLo = topY - 0.655 * bodyH;
      bandHi = topY - 0.545 * bodyH;
    }
    var pts = [];
    var minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, bn = 0;
    var fz = null;
    var capX = 0.14 * bodyH;
    var coreX = [], coreZ = [];
    for (var i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (skin.boneTransform) skin.boneTransform(i, v);
      v.applyMatrix4(mw);
      if (v.y >= headTop) pts.push(v.x, v.y, v.z);
      if (v.y >= bandLo && v.y <= bandHi) {
        if (v.x < minx) minx = v.x;
        if (v.x > maxx) maxx = v.x;
        if (v.z < minz) minz = v.z;
        if (v.z > maxz) { maxz = v.z; fz = [v.x, v.y, v.z]; }
        if (Math.abs(v.x) <= capX) { coreX.push(v.x); coreZ.push(v.z); }
        bn++;
      }
    }
    function pct(arr, p) {
      if (!arr.length) return 0;
      var s = arr.slice().sort(function (a, b) { return a - b; });
      var idx = Math.round(p * (s.length - 1));
      return s[Math.max(0, Math.min(s.length - 1, idx))];
    }
    var cminx = pct(coreX, 0.03), cmaxx = pct(coreX, 0.97);
    var czBack = pct(coreZ, 0.10), czFront = pct(coreZ, 0.90);
    var zDbg = 'coreN=' + coreX.length +
      ' zp=' + [0.5, 0.9].map(function (p) { return pct(coreZ, p).toFixed(2); }).join('/');
    if (coreZ.length < 8) {
      czFront = maxz;
      czBack = minz;
      cminx = minx;
      cmaxx = maxx;
    }
    if (pts.length < 18 || bn < 4) {
      console.warn('[COS] measure empty pts=' + pts.length + ' bn=' + bn +
        ' topY=' + topY.toFixed(3) + ' headTop=' + headTop.toFixed(3) +
        ' band=[' + bandLo.toFixed(3) + ',' + bandHi.toFixed(3) + ']' +
        ' pos=' + (pos ? pos.count : 'none'));
      return null;
    }
    var n = pts.length / 3, cx = 0, cy = 0, cz = 0;
    for (i = 0; i < pts.length; i += 3) { cx += pts[i]; cy += pts[i + 1]; cz += pts[i + 2]; }
    cx /= n; cy /= n; cz /= n;
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (i = 0; i < pts.length; i += 3) {
      if (pts[i] < x0) x0 = pts[i];
      if (pts[i] > x1) x1 = pts[i];
      if (pts[i + 1] < y0) y0 = pts[i + 1];
      if (pts[i + 1] > y1) y1 = pts[i + 1];
      if (pts[i + 2] < z0) z0 = pts[i + 2];
      if (pts[i + 2] > z1) z1 = pts[i + 2];
    }
    var rx = Math.max(0.01, (x1 - x0) / 2);
    var ry = Math.max(0.01, (y1 - y0) / 2);
    var rz = Math.max(0.01, (z1 - z0) / 2);
    var front = 1;
    var hp = wpos(bones && bones.head), cp = wpos(bones && bones.chest);
    return {
      bodyH: bodyH, topY: topY, groundY: groundY,
      cx: cx, cy: cy, cz: cz, rx: rx, ry: ry, rz: rz, rr: (rx + ry + rz) / 3,
      front: front,
      headP: hp, chestP: cp, hipsP: hipsP,
      neckY: shoulderY + 0.35 * Math.max(0, cy - shoulderY),
      shoulderY: shoulderY,
      chestY: shoulderY - 0.10 * bodyH,
      waistY: hipsP.y + 0.35 * Math.max(0, shoulderY - hipsP.y),
      hemY: hipsP.y - 0.04 * bodyH,
      torsoW: Math.max(0.04, (cmaxx - cminx) / 2),
      torsoD: Math.max(0.02, czFront - czBack),
      zMid: (czFront + czBack) / 2,
      zFront: front > 0 ? czFront : czBack,
      zBack: front > 0 ? czBack : czFront,
      fzPt: fz,
      bandPts: bn,
      zDbg: zDbg
    };
  }

  function decorate(model, def) {
    if (!model || !model.glb || !model.scene || !def || !def.__cos) return model;
    if (typeof THREE === 'undefined' || !LG.Models || !LG.Models.mat) return model;
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var c = def.__cos;
    var pal = def.palette || {};
    var added = 0;
    function V(x, y, z) { return new THREE.Vector3(x, y, z); }
    try {
      var scene = model.scene;
      scene.updateMatrixWorld(true);

      var bones = {
        head: findBone(scene, /^Head/i),
        chest: findBone(scene, /^Chest/i),
        hips: findBone(scene, /^Hips/i),
        armL: findBone(scene, /^ArmL/i), armR: findBone(scene, /^ArmR/i),
        foreL: findBone(scene, /^ForearmL/i), foreR: findBone(scene, /^ForearmR/i),
        handL: findBone(scene, /^HandL/i), handR: findBone(scene, /^HandR/i),
        legL: findBone(scene, /^LegL/i), legR: findBone(scene, /^LegR/i),
        calfL: findBone(scene, /^CalfL/i), calfR: findBone(scene, /^CalfR/i),
        footL: findBone(scene, /^FootL/i), footR: findBone(scene, /^FootR/i),
        toesL: findBone(scene, /^ToesL/i), toesR: findBone(scene, /^ToesR/i)
      };

      var skin = null, hairMesh = null, skinned = [], i;
      scene.traverse(function (o) {
        if (!o.isSkinnedMesh) return;
        skinned.push(o);
        var kit = o.userData && o.userData.kit;
        if (kit === 'shirt' && !skin) skin = o;
        else if (kit === 'hair') hairMesh = o;
      });
      if (!skin) {
        for (i = 0; i < skinned.length; i++) {
          var mm = Array.isArray(skinned[i].material) ? skinned[i].material[0] : skinned[i].material;
          if (mm && /^begue/i.test(mm.name || '')) { skin = skinned[i]; break; }
        }
      }

      var groundY = Infinity, skinBox = null, boxes = [];
      for (i = 0; i < skinned.length; i++) {
        var b = meshBox(skinned[i]);
        boxes.push(b);
        if (!b) continue;
        if (b.min.y < groundY) groundY = b.min.y;
        if (skinned[i] === skin) skinBox = b;
      }
      if (groundY === Infinity) groundY = 0;

      var hoodMeshes = [];
      if (skinBox) {
        var topY = skinBox.max.y;
        var bodyH = Math.max(0.001, topY - Math.min(groundY, skinBox.min.y));
        for (i = 0; i < skinned.length; i++) {
          var ho = skinned[i];
          if (ho.userData && ho.userData.kit) continue;
          if (ho === skin || !boxes[i]) continue;
          if (boxes[i].min.y > topY - 0.34 * bodyH) hoodMeshes.push(ho);
        }
        scene.traverse(function (o) {
          if (o.isSkinnedMesh && o.userData && o.userData.kit === 'helmet' && hoodMeshes.indexOf(o) < 0) {
            hoodMeshes.push(o);
          }
        });
      }

      var outfitDef = pick(OUTFITS, c.outfit) || OUTFITS[0];
      var hoodUp = !!outfitDef.hood;
      for (i = 0; i < hoodMeshes.length; i++) hoodMeshes[i].visible = hoodUp;
      if (hairMesh) hairMesh.visible = !hoodUp && c.hair === 'natural';

      var M = null;
      if (skin && skinBox) {
        try { M = measure(skin, skinBox, groundY, bones); } catch (e) { M = null; console.warn('[COS] measure threw: ' + ((e && e.message) || e)); }
      }

      var mEye = LG.Models.mat(0xf2efe6, 'eyew');
      var mDark = LG.Models.mat(0x14161c, 'face');
      var mHairM = LG.Models.mat(pal.hair != null ? pal.hair : 0x333333, 'hair');
      var mShirt = LG.Models.mat(pal.shirt, 'shirt');
      var mTrim = LG.Models.mat(pal.trim, 'trim');
      var mPants = LG.Models.mat(pal.pants, 'pants');
      var mShoe = LG.Models.mat(pal.shoe, 'shoe');
      var mSole = LG.Models.mat(0x15161a, 'sole');

      var pH = bones.head ? new Painter(bones.head) : null;
      var pC = bones.chest ? new Painter(bones.chest) : null;
      var pHip = bones.hips ? new Painter(bones.hips) : null;
      var pAL = bones.armL ? new Painter(bones.armL) : null;
      var pAR = bones.armR ? new Painter(bones.armR) : null;
      var pFL = bones.foreL ? new Painter(bones.foreL) : null;
      var pFR = bones.foreR ? new Painter(bones.foreR) : null;
      var pLL = bones.legL ? new Painter(bones.legL) : null;
      var pLR = bones.legR ? new Painter(bones.legR) : null;
      var pBoL = bones.footL ? new Painter(bones.footL) : null;
      var pBoR = bones.footR ? new Painter(bones.footR) : null;

      var B = M ? M.bodyH : 1.6;
      var eyeDX = 0, eyeR = 0, eyeY = 0, rr = 0;
      function surfZ(dx, dy) {
        if (!M) return 0;
        var t = 1 - (dx * dx) / (M.rx * M.rx) - (dy * dy) / (M.ry * M.ry);
        return M.cz + (t > 0 ? M.rz * Math.sqrt(t) : 0) * M.front;
      }

      if (M && pH) {
        rr = M.rr;
        eyeR = 0.19 * rr;
        eyeDX = 0.38 * M.rx;
        eyeY = M.cy - 0.42 * M.ry;
        var faceDbg = [];
        for (var sg = -1; sg <= 1; sg += 2) {
          var ex = sg * eyeDX;
          var ez = surfZ(ex, eyeY - M.cy);
          faceDbg.push('eye(' + sg + ')=' + ex.toFixed(3) + ',' + eyeY.toFixed(3) + ',' + ez.toFixed(3));
          pH.put(mEye, ball(eyeR), V(ex, eyeY, ez + M.front * 0.35 * eyeR), null, V(1, 1.05, 0.8));
          pH.put(mDark, ball(eyeR * 0.40), V(ex, eyeY, ez + M.front * 1.05 * eyeR), null, null);
          var by = M.cy - 0.05 * M.ry;
          var bz = surfZ(ex, by - M.cy);
          faceDbg.push('brow(' + sg + ')=' + ex.toFixed(3) + ',' + by.toFixed(3) + ',' + bz.toFixed(3));
          pH.put(mHairM, unitBox(), V(ex, by, bz + M.front * 0.35 * rr),
            new THREE.Euler(0, 0, sg * 0.18),
            V(0.26 * rr, 0.065 * rr, 0.08 * rr));
        }
        var my = M.cy - 0.62 * M.ry;
        var mz = surfZ(0, my - M.cy);
        faceDbg.push('mouth=0,' + my.toFixed(3) + ',' + mz.toFixed(3));
        pH.put(mDark, unitBox(), V(0, my, mz + M.front * 0.40 * rr),
          null, V(0.36 * rr, 0.07 * rr, 0.08 * rr));
        console.log('[COS] face ' + faceDbg.join(' ') +
          ' cloud c=' + M.cx.toFixed(3) + ',' + M.cy.toFixed(3) + ',' + M.cz.toFixed(3) +
          ' r=' + M.rx.toFixed(3) + ',' + M.ry.toFixed(3) + ',' + M.rz.toFixed(3) +
          ' hb=' + (function () { var h = new THREE.Vector3(); bones.head.getWorldPosition(h); return h.x.toFixed(3) + ',' + h.y.toFixed(3) + ',' + h.z.toFixed(3); })());
      }

      if (M && pH && c.hair !== 'natural' && !hoodUp) {
        var holder = new THREE.Group();
        holder.position.set(M.cx, M.cy, M.cz);
        var hscale = (M.rr / 0.31) * 1.04;
        holder.scale.set(hscale, hscale, hscale);
        holder.updateMatrix();
        LG.Models.attachHair(holder, def);
        for (var hi = 0; hi < holder.children.length; hi++) {
          var ch = holder.children[hi];
          if (!ch.isMesh || !ch.geometry) continue;
          ch.updateMatrix();
          var hg = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry;
          hg.applyMatrix4(ch.matrix);
          hg.applyMatrix4(holder.matrix);
          pH.putGeo(ch.material, hg);
        }
      }

      var axUL = axisOrFall(axisOf(bones.armL, bones.foreL), bones.armL, B, 0.35);
      var axUR = axisOrFall(axisOf(bones.armR, bones.foreR), bones.armR, B, 0.35);
      var axFL = axisOrFall(axisOf(bones.foreL, bones.handL), bones.foreL, B, 0.30);
      var axFR = axisOrFall(axisOf(bones.foreR, bones.handR), bones.foreR, B, 0.30);
      var axLL = axisOrFall(axisOf(bones.legL, bones.calfL), bones.legL, B, 0.42);
      var axLR = axisOrFall(axisOf(bones.legR, bones.calfR), bones.legR, B, 0.42);

      if (M && pC) {
        function collar(mtl, h) {
          pC.put(mtl, unitBox(), V(0, M.neckY + 0.015 * B + h * 0.5, M.zMid),
            null, V(0.115 * B, h, 0.105 * B));
        }
        function zipper(mtl) {
          pC.put(mtl, unitBox(), V(0, (M.neckY + M.waistY) * 0.5, M.zFront + 0.002 * B),
            null, V(0.024 * B, (M.neckY - M.waistY) * 0.96, 0.03 * B));
        }
        function chev(mtl, y, off, len, tilt) {
          for (var s2 = -1; s2 <= 1; s2 += 2) {
            pC.put(mtl, unitBox(), V(s2 * off, y, M.zFront + 0.003 * B),
              new THREE.Euler(0, 0, -s2 * tilt),
              V(len * 0.15, len, 0.035 * B));
          }
        }
        var id = c.outfit;
        if (id === 'hoody') {
          pC.put(mPants, unitBox(), V(0, M.waistY + 0.04 * B, M.zFront + 0.012 * B),
            null, V(1.3 * M.torsoW, 0.09 * B, 0.045 * B));
          pC.put(mTrim, unitBox(), V(-0.05 * B, M.neckY - 0.05 * B, M.zFront + 0.008 * B),
            null, V(0.014 * B, 0.10 * B, 0.02 * B));
          pC.put(mTrim, unitBox(), V(0.05 * B, M.neckY - 0.05 * B, M.zFront + 0.008 * B),
            null, V(0.014 * B, 0.10 * B, 0.02 * B));
          if (axUL) bandPut(pAL, mShirt, axUL, 0.50, axUL.len * 0.95, 0.070 * B);
          if (axUR) bandPut(pAR, mShirt, axUR, 0.50, axUR.len * 0.95, 0.070 * B);
          if (axFL) bandPut(pFL, mShirt, axFL, 0.5, axFL.len * 0.95, 0.064 * B);
          if (axFR) bandPut(pFR, mShirt, axFR, 0.5, axFR.len * 0.95, 0.064 * B);
        } else if (id === 'hoodydown') {
          pC.put(mPants, unitBox(), V(0, M.neckY - 0.03 * B, M.zBack - 0.03 * B),
            null, V(0.19 * B, 0.09 * B, 0.075 * B));
          pC.put(mPants, unitBox(), V(0, M.neckY - 0.10 * B, M.zBack - 0.015 * B),
            null, V(0.15 * B, 0.06 * B, 0.06 * B));
          collar(mTrim, 0.05 * B);
          if (axUL) bandPut(pAL, mShirt, axUL, 0.50, axUL.len * 0.95, 0.070 * B);
          if (axUR) bandPut(pAR, mShirt, axUR, 0.50, axUR.len * 0.95, 0.070 * B);
          if (axFL) bandPut(pFL, mShirt, axFL, 0.5, axFL.len * 0.95, 0.064 * B);
          if (axFR) bandPut(pFR, mShirt, axFR, 0.5, axFR.len * 0.95, 0.064 * B);
        } else if (id === 'track') {
          collar(mTrim, 0.055 * B);
          zipper(mTrim);
        } else if (id === 'jersey') {
          collar(mTrim, 0.05 * B);
          chev(mTrim, M.chestY + 0.02 * B, 0.045 * B, 0.20 * B, 0.55);
        } else if (id === 'pinnie') {
          for (var s3 = -1; s3 <= 1; s3 += 2) {
            pC.put(mTrim, unitBox(),
              V(s3 * (M.torsoW + 0.022 * B), (M.chestY + M.waistY) * 0.5, M.zMid),
              null, V(0.055 * B, (M.chestY - M.waistY) * 0.9, Math.max(0.03, M.torsoD * 0.55)));
            pC.put(mTrim, unitBox(),
              V(s3 * 0.035 * B, M.neckY + 0.05 * B, M.zFront + 0.004 * B),
              new THREE.Euler(0, 0, -s3 * 0.5),
              V(0.024 * B, 0.13 * B, 0.03 * B));
          }
        } else if (id === 'windbreaker') {
          pC.put(mTrim, unitBox(), V(0, M.shoulderY - 0.075 * B, M.zMid),
            null, V(M.torsoW * 2 + 0.06 * B, 0.15 * B, M.torsoD * 1.3 + 0.05 * B));
          collar(mTrim, 0.08 * B);
        } else if (id === 'baggy') {
          for (var s4 = -1; s4 <= 1; s4 += 2) {
            pC.put(mPants, unitBox(),
              V(s4 * (M.torsoW + 0.012 * B), (M.hemY + M.waistY) * 0.5, M.zMid),
              null, V(0.05 * B, (M.waistY - M.hemY) * 1.05, Math.max(0.03, M.torsoD * 0.8)));
          }
        }
      }

      if (M && c.outfit === 'track') {
        bandPut(pAL, mTrim, axUL, 0.35, 0.045 * B, 0.066 * B);
        bandPut(pAR, mTrim, axUR, 0.35, 0.045 * B, 0.066 * B);
        bandPut(pAL, mTrim, axUL, 0.68, 0.045 * B, 0.066 * B);
        bandPut(pAR, mTrim, axUR, 0.68, 0.045 * B, 0.066 * B);
      }
      if (M && c.outfit === 'jersey') {
        bandPut(pAL, mShirt, axUL, 0.20, 0.11 * B, 0.078 * B);
        bandPut(pAR, mShirt, axUR, 0.20, 0.11 * B, 0.078 * B);
      }
      if (M && c.outfit === 'pinnie') {
        bandPut(pAL, mTrim, axUL, 0.10, 0.05 * B, 0.078 * B);
        bandPut(pAR, mTrim, axUR, 0.10, 0.05 * B, 0.078 * B);
      }
      if (M && c.outfit === 'longsleeve') {
        if (axUL) bandPut(pAL, mShirt, axUL, 0.50, axUL.len * 0.95, 0.070 * B);
        if (axUR) bandPut(pAR, mShirt, axUR, 0.50, axUR.len * 0.95, 0.070 * B);
        if (axFL) bandPut(pFL, mShirt, axFL, 0.5, axFL.len * 0.95, 0.064 * B);
        if (axFR) bandPut(pFR, mShirt, axFR, 0.5, axFR.len * 0.95, 0.064 * B);
        if (pC) {
          pC.put(mTrim, unitBox(), V(0, M.neckY + 0.015 * B + 0.025 * B, M.zMid),
            null, V(0.115 * B, 0.05 * B, 0.105 * B));
        }
      }
      if (M && c.outfit === 'windbreaker') {
        bandPut(pFL, mTrim, axFL, 0.92, 0.05 * B, 0.062 * B);
        bandPut(pFR, mTrim, axFR, 0.92, 0.05 * B, 0.062 * B);
      }
      if (M && c.outfit === 'baggy') {
        function thigh(p, ax) {
          if (!p || !ax) return;
          var q = axisAt(ax, 0.45);
          var top = M.hemY + 0.03 * B;
          var hh = 0.22 * B;
          p.put(mPants, unitBox(), V(q.x, top - hh * 0.5, q.z), ax.q,
            V(0.145 * B, hh, 0.155 * B));
        }
        thigh(pLL, axLL);
        thigh(pLR, axLR);
      }

      function paintBoot(p, footB, toesB) {
        if (!p || !footB || !M) return;
        var fw = new THREE.Vector3();
        footB.getWorldPosition(fw);
        var dir = new THREE.Vector3(0, 0, 1);
        if (toesB) {
          var tw = new THREE.Vector3();
          toesB.getWorldPosition(tw);
          dir.set(tw.x - fw.x, 0, tw.z - fw.z);
          if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
        } else if (M.front < 0) dir.set(0, 0, -1);
        dir.normalize();
        var q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(dir.x, dir.z), 0));
        var L = 0.135 * B, W = 0.048 * B, Hh = 0.065 * B;
        if (toesB) {
          var td = new THREE.Vector3();
          toesB.getWorldPosition(td);
          var span = Math.hypot(td.x - fw.x, td.z - fw.z);
          if (span > 0.02 * B) L = Math.min(0.20 * B, span + 0.085 * B);
        }
        var cx = fw.x + dir.x * 0.035 * B, cz = fw.z + dir.z * 0.035 * B;
        var cy = M.groundY + Hh * 0.5 + 0.004 * B;
        p.put(mShoe, unitBox(), V(cx, cy, cz), q, V(W, Hh, L));
        p.put(mSole, unitBox(), V(cx, M.groundY + 0.013 * B, cz), q,
          V(W * 1.06, 0.026 * B, L * 1.05));
      }
      paintBoot(pBoL, bones.footL, bones.toesL);
      paintBoot(pBoR, bones.footR, bones.toesR);

      if (M && pH) {
        if (c.accessory === 'headband') {
          pH.put(mTrim, new THREE.CylinderGeometry(M.rx * 0.9, M.rx * 0.9, 0.055 * B, 14, 1, true),
            V(0, M.cy + 0.55 * M.ry, M.cz), null, null);
        } else if (c.accessory === 'cap' && !hoodUp) {
          var capR = M.rx * 1.12;
          pH.put(mShirt, new THREE.SphereGeometry(capR, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
            V(0, M.cy + 0.40 * M.ry, M.cz), null, V(1, 0.85, 1));
          pH.put(mTrim, unitBox(), V(0, M.cy + 0.42 * M.ry, M.cz + M.front * capR * 0.78),
            null, V(1.6 * M.rx, 0.03 * B, 0.7 * M.rx));
        } else if (c.accessory === 'glasses') {
          var gz = surfZ(0, eyeY - M.cy);
          pH.put(mDark, unitBox(),
            V(0, eyeY, gz + M.front * 0.10 * rr),
            null, V(2 * eyeDX + 0.44 * rr, 0.20 * rr, 0.16 * rr));
        }
      }
      if (M && c.accessory === 'wristband') {
        bandPut(pFL, mTrim, axFL, 0.94, 0.05 * B, 0.10 * B);
        bandPut(pFR, mTrim, axFR, 0.94, 0.05 * B, 0.10 * B);
      }
      if (M && c.accessory === 'armband') {
        bandPut(pAL, mTrim, axUL, 0.45, 0.05 * B, 0.112 * B);
      }

      var ps = [pH, pC, pHip, pAL, pAR, pFL, pFR, pLL, pLR, pBoL, pBoR];
      for (var pi = 0; pi < ps.length; pi++) if (ps[pi]) added += ps[pi].flush();

      try {
        var ms = ((window.performance && performance.now) ? performance.now() : Date.now()) - t0;
        console.log('[COS] decorate ' + (def.id || '?') +
          ' outfit=' + c.outfit + ' hair=' + c.hair + ' acc=' + c.accessory +
          ' skin=' + c.skin + ' hood=' + (hoodUp ? 'up' : 'down') +
          ' front=' + (M ? (M.front > 0 ? '+Z' : '-Z') : '?') +
          ' rr=' + (M ? M.rr.toFixed(3) : '?') +
          ' bodyH=' + (M ? M.bodyH.toFixed(3) : '?') +
          ' ground=' + (M ? M.groundY.toFixed(3) : '?') +
          ' hoodMeshes=' + hoodMeshes.length +
          ' +mesh=' + added + ' ms=' + ms.toFixed(1) +
          (M ? ' cy=' + M.cy.toFixed(3) + ' cz=' + M.cz.toFixed(3) +
            ' headP=' + M.headP.y.toFixed(3) +
            ' sh=' + M.shoulderY.toFixed(3) + ' neck=' + M.neckY.toFixed(3) +
            ' chest=' + M.chestY.toFixed(3) + ' waist=' + M.waistY.toFixed(3) +
            ' hem=' + M.hemY.toFixed(3) + ' top=' + M.topY.toFixed(3) +
            ' tw=' + M.torsoW.toFixed(3) + ' td=' + M.torsoD.toFixed(3) +
            ' zm=' + M.zMid.toFixed(3) + ' zf=' + M.zFront.toFixed(3) +
            ' zb=' + M.zBack.toFixed(3) + ' ' + M.zDbg : ''));
      } catch (e) { }
    } catch (e) {
      try { console.warn('[COS] decorate failed: ' + ((e && e.message) || e)); } catch (e2) { }
    }
    return model;
  }

  return {
    KEY: KEY,
    catalog: catalog,
    labelOf: labelOf,
    get: get,
    set: set,
    reset: reset,
    resolve: resolve,
    decorate: decorate
  };
})();
