// ============================================================
// STREET LEGENDS — game config + character roster
// ============================================================
var LG = window.LG = window.LG || {};

LG.Config = {
  version: '0.2.0',

  court: {
    width: 26,        // x extent (half = 13)
    length: 44,       // z extent (half = 22)
    goalWidth: 5.2,
    goalDepth: 1.8,
    goalHeight: 1.9,
    fenceHeight: 3.0,
    ballRadius: 0.27,
  },

  match: {
    duration: 120,          // seconds per match (2:00)
    kickoffDelay: 1.4,      // freeze before kickoff
    goalDelay: 2.6,         // celebration pause after a goal
    endDelay: 2.2,
    maxGoalsShown: 9,
    swapCooldown: 0.5,
  },

  physics: {
    gravity: -17,
    bounce: 0.6,            // ground bounce coefficient (low = rolls)
    airDrag: 0.994,
    groundDrag: 0.96,       // rolling friction per frame (0.96^60 ≈ 0.086)
    maxBallSpeed: 34,
    shootPower: 23,         // base shot
    passPower: 15.5,
    dribbleRadius: 0.85,    // ball rides in front of the carrier
  },

  ai: {
    thinkInterval: 0.18,
    shotMinDistance: 13,
    perfectPassChance: 0.5,
  },

  camera: {
    height: 30,
    distance: 25,
    fov: 50,
    xClamp: 11,
    zClamp: 18.5,           // symmetric full-pitch tracking: both ends reachable
  },

  touch: {
    shootThreshold: 0.55,   // hold to charge, shoot when released past this
  },
};

// ------------------------------------------------------------
// ABILITY DEFINITIONS
// data used by abilities.js — each has a callback name
// ------------------------------------------------------------
LG.Abilities = {
  BURST: {
    id: 'BURST', name: 'BURST', label: 'BURST',
    color: 0x35e0ff,
    desc: 'Explode forward with a massive speed boost', dur: 2.6,
  },
  POWER_SHOT: {
    id: 'POWER_SHOT', name: 'POWER_SHOT', label: 'POWER SHOT',
    color: 0xffb62e,
    desc: 'Fire a rocket shot that rattles the net', dur: 0.1,
  },
  DRIBBLE_RUSH: {
    id: 'DRIBBLE_RUSH', name: 'DRIBBLE_RUSH', label: 'DEADLY FEET',
    color: 0x62ff8a,
    desc: 'Ball glues to your boots — plow past defenders', dur: 3.6,
  },
  SUPER_TACKLE: {
    id: 'SUPER_TACKLE', name: 'SUPER_TACKLE', label: 'BLOCKBUSTER',
    color: 0xff8a4d,
    desc: 'Shockwave tackle clears the area', dur: 0.2,
  },
  PERFECT_PASS: {
    id: 'PERFECT_PASS', name: 'PERFECT_PASS', label: 'LASSER LINE',
    color: 0xd9b8ff,
    desc: 'Next pass is laser-guided and unstoppable', dur: 6,
  },
  FREEZE: {
    id: 'FREEZE', name: 'FREEZE', label: 'ICE GRIP',
    color: 0xaad9ff,
    desc: 'Freeze the rival squad in place for a moment', dur: 3.2,
  },
  SHOCKWAVE: {
    id: 'SHOCKWAVE', name: 'SHOCKWAVE', label: 'BOOM HAND',
    color: 0x7dffbf,
    desc: 'Blast everyone away and grab any loose ball', dur: 0.2,
  },
  WALL: {
    id: 'WALL', name: 'WALL', label: 'CONCRETE WALL',
    color: 0xc9c9d1,
    desc: 'Plant into an immovable wall — shots bounce off', dur: 3.4,
  },
};

