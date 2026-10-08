// ============================================================
// REACTPROBE — headless unit probe for js/reactions.js (Phase 8)
//
// Loads the real config/util/settings/reactions scripts under a bare
// window global, then drives the reaction layer against fake
// match/player objects with real limb/body stubs. Proves:
//   * bus hooks bind once (idempotent), the layer never emits events
//   * start() gates: kickAnim, priority up/down, cooldowns, bad kinds
//   * poses land after the frame, hold, then release to the EXACT
//     pre-reaction rest — never a sticky bone
//   * live movement / a new kick releases instead of fighting the body
//   * GOAL stands down entirely (celebration owns the frame) and a
//     pending miss survives it
//   * zero travel: position/velocity never touched
//   * events: shoot/postHit miss resolution (near/far + mate echo),
//     keeperSave, tackleWin, possession win/loss + shot suppression,
//     matchEnd sides + idx stagger, all emergency clears
//   * fatigue scan conditions, reduced-motion shrink, broken models
//   * no Math.random anywhere (the seeded sim stream stays untouched)
//
// Run: node tools/reactprobe.js
// ============================================================
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.resolve(__dirname, '..');
global.window = global;

function load(rel) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), { filename: rel });
}

['js/config.js', 'js/util.js', 'js/settings.js', 'js/reactions.js'].forEach(load);
var LG = global.LG;
if (!LG || !LG.Reactions || !LG.eventBus) {
  console.log('REACTPROBE FAIL scripts did not load');
  process.exit(1);
}

var pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ok - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (detail !== undefined ? '  ->  ' + detail : '')); }
}

var bus = LG.eventBus;
var DT = 1 / 60;

function tick(m, sec) {
  var n = Math.round(sec / DT);
  for (var i = 0; i < n; i++) LG.Reactions.update(m, DT);
}

function limb() { return { rotation: { x: 0, y: 0, z: 0 } }; }

function makeP(o) {
  o = o || {};
  return {
    x: o.x || 0, z: o.z || 0, y: 0, facing: 0, vx: 0, vz: 0,
    team: o.team == null ? 0 : o.team,
    idx: o.idx == null ? 0 : o.idx,
    isGoalkeeper: !!o.gk,
    stamina: o.stamina == null ? 1 : o.stamina,
    hasBall: !!o.hasBall,
    kickAnim: o.kickAnim || 0,
    model: o.noModel ? undefined : (o.broken ? {
      group: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } },
      body: { rotation: { x: 0 } },
    } : {
      group: { position: { x: 0, y: 0, z: 0 }, rotation: { y: 0 } },
      body: { rotation: { x: 0 } },
      limbs: { armL: limb(), armR: limb(), legL: limb(), legR: limb() },
    }),
  };
}

function mkMatch(players, state) {
  return {
    all: players,
    state: state || 'KICKOFF',
    ball: { x: 0, z: 0, owner: null, _s: 0, speed: function () { return this._s; } },
    home: players.filter(function (p) { return p.team === 0; }),
    away: players.filter(function (p) { return p.team === 1; }),
    enemyGoal: function (t) { return { x: 0, z: t === 0 ? -22.5 : 22.5 }; },
    teamPlayers: function (t) { return this.all.filter(function (p) { return p.team === t; }); },
  };
}

function armLx(p) { return p.model && p.model.limbs ? p.model.limbs.armL.rotation.x : NaN; }
function armRx(p) { return p.model && p.model.limbs ? p.model.limbs.armR.rotation.x : NaN; }
function pitchOf(p) { return p.model && p.model.body ? p.model.body.rotation.x : NaN; }
function sp(p) { return Math.sqrt((p.vx || 0) * (p.vx || 0) + (p.vz || 0) * (p.vz || 0)); }

// ---- 1. module + idempotent bind ------------------------------------

