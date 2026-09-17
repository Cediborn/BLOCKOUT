// ============================================================
// KEEPER — dedicated AI goalkeeper.  Simple rule-based brain:
//   IDLE/TRACK   -> hold the ball-axis, stay in the goal mouth
//   SAVE         -> dive toward the predicted shot position
//   COLLECT      -> step out for a loose ball inside the zone
//   HOLD         -> controlled distribution post (protected)
//   DISTRIBUTE   -> release to the safest teammate, then back to TRACK
// The actual ball-stopping (save/parry) lives in Match.updateKeepers
// which runs after ball physics and before the goal check.
// ============================================================
var LG = window.LG = window.LG || {};

LG.KeeperBrain = function (player) {
  this.p = player;
  this.state = 'idle';
  this.thinkT = 0;
  this.actT = 0;            // cooldown between distribution decisions
  this.lastHadBall = false;
  this.moveTarget = { x: 0, z: player.z };
};

LG.KeeperBrain.prototype = {
  // signed world "own goal line" helpers (team0 defends +z, team1 defends -z)
  line: function () {
    var halfL = LG.Config.court.length / 2;
    return this.p.team === 0 ? halfL : -halfL;
  },
  sign: function () {
    return this.p.team === 0 ? 1 : -1;   // +1 = traveling +z toward my goal
  },

  clampZoneX: function (x) {
    return LG.Util.clamp(x, -LG.Config.keeper.halfW, LG.Config.keeper.halfW);
  },
  clampZoneZ: function (z) {
    var line = this.line(), sign = this.sign();
    return LG.Util.clamp(z, line - sign * LG.Config.keeper.depth, line + sign * LG.Config.keeper.stance + sign * 0.1);
  },

  update: function (dt) {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var ball = M.ball;
    if (!ball) return;

    this.thinkT -= dt;
    this.actT -= dt;
    if (me.stun > 0) { me.want.x = 0; me.want.z = 0; me.want.sprint = false; return; }

    // ---------------- HAS THE BALL: hold, then distribute ----------------
    if (me.hasBall) {
      if (!this.lastHadBall) {
        this.lastHadBall = true;
        me.distributeT = LG.Config.keeper.distributeDelay;
      }
      if (me.distributeT > 0) me.distributeT -= dt;
      // stay put on the goal line, face the field
      this.moveTarget = { x: this.clampZoneX(me.x), z: this.clampZoneZ(me.z) };
      me.want.x = (this.moveTarget.x - me.x) * 2;
      me.want.z = (this.moveTarget.z - me.z) * 2;
      me.want.sprint = false;
      if (this.actT <= 0 && me.distributeT <= 0) {
        this.distribute();
        this.actT = 1.0;
        this.state = 'out';
      }
      return;
    }
    this.lastHadBall = false;

    // ---------------- INCOMING SHOT: dive ----------------
    var th = typeof M.keeperThreat === 'function' ? M.keeperThreat(me) : null;
    if (th) {
      this.state = 'save';
      var tx = this.clampZoneX(th.px);
      var tz = this.clampZoneZ(th.pz);
      var dd = me.distTo(tx, tz);
      var sp = Math.min(1, dd > 0.2 ? dd / 1.1 : 1);
      me.want.x = (tx - me.x) * 3 * sp;
      me.want.z = (tz - me.z) * 3 * sp;
      me.want.sprint = dd > 0.5;
      // face the ball
      var ddx = ball.x - me.x, ddz = ball.z - me.z;
      if (ddx * ddx + ddz * ddz > 0.04) me.facing = Math.atan2(ddx, ddz);
      return;
    }

    // ---------------- LOOSE BALL inside the zone: step out ----------------
    var inFront = (this.line() - ball.z) * this.sign();   // >0 = on the field side
    var zoneIn = inFront < LG.Config.keeper.depth + 1.5 && inFront > -LG.Config.keeper.stance - 0.4;
    if (!ball.owner && zoneIn && ball.speed() < LG.Config.keeper.collectSpeed) {
      this.state = 'collect';
      this.moveTarget = {
        x: this.clampZoneX(ball.x),
        z: this.clampZoneZ((this.line() - this.sign() * Math.max(0.05, inFront))),
      };
      var cd = me.distTo(this.moveTarget.x, this.moveTarget.z);
      var csp = Math.min(1, cd > 0.2 ? cd / 1.2 : 1);
      me.want.x = (this.moveTarget.x - me.x) * 2.2 * csp;
      me.want.z = (this.moveTarget.z - me.z) * 2.2 * csp;
      me.want.sprint = cd > 1.2;
      return;
    }

    // ---------------- default: track the ball along the goal mouth ----------------
    this.state = 'track';
    var tx2 = this.clampZoneX(ball.x);
    var tz2 = this.clampZoneZ(this.line() - this.sign() * LG.Config.keeper.stance);
    this.moveTarget = { x: tx2, z: tz2 };
    me.want.x = U.clamp((tx2 - me.x) / 1.4, -1, 1) * 1.2;
    me.want.z = U.clamp((tz2 - me.z) / 1.4, -1, 1) * 1.2;
    me.want.sprint = false;
  },

  // ---------------- DISTRIBUTION ----------------
  distribute: function () {
    var me = this.p;
    var M = LG.Match;
    var target = this.pickTarget();
    if (target) {
      M.passTo(me, target, { lead: true });
    } else {
      this.clear();
    }
    M.bus.emit('keeperDistribute', { gk: me, target: target || null });
  },

  // Nearest OUTFIELD opponent to a candidate — crowded mates are bad outlets.
  crowdOf: function (cand) {
    var M = LG.Match;
    var opps = M.teamPlayers(1 - this.p.team);
    var min = 1e9, i;
    for (i = 0; i < opps.length; i++) {
      var o = opps[i];
      if (o.isGoalkeeper) continue;
      var d = o.distTo(cand.x, cand.z);
      if (d < min) min = d;
    }
    return min;
  },

  // Prefer the SAFEST outlet — an open, advanced teammate beats a closer but
  // marked one — with a little randomness so distribution never becomes a
  // robotic 1-2 repeat.
  pickTarget: function () {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var goal = M.enemyGoal(me.team);
    var mates = M.teamPlayers(me.team);
    var best = null, second = null, i, m;
    for (i = 0; i < mates.length; i++) {
      m = mates[i];
      if (m === me || m.isGoalkeeper) continue;
      var d = m.distTo(me.x, me.z);
      if (d < 1.5) continue;                       // too close to hit a useful pass
      var space = this.crowdOf(m);                 // nearest opponent distance
      var open = U.clamp((space - 1.9) / 1.6, 0, 1);
      var forward = (m.z - me.z) * (goal.z > 0 ? 1 : -1);
      var score = 0.8 + open * 1.0 + U.clamp(forward * 0.09, -0.25, 0.5) - d * 0.022 + U.rand() * 0.25;
      if (!best || score > best.score) { second = best; best = { p: m, score: score }; }
    }
    if (best && second && Math.random() < 0.22) best = second;
    return best ? best.p : null;
  },

  // Safety valve: no reliable teammate -> hoof it upfield toward open space.
  clear: function () {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var goal = M.enemyGoal(me.team);
    var dir = me.team === 0 ? -1 : 1;               // toward the opponent half
    var ax = (U.rand() - 0.5) * 9;
    var az = me.z + dir * (11 + U.rand() * 5);
    ax = U.clamp(ax, -11, 11);
    az = U.clamp(az, -20, 20);
    var dx = ax - me.x, dz = az - me.z;
    var dd = Math.sqrt(dx * dx + dz * dz) || 1;
    var P = LG.Config.physics;
    M.release(me);
    M.ball.kick((dx / dd) * P.passPower * 1.5, 1.6, (dz / dd) * P.passPower * 1.5);
    M.ball.lastKicker = me;
    M.ball.kickT = 0.3;
    LG.Particles.dust(me.x, me.z, 2);
  },
};