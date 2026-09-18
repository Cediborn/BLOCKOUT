// ============================================================
// DIFFICULTY — the single place the menu choice becomes AI tuning.
//
// The numbers live in LG.Config.difficulty (easy / medium / hard). This
// module owns WHICH level is selected (persisted across sessions) and maps a
// team onto the profile it plays with.
//
// Important: the human's own side always plays at the balanced baseline, so
// the chosen level only ever changes the OPPONENTS. Picking EASY should not
// make your own running mates worse — it should give you a team to play with
// and an opponent you can actually beat.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Difficulty = (function () {
  var KEY = 'blockout.difficulty.v1';
  var ORDER = ['easy', 'medium', 'hard'];
  var TABLE = (LG.Config && LG.Config.difficulty) || {};
  var TEAMMATE_LEVEL = 'medium';    // your AI mates' permanent profile
  var current = 'medium';

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw && ORDER.indexOf(raw) >= 0) current = raw;
    } catch (e) { /* no storage (private mode / headless) — keep the default */ }
  }

  function save() {
    try { localStorage.setItem(KEY, current); } catch (e) { /* ignore */ }
  }

  load();

  function preset(id) {
    return TABLE[id] || TABLE.medium || {};
  }

  return {
    LEVELS: ORDER,
    isLevel: function (id) { return ORDER.indexOf(id) >= 0; },

    // ---- selection ----
    get: function () { return current; },
    set: function (id) {
      if (!this.isLevel(id)) return current;
      current = id;
      save();
      return current;
    },
    label: function (id) { return preset(id || current).label || 'MEDIUM'; },
    blurb: function (id) { return preset(id || current).blurb || ''; },

    // The full tuning table for a level (defaults to the current one).
    preset: preset,

    // The profile a TEAM plays with. team 1 = the opponents (the selected
    // difficulty); team 0 = the human's side (always the fair baseline).
    forTeam: function (team) {
      return team === 1 ? preset(current) : preset(TEAMMATE_LEVEL);
    },
  };
})();