console.log('== module + bind ==');
ok(!!(LG.Reactions && LG.Reactions.attach && LG.Reactions.update &&
  LG.Reactions.start && LG.Reactions.clearAll && LG.Reactions.KINDS),
  'module exports attach/update/start/clearAll/KINDS');

var m1 = mkMatch([makeP({ team: 0, idx: 0 })], 'PLAY');
LG.Reactions.attach(m1);
LG.Reactions.attach(m1);          // a second MatchManager must not double-bind
LG.Reactions.bind();
var EVENTS = ['kickoff', 'matchStart', 'goal', 'state', 'shoot', 'postHit',
  'keeperSave', 'tackleWin', 'possession', 'matchEnd'];
var doubled = EVENTS.filter(function (ev) { return (bus._m[ev] || []).length !== 1; });
ok(doubled.length === 0, 'exactly one listener per hooked event', doubled.join(','));

var K = LG.Reactions.KINDS;
ok(K.release.pri < K.fatigue.pri && K.fatigue.pri < K.possession.pri &&
  K.possession.pri < K.miss.pri && K.miss.pri < K.matchEnd.pri &&
  K.matchEnd.pri < K.hit.pri && K.hit.pri < K.tackle.pri &&
  K.tackle.pri < K.save.pri, 'priority ladder: release < fatigue < ... < save');

// ---- 2. start gating -------------------------------------------------

console.log('== start gating ==');
var pA = makeP({ team: 0, idx: 0 });
var mA = mkMatch([pA], 'PLAY');
LG.Reactions.attach(mA);

ok(LG.Reactions.start(pA, 'fatigue', {}) === true, 'a normal start is accepted');
ok(pA._rx && pA._rx.kind === 'fatigue', 'reaction record attached');
pA.kickAnim = 1;
ok(LG.Reactions.start(pA, 'save', {}) === false, 'kickAnim in progress rejects every start');
pA.kickAnim = 0;
ok(LG.Reactions.start(pA, 'hit', {}) === true, 'a stronger pri interrupts the weaker one');
ok(pA._rx.kind === 'hit', 'the stronger reaction owns the body now');

var pB = makeP({ team: 0, idx: 1 });
LG.Reactions.attach(mkMatch([pB], 'PLAY'));
ok(LG.Reactions.start(pB, 'save', {}) === true, 'save starts on a fresh player');
ok(LG.Reactions.start(pB, 'fatigue', {}) === false, 'a weaker pri cannot interrupt save');
ok(pB._rx.kind === 'save', 'save still holds');

var pC = makeP({ team: 0, idx: 2 });
LG.Reactions.attach(mkMatch([pC], 'PLAY'));
ok(LG.Reactions.start(pC, 'fatigue', {}) === true, 'cooldown baseline starts');
ok(LG.Reactions.start(pC, 'fatigue', {}) === false, 'same kind inside its cooldown is refused');
ok(LG.Reactions.start(pC, 'no-such-kind', {}) === false, 'unknown kind refused');
ok(LG.Reactions.start({ x: 0, z: 0 }, 'fatigue', {}) === false, 'a player without a model refused');

// ---- 3. stagger delay ------------------------------------------------

console.log('== stagger ==');
var pD = makeP({ team: 0, idx: 3 });
var mD = mkMatch([pD], 'PLAY');
LG.Reactions.attach(mD);
ok(LG.Reactions.start(pD, 'miss', { delay: 0.5, data: { close: true }, dur: 4 }), 'delayed start accepted');
tick(mD, 0.2);
ok(armLx(pD) === 0, 'nothing is posed before the stagger delay', armLx(pD));
tick(mD, 0.5);
ok(armLx(pD) < -1, 'after the delay the hands-on-head lands', armLx(pD));

// ---- 4. pose + release restores the captured rest exactly ------------

