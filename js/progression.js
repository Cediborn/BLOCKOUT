// ============================================================
// PROGRESSION — coins + unlocks (localStorage)
// ============================================================
var LG = window.LG = window.LG || {};

LG.Progression = (function () {
  var KEY = 'blockout.prog.v1';
  var data = { coins: 0, unlocked: ['blaze'], best: { goals: 0, wins: 0, streak: 0 } };
  var prices = { cannon: null, frenzy: null, stone: null, echo: null, pulse: null, volt: null, brute: null };
  // unlock prices scale up through the roster
  var ORDER = ['blaze', 'cannon', 'frenzy', 'stone', 'echo', 'pulse', 'volt', 'brute'];
  var COST = [0, 300, 300, 500, 600, 600, 800, 900];

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var p = JSON.parse(raw);
        data.coins = p.coins || 0;
        data.unlocked = p.unlocked || ['blaze'];
        data.best = Object.assign(data.best, p.best || {});
      }
    } catch (e) { /* ignore */ }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }

  load();

  function costOf(id) {
    var i = ORDER.indexOf(id);
    return i >= 0 ? COST[i] : 0;
  }

  return {
    coins: function () { return data.coins; },
    addCoins: function (n) { data.coins += n; save(); return data.coins; },
    spend: function (n) { if (data.coins < n) return false; data.coins -= n; save(); return true; },
    isUnlocked: function (id) { return data.unlocked.indexOf(id) >= 0; },
    costOf: costOf,
    unlock: function (id) {
      var c = costOf(id);
      if (c <= 0 || this.isUnlocked(id)) return true;
      if (!this.spend(c)) return false;
      data.unlocked.push(id); save(); return true;
    },
    best: function () { return data.best; },
    recordResult: function (home, away, won) {
      if (home >= data.best.goals) data.best.goals = home;
      if (won) { data.best.wins++; data.best.streak++; } else data.best.streak = 0;
      save();
    },
  };
})();