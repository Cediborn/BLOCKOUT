// ============================================================
// CHALLENGES — short match-specific objectives (Phase 3B).
// Definitions + pure evaluation live here. Persistent state
// (active ids, completions) lives in LG.Progression. Runtime
// only reacts to match events / finalization — never per frame.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Challenges = (function () {
  // Match-specific only. Objective types map 1:1 onto finalized home stats
  // (or the result envelope). No timers, no comeback (no score timeline).
  var POOL = [
    // ATTACK
    { id: 'score_2', title: 'ON FIRE', description: 'Score 2 goals in one match.',
      category: 'attack', difficulty: 'easy', objectiveType: 'goals', target: 2, reward: 50 },
    { id: 'score_3', title: 'HAT TRICK', description: 'Score 3 goals in one match.',
      category: 'attack', difficulty: 'medium', objectiveType: 'goals', target: 3, reward: 100 },
    { id: 'shots_8', title: 'SHOT MAKER', description: 'Take 8 shots in one match.',
      category: 'attack', difficulty: 'medium', objectiveType: 'shots', target: 8, reward: 100 },
    { id: 'score_4', title: 'MACHINE', description: 'Score 4 goals in one match.',
      category: 'attack', difficulty: 'hard', objectiveType: 'goals', target: 4, reward: 200 },
    // PASSING
    { id: 'passes_10', title: 'BUILD UP', description: 'Complete 10 passes in one match.',
      category: 'passing', difficulty: 'easy', objectiveType: 'passes', target: 10, reward: 50 },
    { id: 'assists_2', title: 'CREATE CHANCES', description: 'Record 2 assists in one match.',
      category: 'passing', difficulty: 'medium', objectiveType: 'assists', target: 2, reward: 100 },
    // DEFENSE
    { id: 'tackles_4', title: 'TACKLE MASTER', description: 'Complete 4 tackles in one match.',
      category: 'defense', difficulty: 'easy', objectiveType: 'tackles', target: 4, reward: 50 },
    { id: 'clean_sheet', title: 'LOCK IT DOWN', description: 'Win a match without conceding.',
      category: 'defense', difficulty: 'hard', objectiveType: 'cleanSheet', target: 1, reward: 200 },
    // GOALKEEPING
    { id: 'saves_3', title: 'SAFE HANDS', description: 'Make 3 saves in one match.',
      category: 'goalkeeping', difficulty: 'easy', objectiveType: 'saves', target: 3, reward: 50 },
    { id: 'saves_5', title: 'WALL', description: 'Make 5 saves in one match.',
      category: 'goalkeeping', difficulty: 'hard', objectiveType: 'saves', target: 5, reward: 200 },
    // RESULTS
    { id: 'win_1', title: 'TAKE THE W', description: 'Win a match.',
      category: 'results', difficulty: 'easy', objectiveType: 'win', target: 1, reward: 50 },
    { id: 'win_by_2', title: 'CLEAR VICTORY', description: 'Win by 2 or more goals.',
      category: 'results', difficulty: 'medium', objectiveType: 'winBy', target: 2, reward: 100 },
  ];

  // Fixed active slots so one match always offers attack + defense + mix variety.
  var SLOTS = [
    ['attack'],
    ['defense', 'goalkeeping'],
    ['passing', 'results'],
  ];

  var REWARD = { easy: 50, medium: 100, hard: 200 };

  var byIdMap = {};
  for (var i = 0; i < POOL.length; i++) byIdMap[POOL[i].id] = POOL[i];

  function byId(id) {
    return byIdMap[id] || null;
  }

  function pool() {
    return POOL.slice();
  }

  function slots() {
    return SLOTS;
  }

  // progress = current value against target; done = objective met.
  // live=true skips result-only types (win / clean sheet / winBy) so mid-match
  // UI never claims a result that has not happened yet.
  function evaluate(def, result, live) {
    if (!def || !result) return { progress: 0, done: false };
    var s = result.stats || {};
    var home = s.home || {};
    var away = s.away || {};
    var score = (Object.prototype.toString.call(result.score) === '[object Array]') ? result.score : [0, 0];
    var hf = Number(score[0]) || 0;
    var ha = Number(score[1]) || 0;
    var won = result.won === 1 ? 1 : result.won === -1 ? -1 : 0;
    var target = Number(def.target) || 1;
    var progress = 0;
    var done = false;

    switch (def.objectiveType) {
      case 'goals':
        progress = Number(home.goals) || 0;
        done = progress >= target;
        break;
      case 'shots':
        progress = Number(home.shots) || 0;
        done = progress >= target;
        break;
      case 'passes':
        progress = Number(home.passes) || 0;
        done = progress >= target;
        break;
      case 'assists':
        progress = Number(home.assists) || 0;
        done = progress >= target;
        break;
      case 'tackles':
        progress = Number(home.tackles) || 0;
        done = progress >= target;
        break;
      case 'saves':
        progress = Number(home.saves) || 0;
        done = progress >= target;
        break;
      case 'cleanSheet':
        if (live) {
          progress = 0;
          done = false;
        } else {
          // away goals also come from score when stats missing
          var ga = (away.goals != null) ? Number(away.goals) : ha;
          progress = (won === 1 && ga === 0) ? 1 : 0;
          done = progress === 1;
        }
        break;
      case 'win':
        if (live) {
          progress = 0;
          done = false;
        } else {
          progress = won === 1 ? 1 : 0;
          done = progress === 1;
        }
        break;
      case 'winBy':
        if (live) {
          progress = 0;
          done = false;
        } else {
          var margin = hf - ha;
          progress = (won === 1 && margin >= target) ? 1 : (won === 1 ? Math.max(0, Math.min(target - 1, margin)) : 0);
          done = won === 1 && margin >= target;
        }
        break;
      default:
        progress = 0;
        done = false;
    }
    if (progress > target && def.objectiveType !== 'win' && def.objectiveType !== 'cleanSheet' && def.objectiveType !== 'winBy') {
      progress = target;
    }
    return { progress: progress, done: !!done };
  }

  // Deterministic slot fill: walk the pool from a stored cursor, first match
  // for the slot's categories that is not already active.
  function pickForSlot(slotIndex, activeIds, cursorState) {
    var cats = SLOTS[slotIndex] || ['attack'];
    var start = cursorState.cursor || 0;
    for (var n = 0; n < POOL.length; n++) {
      var idx = (start + n) % POOL.length;
      var def = POOL[idx];
      if (cats.indexOf(def.category) >= 0 && activeIds.indexOf(def.id) < 0) {
        cursorState.cursor = (idx + 1) % POOL.length;
        return def.id;
      }
    }
    // every matching id already active (tiny pool edge case)
    for (var m = 0; m < POOL.length; m++) {
      var d2 = POOL[m];
      if (cats.indexOf(d2.category) >= 0 && activeIds.indexOf(d2.id) < 0) return d2.id;
    }
    return null;
  }

  // ---- in-match progress toasts (event-driven, never per frame) ----
  var bound = false;
  var lastProg = {};
  var LISTEN = ['goal', 'shoot', 'pass', 'tackleWin', 'keeperSave'];

  function resetLive() {
    lastProg = {};
  }

  function onTick() {
    var m = LG.Match;
    if (!m || m._finalized || m.state === 'END') return;
    var P = LG.Progression;
    if (!P || typeof P.activeChallenges !== 'function') return;
    var act = P.activeChallenges();
    if (!act || !act.length) return;
    var live = {
      score: m.score,
      stats: { home: m.stats.home, away: m.stats.away },
      won: null,
    };
    for (var i = 0; i < act.length; i++) {
      var def = byId(act[i]);
      if (!def) continue;
      var ev = evaluate(def, live, true);
      var prev = lastProg[def.id];
      if (prev === undefined) prev = 0;
      if (ev.progress <= prev) continue;
      lastProg[def.id] = ev.progress;
      if (ev.done) {
        if (LG.HUD && LG.HUD.banner) LG.HUD.banner('CHALLENGE COMPLETE', 'team1', 1200);
      } else if (LG.HUD && LG.HUD.toast) {
        LG.HUD.toast(def.title + '  ' + ev.progress + '/' + def.target, 1000);
      }
    }
  }

  function bind() {
    if (bound || !LG.eventBus || !LG.eventBus.on) return;
    bound = true;
    LG.eventBus.on('matchStart', resetLive);
    for (var i = 0; i < LISTEN.length; i++) {
      LG.eventBus.on(LISTEN[i], onTick);
    }
  }

  return {
    POOL: POOL,
    REWARD: REWARD,
    byId: byId,
    pool: pool,
    slots: slots,
    evaluate: evaluate,
    pickForSlot: pickForSlot,
    bind: bind,
    resetLive: resetLive,
  };
})();