console.log('== pose + release ==');
var pE = makeP({ team: 0, idx: 4 });
var mE = mkMatch([pE], 'PLAY');
LG.Reactions.attach(mE);
pE.model.limbs.armL.rotation.x = 0.17;   // simulated mixer pose from last frame
pE.model.body.rotation.x = 0.05;
ok(LG.Reactions.start(pE, 'save', { data: { parry: true }, dur: 4 }), 'save starts');
tick(mE, 0.3);
ok(armRx(pE) < -1, 'parry raises the punching arm', armRx(pE));
pE.kickAnim = 1;                          // a new kick takes the body back
tick(mE, 0.05);
ok(pE._rx === null, 'a new kick drops the reaction instantly, no fight');
ok(pE.model.limbs.armL.rotation.x === 0.17 && pE.model.body.rotation.x === 0.05,
  'kick hand-back restores the exact captured rest',
  pE.model.limbs.armL.rotation.x + '/' + pE.model.body.rotation.x);
pE.kickAnim = 0;
// the soft path too: hold runs out -> release -> exact rest
ok(LG.Reactions.start(pE, 'hit', { dur: 0.4 }), 'second reaction starts');
tick(mE, 0.9);
ok(pE._rx === null, 'hold expiry releases and clears the record');
ok(pE.model.limbs.armL.rotation.x === 0.17, 'arm restored to the exact captured rest', pE.model.limbs.armL.rotation.x);
ok(pE.model.body.rotation.x === 0.05, 'pitch restored to the exact captured rest', pE.model.body.rotation.x);

// ---- 5. live movement outranks a weak reaction -----------------------

console.log('== movement abort ==');
var pF = makeP({ team: 0, idx: 5 });
var mF = mkMatch([pF], 'PLAY');
LG.Reactions.attach(mF);
ok(LG.Reactions.start(pF, 'fatigue', { dur: 4 }), 'fatigue starts while still');
tick(mF, 0.25);
ok(pitchOf(pF) > 0.15, 'fatigue folds the body forward', pitchOf(pF));
pF.vx = 2.2;
tick(mF, 0.5);
ok(pF._rx === null, 'breaking into a run releases instead of fighting');
ok(armLx(pF) === 0 && pitchOf(pF) === 0, 'everything back at rest after the run-away release',
  armLx(pF) + '/' + pitchOf(pF));

// ---- 6. zero travel --------------------------------------------------

console.log('== zero travel ==');
var pG = makeP({ team: 0, idx: 6 });
var mG = mkMatch([pG], 'PLAY');
LG.Reactions.attach(mG);
var x0 = pG.x, z0 = pG.z, f0 = pG.facing;
LG.Reactions.start(pG, 'miss', { data: { close: true }, dur: 4 });
tick(mG, 0.5);
ok(pG.x === x0 && pG.z === z0 && pG.vx === 0 && pG.vz === 0,
  'position and velocity untouched by a reaction');
ok(pG.facing === f0, 'locomotion facing untouched (fatigue/miss-hold)');
ok(pG.model.group.position.x === 0 && pG.model.group.rotation.y === 0,
  'group transform untouched');

// ---- 7. GOAL stands down --------------------------------------------

console.log('== GOAL stand-down ==');
var pH = makeP({ team: 1, idx: 7 });
var mH = mkMatch([pH], 'PLAY');
LG.Reactions.attach(mH);
bus.emit('shoot', { player: pH });
ok(LG.Reactions.state().shot !== null, 'shoot arms a pending miss');
LG.Reactions.start(pH, 'save', { data: { parry: false }, dur: 4 });
mH.state = 'GOAL';
tick(mH, 0.5);
ok(pH._rx.t === 0, 'the layer does not advance during GOAL', pH._rx.t);
ok(armRx(pH) === 0, 'the layer does not pose during GOAL', armRx(pH));
ok(LG.Reactions.state().shot !== null, 'a pending miss survives the GOAL frame');
mH.state = 'PLAY';
tick(mH, 0.1);
ok(pH._rx.t > 0, 'resumes the moment the state leaves GOAL', pH._rx.t);

// ---- 8. events: shot → miss resolution -------------------------------

