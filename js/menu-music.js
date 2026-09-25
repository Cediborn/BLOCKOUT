// ============================================================
// MENU MUSIC — one controller, one audio element, every menu screen.
//
// The playlist IS the folder that already ships with the project
// (audio/menu/*.mp3): those files are never moved, renamed or duplicated,
// they are read from where they are. Screens own nothing: Play, difficulty,
// court, kit, settings and the post-match screens all talk to THIS module,
// so navigating can never restart, duplicate or stack the current track.
//
// The main loop drives it with setActive(true/false): menus play, the match
// (and its pause/result screens) stop it, and coming back resumes the same
// track where it left off. Autoplay is gated by the browser, so playback
// simply waits for the first real gesture — no "enable music" button.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Music = (function () {
  // actual files detected in audio/menu (format: mp3)
  var FILES = [
    'Concrete Turf.mp3',
    'Feel The Light.mp3',
    'Inside My Head.mp3',
    'Le Titane.mp3',
    'Otra Vez.mp3',
  ];
  var TRACKS = [];
  for (var fi = 0; fi < FILES.length; fi++) TRACKS.push('audio/menu/' + FILES[fi]);

  var HOLD_MS = 5000;           // how long the "now playing" chip stays up

  var el = null;                // the single audio element (never two)
  var order = [], step = 0;     // shuffled pass over the playlist
  var index = -1;               // track currently loaded
  var active = false;           // menus are up
  var playing = false;
  var blocked = false;          // still waiting on the autoplay gate
  var pendingStart = false;     // a fresh track is waiting to begin
  var starts = 0;               // tracks actually begun (tests read this)
  var shown = -1;               // last track the chip was shown for
  var holdT = null;
  var gestureH = null;
  var errs = 0;

  function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }

  function volMaster() { return (LG.Settings && LG.Settings.volMaster) ? LG.Settings.volMaster() : 0.55; }
  function volMusic() { return (LG.Settings && LG.Settings.volMusic) ? LG.Settings.volMusic() : 0.7; }
  function level() { return clamp01(volMaster()) * clamp01(volMusic()); }

  // "street_dreams.mp3" -> "Street Dreams", "Concrete Turf.mp3" -> unchanged
  function titleOf(i) {
    var f = FILES[i] || '';
    var name = f.replace(/\.[a-z0-9]+$/i, '');
    name = name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) return f;
    var styled = /[a-z]/.test(name) && /[A-Z]/.test(name);   // already cased by hand
    if (styled) return name.charAt(0).toUpperCase() + name.slice(1);
    name = name.toLowerCase();
    return name.replace(/(^|\s)([a-z])/g, function (m, sp, c) { return sp + c.toUpperCase(); });
  }

  // ---------------- playlist ----------------
  function shuffle() {
    var n = TRACKS.length, a = [], i, j, t;
    for (i = 0; i < n; i++) a.push(i);
    for (i = n - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    // a full pass never repeats, and it never opens with the track that
    // just finished — with a single track this is a plain loop
    if (n > 1 && a[0] === index) { t = a[0]; a[0] = a[n - 1]; a[n - 1] = t; }
    order = a; step = 0;
  }

  function next() {
    if (TRACKS.length <= 1) return 0;
    if (step >= order.length) shuffle();
    return order[step++];
  }

  // ---------------- playback ----------------
  function ensure() {
    if (el !== null || typeof Audio === 'undefined') return el;
    try {
      el = new Audio();
      el.preload = 'auto';
      el.volume = level();
      el.addEventListener('playing', begin);
      el.addEventListener('pause', function () { playing = false; });
      el.addEventListener('ended', function () {
        if (!active) return;
        load(next());
      });
      el.addEventListener('error', function () {
        // a missing/broken file must never wedge the menu: move on, but stop
        // for good once every track has failed (otherwise this spins forever)
        playing = false;
        errs++;
        if (!active || errs >= TRACKS.length) return;
        if (TRACKS.length > 1) load(next());
      });
    } catch (e) { el = null; }
    return el;
  }

  // a track has actually begun — the only place the chip may appear
  function begin() {
    playing = true;
    if (!pendingStart) return;        // resume of the same track: no chip
    pendingStart = false;
    errs = 0;
    starts++;
    if (index === shown) return;      // a lone track looping must not re-toast
    shown = index;
    showChip(titleOf(index));
  }

  function load(i) {
    index = i;
    pendingStart = true;
    playing = false;              // the old track is gone: kick() must call play()
    if (!ensure()) { kick(); return; }          // no <audio> here (harness)
    try {
      el.src = TRACKS[i];
      el.currentTime = 0;
    } catch (e) {}
    kick();
  }

  function kick() {
    if (!active || level() <= 0) { pause(); return; }
    if (!ensure()) { begin(); return; }         // state-only environment
    if (playing) return;                        // never restart a running track
    blocked = false;
    var p = null;
    try { p = el.play(); } catch (e) { blocked = true; armGesture(); return; }
    if (p && p.then) {
      p.then(function () { blocked = false; begin(); },
        function () { blocked = true; armGesture(); });
    } else begin();
  }

  function pause() {
    if (el) { try { el.pause(); } catch (e) {} }
    playing = false;
    hideChip();
  }

  // ---------------- browser autoplay gate ----------------
  function armGesture() {
    if (gestureH || typeof window === 'undefined' || !window.addEventListener) return;
    var types = ['pointerdown', 'touchstart', 'mousedown', 'keydown'];
    gestureH = function () {
      disarmGesture();
      if (!active) return;
      if (index < 0) load(next()); else kick();
    };
    for (var i = 0; i < types.length; i++) window.addEventListener(types[i], gestureH, true);
  }

  function disarmGesture() {
    if (!gestureH || typeof window === 'undefined' || !window.removeEventListener) return;
    var types = ['pointerdown', 'touchstart', 'mousedown', 'keydown'];
    for (var i = 0; i < types.length; i++) window.removeEventListener(types[i], gestureH, true);
    gestureH = null;
  }

  // called from the game's first real gesture (see main.js)
  function unlock() {
    if (!active) return;
    if (index < 0) load(next()); else kick();
  }

  // ---------------- "now playing" chip ----------------
  function chipEl() {
    if (typeof document === 'undefined' || !document.getElementById) return null;
    return document.getElementById('now-playing');
  }

  function showChip(text) {
    var c = chipEl();
    if (!c) return;
    var t = c.querySelector ? c.querySelector('.np-title') : null;
    if (t) t.textContent = text;
    c.classList.remove('show');
    if (c.offsetWidth != null) void c.offsetWidth;   // restart the slide-in
    c.classList.add('show');
    clearTimeout(holdT);
    holdT = setTimeout(hideChip, HOLD_MS);
  }

  function hideChip() {
    clearTimeout(holdT); holdT = null;
    var c = chipEl();
    if (c) c.classList.remove('show');
  }

  // ---------------- public ----------------
  function setActive(on) {
    on = !!on;
    if (on === active) return;           // screen changes cost exactly nothing
    active = on;
    if (!active) { pause(); return; }
    if (index < 0) load(next()); else kick();
  }

  function applyVolume() {
    var v = level();
    if (el) el.volume = v;
    if (v <= 0) { pause(); return; }
    if (active && index >= 0) kick();
  }

  function snapshot() {
    var queue = [];
    for (var i = step; i < order.length; i++) queue.push(order[i]);
    return {
      active: active,
      playing: playing,
      blocked: blocked,
      index: index,
      title: index >= 0 ? titleOf(index) : '',
      starts: starts,
      shown: shown,
      volume: level(),
      tracks: TRACKS.length,
      queue: queue,
    };
  }

  return {
    setActive: setActive,
    unlock: unlock,
    applyVolume: applyVolume,
    snapshot: snapshot,
    files: function () { return TRACKS.slice(); },
    titleOf: titleOf,
  };
})();
