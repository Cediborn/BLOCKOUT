// ============================================================
// SETTINGS — player-facing match options (Time of Day, View)
// Persisted with localStorage alongside the progression save.
// This is the single settings store for the game; other systems
// read from here instead of keeping their own copies.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Settings = (function () {
  var KEY = 'blockout.settings.v1';
  var data = {
    timeOfDay: 'day',   // 'day' | 'night'  (day is the baseline)
    view: 'landscape',  // 'portrait' | 'landscape' (existing mobile default was landscape)
  };

  var TIME = ['day', 'night'];
  var VIEW = ['portrait', 'landscape'];

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (TIME.indexOf(p.timeOfDay) >= 0) data.timeOfDay = p.timeOfDay;
        if (VIEW.indexOf(p.view) >= 0) data.view = p.view;
      }
    } catch (e) { /* ignore */ }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }

  load();

  return {
    timeOfDay: function () { return data.timeOfDay; },
    setTimeOfDay: function (m) {
      if (TIME.indexOf(m) < 0) return data.timeOfDay;
      data.timeOfDay = m; save();
      return data.timeOfDay;
    },
    cycleTimeOfDay: function () {
      return this.setTimeOfDay(data.timeOfDay === 'day' ? 'night' : 'day');
    },

    view: function () { return data.view; },
    setView: function (m) {
      if (VIEW.indexOf(m) < 0) return data.view;
      data.view = m; save();
      return data.view;
    },
    isPortrait: function () { return data.view === 'portrait'; },
    isLandscape: function () { return data.view === 'landscape'; },
  };
})();