// ------------------------------------------------------------
// ROSTER — 8 original street-ballers
// stats out of 10.  team = ids of the two fixed running mates.
// ability references LG.Abilities
// ------------------------------------------------------------
LG.Roster = [
  {
    id: 'blaze', name: 'BLAZE', role: 'WINGER', emoji: '🔥',
    stats: { speed: 10, shoot: 5, pass: 6, dribble: 8, defense: 4, stamina: 7 },
    ability: 'BURST',
    team: ['cannon', 'eddy'],
    palette: { skin: 0xe09a72, hair: 0xff5a2d, shirt: 0x232a36, trim: 0xffd23f, pants: 0x141821, shoe: 0xff5a2d },
  },
  {
    id: 'cannon', name: 'CANNON', role: 'STRIKER', emoji: '💥',
    stats: { speed: 5, shoot: 10, pass: 5, dribble: 4, defense: 6, stamina: 6 },
    ability: 'POWER_SHOT',
    team: ['blaze', 'volt'],
    palette: { skin: 0x8c5a3a, hair: 0x2b2320, shirt: 0xb8312f, trim: 0xffe9c9, pants: 0x1b1d22, shoe: 0xb8312f },
  },
  {
    id: 'frenzy', name: 'FRENZY', role: 'DRIBBLER', emoji: '🌀',
    stats: { speed: 8, shoot: 5, pass: 5, dribble: 10, defense: 3, stamina: 5 },
    ability: 'DRIBBLE_RUSH',
    team: ['stone', 'echo'],
    palette: { skin: 0xc98d5e, hair: 0x7ff25e, shirt: 0xff9c1a, trim: 0x1a1a22, pants: 0x1a1a22, shoe: 0xfff }
  },
  {
    id: 'stone', name: 'STONE', role: 'SWEEPER', emoji: '🧱',
    stats: { speed: 4, shoot: 4, pass: 6, dribble: 3, defense: 10, stamina: 8 },
    ability: 'SUPER_TACKLE',
    team: ['frenzy', 'pulse'],
    palette: { skin: 0x6d4a33, hair: 0x3a3f49, shirt: 0x4a5568, trim: 0xffd23f, pants: 0x262b33, shoe: 0x465063 },
  },
  {
    id: 'echo', name: 'ECHO', role: 'PLAYMAKER', emoji: '🎯',
    stats: { speed: 6, shoot: 6, pass: 10, dribble: 7, defense: 5, stamina: 6 },
    ability: 'PERFECT_PASS',
    team: ['frenzy', 'stone'],
    palette: { skin: 0xe0a878, hair: 0x3d3d4d, shirt: 0x2f7fd4, trim: 0xffffff, pants: 0x1c2440, shoe: 0x2f7fd4 },
  },
  {
    id: 'pulse', name: 'PULSE', role: 'MID', emoji: '⚡',
    stats: { speed: 6, shoot: 7, pass: 7, dribble: 7, defense: 6, stamina: 7 },
    ability: 'FREEZE',
    team: ['stone', 'echo'],
    palette: { skin: 0x8a5a3c, hair: 0x2aa7b0, shirt: 0x10b5a5, trim: 0xffe9c9, pants: 0x0e2b32, shoe: 0x35e0ff },
  },
  {
    id: 'volt', name: 'VOLT', role: 'TRIXTER', emoji: '🌪️',
    stats: { speed: 9, shoot: 4, pass: 5, dribble: 9, defense: 2, stamina: 6 },
    ability: 'SHOCKWAVE',
    team: ['blaze', 'cannon'],
    palette: { skin: 0xd99f72, hair: 0xd3b02c, shirt: 0x7b3fb0, trim: 0xffe23f, pants: 0x241a3a, shoe: 0xffe23f },
  },
  {
    id: 'brute', name: 'BRUTE', role: 'TANK', emoji: '🏗️',
    stats: { speed: 3, shoot: 8, pass: 4, dribble: 3, defense: 9, stamina: 5 },
    ability: 'WALL',
    team: ['cannon', 'pulse'],
    palette: { skin: 0x7a5a42, hair: 0x171a20, shirt: 0x5a2f66, trim: 0x62ff8a, pants: 0x22262e, shoe: 0x343a44 },
  },
];

LG.byId = function (id) {
  for (var i = 0; i < LG.Roster.length; i++) if (LG.Roster[i].id === id) return LG.Roster[i];
  return LG.Roster[0];
};

// human starting team is 4 (blaze unlocked by default) — see progression