console.log('== miss resolution ==');
var shooter = makeP({ team: 0, idx: 0, x: 0, z: 8 });
var mate1 = makeP({ team: 0, idx: 1, x: 2, z: 9 });
var mate2 = makeP({ team: 0, idx: 2, x: -2, z: 9 });
var farMate = makeP({ team: 0, idx: 3, x: 0, z: -9 });
var lone = makeP({ team: 1, idx: 0, x: 5, z: -14 });
var mS = mkMatch([shooter, mate1, mate2, farMate, lone], 'PLAY');
LG.Reactions.attach(mS);
bus.emit('kickoff');   // reset every tracker from the previous sections

bus.emit('shoot', { player: shooter });
mS.ball.x = 0; mS.ball.z = 0; mS.ball._s = 0.4; mS.ball.owner = null;
tick(mS, 0.1);
ok(shooter._rx && shooter._rx.kind === 'miss' && shooter._rx.data.close === false,
  'a dead far shot resolves as a mild far miss');
ok(!mate1._rx && !farMate._rx, 'far misses do not recruit bystanders');
ok(LG.Reactions.state().shot === null, 'the pending shot is consumed');
tick(mS, 4.2);   // expire the far miss + its cooldown headroom

bus.emit('shoot', { player: shooter });
mS.ball.x = 0.4; mS.ball.z = -21.8;   // right in front of the team-0 goal mouth
bus.emit('postHit', {});
ok(shooter._rx && shooter._rx.kind === 'miss' && shooter._rx.data.close === true,
  'the woodwork resolves as an immediate close miss');
ok(mate1._rx && mate1._rx.kind === 'miss' && mate1._rx.delay > 0,
  'a nearby mate echoes late', mate1._rx && mate1._rx.delay);
ok(mate2._rx && mate2._rx.kind === 'miss', 'the second nearby mate echoes too');
ok(!farMate._rx && !lone._rx, 'distant players and the other side stay out of it');
tick(mS, 4.2);

// a shot the shooter simply picks back up is no miss at all
bus.emit('shoot', { player: shooter });
shooter.hasBall = true;
mS.ball.owner = shooter; mS.ball._s = 5;
tick(mS, 0.2);
ok(!shooter._rx, 'shot retained by the shooter poses nobody');
tick(mS, 3.2);
ok(LG.Reactions.state().shot === null && !shooter._rx,
  'a retained shot expires into nothing, never a miss');
shooter.hasBall = false; mS.ball.owner = null;

// ---- 9. events: keeperSave / tackleWin -------------------------------

console.log('== save + tackle events ==');
var gk = makeP({ team: 0, idx: 3, gk: true });
var tackler = makeP({ team: 0, idx: 1 });
var victim = makeP({ team: 1, idx: 2 });
var mM = mkMatch([gk, tackler, victim], 'PLAY');
LG.Reactions.attach(mM);
bus.emit('kickoff');

bus.emit('keeperSave', { gk: gk, parry: false });
ok(gk._rx && gk._rx.kind === 'save' && gk._rx.data.parry === false, 'a grab starts the claim beat');
ok(LG.Reactions.state().shot === null, 'a save clears any pending miss');
tick(mM, 2.2);   // let the save beat + cooldown pass

bus.emit('keeperSave', { gk: gk, parry: true });
ok(gk._rx && gk._rx.data.parry === true, 'a parry starts the punch-out beat');
tick(mM, 2.2);

bus.emit('tackleWin', { src: tackler, victim: victim });
ok(victim._rx && victim._rx.kind === 'hit', 'the robbed player stumbles');
ok(tackler._rx && tackler._rx.kind === 'tackle', 'the tackler pumps');
tick(mM, 2.0);

// ---- 10. events: possession change -----------------------------------

