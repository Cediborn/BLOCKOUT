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
    groundDrag: 0.984,      // rolling friction per frame (0.984^60 ≈ 0.38) — a pass now
                            // rolls roughly as far as its speed in m/s, so a 15m pass still
                            // has legs when it arrives instead of dying halfway
    maxBallSpeed: 36,
    shootPower: 27,         // base shot — a real strike, clearly stronger than a pass
    passPower: 15.5,
    // A pass must actually REACH its target. Rolling friction eats ~half the
    // ball's speed per second, so a single fixed power died short of anything
    // past ~20m (which is exactly why keeper distribution never arrived). The
    // launch speed is solved from the distance instead:
    //   speed = dist * passSpeedPerM + passSpeedBase
    passSpeedPerM: 1.15,
    passSpeedBase: 2.6,
    passSpeedMin: 6.5,
    dribbleRadius: 0.85,    // ball rides in front of the carrier

    playerAccel: 52,        // how hard a player chases their desired velocity
    stopBoost: 1.8,         // extra bite when the stick is released (crisp stops)

    sprintDrain: 0.2,       // stamina / second while sprinting (tactical, not punishing)
    sprintRecover: 0.24,    // stamina / second while not sprinting
    sprintMul: 1.6,         // pace boost (multiplier above maxSpeed)

    tackleRange: 2.4,       // max distance to engage a ball carrier
    tackleBallRange: 2.5,   // tackler must be reaching the BALL, not just the body
    tackleRearBlock: 0.04,  // rear-poke success is essentially disabled (both sides)
    tackleBumpStun: 0.12,   // a failed challenge is a bump, not a freeze

    // shot power curve: a tap is a controlled finish, full charge is a strike
    shootChargeRate: 2.8,   // charge per second while SHOOT is held
    shotPowerTap: 0.42,
    shotPowerFull: 1.0,

    passReceiveSpeed: 24,   // the intended receiver can control a pass up to this speed
    looseBallControl: 16.5, // speed under which anyone can take a loose ball
    passIntentTime: 1.5,    // how long a pass "belongs" to its intended receiver
  },

  ai: {
    thinkInterval: 0.18,
    shotMinDistance: 13,
    perfectPassChance: 0.5,
    // defenders slow to a jockey within this radius so they contain instead of
    // full-sprinting through the attacker every frame
    containRange: 3.2,
  },

  // ------------------------------------------------------------
  // DIFFICULTY — one centralized table.
  // Every AI / keeper decision that should change with the selected level
  // reads from here (js/difficulty.js owns the selector and the team mapping),
  // so tuning never means hunting for scattered `if (easy)` checks.
  //
  // 1.0 == the balanced baseline: MEDIUM plays exactly like the long-standing
  // tuning. Below 1 is looser/weaker/slower, above 1 is sharper. None of these
  // values touch raw physics — no extra sprint speed, no magnetised ball, no
  // teleporting — they only change decisions, reactions, spacing and accuracy.
  // ------------------------------------------------------------
  difficulty: {
    easy: {
      label: 'EASY',
      blurb: 'ROGUE SQUAD PLAYS LOOSE — SLOW REACTIONS, SLOPPY PASSES.',
      reactionTime: 1.8,          // multiplier on how often the AI re-thinks
      decisionDelay: 1.7,         // multiplier on the gap between AI actions
      passAccuracy: 0.5,          // divides pass error: lower = wilder passes
      shotAccuracy: 0.4,          // divides shot spread: lower = wilder shots
      tackleAccuracy: 0.5,        // multiplier on the chance a challenge lands
      interceptionAbility: 0.4,   // how quickly they read a change of possession
      pressingIntensity: 0.45,    // how tightly defenders press the carrier
      playerSwitchSpeed: 0.45,    // how fast the chase is handed to a teammate
      goalkeeperReaction: 0.55,   // keeper's read of a shot + dive speed
      goalkeeperSaveAbility: 0.6, // multiplier on the save roll
      attackingAggression: 0.6,   // shot appetite + how high support runs
      defensiveAggression: 0.5,   // how far up the covering defenders push
      mistakeRate: 0.22,          // how often a visibly poor choice is made
    },
    medium: {
      label: 'MEDIUM',
      blurb: 'BALANCED — SOLID MARKING, HONEST MISTAKES, FAIR PHYSICS.',
      reactionTime: 1.0,
      decisionDelay: 1.0,
      passAccuracy: 1.0,
      shotAccuracy: 1.0,
      tackleAccuracy: 1.0,
      interceptionAbility: 1.0,
      pressingIntensity: 1.0,
      playerSwitchSpeed: 1.0,
      goalkeeperReaction: 1.0,
      goalkeeperSaveAbility: 1.0,
      attackingAggression: 1.0,
      defensiveAggression: 1.0,
      mistakeRate: 0.06,
    },
    hard: {
      label: 'HARD',
      blurb: 'SHARP AND AGGRESSIVE — NO CHEATS, JUST BETTER DECISIONS.',
      reactionTime: 0.72,
      decisionDelay: 0.72,
      passAccuracy: 1.35,
      shotAccuracy: 1.2,
      tackleAccuracy: 1.1,
      interceptionAbility: 1.3,
      pressingIntensity: 1.35,
      playerSwitchSpeed: 1.5,
      goalkeeperReaction: 1.3,
      goalkeeperSaveAbility: 1.2,
      attackingAggression: 1.25,
      defensiveAggression: 1.3,
      mistakeRate: 0.015,
    },
  },

  keeper: {
    seeDist: 8.5,       // start diving when a loose ball is this close to the goal line
    saveWindow: 0.18,   // how far beyond the line a shot can still be clawed back
    depth: 5.2,         // how far in front of their goal the keeper may roam
    halfW: 4.4,         // lateral movement zone (goal mouth 2.6 + margin)
    stance: 0.55,       // how far off the line the keeper stands when idle
    distributeDelay: 0.9,
    commitDist: 4.5,    // how close the ball must be for the reflex roll to arm —
                        // a FIXED distance, so a level only changes skill and never
                        // the timing of the roll
    rxnWindow: 0.5,     // reference time for a "comfortable" reaction
    collectSpeed: 10.0, // loose balls slower than this are collected, faster saved
    diveSpeed: 4.2,     // lateral dive pace — a keeper's stretch, not an outfield sprint
    readSpread: 3.0,    // how far a keeper's read of a corner-bound shot can be off (m)
  },

  camera: {
    // portrait / base framing (the original broadcast camera)
    height: 30,
    distance: 25,
    fov: 50,
    xClamp: 11,
    zClamp: 18.5,           // symmetric full-pitch tracking: both ends reachable
    // landscape framing: pulled closer + tighter so the extra horizontal
    // screen space becomes a WIDER view of the pitch instead of a far-away
    // zoom-out (players stay a readable size)
    landscape: {
      height: 27,
      distance: 23,
      fov: 44,
      xClamp: 12,
      zClamp: 18.5,
    },
  },

  touch: {
    shootThreshold: 0.55,   // hold to charge, shoot when released past this
    // virtual stick feel: full tilt needs a short, comfortable finger travel
    stickDeadZone: 7,       // px before the stick registers at all
    stickFullTilt: 0.58,    // fraction of the joystick half-width that = full tilt
    stickFullMin: 34,       // px floor for full tilt
    stickFullMax: 84,       // px ceiling for full tilt
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

// ------------------------------------------------------------
// KIDS ROSTER — street football kids for casual pickup games
// Smaller bodies, younger faces, casual clothing
// ------------------------------------------------------------
LG.Kids = [
  {
    id: 'kid1', name: 'KAI', role: 'STREET', emoji: '⚽',
    stats: { speed: 7, shoot: 6, pass: 6, dribble: 7, defense: 5, stamina: 7 },
    ability: 'BURST',
    team: ['kid2', 'kid3'],
    palette: { skin: 0xe0a878, hair: 0x1a1a2e, shirt: 0x2f7fd4, trim: 0xffffff, pants: 0x1c2440, shoe: 0x2f7fd4 },
    body: { tall: 0.82, wide: 0.9 },
    hairStyle: 0,
  },
  {
    id: 'kid2', name: 'MAYA', role: 'STREET', emoji: '🌟',
    stats: { speed: 8, shoot: 5, pass: 7, dribble: 8, defense: 4, stamina: 6 },
    ability: 'DRIBBLE_RUSH',
    team: ['kid1', 'kid4'],
    palette: { skin: 0x8c5a3a, hair: 0x2b2320, shirt: 0xff6b6b, trim: 0xffe9c9, pants: 0x1b1d22, shoe: 0xff6b6b },
    body: { tall: 0.78, wide: 0.85 },
    hairStyle: 6,
  },
  {
    id: 'kid3', name: 'JAY', role: 'STREET', emoji: '🔥',
    stats: { speed: 6, shoot: 8, pass: 5, dribble: 5, defense: 7, stamina: 7 },
    ability: 'POWER_SHOT',
    team: ['kid1', 'kid5'],
    palette: { skin: 0xc99a76, hair: 0x4a3520, shirt: 0x4a5568, trim: 0xffd23f, pants: 0x262b33, shoe: 0x465063 },
    body: { tall: 0.85, wide: 0.95 },
    hairStyle: 3,
  },
  {
    id: 'kid4', name: 'LUNA', role: 'STREET', emoji: '🌙',
    stats: { speed: 9, shoot: 4, pass: 8, dribble: 9, defense: 3, stamina: 6 },
    ability: 'PERFECT_PASS',
    team: ['kid2', 'kid6'],
    palette: { skin: 0xd99f72, hair: 0xd3b02c, shirt: 0x7b3fb0, trim: 0xffe23f, pants: 0x241a3a, shoe: 0xffe23f },
    body: { tall: 0.76, wide: 0.82 },
    hairStyle: 5,
  },
  {
    id: 'kid5', name: 'RIO', role: 'STREET', emoji: '💨',
    stats: { speed: 7, shoot: 7, pass: 6, dribble: 6, defense: 6, stamina: 8 },
    ability: 'FREEZE',
    team: ['kid3', 'kid7'],
    palette: { skin: 0x6d4a33, hair: 0x1d1d22, shirt: 0x10b5a5, trim: 0xffe9c9, pants: 0x0e2b32, shoe: 0x35e0ff },
    body: { tall: 0.8, wide: 0.88 },
    hairStyle: 1,
  },
  {
    id: 'kid6', name: 'ZARA', role: 'STREET', emoji: '⚡',
    stats: { speed: 8, shoot: 5, pass: 7, dribble: 7, defense: 5, stamina: 7 },
    ability: 'SHOCKWAVE',
    team: ['kid4', 'kid8'],
    palette: { skin: 0xe09a72, hair: 0xff5a2d, shirt: 0xb8312f, trim: 0xffe9c9, pants: 0x1b1d22, shoe: 0xb8312f },
    body: { tall: 0.77, wide: 0.84 },
    hairStyle: 7,
  },
  {
    id: 'kid7', name: 'OMAR', role: 'STREET', emoji: '🎯',
    stats: { speed: 6, shoot: 6, pass: 9, dribble: 6, defense: 7, stamina: 6 },
    ability: 'SUPER_TACKLE',
    team: ['kid5', 'kid9'],
    palette: { skin: 0x8a5a3c, hair: 0x2b2320, shirt: 0x5a2f66, trim: 0x62ff8a, pants: 0x22262e, shoe: 0x343a44 },
    body: { tall: 0.83, wide: 0.92 },
    hairStyle: 2,
  },
  {
    id: 'kid8', name: 'COCO', role: 'STREET', emoji: '🌈',
    stats: { speed: 7, shoot: 6, pass: 6, dribble: 8, defense: 4, stamina: 7 },
    ability: 'WALL',
    team: ['kid6', 'kid10'],
    palette: { skin: 0xc98d5e, hair: 0x3a3f49, shirt: 0xff9c1a, trim: 0x1a1a22, pants: 0x1a1a22, shoe: 0xff9c1a },
    body: { tall: 0.79, wide: 0.86 },
    hairStyle: 4,
  },
  {
    id: 'kid9', name: 'SAM', role: 'STREET', emoji: '🧊',
    stats: { speed: 5, shoot: 7, pass: 5, dribble: 5, defense: 8, stamina: 8 },
    ability: 'BURST',
    team: ['kid7', 'kid10'],
    palette: { skin: 0x7a5a42, hair: 0x171a20, shirt: 0x4a5568, trim: 0xffd23f, pants: 0x262b33, shoe: 0x465063 },
    body: { tall: 0.84, wide: 0.93 },
    hairStyle: 3,
  },
  {
    id: 'kid10', name: 'MIKA', role: 'STREET', emoji: '🎪',
    stats: { speed: 8, shoot: 5, pass: 7, dribble: 7, defense: 5, stamina: 6 },
    ability: 'DRIBBLE_RUSH',
    team: ['kid8', 'kid9'],
    palette: { skin: 0xd99f72, hair: 0x2aa7b0, shirt: 0x35e0ff, trim: 0xffffff, pants: 0x141a12, shoe: 0x171c14 },
    body: { tall: 0.75, wide: 0.83 },
    hairStyle: 0,
  },
];

LG.kidById = function (id) {
  for (var i = 0; i < LG.Kids.length; i++) if (LG.Kids[i].id === id) return LG.Kids[i];
  return LG.Kids[0];
};

// ------------------------------------------------------------
// OUTFIT COLORS — street football outfit customization
// ------------------------------------------------------------
LG.OutfitColors = [
  { id: 'red',    label: 'RED',    hex: '#ff4444', color: 0xff4444 },
  { id: 'blue',   label: 'BLUE',   hex: '#4488ff', color: 0x4488ff },
  { id: 'yellow', label: 'YELLOW', hex: '#ffcc00', color: 0xffcc00 },
  { id: 'green',  label: 'GREEN',  hex: '#44cc44', color: 0x44cc44 },
  { id: 'orange', label: 'ORANGE', hex: '#ff8833', color: 0xff8833 },
  { id: 'purple', label: 'PURPLE', hex: '#9944cc', color: 0x9944cc },
  { id: 'black',  label: 'BLACK',  hex: '#222222', color: 0x222222 },
  { id: 'white',  label: 'WHITE',  hex: '#eeeeee', color: 0xeeeeee },
];

// Regular clothes palettes — casual street wear variations
LG.RegularClothes = [
  { shirt: 0x3d6b50, pants: 0x2a2a35, shoe: 0x1a1a22, trim: 0x88aa88 },
  { shirt: 0x6b3d66, pants: 0x1b1d22, shoe: 0x2b2320, trim: 0xcc88cc },
  { shirt: 0x3d4a63, pants: 0x262b33, shoe: 0x1a1a22, trim: 0x6688aa },
  { shirt: 0x6b603d, pants: 0x1b1d22, shoe: 0x2b2320, trim: 0xccaa66 },
  { shirt: 0x5a3d3d, pants: 0x2a2a35, shoe: 0x1a1a22, trim: 0xaa6666 },
  { shirt: 0x3d5a6b, pants: 0x1b1d22, shoe: 0x2b2320, trim: 0x66aacc },
];

// human starting team is 4 (blaze unlocked by default) — see progression