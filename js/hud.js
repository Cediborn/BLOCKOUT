// ============================================================
// HUD — scoreboard, timer, player tags, special button, banners
// ============================================================
var LG = window.LG = window.LG || {};

LG.HUD = (function () {
  var scoreEl = { home: null, away: null };
  var clockEl = null;
  var homeLabel = null, awayLabel = null;
  var tags = {};            // player.id -> {el, name, stamBar}
  var announceEl = null;
  var flashEl = null;
  var toastEl = null;
  var aimEl = null;
  var specialBtn = null, specialFill = null, specialName = null;
  var coinEl = null;
  var tmpV = new THREE.Vector3();

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
    document.getElementById('pause-btn').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('pauseRequested'); });
    document.getElementById('btn-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('menuBackRequested'); });
    document.getElementById('btn-play').addEventListener('click', function () { LG.Audio.unlock(); LG.Audio.sfx.click(); LG.eventBus.emit('playRequested'); });
    document.getElementById('btn-how').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('howRequested'); });
    document.getElementById('btn-how-back').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('howBackRequested'); });
    document.getElementById('btn-start-match').addEventListener('click', function () { LG.Audio.sfx.click(); LG.eventBus.emit('startMatchRequested'); });
  }

  function setTeamNames(home, away) {
    homeLabel.textContent = home;
    awayLabel.textContent = away;
  }

  function setScore(h, a) {
    scoreEl.home.textContent = h;
    scoreEl.away.textContent = a;
  }

  function setClock(t) {
    clockEl.textContent = LG.Util.fmtTime(Math.max(0, t));
    clockEl.classList.toggle('low', t <= 10.5 && t > 0);
  }

  function buildTags(match) {
    // remove old
    var olds = document.querySelectorAll('.tag');
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
    tags = {};
    var all = match.all;
    for (i = 0; i < all.length; i++) {
      var p = all[i];
      var el = document.createElement('div');
      el.className = 'tag' + (p.team === 0 ? ' team-home' : ' team-away') + (p.isHuman ? ' tag-me' : p.team === 0 ? ' tag-mate' : ' tag-opp') + (p.isGoalkeeper ? ' tag-gk' : '');
      el.id = 'tag-' + p.id + '-' + p.team;
      // only the controlled player carries a full tag (name + stamina);
      // everyone else gets a compact chip to keep the screen clean
      var dot = document.createElement('i');
      dot.className = 'tdot';
      var name = document.createElement('span');
      name.className = 'tname' + (p.isHuman ? ' me' : '');
      name.textContent = p.name;
      el.appendChild(dot);
      el.appendChild(name);
      if (p.isHuman) {
        var st = document.createElement('span');
        st.className = 'tstam';
        var cave = document.createElement('i');
        cave.className = 'th';
        st.appendChild(cave);
        el.appendChild(st);
        tags[p.team + '.' + p.idx] = { el: el, bar: cave };
      } else {
        tags[p.team + '.' + p.idx] = { el: el, bar: null };
      }
      document.body.appendChild(el);
    }
  }

  function clearTags() {
    var olds = document.querySelectorAll('.tag');
    for (var i = 0; i < olds.length; i++) olds[i].parentNode.removeChild(olds[i]);
    tags = {};
  }

  function updateTags(match, camera, dt) {
    var w = window.innerWidth, h = window.innerHeight;
    var all = match.all;
    var proj = [];
    // 1) project every player once
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      var t = tags[p.team + '.' + p.idx];
      if (!t) continue;
      tmpV.set(p.x, p.height + 0.28, p.z);
      tmpV.project(camera);
      if (tmpV.z >= 1) { t.el.style.display = 'none'; continue; }
      t.el.style.display = 'flex';
      proj.push({ t: t, p: p, sx: (tmpV.x * 0.5 + 0.5) * w, sy: (-tmpV.y * 0.5 + 0.5) * h, prio: p.isHuman ? 3 : (p.hasBall ? 2 : 1) });
    }
    // 2) keep labels from stacking on top of each other
    var pass, a, b;
    for (pass = 0; pass < 4; pass++) {
      for (a = 0; a < proj.length; a++) {
        for (b = a + 1; b < proj.length; b++) {
          var pa = proj[a], pb = proj[b];
          var dxB = Math.abs(pa.sx - pb.sx);
          var dyB = pb.sy - pa.sy;
          if (dxB < 52 && dyB > -4 && dyB < 24) {
            // push the lower-priority tag away
            var low = pb.prio < pa.prio ? pb : pa;
            var high = low === pb ? pa : pb;
            low.sy = high.sy - 30;
          }
        }
      }
    }
    // 3) apply
    for (i = 0; i < proj.length; i++) {
      var pr = proj[i];
      var sc = LG.Util.clamp(1.25 - pr.p.distTo(match.ball.x, match.ball.z) * 0.018, 0.86, 1.08);
      pr.t.el.style.left = pr.sx + 'px';
      pr.t.el.style.top = pr.sy + 'px';
      pr.t.el.style.transform = 'translate(-50%,-100%) scale(' + sc + ')';
      pr.t.el.classList.toggle('carrier', pr.p.hasBall);
      if (pr.t.bar) {
        pr.t.bar.style.width = Math.round(pr.p.stamina * 100) + '%';
        pr.t.bar.className = 'th' + (pr.p.stamina < 0.3 ? ' low' : '');
      }
      // fresh lockout uses the ~full opacity, AI stays subtle
      var emph = pr.p.isHuman || pr.p.hasBall;
      pr.t.el.style.opacity = emph ? '1' : '0.55';
    }
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
    flashEl.style.background = colorStyle || 'rgba(120,220,255,0.35)';
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

  function updateCoins() {
    if (coinEl) coinEl.textContent = LG.Util.fmtMoney(LG.Progression.coins());
  }

  function reset(match) {
    setScore(0, 0);
    setClock(LG.Config.match.duration);
    setTeamNames(match.opts.homeName || 'YOU', match.opts.awayName || 'ROGUE');
    buildTags(match);
    updateCoins();
  }

  return {
    init: init, bindButtons: bindButtons,
    setScore: setScore, setClock: setClock,
    reset: reset, clearTags: clearTags, updateTags: updateTags,
    updateSpecial: updateSpecial, showSpecialName: showSpecialName,
    banner: banner, flash: flash, toast: toast, aim: aim,
    updateCoins: updateCoins, setTeamNames: setTeamNames,
  };
})();