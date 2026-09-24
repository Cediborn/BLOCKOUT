// ============================================================
// TOURNAMENT — 4-team knockout state machine (Phase 3D).
// Owns bracket, rounds, advancement and optional persistence.
// MatchManager still only plays football; this module records
// each finished tournament match exactly once and decides
// whether CONTINUE may start the next fixture.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Tournament = (function () {
  var KEY = 'blockout.tournament.v1';
  var SCHEMA = 1;

  // Fixed field so opening a tournament never consumes Math.random
  // (keeps sim.js seed sections stable). Three opponents + the player.
  var OPPONENT_POOL = ['stone', 'volt', 'brute'];

  function defaults() {
    return {
      v: SCHEMA,
      status: 'idle',        // idle | active | won | eliminated
      round: 0,              // 0 = semifinal, 1 = final
      awaitingResult: false, // true while a tournament fixture is live
      advanced: false,       // round advanced from the last recorded match
      teams: [],             // [{ id, name, isPlayer }]
      results: [],           // [{ round, won, score }]
      otherSemiWinner: '',   // pre-resolved second-semifinal winner id
    };
  }

  var state = defaults();

  function num(n, fallback) {
    n = Number(n);
    return isFinite(n) ? n : (fallback || 0);
  }

  function sanitize(p) {
    var d = defaults();
    if (!p || typeof p !== 'object') return d;
    var status = p.status;
    if (status === 'active' || status === 'won' || status === 'eliminated') d.status = status;
    d.round = p.round === 1 ? 1 : 0;
    d.awaitingResult = !!p.awaitingResult;
    d.advanced = !!p.advanced;
    if (Object.prototype.toString.call(p.teams) === '[object Array]' && p.teams.length === 4) {
      var teams = [];
      var sawPlayer = false;
      for (var i = 0; i < 4; i++) {
        var t = p.teams[i];
        if (!t || typeof t !== 'object') return defaults();
        var tid = typeof t.id === 'string' ? t.id : '';
        var tname = typeof t.name === 'string' ? t.name : '';
        if (!tid || !tname) return defaults();
        var isPlayer = !!t.isPlayer;
        if (isPlayer) {
          if (sawPlayer) return defaults();
          sawPlayer = true;
        }
        teams.push({ id: tid, name: tname, isPlayer: isPlayer });
      }
      if (!sawPlayer) return defaults();
      d.teams = teams;
    } else if (d.status !== 'idle') {
      return defaults();
    }
    if (Object.prototype.toString.call(p.results) === '[object Array]') {
      var rs = [];
      for (var j = 0; j < p.results.length && j < 2; j++) {
        var e = p.results[j];
        if (!e || typeof e !== 'object') continue;
        var sc = (Object.prototype.toString.call(e.score) === '[object Array]') ? e.score : [0, 0];
        rs.push({
          round: e.round === 1 ? 1 : 0,
          won: e.won === 1,
          score: [num(sc[0]), num(sc[1])],
        });
      }
      d.results = rs;
    }
    d.otherSemiWinner = typeof p.otherSemiWinner === 'string' ? p.otherSemiWinner : '';
    // A refresh mid-fixture must never leave the machine stuck waiting
    if (d.status === 'idle') {
      d.awaitingResult = false;
      d.advanced = false;
    }
    return d;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) state = sanitize(JSON.parse(raw));
      else state = defaults();
    } catch (e) {
      state = defaults();
    }
    // A refresh mid-fixture leaves no live MatchManager — clear the latch
    // so the next beginMatch can run. The unbooked fixture simply didn't
    // count (never double-booked, never stuck waiting forever).
    if (state.awaitingResult) {
      state.awaitingResult = false;
      save();
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  load();

  function teamName(id) {
    var d = (typeof LG.byId === 'function') ? LG.byId(id) : null;
    return d ? d.name : String(id || '').toUpperCase();
  }

  function buildTeams(playerId) {
    var pid = playerId || 'blaze';
    var teams = [{ id: pid, name: teamName(pid), isPlayer: true }];
    for (var i = 0; i < OPPONENT_POOL.length; i++) {
      var oid = OPPONENT_POOL[i];
      if (oid === pid) oid = OPPONENT_POOL[(i + 1) % OPPONENT_POOL.length];
      teams.push({ id: oid, name: teamName(oid), isPlayer: false });
    }
    // de-dupe ids if the player already sits in the pool
    var seen = {};
    for (var j = 0; j < teams.length; j++) {
      if (seen[teams[j].id] && !teams[j].isPlayer) {
        // swap to another roster id not yet used
        var all = (LG.Roster || []);
        for (var k = 0; k < all.length; k++) {
          if (!seen[all[k].id]) { teams[j].id = all[k].id; teams[j].name = all[k].name; break; }
        }
      }
      seen[teams[j].id] = 1;
    }
    return teams;
  }

  // Player faces teams[1] in the semifinal. The other semifinal
  // (teams[2] vs teams[3]) is resolved up-front — deterministic,
  // zero RNG, so headless sim seeds never shift.
  function start(playerId) {
    state = defaults();
    state.status = 'active';
    state.round = 0;
    state.awaitingResult = false;
    state.advanced = false;
    state.teams = buildTeams(playerId);
    state.otherSemiWinner = state.teams[2].id;
    save();
    return state;
  }

  function active() {
    return state.status === 'active';
  }

  function status() {
    return state.status;
  }

  function currentRound() {
    return state.round;
  }

  function roundLabel() {
    if (state.status === 'won') return 'CHAMPIONS';
    if (state.status === 'eliminated') return 'ELIMINATED';
    if (state.status !== 'active') return '';
    return state.round === 0 ? 'SEMIFINAL' : 'FINAL';
  }

  function summary() {
    if (state.status === 'idle') return '';
    return 'TOURNAMENT · ' + roundLabel();
  }

  function teams() {
    return state.teams.map(function (t) {
      return { id: t.id, name: t.name, isPlayer: !!t.isPlayer };
    });
  }

  function results() {
    return state.results.map(function (e) {
      return { round: e.round, won: e.won, score: e.score.slice() };
    });
  }

  function opponent() {
    if (state.status !== 'active' || !state.teams.length) return null;
    if (state.round === 0) return state.teams[1] || null;
    // final: the player (if still in) meets the pre-resolved other winner
    return { id: state.otherSemiWinner, name: teamName(state.otherSemiWinner), isPlayer: false };
  }

  // Called once when a tournament fixture actually kicks off.
  function beginMatch() {
    if (state.status !== 'active') return false;
    if (state.awaitingResult) return false;
    state.awaitingResult = true;
    state.advanced = false;
    save();
    return true;
  }

  // The ONE write for a finished tournament fixture. Safe against
  // double endMatch / double Continue (second call is a no-op).
  function endMatch(won, score) {
    if (state.status !== 'active') return false;
    if (!state.awaitingResult) return false;
    state.awaitingResult = false;
    var sc = (Object.prototype.toString.call(score) === '[object Array]') ? score : [0, 0];
    state.results.push({
      round: state.round,
      won: won === true,
      score: [num(sc[0]), num(sc[1])],
    });
    if (!won) {
      state.status = 'eliminated';
      state.advanced = false;
    } else if (state.round === 0) {
      state.round = 1;
      state.advanced = true;
    } else {
      state.status = 'won';
      state.advanced = false;
    }
    save();
    return true;
  }

  // CONTINUE is only legal between fixtures: active, a result was
  // just recorded, the bracket advanced, and no match is live.
  function canContinue(matchLive) {
    if (state.status !== 'active') return false;
    if (state.awaitingResult) return false;
    if (!state.advanced) return false;
    if (matchLive) return false;
    return true;
  }

  function canRetry() {
    return state.status === 'won' || state.status === 'eliminated';
  }

  function reset() {
    state = defaults();
    save();
    return state;
  }

  function reload() {
    load();
    return state;
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  return {
    KEY: KEY,
    start: start,
    active: active,
    status: status,
    currentRound: currentRound,
    roundLabel: roundLabel,
    summary: summary,
    teams: teams,
    results: results,
    opponent: opponent,
    beginMatch: beginMatch,
    endMatch: endMatch,
    canContinue: canContinue,
    canRetry: canRetry,
    reset: reset,
    reload: reload,
    snapshot: snapshot,
  };
})();
