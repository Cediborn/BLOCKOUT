// ============================================================
// PROGRESSION — single source of truth for persistent player
// profile: coins, unlocks, career stats, match history, and the
// active challenge set (Phase 3B). Everything that must survive
// a reload lives here. Temporary match state never does. Save
// only on controlled lifecycle points (finalize, unlock, spend,
// reset) — never per frame.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Progression = (function () {
  var KEY = 'blockout.profile.v2';
  var LEGACY_KEY = 'blockout.prog.v1';
  var SCHEMA = 3;   // v3 adds challenges{}; older v2 payloads sanitize cleanly
  var HISTORY_MAX = 25;
  var ASSIST_WINDOW = 8;   // seconds — mirrored by match.js; kept here as docs
  var ACTIVE_SLOTS = 3;

  // unlock prices scale up through the roster
  var ORDER = ['blaze', 'cannon', 'frenzy', 'stone', 'echo', 'pulse', 'volt', 'brute'];
  var COST = [0, 300, 300, 500, 600, 600, 800, 900];
  var CAREER_KEYS = [
    'matches', 'wins', 'draws', 'losses',
    'goalsFor', 'goalsAgainst', 'assists', 'shots', 'tackles', 'saves',
    'cleanSheets', 'playTime',
  ];

  function defaultChallenges() {
    return { active: [], cursor: 0, completions: {} };
  }

  function defaults() {
    var career = {};
    for (var i = 0; i < CAREER_KEYS.length; i++) career[CAREER_KEYS[i]] = 0;
    return {
      v: SCHEMA,
      coins: 0,
      unlocked: ['blaze'],
      best: { goals: 0, wins: 0, streak: 0 },
      career: career,
      history: [],
      challenges: defaultChallenges(),
    };
  }

  var data = defaults();

  function num(n, fallback) {
    n = Number(n);
    return isFinite(n) && n >= 0 ? n : (fallback || 0);
  }

  function sanitize(p) {
    var d = defaults();
    if (!p || typeof p !== 'object') return d;
    d.coins = num(p.coins);
    if (Object.prototype.toString.call(p.unlocked) === '[object Array]') {
      var u = [];
      for (var i = 0; i < p.unlocked.length; i++) {
        var id = p.unlocked[i];
        if (ORDER.indexOf(id) >= 0 && u.indexOf(id) < 0) u.push(id);
      }
      if (u.indexOf('blaze') < 0) u.unshift('blaze');
      d.unlocked = u;
    }
    if (p.best && typeof p.best === 'object') {
      d.best.goals = num(p.best.goals);
      d.best.wins = num(p.best.wins);
      d.best.streak = num(p.best.streak);
    }
    if (p.career && typeof p.career === 'object') {
      for (var k = 0; k < CAREER_KEYS.length; k++) {
        d.career[CAREER_KEYS[k]] = num(p.career[CAREER_KEYS[k]]);
      }
    }
    if (Object.prototype.toString.call(p.history) === '[object Array]') {
      var h = [];
      for (var j = 0; j < p.history.length && h.length < HISTORY_MAX; j++) {
        var e = p.history[j];
        if (!e || typeof e !== 'object') continue;
        var sc = (Object.prototype.toString.call(e.score) === '[object Array]') ? e.score : [0, 0];
        h.push({
          ts: num(e.ts),
          score: [num(sc[0]), num(sc[1])],
          won: e.won === 1 ? 1 : e.won === -1 ? -1 : 0,
          coins: num(e.coins),
          difficulty: typeof e.difficulty === 'string' ? e.difficulty : '',
          court: typeof e.court === 'string' ? e.court : '',
          assists: num(e.assists),
          shots: num(e.shots),
          tackles: num(e.tackles),
          saves: num(e.saves),
          poss: num(e.poss, 50),
        });
      }
      d.history = h;
    }

    // Phase 3B challenges — always recover to a valid active set
    var ch = defaultChallenges();
    if (p.challenges && typeof p.challenges === 'object') {
      ch.cursor = num(p.challenges.cursor);
      if (p.challenges.completions && typeof p.challenges.completions === 'object') {
        for (var cid in p.challenges.completions) {
          if (!Object.prototype.hasOwnProperty.call(p.challenges.completions, cid)) continue;
          if (LG.Challenges && LG.Challenges.byId && LG.Challenges.byId(cid)) {
            ch.completions[cid] = num(p.challenges.completions[cid]);
          }
        }
      }
      if (Object.prototype.toString.call(p.challenges.active) === '[object Array]') {
        for (var ai = 0; ai < p.challenges.active.length && ch.active.length < ACTIVE_SLOTS; ai++) {
          var aid = p.challenges.active[ai];
          if (typeof aid === 'string' && LG.Challenges && LG.Challenges.byId && LG.Challenges.byId(aid) &&
              ch.active.indexOf(aid) < 0) {
            ch.active.push(aid);
          }
        }
      }
    }
    d.challenges = ch;
    return d;
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        data = sanitize(JSON.parse(raw));
        return;
      }
      // one-time migrate from the Phase 1/2 key (coins + unlocks + best only)
      var leg = localStorage.getItem(LEGACY_KEY);
      if (leg) {
        var lp = JSON.parse(leg);
        data = sanitize({
          v: 1,
          coins: lp && lp.coins,
          unlocked: lp && lp.unlocked,
          best: lp && lp.best,
        });
        save();
        try { localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      data = defaults();   // corrupt / partial / hostile storage never crashes
    }
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
  }

  load();

  function costOf(id) {
    var i = ORDER.indexOf(id);
    return i >= 0 ? COST[i] : 0;
  }

  function careerCopy() {
    var c = {};
    for (var i = 0; i < CAREER_KEYS.length; i++) c[CAREER_KEYS[i]] = data.career[CAREER_KEYS[i]];
    return c;
  }

  function winRate() {
    var m = data.career.matches;
    if (!m) return 0;
    return Math.round((data.career.wins / m) * 100);
  }

  // Deterministic reward for a finished match. Home = player team (YOU).
  // Small, readable bonuses only — no economy sim.
  function rewardFor(won, stats) {
    var base = won === 1 ? 120 : won === 0 ? 60 : 35;
    var home = (stats && stats.home) || {};
    var away = (stats && stats.away) || {};
    var hf = num(home.goals);
    var ha = num(away.goals);
    var coins = base + hf * 12 + ha * 5 + Math.max(0, hf - ha) * 8;
    if (won === 1 && ha === 0) coins += 20;                          // clean sheet
    coins += Math.min(30, num(home.tackles) * 2);                    // tackle bonus
    coins += Math.min(20, num(home.saves) * 5);                      // save bonus
    return Math.round(coins / 10) * 10;
  }

  // The ONE place a completed match mutates the profile. Callers must guard
  // against double-entry (MatchManager._finalized). Returns the result with
  // coins filled in so the results screen reads the finalized payload.
  function finalizeMatch(result) {
    if (!result || typeof result !== 'object') return result;
    if (result.finalized) return result;
    var won = result.won === 1 ? 1 : result.won === -1 ? -1 : 0;
    var stats = result.stats || {};
    var home = stats.home || {};
    var away = stats.away || {};
    var score = (Object.prototype.toString.call(result.score) === '[object Array]') ? result.score : [0, 0];
    var hf = num(score[0]);
    var ha = num(score[1]);
    var coins = rewardFor(won, stats);

    data.coins += coins;
    var c = data.career;
    c.matches += 1;
    if (won === 1) c.wins += 1;
    else if (won === 0) c.draws += 1;
    else c.losses += 1;
    c.goalsFor += hf;
    c.goalsAgainst += ha;
    c.assists += num(home.assists);
    c.shots += num(home.shots);
    c.tackles += num(home.tackles);
    c.saves += num(home.saves);
    if (ha === 0) c.cleanSheets += 1;
    c.playTime += num(result.playTime);

    if (hf >= data.best.goals) data.best.goals = hf;
    if (won === 1) { data.best.wins += 1; data.best.streak += 1; }
    else data.best.streak = 0;

    data.history.unshift({
      ts: num(result.ts) || Date.now(),
      score: [hf, ha],
      won: won,
      coins: coins,
      difficulty: typeof result.difficulty === 'string' ? result.difficulty : '',
      court: typeof result.court === 'string' ? result.court : '',
      assists: num(home.assists),
      shots: num(home.shots),
      tackles: num(home.tackles),
      saves: num(home.saves),
      poss: num(home.poss, 50),
    });
    if (data.history.length > HISTORY_MAX) data.history.length = HISTORY_MAX;

    // Phase 3B: evaluate active challenges exactly once against this frozen
    // result (same once-only gate as the career write above).
    var challengeCoins = 0;
    var completed = [];
    if (LG.Challenges && typeof LG.Challenges.evaluate === 'function') {
      ensureActive();
      var act = data.challenges.active.slice();
      for (var ci = 0; ci < act.length; ci++) {
        var def = LG.Challenges.byId(act[ci]);
        if (!def) continue;
        var ev = LG.Challenges.evaluate(def, result, false);
        if (!ev.done) continue;
        challengeCoins += Number(def.reward) || 0;
        data.challenges.completions[def.id] = (data.challenges.completions[def.id] || 0) + 1;
        completed.push({
          id: def.id,
          title: def.title,
          description: def.description,
          category: def.category,
          difficulty: def.difficulty,
          reward: Number(def.reward) || 0,
          progress: ev.progress,
          target: def.target,
        });
        // replace the finished slot so the next match has a fresh objective
        var slot = -1;
        for (var si = 0; si < act.length; si++) {
          if (act[si] === def.id) { slot = si; break; }
        }
        if (slot >= 0 && LG.Challenges.pickForSlot) {
          var nextId = LG.Challenges.pickForSlot(slot, data.challenges.active, data.challenges);
          if (nextId) data.challenges.active[slot] = nextId;
          else data.challenges.active.splice(slot, 1);
        }
      }
      data.coins += challengeCoins;
    }

    save();
    result.coins = coins;
    result.challengeCoins = challengeCoins;
    result.completedChallenges = completed;
    result.finalized = true;
    result.career = careerCopy();
    return result;
  }

  // Fill / repair the 3 active slots from the pool (deterministic cursor).
  // Wrong-category ids from a corrupt payload are replaced, never kept.
  function ensureActive() {
    if (!LG.Challenges || !LG.Challenges.pickForSlot) return;
    var ch = data.challenges;
    if (!ch.active || Object.prototype.toString.call(ch.active) !== '[object Array]') ch.active = [];
    var slotDefs = LG.Challenges.slots ? LG.Challenges.slots() : [];
    var catsOk = ch.active.length >= slotDefs.length;
    if (catsOk) {
      for (var i = 0; i < slotDefs.length; i++) {
        var d = (typeof ch.active[i] === 'string') ? LG.Challenges.byId(ch.active[i]) : null;
        if (!d || (slotDefs[i] || []).indexOf(d.category) < 0) { catsOk = false; break; }
      }
    }
    if (catsOk) return;   // already a valid 3-slot set — leave ids alone

    var cleaned = [];
    for (var s = 0; s < slotDefs.length && s < ACTIVE_SLOTS; s++) {
      var cats = slotDefs[s] || [];
      var cur = ch.active[s];
      var def = (typeof cur === 'string') ? LG.Challenges.byId(cur) : null;
      if (def && cats.indexOf(def.category) >= 0 && cleaned.indexOf(def.id) < 0) {
        cleaned.push(def.id);
        continue;
      }
      var pick = LG.Challenges.pickForSlot(s, cleaned, ch);
      if (pick) cleaned.push(pick);
    }
    ch.active = cleaned;
  }

  function reset() {
    data = defaults();
    ensureActive();
    save();
    return data;
  }

  function reload() {
    load();
    ensureActive();
    return data;
  }

  function history() {
    // shallow copy of entries so UI cannot mutate the store
    var out = [];
    for (var i = 0; i < data.history.length; i++) out.push(data.history[i]);
    return out;
  }

  function activeChallenges() {
    ensureActive();
    return data.challenges.active.slice();
  }

  function challengeCompletions() {
    var out = {};
    var c = data.challenges.completions || {};
    for (var k in c) {
      if (Object.prototype.hasOwnProperty.call(c, k)) out[k] = c[k];
    }
    return out;
  }

  ensureActive();   // first load always offers 3 objectives

  return {
    // coins / unlocks (existing API — preserved)
    coins: function () { return data.coins; },
    addCoins: function (n) { data.coins += num(n); save(); return data.coins; },
    spend: function (n) {
      n = num(n);
      if (data.coins < n) return false;
      data.coins -= n; save(); return true;
    },
    isUnlocked: function (id) { return data.unlocked.indexOf(id) >= 0; },
    costOf: costOf,
    unlock: function (id) {
      var c = costOf(id);
      if (c <= 0 || this.isUnlocked(id)) return true;
      if (!this.spend(c)) return false;
      data.unlocked.push(id); save(); return true;
    },
    best: function () {
      return { goals: data.best.goals, wins: data.best.wins, streak: data.best.streak };
    },

    // career / history (Phase 3A)
    career: careerCopy,
    winRate: winRate,
    history: history,
    historyMax: function () { return HISTORY_MAX; },
    rewardFor: rewardFor,
    finalizeMatch: finalizeMatch,
    reset: reset,
    reload: reload,
    schema: function () { return SCHEMA; },

    // challenges (Phase 3B) — state only lives here; defs live in LG.Challenges
    activeChallenges: activeChallenges,
    challengeCompletions: challengeCompletions,
    ensureActiveChallenges: ensureActive,
  };
})();
