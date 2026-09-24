// ============================================================
// MAIN — boot, loop, menus, orchestration
// ============================================================
(function () {
  var LG = window.LG;
  var U = LG.Util;

  var renderer, scene, camera, camCtrl;
  var match = null;
  var arenaObj = null;
  var UIState = 'menu';          // menu | mode | challengePick | tournament | diff | select | style | court | setup | how | settings | about | profile | challenges | match | paused | result
  var howFromPause = false;      // track if how-to-play was opened from pause
  var profileResetArmed = false; // two-step confirm on RESET PROFILE
  var settingsResetArmed = false; // two-step confirm on RESET PROGRESS
  var quitting = false;          // mid-quit endMatch must not open the result board
  var resultActionLock = false;  // mode-aware result buttons: one action per result
  var selectedMode = 'quick_match';
  var selectedChallengeFocus = null;
  var selectedId = 'blaze';
  var outfitColor = null;        // null = regular clothes, or LG.OutfitColors entry
  var awayColor = null;          // null = default rogue kit, or LG.OutfitColors entry
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
  function hideLoading() {
    var el = document.getElementById('loading-overlay');
    if (el) el.classList.add('hidden');
  }

  function init() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
    } catch (e) {
      var box = document.getElementById('loading-error');
      var tag = document.getElementById('loading-tag');
      var retry = document.getElementById('btn-loading-retry');
      if (tag) tag.classList.add('hidden');
      if (box) {
        box.classList.remove('hidden');
        box.textContent = '3D GRAPHICS ARE UNAVAILABLE IN THIS BROWSER — WEBGL FAILED TO START.';
      }
      if (retry) retry.classList.remove('hidden');
      return;
    }
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

    // Day/Night atmosphere lives in LG.Lighting (owns the key lights). The
    // arena environment is untouched by it — only its lighting is rebalanced.
    LG.Lighting.build(scene, renderer);
    arenaObj = LG.Arena.build(scene);
    if (LG.Living) LG.Living.build({ scene: scene }, arenaObj);
    LG.Particles.init(scene);
    // gather the environment's own lights/emissive signs/sky now that it exists
    LG.Lighting.collect(scene);
    LG.Lighting.setMode(LG.Settings.timeOfDay());

    LG.Input.init();
    LG.HUD.init();
    LG.HUD.bindButtons();
    refreshDifficultyUI();
    buildSelectGrid();
    if (LG.Courts) {
      LG.Courts.probeAll(function () {
        if (UIState === 'court') buildCourtGrid();
        refreshEnvironment(true);
      });
    }

    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    if (IS_MOBILE) {
      isMobile = true;
      // the rotate-phone overlay is driven from the loop, so it can never get
      // stuck over the menus (resize/orientationchange alone are unreliable on
      // phones, and a stuck overlay makes every button untappable)
      requestAnimationFrame(updateRotate);
    }

    // audio unlock on first gesture
    var unlockOnce = function () { LG.Audio.unlock(); window.removeEventListener('pointerdown', unlockOnce); };
    window.addEventListener('pointerdown', unlockOnce);

    bindEvents();
    bindSettingsUI();
    refreshSettingsUI();
    refreshSettingsScreen();
    applyReducedMotionClass();
    if (LG.Audio && LG.Audio.applyVolumes) LG.Audio.applyVolumes();
    if (LG.Challenges && LG.Challenges.bind) LG.Challenges.bind();
    // keep the focus chip in step with live stats (event-driven, never per frame)
    ['goal', 'pass', 'shoot', 'tackleWin', 'keeperSave', 'perfectPass'].forEach(function (ev) {
      LG.eventBus.on(ev, function () { refreshModeChip(); });
    });
    updateLayoutClass();
    showMenu(true);
    hideLoading();
    requestAnimationFrame(loop);
  }

  var lastRotate = null;
  function updateRotate() {
    if (!isMobile) return;
    var el = document.getElementById('rotate-overlay');
    if (!el) return;
    var portraitDevice = window.innerHeight > window.innerWidth;
    // The phone is always held landscape during a match (both GAME VIEW options
    // run the device in landscape — only the camera/HUD follow the setting).
    // Prompt whenever a match is live on a portrait-held device, regardless of
    // the selected view; menus are never covered so the player can still act.
    var want = portraitDevice &&
      (UIState === 'match' || UIState === 'paused');
    if (want === lastRotate) return;      // only touch the DOM on a real change
    lastRotate = want;
    el.classList.toggle('hidden', !want);
  }

  // Landscape + fullscreen, requested when a match actually starts — for BOTH
  // game views. Doing this on the first stray pointerdown looked harmless on
  // desktop but on a phone the viewport resize it triggers re-lays out the page
  // mid-tap, so the press was swallowed and the button never fired: exactly one
  // press of KICK OFF did nothing. Starting a match is a user gesture too, so it
  // is allowed. The physical screen never locks to portrait; only the camera
  // pose and HUD follow Settings.view.
  function enterLandscape() {
    if (!isMobile) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      requestOrientation('landscape');
      return;
    }
    try {
      var fs = document.documentElement;
      if (fs.requestFullscreen) {
        fs.requestFullscreen().then(function () { requestOrientation('landscape'); }).catch(function () {});
      } else if (fs.webkitRequestFullscreen) {
        fs.webkitRequestFullscreen();
        requestOrientation('landscape');
      }
    } catch (e) {}
  }

  // Steers the physical screen toward the player-chosen view. Locking only
  // exists behind fullscreen on most mobile browsers, and some refuse entirely
  // — every path is wrapped so the game keeps playing in whatever shape the
  // browser actually gives it (the camera + HUD follow the real viewport).
  function requestOrientation(orient) {
    try {
      var so = screen.orientation || {};
      if (so.lock && so.lock.call) so.lock(orient).catch(function () {});
      else if (orient === null && so.unlock) so.unlock();
    } catch (e) {}
  }

  // Keeps the body classes in sync with BOTH the real viewport shape and the
  // player's VIEW choice. is-portrait/is-landscape mirror the actual screen;
  // view-portrait/view-landscape mirror the selected setting, so choosing
  // LANDSCAPE rearranges the HUD/panels immediately even where the physical
  // window cannot rotate (desktop, unsupported orientation lock, ...).
  function updateLayoutClass() {
    var portrait = window.innerHeight > window.innerWidth;
    document.body.classList.toggle('is-portrait', portrait);
    document.body.classList.toggle('is-landscape', !portrait);
    var wantLandscape = LG.Settings.isLandscape();
    document.body.classList.toggle('view-landscape', wantLandscape);
    document.body.classList.toggle('view-portrait', !wantLandscape);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    updateLayoutClass();
    updateRotate();
    if (LG.DBG) LG.DBG.log('[viewport] ' + window.innerWidth + 'x' + window.innerHeight + ' aspect ' + (window.innerWidth / window.innerHeight).toFixed(3));
  }

  // ---------------- events ----------------
  function bindEvents() {
    var bus = LG.eventBus;

    // ------------------------------------------------------------
    // PRE-MATCH FLOW — mode first, then one screen, one purpose:
    //   menu -> MODE -> (challenge pick | tournament) -> DIFFICULTY
    //   -> STAR -> STYLE -> COURT -> MATCH SETUP -> game
    // Modes decide WHY; MatchManager keeps deciding HOW.
    // ------------------------------------------------------------
    bus.on('playRequested', function () {
      UIState = 'mode';
      selectedMode = (LG.Modes && LG.Modes.id) ? LG.Modes.id() : 'quick_match';
      refreshModeUI();
      showOverlay('menu-overlay', false);
      showOverlay('mode-overlay', true);
    });

    bus.on('modeBackRequested', function () {
      UIState = 'menu';
      showOverlay('mode-overlay', false);
      showOverlay('menu-overlay', true);
    });

    bus.on('modeRequested', function (e) {
      if (e && e.id) selectedMode = e.id;
      refreshModeUI();
    });

    bus.on('modeConfirmed', function () {
      if (LG.Modes) LG.Modes.select(selectedMode);
      if (selectedMode === 'challenge_match') {
        UIState = 'challengePick';
        selectedChallengeFocus = (LG.Modes && LG.Modes.challenge) ? LG.Modes.challenge() : null;
        refreshChallengePickUI();
        showOverlay('mode-overlay', false);
        showOverlay('challenge-pick-overlay', true);
        return;
      }
      if (selectedMode === 'tournament') {
        UIState = 'tournament';
        refreshTournamentUI();
        showOverlay('mode-overlay', false);
        showOverlay('tournament-overlay', true);
        return;
      }
      UIState = 'diff';
      refreshDifficultyUI();
      showOverlay('mode-overlay', false);
      showOverlay('diff-overlay', true);
    });

    bus.on('challengePickBackRequested', function () {
      UIState = 'mode';
      showOverlay('challenge-pick-overlay', false);
      showOverlay('mode-overlay', true);
    });

    bus.on('challengeFocusRequested', function (e) {
      if (e && e.id) selectedChallengeFocus = e.id;
      refreshChallengePickUI();
    });

    bus.on('challengePickConfirmed', function () {
      if (!selectedChallengeFocus || !LG.Modes || !LG.Modes.selectChallenge(selectedChallengeFocus)) {
        LG.HUD.toast('PICK A CHALLENGE');
        return;
      }
      UIState = 'diff';
      refreshDifficultyUI();
      showOverlay('challenge-pick-overlay', false);
      showOverlay('diff-overlay', true);
    });

    bus.on('tournamentBackRequested', function () {
      UIState = 'mode';
      showOverlay('tournament-overlay', false);
      showOverlay('mode-overlay', true);
    });

    bus.on('tournamentStartRequested', function () {
      var T = LG.Tournament;
      if (!T) return;
      // won/eliminated START = fresh cup (no page reload)
      if (T.status() === 'won' || T.status() === 'eliminated') T.reset();
      if (!T.active()) T.start(selectedId);
      // RESUME between fixtures skips setup and plays the next tie
      if (T.canContinue(false)) {
        showOverlay('tournament-overlay', false);
        startMatch(selectedId);
        return;
      }
      // first fixture (or a fresh draw) still runs the normal setup screens
      UIState = 'diff';
      refreshDifficultyUI();
      showOverlay('tournament-overlay', false);
      showOverlay('diff-overlay', true);
    });

    bus.on('tournamentContinueRequested', function () {
      if (resultActionLock) return;
      var T = LG.Tournament;
      if (!T || !T.canContinue(!!(match && !match._finalized))) return;
      resultActionLock = true;
      showOverlay('result-overlay', false);
      startMatch(selectedId);
      resultActionLock = false;
    });

    bus.on('resultSetupRequested', function () {
      if (resultActionLock) return;
      if (LG.Modes && LG.Modes.is('tournament')) return; // tournament has no mid-bracket setup hop
      resultActionLock = true;
      if (match && !match._finalized && match.clock !== undefined) {
        quitting = true;
        match.endMatch();
        quitting = false;
      }
      if (match) clearMatchFromScene();
      LG.Input.reset();
      LG.HUD.clearTags();
      LG.HUD.setModeChip('');
      showOverlay('result-overlay', false);
      showMatchUI(false);
      UIState = 'setup';
      refreshSettingsUI();
      showOverlay('setup-overlay', true);
      resultActionLock = false;
    });

    bus.on('difficultyRequested', function (e) {
      LG.Difficulty.set(e && e.id);
      refreshDifficultyUI();
    });

    bus.on('difficultyConfirmed', function () {
      UIState = 'select';
      showOverlay('diff-overlay', false);
      showOverlay('select-overlay', true);
    });

    bus.on('difficultyBackRequested', function () {
      // back into the mode layer (challenge/tournament return to their screens)
      if (selectedMode === 'challenge_match') {
        UIState = 'challengePick';
        selectedChallengeFocus = (LG.Modes && LG.Modes.challenge) ? LG.Modes.challenge() : null;
        refreshChallengePickUI();
        showOverlay('diff-overlay', false);
        showOverlay('challenge-pick-overlay', true);
        return;
      }
      if (selectedMode === 'tournament') {
        UIState = 'tournament';
        refreshTournamentUI();
        showOverlay('diff-overlay', false);
        showOverlay('tournament-overlay', true);
        return;
      }
      UIState = 'mode';
      refreshModeUI();
      showOverlay('diff-overlay', false);
      showOverlay('mode-overlay', true);
    });

    bus.on('howRequested', function () {
      howFromPause = false;
      UIState = 'how';
      showOverlay('menu-overlay', false);
      showOverlay('how-overlay', true);
    });
    bus.on('settingsRequested', function () {
      if (UIState !== 'menu') return;
      UIState = 'settings';
      settingsResetArmed = false;
      refreshSettingsScreen();
      showOverlay('menu-overlay', false);
      showOverlay('settings-overlay', true);
    });
    bus.on('settingsBackRequested', function () {
      UIState = 'menu';
      settingsResetArmed = false;
      showOverlay('settings-overlay', false);
      showOverlay('menu-overlay', true);
    });
    bus.on('aboutRequested', function () {
      if (UIState !== 'menu') return;
      UIState = 'about';
      refreshAboutUI();
      showOverlay('menu-overlay', false);
      showOverlay('about-overlay', true);
    });
    bus.on('aboutBackRequested', function () {
      UIState = 'menu';
      showOverlay('about-overlay', false);
      showOverlay('menu-overlay', true);
    });
    bus.on('profileRequested', function () {
      UIState = 'profile';
      refreshProfileUI();
      showOverlay('menu-overlay', false);
      showOverlay('profile-overlay', true);
    });
    bus.on('profileBackRequested', function () {
      UIState = 'menu';
      showOverlay('profile-overlay', false);
      showOverlay('menu-overlay', true);
    });
    bus.on('profileResetRequested', function () {
      if (profileResetArmed) {
        profileResetArmed = false;
        if (LG.Progression && LG.Progression.reset) LG.Progression.reset();
        if (LG.Tournament && LG.Tournament.reset) LG.Tournament.reset();
        LG.HUD.updateCoins();
        refreshProfileUI();
        refreshChallengesUI();
        var rb = document.getElementById('btn-profile-reset');
        if (rb) rb.textContent = 'RESET PROFILE';
        LG.HUD.toast('PROFILE RESET');
      } else {
        profileResetArmed = true;
        var rb2 = document.getElementById('btn-profile-reset');
        if (rb2) rb2.textContent = 'CONFIRM RESET?';
      }
    });
    bus.on('challengesRequested', function () {
      UIState = 'challenges';
      refreshChallengesUI();
      showOverlay('menu-overlay', false);
      showOverlay('challenges-overlay', true);
    });
    bus.on('challengesBackRequested', function () {
      UIState = 'menu';
      showOverlay('challenges-overlay', false);
      showOverlay('menu-overlay', true);
    });
    bus.on('pauseHowRequested', function () {
      howFromPause = true;
      UIState = 'how';
      showOverlay('pause-overlay', false);
      showOverlay('how-overlay', true);
    });
    bus.on('howBackRequested', function () {
      showOverlay('how-overlay', false);
      if (howFromPause) {
        UIState = 'paused';
        showOverlay('pause-overlay', true);
      } else {
        UIState = 'menu';
        showOverlay('menu-overlay', true);
      }
      howFromPause = false;
    });

    bus.on('menuBackRequested', function () {
      // STAR BACK returns to difficulty (unchanged); difficulty BACK is handled above
      UIState = 'diff';
      refreshDifficultyUI();
      showOverlay('select-overlay', false);
      showOverlay('diff-overlay', true);
    });

    // STAR -> PLAYER STYLE (kit colors for both sides)
    bus.on('selectConfirmed', function () {
      UIState = 'style';
      buildColorGrid();
      buildAwayColorGrid();
      showOverlay('select-overlay', false);
      showOverlay('style-overlay', true);
    });

    bus.on('styleBackRequested', function () {
      UIState = 'select';
      showOverlay('style-overlay', false);
      showOverlay('select-overlay', true);
    });

    // PLAYER STYLE -> COURT SELECTION
    bus.on('styleConfirmed', function () {
      UIState = 'court';
      buildCourtGrid();
      showOverlay('style-overlay', false);
      showOverlay('court-overlay', true);
    });

    bus.on('courtBackRequested', function () {
      UIState = 'style';
      showOverlay('court-overlay', false);
      showOverlay('style-overlay', true);
    });

    // COURT SELECTION -> MATCH SETUP (day/night + portrait/landscape)
    bus.on('courtConfirmed', function () {
      UIState = 'setup';
      refreshSettingsUI();
      showOverlay('court-overlay', false);
      showOverlay('setup-overlay', true);
    });

    bus.on('setupBackRequested', function () {
      UIState = 'court';
      showOverlay('setup-overlay', false);
      showOverlay('court-overlay', true);
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
      if (match) {
        match.all.forEach(function (p) {
          p.shotCharge = 0;
          p.wasShooting = false;
        });
        if (match.active) {
          match.active.shotCharge = 0;
          match.active.wasShooting = false;
        }
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
      profileResetArmed = false;
      resultActionLock = false;
      // leaving mid-match still books the unfinished game once (never re-books)
      if (match && !match._finalized && match.clock !== undefined) {
        quitting = true;
        match.endMatch();
        quitting = false;
      }
      if (match) clearMatchFromScene();
      LG.Input.reset();
      LG.HUD.clearTags();
      LG.HUD.setModeChip('');
      showOverlay('pause-overlay', false);
      showOverlay('result-overlay', false);
      showOverlay('profile-overlay', false);
      showOverlay('challenges-overlay', false);
      showOverlay('mode-overlay', false);
      showOverlay('challenge-pick-overlay', false);
      showOverlay('tournament-overlay', false);
      showOverlay('settings-overlay', false);
      showOverlay('about-overlay', false);
      showOverlay('how-overlay', false);
      howFromPause = false;
      settingsResetArmed = false;
      profileResetArmed = false;
      refreshSettingsScreen();
      showMatchUI(false);
      showOverlay('menu-overlay', true);
      LG.Particles.clear();
      camCtrl.reset();
      LG.Audio.crowdStop();
    });

    bus.on('rematchRequested', function () {
      if (LG.Modes && LG.Modes.is('tournament')) {
        var T = LG.Tournament;
        // results board: only a finished cup may START OVER (resets state)
        if (UIState === 'result') {
          if (resultActionLock || !T || !T.canRetry()) return;
          resultActionLock = true;
          T.reset();
          T.start(selectedId);
          showOverlay('result-overlay', false);
          startMatch(selectedId);
          resultActionLock = false;
          return;
        }
        // mid-match / pause RESTART re-runs the same fixture only
        if (UIState === 'paused' || UIState === 'match') startMatch(selectedId);
        return;
      }
      startMatch(selectedId);
    });

    bus.on('matchStart', function () {
      LG.HUD.reset(match);
      refreshModeChip();
    });
    bus.on('clock', function (e) { LG.HUD.setClock(e.t); });

    bus.on('goal', function (g) {
      var mine = g.team === 0;
      LG.HUD.banner(mine ? 'GOAL!' : 'CONCEDED', mine ? 'team1' : 'team2', 1800);
      LG.HUD.flash(mine ? 'rgba(236,225,200,0.32)' : 'rgba(193,74,53,0.38)', 300);
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
      LG.HUD.flash('rgba(196,106,43,0.4)', 220);
      camCtrl.pulse(0.8);
    });

    bus.on('tackleWin', function (t) {
      if (t.src.isHuman) { LG.HUD.toast('ROCKED THEM!', 900); LG.HUD.flash('rgba(169,199,122,0.2)', 180); }
      camCtrl.shake(0.2, 0.22);
    });

    bus.on('perfectPass', function () { LG.HUD.toast('LASER PASS', 800); });

    bus.on('keeperSave', function (e) {
      var me = (match.home || []).indexOf(e.gk) >= 0;
      if (me) { LG.HUD.toast(e.parry ? 'GUARD PUNCHES IT OUT!' : 'GUARD GRABS IT!', 1200); LG.HUD.flash('rgba(169,199,122,0.16)', 180); }
      else { LG.HUD.toast(e.parry ? 'WHAT A PARADE!' : 'KEEPER CLAIMS IT!', 1200); }
    });

    bus.on('switchPlayer', function () {
      LG.HUD.updateSpecial(match.active);
    });

    bus.on('matchEnd', function (r) {
      // Tournament books each fixture once here — even a quit-to-menu mid
      // match still records (MatchManager already finalized the profile).
      // Phase 3B challenge rewards stay solely inside Progression.finalizeMatch.
      if (r && !r._tournamentBooked && LG.Modes && LG.Modes.is('tournament') && LG.Tournament) {
        if (LG.Tournament.endMatch(r.won === 1, r.score)) r._tournamentBooked = true;
      }
      // ignore a late end from a match we already replaced (quit/rematch)
      if (quitting || match === null) return;
      UIState = 'result';
      resultActionLock = false;
      LG.Input.reset();
      LG.Audio.crowdStop();
      LG.HUD.setModeChip('');
      var endedMatch = match;
      setTimeout(function () {
        if (match !== endedMatch) return; // match was replaced (rematch/quit) while waiting
        showMatchUI(false);
        showOverlay('result-overlay', true);
        setupResult(r);
      }, 900);
    });
  }

  // ---------------- match settings (Time of Day / View) ----------------
  function bindSettingsUI() {
    function on(id, fn) {
      var b = document.getElementById(id);
      if (!b) return;
      b.addEventListener('click', function () { LG.Audio.sfx.click(); fn(); });
    }
    on('time-day', function () { setTimeOfDay('day'); });
    on('time-night', function () { setTimeOfDay('night'); });
    on('view-portrait', function () { setView('portrait'); });
    on('view-landscape', function () { setView('landscape'); });
    // Settings screen (Phase 4) — same stores, separate controls
    on('settings-day', function () { setTimeOfDay('day'); refreshSettingsScreen(); });
    on('settings-night', function () { setTimeOfDay('night'); refreshSettingsScreen(); });
    on('settings-portrait', function () { setView('portrait'); refreshSettingsScreen(); });
    on('settings-landscape', function () { setView('landscape'); refreshSettingsScreen(); });
    on('vol-master-0', function () { LG.Settings.setVolMaster(0); refreshSettingsScreen(); });
    on('vol-master-50', function () { LG.Settings.setVolMaster(0.5); refreshSettingsScreen(); });
    on('vol-master-100', function () { LG.Settings.setVolMaster(1); refreshSettingsScreen(); });
    on('vol-sfx-0', function () { LG.Settings.setVolSfx(0); refreshSettingsScreen(); });
    on('vol-sfx-50', function () { LG.Settings.setVolSfx(0.5); refreshSettingsScreen(); });
    on('vol-sfx-100', function () { LG.Settings.setVolSfx(1); refreshSettingsScreen(); });
    on('vol-crowd-0', function () { LG.Settings.setVolCrowd(0); refreshSettingsScreen(); });
    on('vol-crowd-50', function () { LG.Settings.setVolCrowd(0.5); refreshSettingsScreen(); });
    on('vol-crowd-100', function () { LG.Settings.setVolCrowd(1); refreshSettingsScreen(); });
    on('rm-on', function () { setReducedMotion(true); refreshSettingsScreen(); });
    on('rm-off', function () { setReducedMotion(false); refreshSettingsScreen(); });
    on('btn-settings-reset', function () { requestSettingsReset(); });
    on('btn-bug-fill', function () { fillBugReport(); });
    on('btn-bug-copy', function () { copyBugReport(); });
    // stamp versions from the single source
    var ver = (LG.Config && LG.Config.version) || '0.0.0';
    var mv = document.getElementById('menu-version');
    if (mv) mv.textContent = 'v' + ver;
    var av = document.getElementById('about-version');
    if (av) av.textContent = ver;
    applyReducedMotionClass();
    LG.Audio.applyVolumes();
  }

  function setReducedMotion(on) {
    LG.Settings.setReducedMotion(on);
    applyReducedMotionClass();
    if (camCtrl) { camCtrl.shakeT = 0; camCtrl.shakeAmp = 0; camCtrl.zoomPulse = 0; }
  }

  function applyReducedMotionClass() {
    var on = LG.Settings.reducedMotion();
    document.body.classList.toggle('reduced-motion', on);
  }

  function markSelected(id, on) {
    var b = document.getElementById(id);
    if (b) b.classList.toggle('selected', !!on);
  }

  function volBucket(v) {
    if (v <= 0.01) return 0;
    if (v <= 0.6) return 50;
    return 100;
  }

  function refreshSettingsScreen() {
    var tod = LG.Settings.timeOfDay();
    var view = LG.Settings.view();
    markSelected('settings-day', tod === 'day');
    markSelected('settings-night', tod === 'night');
    markSelected('settings-portrait', view === 'portrait');
    markSelected('settings-landscape', view === 'landscape');
    var mb = volBucket(LG.Settings.volMaster());
    var sb = volBucket(LG.Settings.volSfx());
    var cb = volBucket(LG.Settings.volCrowd());
    markSelected('vol-master-0', mb === 0);
    markSelected('vol-master-50', mb === 50);
    markSelected('vol-master-100', mb === 100);
    markSelected('vol-sfx-0', sb === 0);
    markSelected('vol-sfx-50', sb === 50);
    markSelected('vol-sfx-100', sb === 100);
    markSelected('vol-crowd-0', cb === 0);
    markSelected('vol-crowd-50', cb === 50);
    markSelected('vol-crowd-100', cb === 100);
    markSelected('rm-on', LG.Settings.reducedMotion());
    markSelected('rm-off', !LG.Settings.reducedMotion());
    var rb = document.getElementById('btn-settings-reset');
    if (rb) {
      rb.textContent = settingsResetArmed ? 'CONFIRM WIPE?' : 'RESET PROGRESS';
      rb.classList.toggle('selected', settingsResetArmed);
    }
    refreshSettingsUI();
  }

  // Clears profile / challenges / tournament; keeps display, audio, difficulty, court.
  function requestSettingsReset() {
    if (!settingsResetArmed) {
      settingsResetArmed = true;
      refreshSettingsScreen();
      return;
    }
    settingsResetArmed = false;
    if (LG.Progression && LG.Progression.reset) LG.Progression.reset();
    if (LG.Tournament && LG.Tournament.reset) LG.Tournament.reset();
    if (LG.Modes && LG.Modes.reset) LG.Modes.reset();
    selectedChallengeFocus = null;
    selectedMode = 'quick_match';
    LG.HUD.updateCoins();
    refreshProfileUI();
    refreshChallengesUI();
    refreshSettingsScreen();
    LG.HUD.toast('PROGRESS RESET');
  }

  function fillBugReport() {
    var box = document.getElementById('bug-report-box');
    if (!box) return;
    var ver = (LG.Config && LG.Config.version) || '0.0.0';
    var lines = [];
    lines.push('BLACKOUT bug report');
    lines.push('version: ' + ver);
    lines.push('time: ' + new Date().toISOString());
    lines.push('state: ' + UIState);
    lines.push('mode: ' + ((LG.Modes && LG.Modes.id) ? LG.Modes.id() : '-'));
    lines.push('viewport: ' + window.innerWidth + 'x' + window.innerHeight);
    lines.push('mobile: ' + isMobile);
    lines.push('view: ' + LG.Settings.view() + '  tod: ' + LG.Settings.timeOfDay());
    lines.push('reducedMotion: ' + LG.Settings.reducedMotion());
    lines.push('difficulty: ' + ((LG.Difficulty && LG.Difficulty.get) ? LG.Difficulty.get() : '-'));
    lines.push('court: ' + ((LG.Courts && LG.Courts.selected) ? LG.Courts.selected() : '-'));
    lines.push('coins: ' + ((LG.Progression && LG.Progression.coins) ? LG.Progression.coins() : '-'));
    lines.push('matches: ' + ((LG.Progression && LG.Progression.career) ? (LG.Progression.career().matches || 0) : '-'));
    lines.push('tournament: ' + ((LG.Tournament && LG.Tournament.status) ? LG.Tournament.status() : '-'));
    lines.push('ua: ' + (navigator.userAgent || 'unknown'));
    lines.push('storage: ' + (function () {
      try {
        localStorage.setItem('__bo_probe__', '1');
        localStorage.removeItem('__bo_probe__');
        return 'ok';
      } catch (e) { return 'blocked'; }
    })());
    lines.push('---');
    lines.push('What happened?');
    lines.push('Steps to reproduce:');
    box.value = lines.join('\n');
    var st = document.getElementById('bug-copy-status');
    if (st) st.textContent = 'REPORT READY — USE COPY';
  }

  function copyBugReport() {
    var box = document.getElementById('bug-report-box');
    var st = document.getElementById('bug-copy-status');
    if (!box) return;
    if (!box.value) fillBugReport();
    function done(ok) { if (st) st.textContent = ok ? 'COPIED TO CLIPBOARD' : 'SELECT ALL AND COPY MANUALLY'; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(box.value).then(function () { done(true); }, function () { fallbackCopy(box, done); });
    } else {
      fallbackCopy(box, done);
    }
  }

  function fallbackCopy(box, done) {
    try {
      box.focus();
      box.select();
      var ok = document.execCommand && document.execCommand('copy');
      done(!!ok);
    } catch (e) { done(false); }
  }

  function refreshAboutUI() {
    var ver = (LG.Config && LG.Config.version) || '0.0.0';
    var av = document.getElementById('about-version');
    if (av) av.textContent = ver;
    var box = document.getElementById('bug-report-box');
    if (box && !box.value) fillBugReport();
    var st = document.getElementById('bug-copy-status');
    if (st) st.textContent = '';
  }

  function setTimeOfDay(m) {
    LG.Settings.setTimeOfDay(m);
    // cheap reconfigure — the environment is already built, only the lighting
    // presets are re-applied (no rebuild, no reload)
    LG.Lighting.setMode(m);
    refreshSettingsUI();
  }

  function setView(m) {
    LG.Settings.setView(m);
    // The phone stays landscape for BOTH views — only the camera pose and HUD
    // follow the choice. Never lock portrait (a portrait lock fought the rotate
    // prompt and left the device stuck upright for a landscape-world camera).
    requestOrientation('landscape');
    updateRotate();
    refreshSettingsUI();
    updateLayoutClass();
    if (LG.DBG) LG.DBG.log('[orientation] ' + LG.Settings.view());
  }

  function refreshSettingsUI() {
    var tod = LG.Settings.timeOfDay();
    var view = LG.Settings.view();
    var pairs = [
      ['time-day', tod === 'day'], ['time-night', tod === 'night'],
      ['view-portrait', view === 'portrait'], ['view-landscape', view === 'landscape'],
    ];
    for (var i = 0; i < pairs.length; i++) {
      var b = document.getElementById(pairs[i][0]);
      if (b) b.classList.toggle('selected', pairs[i][1]);
    }
  }

  // Re-apply the environment options to the arena: with courtSwitch it also
  // swaps the pitch surface (court change); without it the surface stays put
  // while the lighting re-collects + re-applies the chosen time of day. This
  // is what makes the DAY/NIGHT setting actually reach the rendered match (and
  // keeps a new court's lights/signs on the selected atmosphere).
  function refreshEnvironment(courtSwitch) {
    if (courtSwitch && arenaObj && arenaObj.refreshCourt) arenaObj.refreshCourt();
    if (LG.Lighting) {
      LG.Lighting.collect(scene);
      LG.Lighting.setMode(LG.Settings.timeOfDay());
    }
  }

  // Reflect the selected level on the difficulty screen.
  function refreshDifficultyUI() {
    var cur = LG.Difficulty.get();
    var levels = LG.Difficulty.LEVELS;
    for (var i = 0; i < levels.length; i++) {
      var btn = document.getElementById('diff-' + levels[i]);
      if (btn) btn.classList.toggle('selected', levels[i] === cur);
    }
  }

  function setupResult(r) {
    var modeId = (LG.Modes && typeof LG.Modes.id === 'function') ? LG.Modes.id() : 'quick_match';
    var T = LG.Tournament;
    var title = document.getElementById('result-title');
    var note = document.getElementById('result-mode-note');
    var btnContinue = document.getElementById('btn-continue');
    var btnRematch = document.getElementById('btn-rematch');
    var btnSetup = document.getElementById('btn-result-setup');
    var modeTag = document.getElementById('result-mode-tag');

    // mode-aware headline
    var headline;
    if (modeId === 'tournament' && T) {
      if (T.status() === 'won') headline = 'CUP WON';
      else if (T.status() === 'eliminated') headline = T.currentRound() === 1 ? 'FINAL LOST' : 'SEMIFINAL LOST';
      else headline = 'SEMIFINAL WON'; // active + advanced after a semi win
    } else if (modeId === 'challenge_match') {
      var focusDone = false;
      var completed = r.completedChallenges || [];
      var focusId = (LG.Modes && LG.Modes.challenge) ? LG.Modes.challenge() : null;
      for (var fi = 0; fi < completed.length; fi++) {
        if (focusId && completed[fi].id === focusId) { focusDone = true; break; }
      }
      if (focusDone) headline = 'CHALLENGE CLEARED';
      else headline = r.won === 1 ? 'MATCH WON' : r.won === 0 ? 'DRAW' : 'MATCH LOST';
    } else {
      headline = r.won === 1 ? 'MATCH WON' : r.won === 0 ? 'DRAW' : 'MATCH LOST';
    }

    title.className = 'result-title ' + (r.won === 1 ? 'win' : r.won === 0 ? 'draw' : 'lose');
    title.textContent = headline;

    if (modeTag) {
      var tagText = modeId === 'tournament' && T ? ('STREET CUP · ' + T.roundLabel())
        : modeId === 'challenge_match' ? 'CHALLENGE MATCH'
        : 'QUICK MATCH';
      modeTag.textContent = tagText;
      modeTag.classList.remove('hidden');
    }

    document.getElementById('res-home').textContent = r.score[0];
    document.getElementById('res-away').textContent = r.score[1];
    document.getElementById('res-coins-n').textContent = '+' + U.fmtMoney(r.coins);
    // match statistics table (missing stats degrades to zeros / 50%)
    var s = r.stats || {};
    var h = s.home || {};
    var a = s.away || {};
    var map = [
      ['st-h-g', 'st-a-g', 'goals', 0],
      ['st-h-as', 'st-a-as', 'assists', 0],
      ['st-h-s', 'st-a-s', 'shots', 0],
      ['st-h-p', 'st-a-p', 'passes', 0],
      ['st-h-t', 'st-a-t', 'tackles', 0],
      ['st-h-sv', 'st-a-sv', 'saves', 0],
    ];
    for (var i = 0; i < map.length; i++) {
      var he = document.getElementById(map[i][0]);
      var ae = document.getElementById(map[i][1]);
      if (he) he.textContent = h[map[i][2]] != null ? h[map[i][2]] : map[i][3];
      if (ae) ae.textContent = a[map[i][2]] != null ? a[map[i][2]] : map[i][3];
    }
    var hp = document.getElementById('st-h-po');
    var ap = document.getElementById('st-a-po');
    if (hp) hp.textContent = (h.poss != null ? h.poss : 50) + '%';
    if (ap) ap.textContent = (a.poss != null ? a.poss : 50) + '%';

    // challenges completed this match (empty list is fine — never punitive)
    var chList = document.getElementById('res-ch-list');
    var chEmpty = document.getElementById('res-ch-empty');
    var chCoins = document.getElementById('res-ch-coins');
    var completedAll = r.completedChallenges || [];
    if (chList) {
      chList.innerHTML = '';
      for (var ci = 0; ci < completedAll.length; ci++) {
        var c = completedAll[ci];
        var li = document.createElement('li');
        li.className = 'pf-row ch-done';
        li.innerHTML = '<span class="ch-check">✓</span>' +
          '<span class="ch-title">' + c.title + '</span>' +
          '<span class="ch-desc">' + (c.description || '') + '</span>' +
          '<span class="pf-c">+' + c.reward + '</span>';
        chList.appendChild(li);
      }
    }
    if (chEmpty) chEmpty.classList.toggle('hidden', completedAll.length > 0);
    if (chCoins) {
      var chAmt = r.challengeCoins || 0;
      chCoins.classList.toggle('hidden', !chAmt);
      chCoins.innerHTML = chAmt ? '<span class="coin"></span><span>+ ' + chAmt + ' CHALLENGES</span>' : '';
    }

    // mode-aware action row (idempotent labels + visibility)
    resultActionLock = false;
    if (btnContinue && btnRematch && btnSetup) {
      var showContinue = modeId === 'tournament' && T && T.canContinue(false);
      var showRetryCup = modeId === 'tournament' && T && T.canRetry();
      if (modeId === 'tournament') {
        btnContinue.classList.toggle('hidden', !showContinue);
        btnRematch.textContent = 'NEW TOURNAMENT';
        btnRematch.classList.toggle('hidden', !showRetryCup);
        btnRematch.classList.add('gold');
        btnSetup.classList.add('hidden');
      } else if (modeId === 'challenge_match') {
        btnContinue.classList.add('hidden');
        btnRematch.textContent = 'RETRY';
        btnRematch.classList.remove('hidden');
        btnRematch.classList.add('gold');
        btnSetup.classList.remove('hidden');
      } else {
        btnContinue.classList.add('hidden');
        btnRematch.textContent = 'REMATCH';
        btnRematch.classList.remove('hidden');
        btnRematch.classList.add('gold');
        btnSetup.classList.remove('hidden');
      }
    }
    if (note) {
      if (modeId === 'tournament') note.textContent = 'ONE CUP · TWO WINS · NO SHORTCUTS';
      else if (modeId === 'challenge_match') note.textContent = 'FOCUSED CHALLENGE PAYS VIA THE ACTIVE SET';
      else note.textContent = '+ COINS UNLOCK MORE STARS';
    }

    LG.HUD.updateCoins();
    if (r.won === 1) LG.Audio.sfx.resultWin();
    else if (r.won === 0) LG.Audio.sfx.resultDraw();
    else LG.Audio.sfx.resultLose();
  }

  // Fill the profile card from the single source of truth (safe on missing nodes).
  function refreshProfileUI() {
    var P = LG.Progression;
    if (!P) return;
    var c = (P.career && P.career()) || {};
    var best = (P.best && P.best()) || { goals: 0, wins: 0, streak: 0 };
    function set(id, v) {
      var el = document.getElementById(id);
      if (el) el.textContent = v;
    }
    set('pf-coins', U.fmtMoney(P.coins ? P.coins() : 0));
    set('pf-matches', c.matches || 0);
    set('pf-wins', c.wins || 0);
    set('pf-draws', c.draws || 0);
    set('pf-losses', c.losses || 0);
    set('pf-winrate', (P.winRate ? P.winRate() : 0) + '%');
    set('pf-gf', c.goalsFor || 0);
    set('pf-ga', c.goalsAgainst || 0);
    set('pf-cs', c.cleanSheets || 0);
    set('pf-assists', c.assists || 0);
    set('pf-shots', c.shots || 0);
    set('pf-tackles', c.tackles || 0);
    set('pf-saves', c.saves || 0);
    set('pf-streak', best.streak || 0);
    set('pf-best', best.goals || 0);

    var list = document.getElementById('pf-history');
    if (!list) return;
    var hist = (P.history && P.history()) || [];
    list.innerHTML = '';
    if (!hist.length) {
      var empty = document.createElement('li');
      empty.className = 'pf-empty';
      empty.textContent = 'NO MATCHES YET — KICK OFF';
      list.appendChild(empty);
      return;
    }
    for (var i = 0; i < hist.length && i < 5; i++) {
      var e = hist[i];
      var li = document.createElement('li');
      li.className = 'pf-row ' + (e.won === 1 ? 'w' : e.won === -1 ? 'l' : 'd');
      var res = e.won === 1 ? 'W' : e.won === -1 ? 'L' : 'D';
      li.innerHTML = '<span class="pf-res">' + res + '</span>' +
        '<span class="pf-sc">' + e.score[0] + '–' + e.score[1] + '</span>' +
        '<span class="pf-meta">' + (e.difficulty || 'match') + (e.court ? ' · ' + e.court : '') + '</span>' +
        '<span class="pf-c">+' + e.coins + '</span>';
      list.appendChild(li);
    }
    var rb = document.getElementById('btn-profile-reset');
    if (rb) rb.textContent = 'RESET PROFILE';
    profileResetArmed = false;
  }

  // Active challenges screen — 3 slots, pure defs from LG.Challenges.
  function refreshChallengesUI() {
    var list = document.getElementById('challenge-list');
    if (!list) return;
    list.innerHTML = '';
    var act = (LG.Progression && LG.Progression.activeChallenges) ? LG.Progression.activeChallenges() : [];
    if (!act.length) {
      var empty = document.createElement('div');
      empty.className = 'pf-empty';
      empty.textContent = 'NO ACTIVE CHALLENGES';
      list.appendChild(empty);
      return;
    }
    for (var i = 0; i < act.length; i++) {
      var def = LG.Challenges && LG.Challenges.byId ? LG.Challenges.byId(act[i]) : null;
      if (!def) continue;
      var card = document.createElement('div');
      card.className = 'challenge-card ch-' + def.difficulty;
      card.innerHTML =
        '<div class="challenge-head">' +
          '<span class="challenge-title">' + def.title + '</span>' +
          '<span class="challenge-diff">' + def.difficulty.toUpperCase() + '</span>' +
        '</div>' +
        '<div class="challenge-desc">' + def.description + '</div>' +
        '<div class="challenge-meta">' +
          '<span class="challenge-target">' + challengeTargetLabel(def) + '</span>' +
          '<span class="challenge-reward"><span class="coin"></span>+' + def.reward + '</span>' +
        '</div>';
      list.appendChild(card);
    }
  }

  function challengeTargetLabel(def) {
    switch (def.objectiveType) {
      case 'cleanSheet': return 'CLEAN SHEET';
      case 'win': return '1 WIN';
      case 'winBy': return 'WIN BY ' + def.target + '+';
      default: return 'TARGET ' + def.target;
    }
  }

  // ---------------- mode / tournament UI (Phase 3D) ----------------
  function refreshModeUI() {
    var list = document.getElementById('mode-list');
    if (!list) return;
    list.innerHTML = '';
    var modes = (LG.Modes && LG.Modes.list) ? LG.Modes.list() : [];
    for (var i = 0; i < modes.length; i++) {
      (function (m) {
        var card = document.createElement('div');
        card.className = 'mode-card' + (m.id === selectedMode ? ' selected' : '');
        card.dataset.id = m.id;
        var tag = m.id === 'tournament' ? 'KNOCKOUT · 4 TEAMS'
          : m.id === 'challenge_match' ? 'USES YOUR 3 ACTIVE CHALLENGES'
          : 'STANDARD MATCH';
        card.innerHTML =
          '<div class="mode-name">' + m.name + '</div>' +
          '<div class="mode-blurb">' + m.blurb + '</div>' +
          '<div class="mode-tag">' + tag + '</div>';
        card.addEventListener('click', function () {
          selectedMode = m.id;
          if (LG.Modes) LG.Modes.select(m.id);
          refreshModeUI();
          LG.Audio.sfx.click();
        });
        list.appendChild(card);
      })(modes[i]);
    }
  }

  function refreshChallengePickUI() {
    var list = document.getElementById('challenge-pick-list');
    if (!list) return;
    list.innerHTML = '';
    var act = (LG.Progression && LG.Progression.activeChallenges) ? LG.Progression.activeChallenges() : [];
    if (!act.length) {
      var empty = document.createElement('div');
      empty.className = 'pf-empty';
      empty.textContent = 'NO ACTIVE CHALLENGES';
      list.appendChild(empty);
      return;
    }
    if (!selectedChallengeFocus || act.indexOf(selectedChallengeFocus) < 0) {
      selectedChallengeFocus = act[0];
    }
    if (LG.Modes) LG.Modes.selectChallenge(selectedChallengeFocus);
    for (var i = 0; i < act.length; i++) {
      (function (id) {
        var def = LG.Challenges && LG.Challenges.byId ? LG.Challenges.byId(id) : null;
        if (!def) return;
        var card = document.createElement('div');
        card.className = 'challenge-card ch-' + def.difficulty +
          (id === selectedChallengeFocus ? ' selected-focus' : '');
        card.dataset.id = id;
        if (id === selectedChallengeFocus) card.style.outline = '2px solid #14c8db';
        card.innerHTML =
          '<div class="challenge-head">' +
            '<span class="challenge-title">' + def.title + '</span>' +
            '<span class="challenge-diff">' + def.difficulty.toUpperCase() + '</span>' +
          '</div>' +
          '<div class="challenge-desc">' + def.description + '</div>' +
          '<div class="challenge-meta">' +
            '<span class="challenge-target">' + challengeTargetLabel(def) + '</span>' +
            '<span class="challenge-reward"><span class="coin"></span>+' + def.reward + '</span>' +
          '</div>';
        card.addEventListener('click', function () {
          selectedChallengeFocus = id;
          if (LG.Modes) LG.Modes.selectChallenge(id);
          refreshChallengePickUI();
          LG.Audio.sfx.click();
        });
        list.appendChild(card);
      })(act[i]);
    }
  }

  function refreshTournamentUI() {
    var statusEl = document.getElementById('tournament-status');
    var bracket = document.getElementById('tournament-bracket');
    var startBtn = document.getElementById('btn-tournament-start');
    var T = LG.Tournament;
    if (!T) return;
    var st = T.status();
    if (statusEl) {
      if (st === 'idle') statusEl.textContent = '4 TEAMS · SEMIFINAL + FINAL';
      else if (st === 'active') statusEl.textContent = 'IN PROGRESS · ' + T.roundLabel();
      else if (st === 'won') statusEl.textContent = 'CHAMPIONS · START A NEW CUP';
      else statusEl.textContent = 'ELIMINATED · START A NEW CUP';
    }
    if (startBtn) {
      startBtn.textContent = st === 'active' ? 'RESUME' : 'START';
    }
    if (bracket) {
      bracket.innerHTML = '';
      if (st === 'idle' || !T.teams().length) {
        var ph = document.createElement('div');
        ph.className = 'pf-empty';
        ph.textContent = 'DRAW PENDING — HIT START';
        bracket.appendChild(ph);
        return;
      }
      var teams = T.teams();
      var results = T.results();
      // SEMIFINAL column
      var semi = document.createElement('div');
      semi.className = 'tournament-round' + (T.currentRound() === 0 && st === 'active' ? ' active-round' : st !== 'idle' ? ' done-round' : '');
      semi.innerHTML = '<div class="tr-title">SEMIFINAL</div>';
      var you = teams[0], opp = teams[1];
      var semiRes = results[0];
      semi.appendChild(fixtureRow(you, opp, semiRes));
      var otherA = teams[2], otherB = teams[3];
      var otherWin = T.snapshot().otherSemiWinner;
      var row2 = document.createElement('div');
      row2.className = 'tr-fixture';
      row2.innerHTML =
        '<span class="' + (otherWin === otherA.id ? 'win' : 'lose') + '">' + otherA.name + '</span>' +
        '<span class="' + (otherWin === otherB.id ? 'win' : 'lose') + '">' + otherB.name + '</span>';
      semi.appendChild(row2);
      bracket.appendChild(semi);
      // FINAL column
      var fin = document.createElement('div');
      fin.className = 'tournament-round' + (T.currentRound() === 1 && st === 'active' ? ' active-round' : st === 'won' ? ' done-round' : '');
      fin.innerHTML = '<div class="tr-title">FINAL</div>';
      var finRow = document.createElement('div');
      finRow.className = 'tr-fixture';
      var finalRes = results[1];
      var finalOppName = otherWin ? (otherWin === otherA.id ? otherA.name : otherB.name) : '—';
      if (st === 'won') {
        finRow.innerHTML = '<span class="win you">' + you.name + '</span><span class="win">' + finalOppName + '</span>';
      } else if (st === 'eliminated' && T.currentRound() === 1 && finalRes) {
        finRow.innerHTML = '<span class="' + (finalRes.won ? 'win' : 'lose') + ' you">' + you.name + '</span>' +
          '<span class="' + (finalRes.won ? 'lose' : 'win') + '">' + finalOppName + '</span>';
      } else if (st === 'active' && T.currentRound() === 1) {
        finRow.innerHTML = '<span class="you">' + you.name + '</span><span>' + finalOppName + '</span>';
      } else {
        finRow.innerHTML = '<span class="you">' + you.name + '</span><span>' + finalOppName + '</span>';
      }
      fin.appendChild(finRow);
      bracket.appendChild(fin);
    }
  }

  function fixtureRow(a, b, res) {
    var row = document.createElement('div');
    row.className = 'tr-fixture';
    var aCls = a.isPlayer ? 'you' : '';
    var bCls = b.isPlayer ? 'you' : '';
    if (res) {
      // won flag is from the player's perspective on round 0/1 player fixture
      var playerWon = res.won;
      if (a.isPlayer) {
        aCls += playerWon ? ' win' : ' lose';
        bCls += playerWon ? ' lose' : ' win';
      }
      row.innerHTML = '<span class="' + aCls + '">' + a.name + '</span>' +
        '<span class="' + bCls + '">' + b.name + '</span>';
    } else {
      row.innerHTML = '<span class="' + aCls + '">' + a.name + '</span>' +
        '<span class="' + bCls + '">' + b.name + '</span>';
    }
    return row;
  }

  // Non-modal focus chip: mode label + optional live challenge progress.
  function refreshModeChip() {
    if (UIState !== 'match' && UIState !== 'paused') return;
    var modeId = (LG.Modes && LG.Modes.id) ? LG.Modes.id() : 'quick_match';
    if (modeId === 'tournament' && LG.Tournament) {
      LG.HUD.setModeChip(LG.Tournament.summary());
      return;
    }
    if (modeId === 'challenge_match') {
      var def = (LG.Modes && LG.Modes.challenge && LG.Challenges)
        ? LG.Challenges.byId(LG.Modes.challenge()) : null;
      if (!def || !match) { LG.HUD.setModeChip('CHALLENGE MATCH'); return; }
      var live = {
        score: match.score,
        stats: { home: match.stats.home, away: match.stats.away },
        won: null,
      };
      var ev = LG.Challenges.evaluate(def, live, true);
      LG.HUD.setModeChip('CHALLENGE ' + def.title + '  ' + Math.min(ev.progress, def.target) + '/' + def.target);
      return;
    }
    LG.HUD.setModeChip('');
  }

  // ---------------- match lifecycle ----------------
  function startMatch(playerId) {
    selectedId = playerId;
    enterLandscape();
    // consume the selected atmosphere now (also re-collects + re-applies if a
    // court swap added any new lights or emissive signs after boot)
    refreshEnvironment();
    LG.Input.reset();
    if (match) {
      clearMatchFromScene();
    }

    var matchOpts = {
      playerId: playerId, homeName: 'YOU', awayName: 'ROGUE',
      difficulty: LG.Difficulty.get(),
      outfitColor: outfitColor,
      awayColor: awayColor,
    };

    // Tournament fixture: pin the opponent side + open the once-only latch.
    // Restarting the same fixture reuses an open latch (never double-begins).
    if (LG.Modes && LG.Modes.is('tournament') && LG.Tournament && LG.Tournament.active()) {
      if (!LG.Tournament.snapshot().awaitingResult) LG.Tournament.beginMatch();
      var opp = LG.Tournament.opponent();
      if (opp) {
        var oppDef = LG.byId(opp.id);
        var awayIds = [opp.id];
        var mates = (oppDef && oppDef.team) || [];
        for (var mi = 0; mi < mates.length && awayIds.length < 3; mi++) {
          if (awayIds.indexOf(mates[mi]) < 0) awayIds.push(mates[mi]);
        }
        var fillers = ['stone', 'volt', 'brute', 'echo', 'pulse', 'cannon'];
        for (var fi = 0; fi < fillers.length && awayIds.length < 3; fi++) {
          if (awayIds.indexOf(fillers[fi]) < 0 && fillers[fi] !== playerId) awayIds.push(fillers[fi]);
        }
        matchOpts.awayIds = awayIds;
        matchOpts.awayName = opp.name.toUpperCase();
      }
      matchOpts.mode = 'tournament';
    } else if (LG.Modes && LG.Modes.is('tournament')) {
      // cup not active yet — still label the mode, random draw like quick
      matchOpts.mode = 'tournament';
    } else {
      matchOpts.mode = (LG.Modes && LG.Modes.id) ? LG.Modes.id() : 'quick_match';
    }

    match = new LG.MatchManager(matchOpts);
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

    showMatchUI(true);

    LG.HUD.reset(match);
    refreshModeChip();
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
    var overlays = ['menu-overlay', 'mode-overlay', 'challenge-pick-overlay', 'tournament-overlay', 'diff-overlay', 'select-overlay', 'style-overlay', 'court-overlay', 'setup-overlay', 'how-overlay', 'settings-overlay', 'about-overlay', 'profile-overlay', 'challenges-overlay', 'pause-overlay', 'result-overlay'];
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
    var el = document.getElementById(id);
    if (!el) return;
    if (on) {
      el.classList.remove('hidden');
      el.classList.remove('leaving');
      // cancel any leave animation so the panel is fully opaque again
      var panel = el.querySelector && el.querySelector('.panel');
      if (panel && panel.getAnimations) {
        try { panel.getAnimations().forEach(function (a) { a.cancel(); }); } catch (e) {}
      }
      // force reflow so re-showing the same panel replays paste-in
      if (el.offsetWidth != null) void el.offsetWidth;
    } else {
      // class flips synchronously (tests + a11y). Exit motion is cosmetic via
      // the Web Animations API when available — never delays the hide.
      el.classList.add('leaving');
      var p = el.querySelector && el.querySelector('.panel');
      if (p && p.animate) {
        try {
          p.animate(
            [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(6px) scale(0.99)' }],
            { duration: 180, easing: 'ease', fill: 'forwards' }
          );
        } catch (e) {}
      }
      el.classList.add('hidden');
      clearTimeout(el._hideT);
      el._hideT = setTimeout(function () { el.classList.remove('leaving'); }, 200);
    }
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
          '</div>';
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
      html += '<div class="stat-row">' + names[i] + ' <b>' + v + '</b></div>';
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

  // Locked stars stay selectable: tapping buys them if the coins are there
  // (the toast says the price otherwise). Presentation only — the underlying
  // progression/unlock system is untouched, but the full-card lock overlay
  // and coin emoji are gone in favour of one quiet price line.
  function refreshCardLock(card, def) {
    var price = card.querySelector('.price');
    if (!LG.Progression.isUnlocked(def.id)) {
      card.classList.add('locked');
      if (!price) {
        price = document.createElement('span');
        price.className = 'price';
        card.appendChild(price);
      }
      price.textContent = 'UNLOCK · ' + LG.Progression.costOf(def.id);
    } else {
      card.classList.remove('locked');
      if (price) price.remove();
    }
  }

  // ---------------- player style / customization UI ----------------
  // The two squads must never end up in the same kit. YOUR kit always wins
  // the pick: if the Rogue Squad was wearing it, it slides to the first color
  // that is not yours. A Rogue pick that would mirror YOUR kit is refused
  // (the note under the grid says why), so the clash can never happen.
  function resolveKitClash() {
    if (!outfitColor || !awayColor || awayColor.id !== outfitColor.id) return;
    for (var i = 0; i < LG.OutfitColors.length; i++) {
      if (LG.OutfitColors[i].id !== outfitColor.id) { awayColor = LG.OutfitColors[i]; return; }
    }
  }

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
      refreshAwayColorGrid();
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
          resolveKitClash();
          refreshColorGrid();
          refreshAwayColorGrid();
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

  // ---------------- court picker UI ----------------
  function buildCourtGrid() {
    var grid = document.getElementById('court-grid');
    if (!grid) return;
    grid.innerHTML = '';
    var list = (LG.Courts && LG.Courts.list()) || [];
    var selected = LG.Courts ? LG.Courts.selected() : '';

    // procedural / classic tile
    (function () {
      var t = document.createElement('div');
      t.className = 'court-btn' + (selected === '' ? ' selected' : '');
      t.innerHTML =
        '<div class="court-thumb procedural">CLASSIC<br>&nbsp;STREET</div>' +
        '<div class="court-name">CLASSIC</div>';
      t.addEventListener('click', function () {
        if (!LG.Courts) return;
        LG.Courts.set('');
        refreshEnvironment(true);
        LG.Audio.sfx.click();
        refreshCourtGrid();
      });
      grid.appendChild(t);
    })();

    // court tiles
    for (var i = 0; i < list.length; i++) {
      (function (c) {
        var t = document.createElement('div');
        t.className = 'court-btn' + (selected === c.id ? ' selected' : '');
        var name = c.name || ('COURT ' + c.id.replace('court', ''));
        t.innerHTML =
          '<img class="court-thumb" src="courts/' + c.file + '" alt="' + name + '" loading="lazy">' +
          '<div class="court-name">' + name + '</div>';
        t.addEventListener('click', function () {
          if (!LG.Courts) return;
          LG.Courts.set(c.id);
          refreshEnvironment(true);
          LG.Audio.sfx.click();
          refreshCourtGrid();
        });
        grid.appendChild(t);
      })(list[i]);
    }

    refreshCourtGrid();
  }

  function refreshCourtGrid() {
    var grid = document.getElementById('court-grid');
    if (!grid) return;
    var selected = LG.Courts ? LG.Courts.selected() : '';
    var list = (LG.Courts && LG.Courts.list()) || [];
    var btns = grid.querySelectorAll('.court-btn');
    for (var i = 0; i < btns.length; i++) {
      var id = i === 0 ? '' : (list[i - 1] ? list[i - 1].id : '');
      btns[i].classList.toggle('selected', id === selected);
    }
  }

  // ---------------- opponent kit UI ----------------
  function buildAwayColorGrid() {
    var grid = document.getElementById('away-color-grid');
    if (!grid) return;
    grid.innerHTML = '';
    var regBtn = document.createElement('div');
    regBtn.className = 'color-btn' + (awayColor === null ? ' selected' : '');
    regBtn.innerHTML = '<div class="color-swatch" style="background:linear-gradient(135deg,#7a1f1f,#241010);border-color:rgba(255,255,255,0.5)"></div><div class="color-label">DEFAULT</div>';
    regBtn.addEventListener('click', function () {
      awayColor = null;
      refreshAwayColorGrid();
      LG.Audio.sfx.click();
    });
    grid.appendChild(regBtn);
    for (var i = 0; i < LG.OutfitColors.length; i++) {
      (function (c) {
        var btn = document.createElement('div');
        btn.className = 'color-btn' + (awayColor && awayColor.id === c.id ? ' selected' : '');
        btn.innerHTML = '<div class="color-swatch" style="background:' + c.hex + '"></div><div class="color-label">' + c.label + '</div>';
        btn.addEventListener('click', function () {
          // refuse a Rogue kit that would mirror yours — the squads stay apart
          if (outfitColor && outfitColor.id === c.id) {
            refreshAwayColorGrid();
            var note = document.getElementById('away-kit-note');
            if (note) {
              note.className = 'kit-note conflict';
              note.textContent = c.label + ' IS YOUR KIT — PICK A DIFFERENT COLOR';
            }
            LG.Audio.sfx.click();
            return;
          }
          awayColor = c;
          refreshAwayColorGrid();
          LG.Audio.sfx.click();
        });
        grid.appendChild(btn);
      })(LG.OutfitColors[i]);
    }
    refreshAwayColorGrid();
  }

  function refreshAwayColorGrid() {
    var btns = document.querySelectorAll('#away-color-grid .color-btn');
    for (var i = 0; i < btns.length; i++) {
      if (i === 0) {
        btns[i].classList.toggle('selected', awayColor === null);
      } else {
        var c = LG.OutfitColors[i - 1];
        btns[i].classList.toggle('selected', awayColor && awayColor.id === c.id);
      }
    }
    refreshAwayKitNote();
  }

  function refreshAwayKitNote() {
    var note = document.getElementById('away-kit-note');
    if (!note) return;
    if (!awayColor || !outfitColor || awayColor.id !== outfitColor.id) {
      note.className = 'kit-note';
      note.textContent = awayColor
        ? 'ROGUE SQUAD wear the ' + awayColor.label + ' kit'
        : 'ROGUE SQUAD keep their default kits';
      return;
    }
    note.className = 'kit-note conflict';
    note.textContent = awayColor.label + ' IS YOUR KIT — PICK A DIFFERENT COLOR';
  }

  function refreshStylePreview() {
    var preview = document.getElementById('style-preview');
    if (!preview) return;
    var playerDef = LG.byId(selectedId);
    var name = playerDef ? playerDef.name : '';
    if (outfitColor === null) {
      preview.innerHTML = '<div class="preview-label">' + name + ' — REGULAR KIT</div>';
    } else {
      preview.innerHTML = '<div class="preview-label">' + name + ' — ' + outfitColor.label + ' KIT</div>';
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
    updateRotate();

    if (UIState === 'match') {
      match.update(dt);
      camCtrl.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
      LG.HUD.updateTags(match, camera, dt);
      LG.HUD.updateSpecial(match.active);
      LG.HUD.updateCoins();
      LG.HUD.aim(match.active.shotCharge > 0.15 && match.active.hasBall);
      // particles must keep running through GOAL — otherwise the celebration
      // confetti freezes in mid-air for the whole goalDelay
      LG.Particles.update(dt);
      arenaObj.update(dt);
      if (LG.Living) LG.Living.update(dt);
    } else if (UIState === 'menu') {
      // idle cinematic drift
      var a = bgT * 0.06;
      camera.position.set(Math.sin(a) * 30, 21, Math.cos(a) * 30 + 6);
      camera.lookAt(0, 0, 0);
      LG.Particles.update(dt);
      arenaObj.update(dt);
      if (LG.Living) LG.Living.update(dt);
    } else {
      camera.position.set(0, 19, 24);
      camera.lookAt(0, 0, 0);
    }

    renderer.render(scene, camera);
  }

  // PWA service worker registration. A phone that has already run an older
  // worker keeps being served the OLD game out of its cache with no way to see
  // the fix, so: never serve the worker script from HTTP cache, force an update
  // check on every load, and when a new worker takes over reload once (only in
  // the menu, at most once per session) so the fresh build actually lands.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      var hadController = !!navigator.serviceWorker.controller;
      var reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController || reloaded) return;
        if (window.LGMain && window.LGMain.getState() !== 'menu') return;
        try {
          if (sessionStorage.getItem('blockout.swReload')) return;
          sessionStorage.setItem('blockout.swReload', '1');
        } catch (e) { return; }
        reloaded = true;
        location.reload();
      });
      navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' })
        .then(function (reg) { reg.update(); })
        .catch(function () {});
    });
  }

  // boot
  window.addEventListener('load', init);
  window.LGMain = {
    startMatch: startMatch,
    getState: function () { return UIState; },
    getMatch: function () { return match; },
    // read-only view of the pre-match choices — used by the boot harness to
    // prove the menu selections really reach the match
    getSelections: function () {
      return {
        player: selectedId,
        homeKit: outfitColor ? outfitColor.id : null,
        awayKit: awayColor ? awayColor.id : null,
        difficulty: LG.Difficulty.get(),
        court: LG.Courts ? LG.Courts.selected() : '',
        timeOfDay: LG.Settings.timeOfDay(),
        view: LG.Settings.view(),
      };
    },
  };
})();