console.log('== possession events ==');
var ha = makeP({ team: 0, idx: 0 });
var hb = makeP({ team: 0, idx: 1 });
var aa = makeP({ team: 1, idx: 0 });
var ab = makeP({ team: 1, idx: 1 });
var mP = mkMatch([ha, hb, aa, ab], 'PLAY');
LG.Reactions.attach(mP);
bus.emit('kickoff');

bus.emit('possession', { player: ha });
ok(!ha._rx, 'the first gain fires nothing (no previous carrier)');
bus.emit('possession', { player: aa });
ok(ha._rx && ha._rx.kind === 'possession' && ha._rx.data.lose === true,
  'the side that lost the ball groans');
ok(aa._rx && aa._rx.kind === 'possession' && aa._rx.data.lose === false,
  'the new carrier gets its short beat');
tick(mP, 1.5);
bus.emit('possession', { player: ab });   // same side: circulation
ok(!ab._rx && !aa._rx, 'same-side possession change stays silent');

// shot aftermath: possession right after the shooter's effort is owned
// by the shot/miss beats, not by the possession beat
bus.emit('kickoff');
bus.emit('possession', { player: ha });
bus.emit('shoot', { player: ha });
bus.emit('possession', { player: aa });
ok(!ha._rx && !aa._rx, 'shot aftermath suppresses the possession beat');

// ---- 11. events: matchEnd + stagger ---------------------------------

console.log('== matchEnd ==');
var w0 = makeP({ team: 0, idx: 0 });
var w1 = makeP({ team: 0, idx: 1 });
var wgk = makeP({ team: 0, idx: 3, gk: true });
var l0 = makeP({ team: 1, idx: 0 });
var l1 = makeP({ team: 1, idx: 1 });
var lgk = makeP({ team: 1, idx: 3, gk: true });
var mE2 = mkMatch([w0, w1, wgk, l0, l1, lgk], 'END');
LG.Reactions.attach(mE2);
bus.emit('kickoff');
bus.emit('matchEnd', { won: 1, score: [2, 0] });
ok(w0._rx && w0._rx.kind === 'matchEnd' && w0._rx.data.side === 'win', 'the winners celebrate');
ok(wgk._rx && wgk._rx.data.side === 'win' && wgk._rx.data.gk === true, 'the winning keeper gets its own beat');
ok(l0._rx && l0._rx.data.side === 'lose' && l1._rx.data.side === 'lose', 'the losers slump');
ok(lgk._rx && lgk._rx.data.gk === true && lgk._rx.data.side === 'lose', 'the losing keeper folds');
ok(w0._rx.delay !== w1._rx.delay, 'idx stagger: teammates start apart',
  w0._rx.delay + ' vs ' + w1._rx.delay);
tick(mE2, 0.35);
ok(armLx(w0) < -1, 'in the END state the reactions still pose', armLx(w0));

// ---- 12. emergency clears -------------------------------------------

console.log('== emergency clears ==');
function clearVia(ev, data) {
  var p = makeP({ team: 0, idx: 0 });
  var m = mkMatch([p], 'PLAY');
  LG.Reactions.attach(m);
  LG.Reactions.start(p, 'miss', { data: { close: true }, dur: 4 });
  bus.emit(ev, data);
  return p._rx === null;
}
ok(clearVia('kickoff', { match: m1 }), 'kickoff hard-clears');
ok(clearVia('matchStart', { match: m1 }), 'matchStart hard-clears');
ok(clearVia('goal', { team: 0 }), 'goal hard-clears');
ok(clearVia('state', { state: 'KICKOFF' }), 'KICKOFF state hard-clears');
ok(clearVia('state', { state: 'GOAL' }), 'GOAL state hard-clears');
(function () {
  var p = makeP({ team: 0, idx: 0 });
  var m = mkMatch([p], 'PLAY');
  LG.Reactions.attach(m);
  LG.Reactions.start(p, 'miss', { data: { close: true }, dur: 4 });
  bus.emit('state', { state: 'PLAY' });
  ok(p._rx !== null, 'PLAY state never clears');
})();
(function () {
  // kickoff also resets the carrier tracking: the next gain is "first"
  var m = mkMatch([makeP({ team: 0, idx: 0 })], 'PLAY');
  LG.Reactions.attach(m);
  bus.emit('kickoff');
  var p = m.all[0];
  bus.emit('possession', { player: p });
  ok(!p._rx, 'after a kickoff the next gain reads as a first gain');
})();

