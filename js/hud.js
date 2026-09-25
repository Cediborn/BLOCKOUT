// ============================================================
// HUD — scoreboard, timer, special button, banners
// (per-player head markers were removed: the only possession marker is the
//  single world-space ball-carrier indicator owned by the match — see match.js)
// ============================================================
var LG = window.LG = window.LG || {};

LG.HUD = (function () {
  var scoreEl = { home: null, away: null };
  var clockEl = null;
  var homeLabel = null, awayLabel = null;
  var tags = {};
  var announceEl = null;
  var flashEl = null;
  var toastEl = null;
  var aimEl = null;
  var specialBtn = null, specialFill = null, specialName = null;
  var coinEl = null;

  function init() {
    scoreEl.home = document.getElementById('home-score');
    scoreEl.away = document.getElementById('away-score');
    clockEl = document.getElementById('clock');
    homeLabel = document.getElementById('home-label');
    awayLabel = document.getElementById('away-label');
    announceEl = document.getElementById('announce');
    flashEl = document.getElementById('flash');
    toastEl = document.getElementById('toast');
    aimEl = document.getElementById('aim-hint');
    specialBtn = document.getElementById('special-btn');
    specialFill = specialBtn.querySelector('.fill');
    specialName = document.getElementById('special-name');
    coinEl = document.getElementById('coin-amnt');
  }

  function bindButtons() {
    // special button handled through Input (shared 'special' edge)
    document.getElementById('btn-rematch').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('rematchRequested'); });
    document.getElementById('btn-result-menu').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('quitRequested'); });
    document.getElementById('btn-resume').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('resumeRequested'); });
    document.getElementById('btn-quit-menu').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('quitRequested'); });
    document.getElementById('btn-restart').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('rematchRequested'); });
    document.getElementById('btn-pause-how').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('pauseHowRequested'); });
    document.getElementById('pause-btn').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('pauseRequested'); });
    document.getElementById('btn-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('menuBackRequested'); });
    document.getElementById('btn-play').addEventListener('click', function () { LG.Audio.unlock(); LG.Audio.sfx.click(); LG.eventBus.emit('playRequested'); });
    document.getElementById('btn-how').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('howRequested'); });
    document.getElementById('btn-how-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('howBackRequested'); });
    document.getElementById('btn-settings').addEventListener('click', function () { LG.Audio.unlock(); LG.Audio.sfx.click(); LG.eventBus.emit('settingsRequested'); });
    document.getElementById('btn-settings-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('settingsBackRequested'); });
    document.getElementById('btn-about').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('aboutRequested'); });
    document.getElementById('btn-about-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('aboutBackRequested'); });
    document.getElementById('btn-profile').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('profileRequested'); });
    document.getElementById('btn-profile-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('profileBackRequested'); });
    document.getElementById('btn-profile-reset').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('profileResetRequested'); });
    document.getElementById('btn-challenges').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('challengesRequested'); });
    document.getElementById('btn-challenges-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('challengesBackRequested'); });
    // game mode select
    var modeBack = document.getElementById('btn-mode-back');
    if (modeBack) modeBack.addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('modeBackRequested'); });
    var modeGo = document.getElementById('btn-mode-go');
    if (modeGo) modeGo.addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('modeConfirmed'); });
    // challenge match focus pick
    var chPickBack = document.getElementById('btn-challenge-pick-back');
    if (chPickBack) chPickBack.addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('challengePickBackRequested'); });
    var chPickGo = document.getElementById('btn-challenge-pick-go');
    if (chPickGo) chPickGo.addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('challengePickConfirmed'); });
    // tournament
    var tBack = document.getElementById('btn-tournament-back');
    if (tBack) tBack.addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('tournamentBackRequested'); });
    var tStart = document.getElementById('btn-tournament-start');
    if (tStart) tStart.addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('tournamentStartRequested'); });
    // mode-aware results actions
    var btnContinue = document.getElementById('btn-continue');
    if (btnContinue) btnContinue.addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('tournamentContinueRequested'); });
    var btnResultSetup = document.getElementById('btn-result-setup');
    if (btnResultSetup) btnResultSetup.addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('resultSetupRequested'); });
    var startBtn = document.getElementById('btn-start-match');
    if (startBtn) startBtn.addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('startMatchRequested'); });
    // linear pre-match flow: STAR -> STYLE -> COURT -> MATCH SETUP
    document.getElementById('btn-select-go').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('selectConfirmed'); });
    document.getElementById('btn-style-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('styleBackRequested'); });
    document.getElementById('btn-style-go').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('styleConfirmed'); });
    document.getElementById('btn-court-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('courtBackRequested'); });
    document.getElementById('btn-court-go').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('courtConfirmed'); });
    document.getElementById('btn-setup-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('setupBackRequested'); });

    // difficulty picker: the buttons only carry the choice, the match flow in
    // main.js owns what happens next
    var levels = LG.Difficulty.LEVELS;
    for (var i = 0; i < levels.length; i++) {
      (function (id, btn) {
        if (!btn) return;
        btn.addEventListener('click', function () {
          LG.Audio.sfx.click();
          LG.eventBus.emit('difficultyRequested', { id: id });
        });
      })(levels[i], document.getElementById('diff-' + levels[i]));
    }
    document.getElementById('btn-diff-go').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('difficultyConfirmed'); });
    document.getElementById('btn-diff-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('difficultyBackRequested'); });
  }

  function setTeamNames(home, away) {
    homeLabel.textContent = home;
    awayLabel.textContent = away;
  }

  function setScore(h, a) {
    if (scoreEl.home) scoreEl.home.textContent = h;
    if (scoreEl.away) scoreEl.away.textContent = a;
  }

  function setClock(t) {
    clockEl.textContent = LG.Util.fmtTime(Math.max(0, t));
    clockEl.classList.toggle('low', t <= 10.5 && t > 0);
  }

  function clearTags() {
    var olds = document.querySelectorAll('.tag');
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
    tags = {};
  }

  // special meter button
  function updateSpecial(activePlayer) {
    if (!activePlayer) return;
    var def = LG.Abilities[activePlayer.def.ability];
    specialName.textContent = def.name;
    specialBtn.classList.toggle('ready', activePlayer.meterFull && !activePlayer.active);
    specialBtn.classList.toggle('active', !!activePlayer.active);
    specialFill.style.height = Math.round(activePlayer.meter * 100) + '%';
    specialBtn.style.borderColor = 'rgba(255,255,255,0.35)';
    if (activePlayer.active) {
      specialBtn.style.borderColor = '#' + new THREE.Color(activePlayer.activeColor).getHexString();
    }
  }

  function showSpecialName(abilityName) {
    if (specialName) specialName.textContent = abilityName;
  }

  function banner(text, cls, dur) {
    if (!announceEl) return;
    var el = document.createElement('div');
    el.className = 'banner ' + (cls || '');
    el.textContent = text;
    announceEl.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    }, dur || 1400);
  }

  function flash(colorStyle, dur) {
    if (!flashEl) return;
    flashEl.style.background = colorStyle || 'rgba(236,225,200,0.3)';
    flashEl.classList.add('hit');
    clearTimeout(flashEl._t);
    flashEl._t = setTimeout(function () { flashEl.classList.remove('hit'); }, dur || 260);
  }

  function toast(msg, dur) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, dur || 1200);
  }

  function aim(v) {
    if (!aimEl) return;
    aimEl.classList.toggle('show', !!v);
  }

  function flashAmm() { /* noop */ }

  // CONTEXT-SENSITIVE on-screen controls: PASS | SHOOT while our team has the
  // ball, SWITCH | TACKLE while the opponent does. Hiding the other two action
  // buttons (SPRINT and SPECIAL stay) means there is exactly one set either
  // way, and it flips the moment possession changes.
  function setControlMode(mode) {
    var attack = mode === 'attack';
    function show(id, on) {
      var b = document.getElementById(id);
      if (!b) return;
      b.classList.toggle('hidden-control', !on);
    }
    show('btn-pass', attack);
    show('btn-shoot', attack);
    show('btn-tackle', !attack);
    show('btn-switch', !attack);
  }

  var lastCoins = null;
  function updateCoins() {
    if (!coinEl) return;
    // called every frame of a match — only touch the DOM when the number moved
    var c = LG.Progression.coins();
    if (c === lastCoins) return;
    lastCoins = c;
    coinEl.textContent = LG.Util.fmtMoney(c);
  }

  // Quiet non-modal mode / challenge focus readout (Phase 3D).
  function setModeChip(text) {
    var chip = document.getElementById('mode-chip');
    if (!chip) return;
    if (!text) {
      chip.classList.add('hidden');
      chip.textContent = '';
      return;
    }
    chip.textContent = text;
    chip.classList.remove('hidden');
  }

  function reset(match) {
    setScore(0, 0);
    setClock(LG.Config.match.duration);
    setTeamNames(match.opts.homeName || 'YOU', match.opts.awayName || 'ROGUE');
    clearTags();
    updateCoins();
  }

  return {
    init: init, bindButtons: bindButtons,
    setScore: setScore, setClock: setClock,
    reset: reset, clearTags: clearTags,
    updateSpecial: updateSpecial, showSpecialName: showSpecialName,
    banner: banner, flash: flash, toast: toast, aim: aim,
    updateCoins: updateCoins, setTeamNames: setTeamNames,
    setControlMode: setControlMode, setModeChip: setModeChip,
  };
})();