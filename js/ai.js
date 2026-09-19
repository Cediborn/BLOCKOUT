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
  this.diff = null;                      // this side's difficulty profile
  this.reactT = 0;                       // how long until they read the turnover
  this._lastPoss = null;
};

LG.AIBrain.prototype = {
  // The profile for the side this brain plays on. Deliberately NOT cached:
  // forTeam() is a table lookup, and never caching means changing the level
  // always changes gameplay immediately (there is no stale profile to miss).
  difficulty: function () {
    return LG.Difficulty.forTeam(this.p.team);
  },

  // which direction is "toward the enemy goal" for my team?
  attDir: function () {
    return this.p.team === 0 ? -1 : 1;
  },

  // How much an AI pass wobbles: how hard the passer is being pressed and how
  // good a passer they are, divided by this difficulty's passing accuracy.
  passError: function (pressure) {
    var D = this.difficulty();
    return pressure * (1 - this.p.stats.pass / 12) * 0.35 / (D.passAccuracy || 1);
  },

  // A deliberately mediocre target — used by mistakeRate so a bad pass is a bad
  // DECISION (a mate who is marked or behind the play), never random nonsense.
  randomMate: function () {
    var mates = LG.Match.teamPlayers(this.p.team);
    var pool = [];
    for (var i = 0; i < mates.length; i++) {
      var m = mates[i];
      if (m !== this.p && !m.isGoalkeeper) pool.push(m);
    }
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
  },

  update: function (dt) {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var ball = M.ball;
    var D = this.difficulty();

    this.actionCd = Math.max(0, this.actionCd - dt);
    if (me.stun > 0) { me.want.x = 0; me.want.z = 0; return; }

    // reading the game: a low-anticipation side is a beat late to a change of
    // possession, so loose balls and second balls fall to the alert side.
    // (This is the whole interception knob — no ball magnetism anywhere.)
    if (this._lastPoss !== M.possessionTeam) {
      this._lastPoss = M.possessionTeam;
      var slow = 1 - (D.interceptionAbility || 1);
      this.reactT = slow > 0 ? slow * 0.6 : 0;
    }
    if (this.reactT > 0) this.reactT = Math.max(0, this.reactT - dt);

    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = LG.Config.ai.thinkInterval * (D.reactionTime || 1) * (0.7 + Math.random() * 0.6);
      this.think();
    }

    // run onto a pass that is actually aimed at me — the ball's own motion sets
    // the lead, so two chasers never fight over the same intercept point
    if (ball && ball.intendedReceiver === me && ball.intendedT > 0 && !me.hasBall) {
      var lead = Math.min(0.4, 3 / Math.max(2, ball.speed()));
      this.moveTarget.x = U.clamp(ball.x + ball.vx * lead, -12.6, 12.6);
      this.moveTarget.z = U.clamp(ball.z + ball.vz * lead, -21.6, 21.6);
      if (ball.lastKicker && ball.lastKicker.team !== me.team) {
        // a loose opponent pass cut off — close it down hard
        this.moveTarget.x = ball.x;
        this.moveTarget.z = ball.z;
      }
    } else {
      // keep spacing: don't stack onto a mate or swarm a free ball
      this.separate(this.moveTarget, me.hasBall);
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

    // sprint when chasing or attacking goal — a side that has not read the
    // turnover yet jogs back instead of flying into the challenge
    var sprint = false;
    if (this.reactT <= 0 && M.possessionTeam !== me.team && this.isClosestChaser()) {
      var cCarrier = M.ownerPlayer();
      var cDist = cCarrier ? me.distTo(cCarrier.x, cCarrier.z) : me.distTo(ball.x, ball.z);
      sprint = cDist > (LG.Config.ai.containRange || 3.2); // sprint to close down, jog to contain
    }
    if (me.hasBall && me.team === M.possessionTeam) sprint = (M.distToGoal(me) > 8 && Math.random() < 0.4 * (D.attackingAggression || 1));
    // receivers sprint onto their own pass; defenders sprint to a cut ball
    if (ball && ball.intendedReceiver === me && ball.intendedT > 0 && !me.hasBall) {
      var tSp = ball.speed();
      sprint = sprint || (tSp > 12 && Math.random() < 0.7);
    }
    me.want.sprint = sprint;
  },

  // Pull `target` away from teammates (and a free ball) so the side keeps
  // spacing instead of collapsing. Only a shape target — never snaps the ball
  // chase: the designated chaser is exempt from the ball repulsion.
  separate: function (target, haveBall) {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var ax = target.x, az = target.z;
    var mates = M.teamPlayers(me.team);
    var i, m, dx, dz, d, f;
    for (i = 0; i < mates.length; i++) {
      m = mates[i];
      if (m === me) continue;
      dx = ax - m.x; dz = az - m.z;
      d = Math.sqrt(dx * dx + dz * dz);
      if (d < 2.2 && d > 0.001) {
        f = ((2.2 - d) / 2.2) * 1.7;
        ax += (dx / d) * f;
        az += (dz / d) * f;
      }
    }
    if (!haveBall && !this.isClosestChaser()) {
      var b = M.ball;
      dx = ax - b.x; dz = az - b.z;
      d = Math.sqrt(dx * dx + dz * dz);
      if (d < 2.6 && d > 0.001) {
        f = ((2.6 - d) / 2.6) * 2.2;
        ax += (dx / d) * f;
        az += (dz / d) * f;
      }
    }
    this.moveTarget.x = U.clamp(ax, -12.6, 12.6);
    this.moveTarget.z = U.clamp(az, -21.6, 21.6);
  },

  // The designated chaser is decided per TEAM by the match, on a cadence set
  // by the difficulty's playerSwitchSpeed: a passive side is slow to hand the
  // chase to the teammate who is actually closest, a sharp side switches at
  // once. Sharing one answer per team also stops two defenders both deciding
  // they are "the" chaser and piling into the same carry.
  isClosestChaser: function () {
    return LG.Match.chaserOf(this.p.team) === this.p;
  },

  // Commit to a challenge. A mistake-prone side mistimes it — an early lunge
  // that costs them the recovery time — and the challenge itself is scaled by
  // the difficulty's tackle accuracy.
  attemptTackle: function (distToCarrier) {
    var D = this.difficulty();
    this.actionCd = Math.max(0.4, 0.9 - distToCarrier * 0.08) * (D.decisionDelay || 1);
    if (Math.random() < (D.mistakeRate || 0) * 1.4) {
      this.actionCd *= 2.2;                     // lunged too early, out of the play
      return;
    }
    LG.Match.tryTackle(this.p, { accuracy: D.tackleAccuracy || 1 });
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
      if (o.isGoalkeeper) continue;   // the keeper is the target, not a blocker
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
    var D = this.difficulty();

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
            // mistakeRate turns an acceptable decision into a poor one: the
            // ball still goes to a teammate, just the wrong one
            var target = pass.player;
            if (Math.random() < (D.mistakeRate || 0)) {
              var sloppy = this.randomMate();
              if (sloppy) target = sloppy;
            }
            M.passTo(me, target, { lead: true, error: this.passError(pressure) });
            this.actionCd = 0.7 * (D.decisionDelay || 1);
            this.dribbleT = 0.15;
            return;
          }
        }
      }
    }

    // 2) SHOOT — only in range with a clear lane
    var dGoal2 = M.distToGoal(me);
    if (this.actionCd <= 0 && this.reactT <= 0 && dGoal2 < M.shootRange(me) &&
        Math.random() < (0.55 + this.desire) * (D.attackingAggression || 1)) {
      if (this.aimClear(goal)) {
        var power = U.lerp(0.7, 1, me.stats.shoot / 10);
        M.shootDirect(me, power, goal, { accuracy: D.shotAccuracy || 1 });
        M.aiShootPulse();
        this.actionCd = 1.2 * (D.decisionDelay || 1);
        this.dribbleT = 0;
        return;
      } else if (this.pressure(2.4) > 0.5) {
        // lane is blocked and we're being closed on: recycle instead of forcing it
        var rec = this.bestPassTarget();
        if (rec && rec.score > 0.45) {
          M.passTo(me, rec.player, { lead: true, error: this.passError(0.35) });
          this.actionCd = 0.7 * (D.decisionDelay || 1);
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
    var dir = this.attDir();
    var mates = M.teamPlayers(me.team);
    var best = null;
    for (var i = 0; i < mates.length; i++) {
      var t = mates[i];
      if (t === me || t.isGoalkeeper) continue;
      var d = t.distTo(me.x, me.z);
      if (d < 1.6) continue;                       // too close = no value to a pass
      if (!M.lineClear(me, t)) continue;           // defender on the lane
      var forward = (t.z - me.z) * dir;            // how far upfield the target is
      var open = M.openness(t, 1 - me.team, 2.6);
      var toGoal = M.distToGoal(t);
      var atMouth = toGoal < 3 ? 0.4 : 0;          // a mate parked on the goal line is a bad idea
      // open + forward is king; long passes are riskier than short ones
      var score = open * (0.6 + forward * 0.045) - d * 0.028 - atMouth;
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
    var carrier = M.ownerPlayer();
    var D = this.difficulty();
    var agg = D.attackingAggression || 1;
    var dir = this.attDir();

    // "s" = progress toward the enemy goal (−20.5 own goal line .. +20.5 theirs)
    var ballS = dir * M.ball.z;
    var cs = carrier ? dir * carrier.z : ballS;
    var cx = carrier ? carrier.x : M.ball.x;
    var push = U.lerp(3, 9, me.stats.speed / 10) * (0.72 + 0.28 * agg);
    var s, x;

    switch (me.idx) {
      case 0:
        // holding man: sits behind the ball, the release valve / shield
        s = U.clamp(ballS - Math.max(8, push), -16, 3);
        x = U.lerp(0, cx, 0.4);
        break;
      case 1:
        // link man: just behind the ball, drifting to the carrier's side
        s = U.clamp(cs - push * 0.55, -12, 10);
        x = U.lerp(-3.5, cx, 0.55);
        break;
      case 2:
      default:
        // forward runner: highest line, hugs the far side to stretch the box
        s = U.clamp(cs + push, 7, 18.5);
        x = (cx >= 0 ? -1 : 1) * U.lerp(3.5, 7.5, me.stats.speed / 12);
        break;
    }

    this.moveTarget = {
      x: U.clamp(x + (U.rand() - 0.5) * 1.6, -11.5, 11.5),
      z: U.clamp(dir * s + (U.rand() - 0.5) * 1.1, -20.5, 20.5),
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
    var D = this.difficulty();
    // pressing: how much room the challenge is given, and how soon the side
    // commits. A passive side stands off and gives the carrier time on the ball.
    var press = D.pressingIntensity || 1;

    if (this.isClosestChaser()) {
      // containment & tackle: approach goalside/shoulder instead of brainless rear-sprinting
      var tx, tz;
      if (carrier) {
        var d = me.distTo(carrier.x, carrier.z);
        // anticipation: meet the attacker where they are GOING, so a quick
        // carrier cannot simply out-run the challenge every time
        var lead = Math.min(0.5, d / Math.max(me.maxSpeed, 1) * 0.55);
        var cx = carrier.x + carrier.vx * lead;
        var cz = carrier.z + carrier.vz * lead;
        // containment point: sit goalside of the carrier, on the ball side
        var gDx = myGoal.x - cx, gDz = myGoal.z - cz;
        var gLen = Math.sqrt(gDx * gDx + gDz * gDz) || 1;
        var stand = Math.min(1.6, 0.45 + d * 0.28) * (1.9 - 0.9 * press);
        tx = cx + (gDx / gLen) * stand;
        tz = cz + (gDz / gLen) * stand;
        this.moveTarget = { x: U.clamp(tx, -12, 12), z: U.clamp(tz, -21, 21) };

        // only challenge when actually in range AND awake to the play — and
        // tryTackle refuses to hand over the ball for a challenge from behind
        var challengeAt = 2.1 * press;
        if (this.reactT > 0) challengeAt = 0;
        if (this.actionCd <= 0 && d < challengeAt) {
          this.attemptTackle(d);
        }
      } else {
        tx = ball.x; tz = ball.z;
        this.moveTarget = { x: tx, z: tz };
        var db = me.distTo(tx, tz);
        if (this.actionCd <= 0 && this.reactT <= 0 && db < 2.25) {
          this.attemptTackle(db);
        }
      }
    } else {
      // cover passing lanes & dangerous attackers. With an AI DEF man the slot
      // order owns the marks (DEF takes the top threat, MID the second, the
      // FWD guards the deep zone); when the human is on DEF the two AI men
      // pick up the top-two threats instead. defensiveAggression decides how
      // high the covering men hold: a passive side drops off toward its own
      // goal and concedes space.
      var sink = U.clamp((1 - (D.defensiveAggression || 1)) * 0.55, -0.3, 0.6);

      // rank the opponent's forward options by threat: close to the carrier
      // AND close to our goal is the pass that kills us
      var marks = [];
      var opps = M.teamPlayers(1 - me.team);
      for (var mi = 0; mi < opps.length; mi++) {
        var mo = opps[mi];
        if (mo === carrier || mo.isGoalkeeper) continue;   // never mark the keeper
        var danger = M.distToGoal(mo) * 0.6 + (carrier ? mo.distTo(carrier.x, carrier.z) : 0);
        marks.push({ o: mo, danger: danger });
      }
      marks.sort(function (a, b) { return a.danger - b.danger; });

      var mine = null;
      if (marks.length) {
        // is OUR DEF slot an AI or the human? When the human is on DEF they
        // never run this module, so the two AI outfielders must take over the
        // top-two marks. When DEF is AI, the slot order (DEF then MID) owns
        // the marks exactly as before and the FWD guards the deep zone.
        var defP = null;
        var matesD = M.teamPlayers(me.team);
        for (var dij = 0; dij < matesD.length; dij++) {
          if (matesD[dij].idx === 0) { defP = matesD[dij]; break; }
        }
        var defIsAi = !!(defP && defP.ai && !defP.isHuman);
        if (defIsAi) {
          if (me.idx === 0) mine = marks[0].o;                    // DEF man: top threat
          else if (me.idx === 1 && marks.length > 1) mine = marks[1].o;  // MID: second
        } else {
          if (me.idx === 1) mine = marks[0].o;                    // MID covers the top threat
          else if (me.idx === 2 && marks.length > 1) mine = marks[1].o;  // FWD: second
        }
      }

      if (mine && carrier) {
        // cut the passing lane between carrier & receiver, leaning goalside
        var lx = (carrier.x + mine.x * 1.3) / 2.3;
        var lz = (carrier.z + mine.z * 1.3) / 2.3;
        lz += (myGoal.z - lz) * 0.3;
        // never let the mark get goal side of me
        if (me.team === 0) lz = Math.max(lz, mine.z + 0.7);
        else lz = Math.min(lz, mine.z - 0.7);
        this.moveTarget = this.sinkTo({
          x: U.clamp(lx, -11.5, 11.5),
          z: U.clamp(lz, -20.5, 20.5),
        }, myGoal, sink);
      } else {
        // zonal cover: hold the line between the ball and our goal, shielding
        // the mouth from cutters — the back four when there is no man to mark
        var lz2 = myGoal.z - this.attDir() * 2.6;
        var lx2 = U.clamp(M.ball.x * 0.7, -7, 7);
        this.moveTarget = this.sinkTo({
          x: U.clamp(lx2 + (U.rand() - 0.5) * 1.8, -11.5, 11.5),
          z: U.clamp(lz2, -20.5, 20.5),
        }, myGoal, sink);
      }
    }
    me.want.tackle = false;
  },

  // Blend a defensive position toward (sink > 0) or away from (sink < 0) our
  // own goal. Identity at sink === 0, so the balanced level is untouched.
  sinkTo: function (pt, goal, sink) {
    if (!sink) return pt;
    return {
      x: LG.Util.clamp(pt.x + (goal.x - pt.x) * sink, -11.5, 11.5),
      z: LG.Util.clamp(pt.z + (goal.z - pt.z) * sink, -20.5, 20.5),
    };
  },

  // ---------- LOOSE BALL ----------
  looseBall: function () {
    var me = this.p;
    var M = LG.Match;
    var U = LG.Util;
    var ball = M.ball;
    var dir = this.attDir();
    var ballS = dir * ball.z;

    // a side that has not read the turnover yet does not pounce on the loose
    // ball — it drops into shape and lets the alert side win it
    if (this.isClosestChaser() && this.reactT <= 0) {
      this.moveTarget = { x: ball.x, z: ball.z };
      return;
    }

    // role-appropriate recovery spot: the DEF holds deep, the MID drops to the
    // ball side for the second ball, the FWD keeps a high outlet so the team
    // can counter from the shape
    var s, x;
    switch (me.idx) {
      case 0:
        s = U.clamp(ballS - 7, -18, -4);
        x = U.clamp(ball.x * 0.5, -7, 7);
        break;
      case 1:
        s = U.clamp(ballS - 2, -12, 9);
        x = U.clamp(ball.x + 3.5, -11.5, 11.5);
        break;
      case 2:
      default:
        s = U.clamp(ballS + 8, 3, 18);
        x = (ball.x >= 0 ? -1 : 1) * 5;
        break;
    }
    this.moveTarget = {
      x: U.clamp(x + (U.rand() - 0.5) * 1.6, -11.5, 11.5),
      z: U.clamp(dir * s + (U.rand() - 0.5) * 1.2, -20.5, 20.5),
    };
  },
};