// ---- 13. fatigue scan ------------------------------------------------

console.log('== fatigue scan ==');
var tired = makeP({ team: 0, idx: 0, stamina: 0.05, x: 4, z: 4 });
var fresh = makeP({ team: 0, idx: 1, stamina: 0.6 });
var runner = makeP({ team: 0, idx: 2, stamina: 0.05 });
var carrier = makeP({ team: 0, idx: 3, stamina: 0.05, hasBall: true });
var gk2 = makeP({ team: 0, idx: 4, gk: true, stamina: 0.05 });
runner.vx = 1.0;
var mT = mkMatch([tired, fresh, runner, carrier, gk2], 'PLAY');
LG.Reactions.attach(mT);
tick(mT, 0.1);   // first scan (throttle may owe a beat)
tick(mT, 0.4);
ok(tired._rx && tired._rx.kind === 'fatigue', 'a stationary exhausted player reacts');
ok(!fresh._rx, 'a fresh player never slumps');
ok(!runner._rx, 'someone already running never slumps');
ok(!carrier._rx, 'the carrier never slumps');
ok(!gk2._rx, 'goalkeepers are excluded');

// ---- 14. reduced motion ---------------------------------------------

console.log('== reduced motion ==');
var rmP = makeP({ team: 0, idx: 0 });
var mR = mkMatch([rmP], 'PLAY');
LG.Reactions.attach(mR);
var origRM = LG.Settings.reducedMotion;
LG.Settings.reducedMotion = function () { return true; };
LG.Reactions.start(rmP, 'miss', { data: { close: true } });
var rmDur = rmP._rx ? rmP._rx.dur : 0;
var rmAmp = rmP._rx ? rmP._rx.amp : 0;
LG.Settings.reducedMotion = origRM;
ok(rmDur > 0 && rmDur < K.miss.dur, 'reduced motion shortens the hold',
  rmDur + ' vs ' + K.miss.dur);
ok(rmAmp > 0 && rmAmp < 1, 'reduced motion softens the amplitude', rmAmp);
tick(mR, 2.5);

// ---- 15. broken / missing models degrade -----------------------------

console.log('== degraded players ==');
var broken = makeP({ team: 0, idx: 0, broken: true });
var mB = mkMatch([broken], 'PLAY');
LG.Reactions.attach(mB);
ok(LG.Reactions.start(broken, 'tackle', {}) === true, 'a model without limbs still starts');
tick(mB, 0.3);
ok(broken._rx.t > 0, 'the clock advances even though there is nothing to pose');
tick(mB, 0.6);
ok(broken._rx === null, 'it still releases and clears cleanly');

// ---- 16. source hygiene ----------------------------------------------

console.log('== source hygiene ==');
var src = fs.readFileSync(path.join(ROOT, 'js', 'reactions.js'), 'utf8');
ok(!/Math\.random/.test(src), 'no Math.random — the seeded sim stream stays untouched');
ok(!/\.emit\(/.test(src), 'the layer never emits — the bus surface is unchanged for sim');
ok(/state === 'GOAL'/.test(src), 'GOAL stand-down is in the source contract');
ok(/kickAnim/.test(src) && /_rxcd/.test(src), 'kick gate + cooldowns are in the source contract');

// ----------------------------------------------------------------------

if (fail) {
  console.log('REACTPROBE FAIL ' + fail + ' failed / ' + pass + ' passed');
  process.exit(1);
}
console.log('REACTPROBE PASS ' + pass + '/' + pass);
