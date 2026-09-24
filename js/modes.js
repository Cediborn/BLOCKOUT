// ============================================================
// MODES — the game-mode selection layer over the match engine.
// Modes decide WHY a match is being played; MatchManager decides
// HOW. One current mode + optional challenge focus; tournament
// state lives in LG.Tournament. No per-frame work here.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Modes = (function () {
  var DEFS = [
    {
      id: 'quick_match',
      name: 'QUICK MATCH',
      blurb: 'One friendly. Full setup, full rewards.',
      type: 'quick',
    },
    {
      id: 'challenge_match',
      name: 'CHALLENGE MATCH',
      blurb: 'Focus one active challenge. Clear it for coins.',
      type: 'challenge',
    },
    {
      id: 'tournament',
      name: 'TOURNAMENT',
      blurb: 'Four-team knockout. Win two matches, take the crown.',
      type: 'tournament',
    },
  ];

  var byIdMap = {};
  for (var i = 0; i < DEFS.length; i++) byIdMap[DEFS[i].id] = DEFS[i];

  var currentId = 'quick_match';
  var selectedChallenge = null;

  function list() {
    return DEFS.slice();
  }

  function def(id) {
    return byIdMap[id] || null;
  }

  function current() {
    return def(currentId) || DEFS[0];
  }

  function id() {
    return current().id;
  }

  function is(modeId) {
    return id() === modeId;
  }

  function type() {
    return current().type;
  }

  function select(modeId) {
    if (!byIdMap[modeId]) return currentId;
    currentId = modeId;
    if (currentId !== 'challenge_match') selectedChallenge = null;
    return currentId;
  }

  // Challenge Match focuses exactly one of the player's 3 active
  // Phase 3B objectives — never a separate reward path.
  function challenge() {
    return selectedChallenge;
  }

  function selectChallenge(chId) {
    if (!chId || !LG.Challenges || !LG.Challenges.byId(chId)) return false;
    var act = (LG.Progression && LG.Progression.activeChallenges)
      ? LG.Progression.activeChallenges() : [];
    if (act.indexOf(chId) < 0) return false;
    selectedChallenge = chId;
    return true;
  }

  function clearChallenge() {
    selectedChallenge = null;
  }

  function reset() {
    currentId = 'quick_match';
    selectedChallenge = null;
  }

  return {
    DEFS: DEFS,
    list: list,
    def: def,
    current: current,
    id: id,
    is: is,
    type: type,
    select: select,
    challenge: challenge,
    selectChallenge: selectChallenge,
    clearChallenge: clearChallenge,
    reset: reset,
  };
})();
