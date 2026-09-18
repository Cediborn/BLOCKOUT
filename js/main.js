// ============================================================
// MAIN — boot, loop, menus, orchestration
// ============================================================
(function () {
  var LG = window.LG;
  var U = LG.Util;

  var renderer, scene, camera, camCtrl;
  var match = null;
  var arenaObj = null;
  var UIState = 'menu';          // menu | sides | diff | select | style | how | match | paused | result
  var selectedId = 'blaze';
  var outfitColor = null;        // null = regular clothes, or LG.OutfitColors entry
  var bgT = 0;
  var clock = { t: 0 };
  var isMobile = false;

  var IS_MOBILE = (function () {
    var t = 'ontouchstart' in window;
    var p = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var ua = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(navigator.userAgent || '');
    return t || p || ua;
  })();

  // ---------------- init ----------------
  function init() {
    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x10141c, 45, 120);

    camera = new THREE.PerspectiveCamera(LG.Config.camera.fov, window.innerWidth / window.innerHeight, 0.1, 220);
    camCtrl = new LG.MatchCamera(camera);
    camCtrl.reset();

    lights();
    arenaObj = LG.Arena.build(scene);
    LG.Particles.init(scene);

    LG.Input.init();
    LG.HUD.init();
    LG.HUD.bindButtons();
    refreshDifficultyUI();
    buildSelectGrid();

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    if (IS_MOBILE) {
      isMobile = true;
      // push into landscape + fullscreen on the first gesture, and keep the
      // rotate-phone overlay honest if the user flips back to portrait.
      var orientOnce = function () {
        try {
          var so = screen.orientation || {};
          if (so.lock && so.lock.call) so.lock('landscape').catch(function () {});
        } catch (e) {}
        var fs = document.documentElement;
        if (fs.requestFullscreen) fs.requestFullscreen().catch(function () {});
        else if (fs.webkitRequestFullscreen) fs.webkitRequestFullscreen();
        window.removeEventListener('pointerdown', orientOnce);
      };
      window.addEventListener('pointerdown', orientOnce);
      // show the rotate overlay immediately if already in portrait
      requestAnimationFrame(updateRotate);
    }

    // audio unlock on first gesture
    var unlockOnce = function () { LG.Audio.unlock(); window.removeEventListener('pointerdown', unlockOnce); };
    window.addEventListener('pointerdown', unlockOnce);

    bindEvents();
    showMenu(true);
    requestAnimationFrame(loop);
  }

  function lights() {
    var hemi = new THREE.HemisphereLight(0x9db4da, 0x23272f, 0.85);
    scene.add(hemi);
    var ambient = new THREE.AmbientLight(0x3a4150, 0.5);
    scene.add(ambient);
    var sun = new THREE.DirectionalLight(0xffd9a0, 1.15);
    sun.position.set(16, 30, 12);
    sun.castShadow = true;
    var d = 26;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    scene.add(sun);
  }

  function updateRotate() {
    if (!isMobile) return;
    var el = document.getElementById('rotate-overlay');
    if (!el) return;
    var portrait = window.innerHeight > window.innerWidth;
    el.classList.toggle('hidden', !portrait);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    updateRotate();
  }

  // ---------------- events ----------------
  function bindEvents() {
    var bus = LG.eventBus;

    bus.on('playRequested', function () {
      UIState = 'sides';
      showOverlay('menu-overlay', false);
      showOverlay('sides-overlay', true);
    });

    bus.on('sidesConfirmed', function () {
      UIState = 'diff';
      refreshDifficultyUI();
      showOverlay('sides-overlay', false);
      showOverlay('diff-overlay', true);
    });

    bus.on('sidesBackRequested', function () {
      UIState = 'menu';
      showOverlay('sides-overlay', false);
      showOverlay('menu-overlay', true);
    });

    bus.on('difficultyRequested', function (e) {
      LG.Difficulty.set(e && e.id);
      refreshDifficultyUI();
    });

    bus.on('difficultyConfirmed', function () {
      UIState = 'select';
      refreshDifficultyUI();
      showOverlay('diff-overlay', false);
      showOverlay('select-overlay', true);
    });

    bus.on('difficultyBackRequested', function () {
      UIState = 'sides';
      showOverlay('diff-overlay', false);
      showOverlay('sides-overlay', true);
    });

    bus.on('howRequested', function () {
      showOverlay('menu-overlay', false);
      showOverlay('how-overlay', true);
    });
    bus.on('howBackRequested', function () {
      showOverlay('how-overlay', false);
      showOverlay('menu-overlay', true);
    });

    bus.on('menuBackRequested', function () {
      UIState = 'diff';
      refreshDifficultyUI();
      showOverlay('select-overlay', false);
      showOverlay('diff-overlay', true);
    });

    bus.on('styleRequested', function () {
      UIState = 'style';
      buildColorGrid();
      showOverlay('select-overlay', false);
      showOverlay('style-overlay', true);
    });

    bus.on('styleBackRequested', function () {
      UIState = 'select';
      showOverlay('style-overlay', false);
      showOverlay('select-overlay', true);
    });

    bus.on('styleConfirmed', function () {
      UIState = 'select';
      showOverlay('style-overlay', false);
      showOverlay('select-overlay', true);
    });

    bus.on('startMatchRequested', function () {
      startMatch(selectedId);
    });

    bus.on('pauseRequested', function () {
      if (UIState !== 'match') return;
      UIState = 'paused';
      showOverlay('pause-overlay', true);
      LG.Audio.crowdStop();
      LG.Input.setEnabled(false);
      // a charged shot held across the pause must not fire on resume
      if (match && match.active) {
        match.active.shotCharge = 0;
        match.active.wasShooting = false;
      }
    });
    bus.on('resumeRequested', function () {
      UIState = 'match';
      showOverlay('pause-overlay', false);
      lastNow = nowSec();
      LG.Audio.crowd(0.5);
    });

    bus.on('quitRequested', function () {
      UIState = 'menu';
      if (match) clearMatchFromScene();
      LG.Input.reset();
      LG.HUD.clearTags();
      showOverlay('pause-overlay', false);
      showOverlay('result-overlay', false);
      showMatchUI(false);
      showOverlay('menu-overlay', true);
      LG.Particles.clear();
      camCtrl.reset();
      LG.Audio.crowdStop();
    });

    bus.on('rematchRequested', function () {
      startMatch(selectedId);
    });

    bus.on('matchStart', function () { LG.HUD.reset(match); });
    bus.on('clock', function (e) { LG.HUD.setClock(e.t); });

    bus.on('goal', function (g) {
      var mine = g.team === 0;
      LG.HUD.banner(mine ? 'GOAL!' : 'CONCEDED', mine ? 'team1' : 'team2', 1800);
      LG.HUD.flash(mine ? 'rgba(90,225,255,0.35)' : 'rgba(255,77,94,0.35)', 300);
      LG.HUD.setScore(g.score[0], g.score[1]);
      if (mine) camCtrl.pulse(0.5);
    });

    bus.on('state', function (s) {
      if (s.state === 'KICKOFF') {
        LG.HUD.toast('KICKOFF', 900);
      }
    });

    bus.on('abilityReady', function (p) {
      LG.HUD.toast(LG.Abilities[p.def.ability].name + ' READY!', 1300);
    });

    bus.on('abilityActivated', function (p) {
      var n = LG.Abilities[p.def.ability].name;
      LG.HUD.banner('★ ' + n + ' ★', 'team1', 1100);
      LG.HUD.flash('rgba(255,182,46,0.4)', 220);
      camCtrl.pulse(0.8);
    });

    bus.on('tackleWin', function (t) {
      if (t.src.isHuman) { LG.HUD.toast('ROCKED THEM!', 900); LG.HUD.flash('rgba(120,255,150,0.18)', 180); }
      camCtrl.shake(0.2, 0.22);
    });

    bus.on('perfectPass', function () { LG.HUD.toast('LASER PASS', 800); });

    bus.on('keeperSave', function (e) {
      var me = (match.home || []).indexOf(e.gk) >= 0;
      if (me) { LG.HUD.toast(e.parry ? 'GUARD PUNCHES IT OUT!' : 'GUARD GRABS IT!', 1200); LG.HUD.flash('rgba(120,255,150,0.14)', 180); }
      else { LG.HUD.toast(e.parry ? 'WHAT A PARADE!' : 'KEEPER CLAIMS IT!', 1200); }
    });

    bus.on('switchPlayer', function () {
      LG.HUD.updateSpecial(match.active);
    });

    bus.on('matchEnd', function (r) {
      UIState = 'result';
      LG.Input.reset();
      LG.Audio.crowdStop();
      var endedMatch = match;
      setTimeout(function () {
        if (match !== endedMatch) return; // match was replaced (rematch/quit) while waiting
        showMatchUI(false);
        showOverlay('result-overlay', true);
        setupResult(r);
      }, 900);
    });
  }

  // Reflect the selected level on the difficulty screen and the select screen.
  function refreshDifficultyUI() {
    var cur = LG.Difficulty.get();
    var levels = LG.Difficulty.LEVELS;
    for (var i = 0; i < levels.length; i++) {
      var btn = document.getElementById('diff-' + levels[i]);
      if (btn) btn.classList.toggle('selected', levels[i] === cur);
    }
    var note = document.getElementById('diff-note');
    if (note) note.textContent = LG.Difficulty.blurb();
    var chip = document.getElementById('diff-chip');
    if (chip) chip.textContent = 'DIFFICULTY: ' + LG.Difficulty.label();
  }

  function setupResult(r) {
    var title = document.getElementById('result-title');
    title.className = 'result-title ' + (r.won === 1 ? 'win' : r.won === 0 ? 'draw' : 'lose');
    title.textContent = r.won === 1 ? 'MATCH WON' : r.won === 0 ? 'DRAW' : 'MATCH LOST';
    document.getElementById('res-home').textContent = r.score[0];
    document.getElementById('res-away').textContent = r.score[1];
    document.getElementById('res-coins-n').textContent = '+' + U.fmtMoney(r.coins);
    LG.HUD.updateCoins();
    if (r.won === 1) LG.Audio.sfx.whistle(0.5);
  }

  // ---------------- match lifecycle ----------------
  function startMatch(playerId) {
    selectedId = playerId;
    LG.Input.reset();
    if (match) {
      clearMatchFromScene();
    }
    match = new LG.MatchManager({
      playerId: playerId, homeName: 'YOU', awayName: 'ROGUE',
      difficulty: LG.Difficulty.get(),
      outfitColor: outfitColor,
    });
    match.attachScene(scene, arenaObj);
    match.camera = camCtrl;
    match.selectActive();

    // Mobile: scale players larger for better visibility on small screens
    if (isMobile) {
      var mobileScale = 1.35;
      var allPlayers = match.all;
      for (var pi = 0; pi < allPlayers.length; pi++) {
        allPlayers[pi].model.group.scale.set(mobileScale, mobileScale, mobileScale);
        allPlayers[pi].radius *= mobileScale;
        allPlayers[pi].height *= mobileScale;
      }
      // scale ball slightly
      if (match.ball && match.ball.mesh) {
        match.ball.mesh.scale.set(1.25, 1.25, 1.25);
        match.ball.r *= 1.25;
      }
    }

    showOverlay('select-overlay', false);
    showOverlay('result-overlay', false);
    showMatchUI(true);

    LG.HUD.reset(match);
    camCtrl.reset();
    camCtrl.pulse(0.6);
    LG.Particles.clear();
    match.start();
    UIState = 'match';
    lastNow = nowSec();
  }

  function clearMatchFromScene() {
    if (match.ball && match.ball.mesh) scene.remove(match.ball.mesh);
    if (match.ballGlow) scene.remove(match.ballGlow);
    var all = match.all || [];
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      scene.remove(p.model.group);
      if (p.ring) scene.remove(p.ring);
      if (p.auraMesh) scene.remove(p.auraMesh);
    }
    match = null;
  }

  function showMatchUI(on) {
    document.getElementById('controls').classList.toggle('hidden', !on);
    document.getElementById('scoreboard').classList.toggle('hidden', !on);
    document.getElementById('pause-btn').classList.toggle('hidden', !on);
    document.getElementById('coin-chip').classList.toggle('hidden', false);
    var overlays = ['menu-overlay', 'sides-overlay', 'diff-overlay', 'select-overlay', 'style-overlay', 'how-overlay', 'pause-overlay', 'result-overlay'];
    for (var i = 0; i < overlays.length; i++) document.getElementById(overlays[i]).classList.add('hidden');
  }

  function showMenu(on) {
    showOverlay('menu-overlay', on);
    document.getElementById('coin-chip').classList.toggle('hidden', false);
    document.getElementById('controls').classList.add('hidden');
    document.getElementById('scoreboard').classList.add('hidden');
    document.getElementById('pause-btn').classList.add('hidden');
  }

  function showOverlay(id, on) {
    document.getElementById(id).classList.toggle('hidden', !on);
  }

  // ---------------- character select UI ----------------
  function buildSelectGrid() {
    var grid = document.getElementById('char-grid');
    grid.innerHTML = '';
    for (var i = 0; i < LG.Roster.length; i++) {
      (function (def, idx) {
        var card = document.createElement('div');
        card.className = 'char-card' + (def.id === selectedId ? ' selected' : '');
        var pal = def.palette;
        var color = '#' + pal.shirt.toString(16).padStart(6, '0');
        card.innerHTML =
          '<div class="avatar" style="background:linear-gradient(180deg,rgba(255,255,255,0.16),rgba(0,0,0,0.25));border-color:' + color + '">' + def.emoji + '</div>' +
          '<div class="cname">' + def.name + '</div>' +
          '<div class="crole">' + def.role + '</div>' +
          '<div class="cstats">' +
          statRows(def.stats) +
          '</div>' +
          '<div class="cabil">★ ' + LG.Abilities[def.ability].name + '</div>';
        card.dataset.id = def.id;
        card.addEventListener('click', function () {
          onCardClick(def, card);
        });
        grid.appendChild(card);
        refreshCardLock(card, def);
      })(LG.Roster[i], i);
    }
  }

  function statRows(stats) {
    var names = ['speed', 'shoot', 'pass', 'dribble', 'defense', 'stamina'];
    var html = '';
    for (var i = 0; i < names.length; i++) {
      var v = stats[names[i]];
      html += '<div style="text-align:left">' + names[i] + ' <b>' + v + '</b></div>';
    }
    return html;
  }

  function onCardClick(def, card) {
    if (!LG.Progression.isUnlocked(def.id)) {
      var cost = LG.Progression.costOf(def.id);
      if (LG.Progression.unlock(def.id)) {
        LG.Audio.sfx.specialReady();
        LG.HUD.updateCoins();
        refreshCardLock(card, def);
      } else {
        LG.HUD.toast('NEED ' + cost + ' COINS');
        LG.Audio.sfx.click();
        return;
      }
    }
    selectedId = def.id;
    var cards = document.querySelectorAll('.char-card');
    for (var i = 0; i < cards.length; i++) cards[i].classList.remove('selected');
    card.classList.add('selected');
    LG.Audio.sfx.click();
  }

  function refreshCardLock(card, def) {
    var lock = card.querySelector('.lock');
    var price = card.querySelector('.price');
    if (!LG.Progression.isUnlocked(def.id)) {
      if (!lock) {
        lock = document.createElement('div');
        lock.className = 'lock';
        lock.textContent = '🔒';
        card.appendChild(lock);
      }
      if (!price) {
        price = document.createElement('span');
        price.className = 'price';
        card.appendChild(price);
      }
      price.textContent = '🪙 ' + LG.Progression.costOf(def.id);
    } else {
      if (lock) lock.remove();
      if (price) price.remove();
    }
  }

  // ---------------- player style / customization UI ----------------
  function buildColorGrid() {
    var grid = document.getElementById('color-grid');
    if (!grid) return;
    grid.innerHTML = '';
    // regular clothes button
    var regBtn = document.createElement('div');
    regBtn.className = 'color-btn' + (outfitColor === null ? ' selected' : '');
    regBtn.innerHTML = '<div class="color-swatch" style="background:linear-gradient(135deg,#3d6b50,#6b3d66);border-color:rgba(255,255,255,0.5)"></div><div class="color-label">REGULAR</div>';
    regBtn.addEventListener('click', function() {
      outfitColor = null;
      refreshColorGrid();
      LG.Audio.sfx.click();
    });
    grid.appendChild(regBtn);
    // color buttons
    for (var i = 0; i < LG.OutfitColors.length; i++) {
      (function(c) {
        var btn = document.createElement('div');
        btn.className = 'color-btn' + (outfitColor && outfitColor.id === c.id ? ' selected' : '');
        btn.innerHTML = '<div class="color-swatch" style="background:' + c.hex + '"></div><div class="color-label">' + c.label + '</div>';
        btn.addEventListener('click', function() {
          outfitColor = c;
          refreshColorGrid();
          LG.Audio.sfx.click();
        });
        grid.appendChild(btn);
      })(LG.OutfitColors[i]);
    }
    refreshStylePreview();
  }

  function refreshColorGrid() {
    var btns = document.querySelectorAll('#color-grid .color-btn');
    for (var i = 0; i < btns.length; i++) {
      if (i === 0) {
        btns[i].classList.toggle('selected', outfitColor === null);
      } else {
        var c = LG.OutfitColors[i - 1];
        btns[i].classList.toggle('selected', outfitColor && outfitColor.id === c.id);
      }
    }
    refreshStylePreview();
  }

  function refreshStylePreview() {
    var preview = document.getElementById('style-preview');
    if (!preview) return;
    var playerDef = LG.byId(selectedId);
    var name = playerDef ? playerDef.name : '';
    if (outfitColor === null) {
      preview.innerHTML = '<div class="preview-label">👟 ' + name + ' — REGULAR CLOTHES</div>';
    } else {
      preview.innerHTML = '<div class="preview-label">⚽ ' + name + ' — ' + outfitColor.label + ' KIT</div>';
    }
  }

  // Apply outfit colors to a player definition (returns a new palette)
  function applyOutfit(def) {
    if (!outfitColor) return def.palette; // regular clothes: keep original
    var p = JSON.parse(JSON.stringify(def.palette));
    p.shirt = outfitColor.color;
    p.shoe = outfitColor.color;
    return p;
  }

  // ---------------- loop ----------------
  var lastNow = nowSec();
  function nowSec() { return performance.now() / 1000; }

  function loop() {
    requestAnimationFrame(loop);
    var now = nowSec();
    var dt = U.clamp(now - lastNow, 0, 0.05);
    lastNow = now;

    LG.Input.setEnabled(UIState === 'match');
    LG.Input.update(now);
    bgT += dt;

    if (UIState === 'match') {
      match.update(dt);
      camCtrl.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
      LG.HUD.updateTags(match, camera, dt);
      LG.HUD.updateSpecial(match.active);
      LG.HUD.updateCoins();
      LG.HUD.aim(match.active.shotCharge > 0.15 && match.active.hasBall);
      if (match.state !== 'GOAL') LG.Particles.update(dt);
      arenaObj.update(dt);
    } else if (UIState === 'menu') {
      // idle cinematic drift
      var a = bgT * 0.06;
      camera.position.set(Math.sin(a) * 30, 21, Math.cos(a) * 30 + 6);
      camera.lookAt(0, 0, 0);
      LG.Particles.update(dt);
      arenaObj.update(dt);
    } else {
      camera.position.set(0, 19, 24);
      camera.lookAt(0, 0, 0);
    }

    renderer.render(scene, camera);
  }

  // PWA service worker registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('./service-worker.js').catch(function() {});
    });
  }

  // boot
  window.addEventListener('load', init);
  window.LGMain = {
    startMatch: startMatch,
    getState: function () { return UIState; },
    getMatch: function () { return match; },
  };
})();
