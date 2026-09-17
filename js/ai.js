// ============================================================
// AI — teammates & opponents
// ============================================================
var LG = window.LG = window.LG || {};

LG.AIBrain = function (player) {
  this.p = player;
  this.thinkT = 0;
  this.moveTarget = { x: player.x, z: player.z };
  this.actionCd = 0;
  this.desire = Math.random() * 0.3;     // personality: how eager to shoot
  this.dribbleT = Math.random() * 0.8;
};

LG.AIBrain.prototype = {
  update: function (dt) {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var ball = M.ball;

    this.actionCd = Math.max(0, this.actionCd - dt);
    if (me.stun > 0) { me.want.x = 0; me.want.z = 0; return; }

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = LG.Config.ai.thinkInterval * (0.7 + Math.random() * 0.6);
      this.think();
    }

    // move toward target
    var dx = this.moveTarget.x - me.x;
    var dz = this.moveTarget.z - me.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d > 0.35) {
      var sp = Math.min(1, d / 1.2);
      me.want.x = (dx / d) * sp;
      me.want.z = (dz / d) * sp;
    } else if (me.hasBall && M.possessionTeam === me.team) {
      // hold near ball with slight shuffle (avoid being static)
      me.want.x = Math.sin(U.rand() * 6.28) * 0.15;
      me.want.z = Math.cos(U.rand() * 6.28) * 0.15;
    } else {
      me.want.x = 0; me.want.z = 0;
    }

    // sprint when chasing or attacking the goal
    var sprint = false;
    if (M.possessionTeam !== me.team && this.isClosestChaser()) sprint = true;
    if (me.hasBall && me.team === M.possessionTeam) sprint = (M.distToGoal(me) > 8 && Math.random() < 0.4 ? true : false);
    me.want.sprint = sprint;
  },

  isClosestChaser: function () {
    var M = LG.Match;
    var ball = M.ball;
    var team = this.p.team;
    var players = M.teamPlayers(team);
    var closest = null, cd = 1e9;
    for (var i = 0; i < players.length; i++) {
      var d = players[i].distTo(ball.x, ball.z);
      if (d < cd) { cd = d; closest = players[i]; }
    }
    return closest === this.p;
  },

  // is any opponent standing on the shot line?
  aimClear: function (goal) {
    var M = LG.Match;
    var me = this.p;
    var opps = M.opponents(me);
    var ax = me.x, az = me.z, bx = goal.x, bz = goal.z;
    var len2 = (bx - ax) * (bx - ax) + (bz - az) * (bz - az);
    if (len2 < 4) return true;
    for (var i = 0; i < opps.length; i++) {
      var o = opps[i];
      var t = ((o.x - ax) * (bx - ax) + (o.z - az) * (bz - az)) / len2;
      t = LG.Util.clamp(t, 0, 1);
      var cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
      var d = o.distTo(cx, cz);
      if (d < 1.5) return false;
    }
    return true;
  },

  think: function () {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var ball = M.ball;
    if (!ball) return;

    var possession = M.possessionTeam; // -1 loose
    if (me.hasBall && possession === me.team) { this.offenseCarry(); return; }
    if (possession === me.team) { this.offenseSupport(); return; }
    if (possession === 1 - me.team) { this.defense(); return; }
    this.looseBall();
  },

  // ---------- HAVE THE BALL ----------
  offenseCarry: function () {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var goal = M.enemyGoal(me.team);

    this.dribbleT = Math.max(0, this.dribbleT - 0.05);
    if (this.actionCd <= 0) {

      // 1) PASS — the FIRST choice, before shooting or dribbling further
      var pass = this.bestPassTarget();
      if (pass) {
        var pressure = this.pressure(3.0);
        var dGoal = M.distToGoal(me);
        var strong = pass.score > 0.8;                    // clear, forward, open target
        var underHeat = pressure > 0.65 && pass.score > 0.35; // pressed + any decent outlet
        var fedUp = this.dribbleT <= 0.05 && pass.score > 0.5; // dribbled long enough, make the pass
        var notTooDeep = dGoal > 10;                      // no need to pass right at the goal
        if (strong || (underHeat && pass.score > 0.4) || fedUp) {
          if (notTooDeep || pass.score > 0.95) {
            M.passTo(me, pass.player, { lead: true });
            this.actionCd = 0.7;
            this.dribbleT = 0.15;
            return;
          }
        }
      }
    }

    // 2) SHOOT — only in range with a clear lane
    var dGoal2 = M.distToGoal(me);
    if (this.actionCd <= 0 && dGoal2 < M.shootRange(me) && Math.random() < 0.55 + this.desire) {
      if (this.aimClear(goal)) {
        var power = U.lerp(0.7, 1, me.stats.shoot / 10);
        M.shootDirect(me, power, goal);
        M.aiShootPulse();
        this.actionCd = 1.2;
        this.dribbleT = 0;
        return;
      } else if (this.pressure(2.4) > 0.5) {
        // lane is blocked and we're being closed on: recycle instead of forcing it
        var rec = this.bestPassTarget();
        if (rec && rec.score > 0.45) {
          M.passTo(me, rec.player, { lead: true });
          this.actionCd = 0.7;
          this.dribbleT = 0.15;
          return;
        }
      }
    }

    // 3) DRIBBLE toward goal, dodging the nearest opponent
    var gx = goal.x, gz = goal.z;
    var opp = M.nearestOpponent(me, 4.5);
    if (opp) {
      var oppD = opp.distTo(me.x, me.z);
      if (oppD < 3.4) {
        var ox = me.x - opp.x, oz = me.z - opp.z;
        var od = Math.sqrt(ox * ox + oz * oz) || 1;
        gx += (ox / od) * 4.8;
        gz += (oz / od) * 4.8;
        // pressure + no outlet -> burn the dribble timer so the next
        // evaluation strongly prefers a pass
        if (this.actionCd <= 0) this.dribbleT = Math.min(this.dribbleT, 0.02);
      }
    }
    gx += (Math.random() - 0.5) * 1.4;
    gz += (Math.random() - 0.5) * 1.4;
    this.moveTarget = { x: U.clamp(gx, -12, 12), z: U.clamp(gz, -21, 21) };
  },

  // 0..1 how much the ball-carrier is being closed down
  pressure: function (radius) {
    var M = LG.Match;
    var opps = M.opponents(this.p);
    var min = 1e9;
    for (var i = 0; i < opps.length; i++) {
      var d = opps[i].distTo(this.p.x, this.p.z);
      if (d < min) min = d;
    }
    if (min > radius) return 0;
    return Math.min(1, (radius - min) / radius);
  },

  bestPassTarget: function () {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var goal = M.enemyGoal(me.team);
    var mates = M.teamPlayers(me.team);
    var best = null;
    for (var i = 0; i < mates.length; i++) {
      var t = mates[i];
      if (t === me) continue;
      var d = t.distTo(me.x, me.z);
      if (d < 1.6) continue;                       // too close = no value to a pass
      if (!M.lineClear(me, t)) continue;           // defender on the lane
      var forward = (t.z - me.z) * (goal.z > 0 ? 1 : -1);
      var open = M.openness(t, 1 - me.team, 2.6);
      // open + forward is king; long passes are riskier than short ones
      var score = open * (0.55 + forward * 0.045) - d * 0.028;
      // the human is a legitimate, slightly-preferred target when they've
      // found space ahead (but not mandatory — AI still shares between mates)
      if (t.isHuman && forward > 1.5) score += 0.22;
      if (!best || score > best.score) best = { player: t, score: score, d: d };
    }
    return best;
  },

  // ---------- TEAMMATE HAS THE BALL ----------
  offenseSupport: function () {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var goal = M.enemyGoal(me.team);
    var carrier = M.ownerPlayer();
    var dCarrier = carrier ? me.distTo(carrier.x, carrier.z) : 999;

    // when we are the closest not-carrier, keep near for short outlet
    var pushForward = U.lerp(4, 9, me.stats.speed / 10);
    var baseZ = goal.z - Math.sign(goal.z) * pushForward;
    var baseX = (me.idx === 1 ? -3.5 : 3.5) + U.rand() * 1.4;

    // follow around the ball attack slightly behind it
    var tx = U.lerp(baseX, carrier ? carrier.x : 0, 0.35);
    var tz = U.lerp(baseZ, goal.z, 0.6);
    this.moveTarget = {
      x: U.clamp(tx + (U.rand() - 0.5) * 1.6, -11.5, 11.5),
      z: U.clamp(tz + (U.rand() - 0.5) * 1.2, -20.5, 20.5),
    };
    // call for a pass sometimes
    this.actionCd = Math.max(this.actionCd, 0);
  },

  // ---------- OPPONENT HAS THE BALL ----------
  defense: function () {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var ball = M.ball;
    var myGoal = M.myGoal(me.team);
    var carrier = M.ownerPlayer();

    if (this.isClosestChaser()) {
      // chase & tackle
      var tx, tz;
      if (carrier) {
        tx = carrier.x; tz = carrier.z;
      } else {
        tx = ball.x; tz = ball.z;
      }
      this.moveTarget = { x: tx, z: tz };
      var d = me.distTo(tx, tz);
      if (this.actionCd <= 0 && d < 2.25 && carrier) {
        M.tryTackle(me);
        this.actionCd = 1.0;
      } else if (this.actionCd <= 0 && d < 2.25 && !carrier) {
        // any loose ball in reach is worth claiming
        M.tryTackle(me);
        this.actionCd = 0.8;
      }
    } else {
      // cover the most dangerous attacker: goalside between a marked opp and goal
      var mark = null, mind = 1e9;
      var opps = M.teamPlayers(1 - me.team);
      for (var i = 0; i < opps.length; i++) {
        var o = opps[i];
        if (o === carrier) continue;
        var dGoal = M.distToGoal(o);
        if (dGoal < mind && !o.hasBall) { mind = dGoal; mark = o; }
      }
      if (mark) {
        var mx = (mark.x + myGoal.x) / 2 + (U.rand() - 0.5) * 1.4;
        var mz = (mark.z + myGoal.z) / 2 + (U.rand() - 0.5) * 1.4;
        this.moveTarget = { x: U.clamp(mx, -11.5, 11.5), z: U.clamp(mz, -20.5, 20.5) };
      } else {
        // drift goal-side
        var gdx = (ball.x + myGoal.x) / 2;
        var gdz = (ball.z + myGoal.z) / 2;
        this.moveTarget = { x: U.clamp(gdx + (U.rand() - 0.5) * 2.4, -11.5, 11.5), z: U.clamp(gdz + (U.rand() - 0.5) * 1.6, -20.5, 20.5) };
      }
    }
    me.want.tackle = false;
  },

  // ---------- LOOSE BALL ----------
  looseBall: function () {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var ball = M.ball;
    var goal = M.enemyGoal(me.team);

    if (this.isClosestChaser()) {
      this.moveTarget = { x: ball.x, z: ball.z };
    } else {
      var gx = (ball.x + goal.x) / 2 + (U.rand() - 0.5) * 2;
      var gz = (ball.z + goal.z) / 2;
      this.moveTarget = { x: U.clamp(gx, -11.5, 11.5), z: U.clamp(gz, -20.5, 20.5) };
    }
  },
};