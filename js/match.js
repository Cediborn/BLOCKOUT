// ============================================================
// MATCH — 3v3 street-football match manager
// ============================================================
var LG = window.LG = window.LG || {};

LG.MatchManager = function (opts) {
  var U = LG.Util;
  var C = LG.Config;

  LG.Match = this;
  this.opts = opts || {};
  this.home = [];          // LG.Player[]
  this.away = [];
  this.all = [];
  this.active = null;      // human-controlled for team 0
  this.ball = new LG.Ball();
  this.arena = null;
  this.camera = null;

  this.state = 'IDLE';     // IDLE | KICKOFF | PLAY | GOAL | END
  this.stateT = 0;
  this.clock = C.match.duration;
  this.score = [0, 0];
  this.possessionTeam = -1;
  this.slowOwner = null;
  this.bus = LG.eventBus;

  this.howEarned = { pass: 0, shot: 0, tackle: 0, goal: 0, time: 0 };
  this.spectatorsReached = false;
  this._autoSwitchT = 0;       // cooldown so automatic switching never fights manual X

  this.buildRosters();
  this.sceneHooks = {};

  // possession glow under the ball
  this.ballGlow = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.6, 24),
    new THREE.MeshBasicMaterial({ color: 0x35e0ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  this.ballGlow.rotation.x = -Math.PI / 2;
  this.ballGlow.position.y = 0.03;
};

LG.MatchManager.prototype = {
  // ------------------------------------------------------------
  buildRosters: function () {
    var O = this.opts;
    var U = LG.Util;
    var playerDef = LG.byId(O.playerId || 'blaze');
    var mateDefs = [playerDef];
    (playerDef.team || []).forEach(function (id) { mateDefs.push(LG.byId(id)); });

    var team0 = this.teamOf(mateDefs, 0);
    var oppIds = U.choose([['blaze', 'cannon', 'volt'], ['stone', 'echo', 'pulse'], ['frenzy', 'brute', 'pulse'], ['volt', 'echo', 'stone'], ['cannon', 'frenzy', 'blaze']]);
    if ((playerDef.team || []).some(function (id) { return oppIds.indexOf(id) >= 0; })) {
      oppIds = ['blaze', 'volt', 'stone'];
      // avoid duplicating the same 3 as player team
    }
    var team1 = this.teamOf(oppIds.map(function (id) { return LG.byId(id); }), 1);

    this.home = team0;
    this.away = team1;
    this.all = team0.concat(team1);
    this.active = team0[0];
    this.active.isHuman = true;

    var i;
    for (i = 0; i < this.all.length; i++) {
      var p = this.all[i];
      p.ai = p.isHuman ? null : new LG.AIBrain(p);
    }

    // attach rings — a clean circular selection ring: thin annulus flat on the
    // ground + a small chevron that points the active player's heading.
    var ringM = new THREE.MeshBasicMaterial({ color: 0x35e0ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
    var ringG = new THREE.RingGeometry(0.66, 0.8, 48);
    var tickM = new THREE.MeshBasicMaterial({ color: 0xdfffff, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false });
    var tickG = new THREE.ConeGeometry(0.11, 0.2, 3);
    for (i = 0; i < this.all.length; i++) {
      var sel = new THREE.Group();
      var ann = new THREE.Mesh(ringG, ringM.clone());
      ann.rotation.x = -Math.PI / 2;
      ann.position.y = 0.045;
      sel.add(ann);
      var tick = new THREE.Mesh(tickG, tickM);
      tick.rotation.x = Math.PI / 2;   // flat on ground, tip pointing forward
      tick.position.set(0, 0.045, 0.73);
      sel.add(tick);
      sel.visible = false;
      sel.userData = { ann: ann, tick: tick };
      this.all[i].ring = sel;
      // aura sprite for abilities
      var auraTex = LG.Util.makeCanvasTexture(function (g, w, h) {
        var grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
        grd.addColorStop(0, 'rgba(255,255,255,0.9)');
        grd.addColorStop(0.5, 'rgba(255,255,255,0.28)');
        grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      }, 64, 64);
      var aura = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 2.6),
        new THREE.MeshBasicMaterial({ map: auraTex, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })
      );
      aura.rotation.x = 0;
      aura.position.y = 1.1;
      aura.visible = false;
      this.all[i].setAura(aura);
    }
  },

  teamOf: function (defs, team) {
    return defs.map(function (d, i) {
      var p = new LG.Player(d, team, i);
      p.isHuman = false;
      return p;
    });
  },

  // ------------------------------------------------------------
  attachScene: function (scene, arena) {
    this.arena = arena;
    this.ball.posts = arena.posts;
    scene.add(this.ball.mesh);
    scene.add(this.ballGlow);
    var i;
    for (i = 0; i < this.all.length; i++) {
      scene.add(this.all[i].model.group);
      scene.add(this.all[i].ring);
      scene.add(this.all[i].auraMesh);
    }
  },

  // evaluate world half — home(0) defends +z, attacks -z
  enemyGoal: function (team) {
    return team === 0 ? { x: 0, z: -LG.Config.court.length / 2 - 0.6 } : { x: 0, z: LG.Config.court.length / 2 + 0.6 };
  },
  myGoal: function (team) {
    return team === 0 ? { x: 0, z: LG.Config.court.length / 2 + 0.6 } : { x: 0, z: -LG.Config.court.length / 2 - 0.6 };
  },
  distToGoal: function (p) {
    var g = this.enemyGoal(p.team);
    return p.distTo(g.x, g.z);
  },
  shootRange: function (p) {
    // better shooters fire sooner & farther
    return 8 + p.stats.shoot * 1.1;
  },
  ownerPlayer: function () {
    for (var i = 0; i < this.all.length; i++) if (this.all[i].hasBall) return this.all[i];
    return null;
  },
  teamPlayers: function (team) { return team === 0 ? this.home : this.away; },
  opponents: function (p) { return this.teamPlayers(1 - p.team); },

  // ------------------------------------------------------------
  start: function () {
    this.state = 'KICKOFF';
    this.stateT = LG.Config.match.kickoffDelay;
    this.clock = LG.Config.match.duration;
    this.score = [0, 0];
    this.placeKickoff();
    this.bus.emit('matchStart', { match: this });
    this.bus.emit('state', { state: 'KICKOFF' });
    LG.Audio.crowd(0.5);
    LG.Audio.sfx.whistle(0.55);
    LG.Audio.sfx.matchStart();
  },

  placeKickoff: function () {
    var halfW = LG.Config.court.width / 2 - 0.6;
    var i;
    var homePos = [[0, 9], [-6, 13], [6, 13]];
    var awayPos = [[0, -9], [-6, -13], [6, -13]];
    for (i = 0; i < 3; i++) {
      this.home[i].x = LG.Util.clamp(homePos[i][0], -halfW + 0.4, halfW - 0.4);
      this.home[i].z = homePos[i][1];
      this.home[i].vx = this.home[i].vz = 0;
      this.home[i].stamina = 1;
      this.home[i].model.group.position.set(this.home[i].x, 0, this.home[i].z);
    }
    for (i = 0; i < 3; i++) {
      this.away[i].x = LG.Util.clamp(awayPos[i][0], -halfW + 0.4, halfW - 0.4);
      this.away[i].z = awayPos[i][1];
      this.away[i].vx = this.away[i].vz = 0;
      this.away[i].model.group.position.set(this.away[i].x, 0, this.away[i].z);
    }
    this.ball.reset(0, 0);
    this.possessionTeam = -1;
    this.owner = null;
    this.slowOwner = null;
    this.bus.emit('kickoff', { match: this });
  },

  // ------------------------------------------------------------
  update: function (dt) {
    this.stateT -= dt;
    var U = LG.Util;

    if (this.ball.noPkT > 0) this.ball.noPkT -= dt;
    if (this.ball.kickT > 0) this.ball.kickT -= dt;
    if (this.ball._guided && this.ball._guided.target && this.ball._guided.target.hasBall) this.ball._guided = null;

    if (this.slowOwner) {
      this.slowOwner.t -= dt;
      if (this.slowOwner.t <= 0) this.slowOwner = null;
    }

    if (this._autoSwitchT > 0) this._autoSwitchT = Math.max(0, this._autoSwitchT - dt);

    switch (this.state) {
      case 'KICKOFF':
        this.updatePlayers(0);
        if (this.stateT <= 0) {
          this.state = 'PLAY';
          this.bus.emit('state', { state: 'PLAY' });
        }
        break;
      case 'GOAL':
        this.updatePlayers(0.4);
        if (this.stateT <= 0) {
          this.state = 'KICKOFF';
          this.stateT = LG.Config.match.kickoffDelay;
          this.placeKickoff();
          this.bus.emit('state', { state: 'KICKOFF' });
        }
        break;
      case 'PLAY':
        this.tickTimer(dt);
        this.updatePlayers(dt);
        if (this.clock <= 0) { this.endMatch(); return; }
        this.resolvePossession();
        this.ball.step(dt, this.arena);
        this.checkGoal();
        this.ticks(dt);
        break;
      case 'END':
        this.updatePlayers(0);
        break;
    }

    this.ballGlow.position.x = this.ball.x;
    this.ballGlow.position.z = this.ball.z;
    var owned = !!this.ownerPlayer();
    this.ballGlow.material.opacity = owned ? (0.5 + Math.sin(this.t * 10) * 0.2) : 0;
    this.t = (this.t || 0) + dt;
  },

  ticks: function (dt) {
    // tiny passive meter fill
    for (var i = 0; i < this.all.length; i++) {
      var p = this.all[i];
      if (!p.meterFull && !p.active) p.fillMeter(dt * 0.014);
      LG.Abilities.tickPerfectPass(p, dt);
    }
  },

  tickTimer: function (dt) {
    var last = this.clock;
    this.clock -= dt;
    if (Math.ceil(this.clock) !== Math.ceil(last) && this.clock > 0 && this.clock < 10) {
      LG.Audio.sfx.whistle(0.1);
    }
    this.bus.emit('clock', { t: this.clock });
  },

  // ------------------------------------------------------------
  updatePlayers: function (dt) {
    var i;
    // decide intents
    for (i = 0; i < this.all.length; i++) {
      var p = this.all[i];
      if (p.isHuman) this.resolveHuman(p, dt);
      else if (p.ai) { p.ai.update(dt); }
    }
    // integrate
    for (i = 0; i < this.all.length; i++) this.all[i].update(dt);
    this.resolvePlayerCollisions();
  },

  // ------------------------------------------------------------
  // HUMAN
  // ------------------------------------------------------------
  resolveHuman: function (h, dt) {
    var inp = LG.Input;
    var mv = inp.moveVec();

    h.want.x = mv.x;
    h.want.z = -mv.y;               // screen-up (y+) => -z (toward away goal)
    h.want.sprint = inp.down('sprint');

    if (inp.pressed('switch')) this.switchPlayer();
    if (inp.pressed('pause')) this.bus.emit('pauseRequested');
    if (inp.pressed('special') && h.meterFull) {
      h.activateAbility();
    }

    if (this.state !== 'PLAY') { h.want.x = h.want.z = 0; h.want.sprint = false; return; }

    if (inp.pressed('pass')) {
      if (h.hasBall) this.humanPass(h);
      this.bus.emit('actionPerformed', { type: 'pass', player: h });
    }
    if (inp.pressed('tackle')) {
      this.tryTackle(h);
    }

    // shoot: charge while held, fire on release
    if (inp.down('shoot')) {
      if (h.hasBall) h.shotCharge = Math.min(1, h.shotCharge + dt * 2.4);
      h.wasShooting = true;
    } else if (h.wasShooting) {
      this.fireHumanShot(h);
      h.shotCharge = 0;
      h.wasShooting = false;
    }
  },

  humanPass: function (h) {
    var t = this.bestHumanPass(h);
    if (t) this.passTo(h, t.player, { lead: true });
  },

  bestHumanPass: function (h) {
    var U = LG.Util;
    var goal = this.enemyGoal(h.team);
    var mates = this.teamPlayers(h.team);
    var best = null;
    for (var i = 0; i < mates.length; i++) {
      var m = mates[i];
      if (m === h) continue;
      var d = m.distTo(h.x, h.z);
      var forward = (m.z - h.z) * (goal.z > 0 ? 1 : -1);
      var open = this.openness(m, 1 - h.team, 2.3);
      var score = open * (1 + forward * 0.12) + U.rand() * 0.5 - d * 0.02;
      if (!best || score > best.score) best = { player: m, score: score };
    }
    // if no teammate good, pass forward into space
    return best;
  },

  fireHumanShot: function (h) {
    this.fireHumanShotReal(h, h.shotCharge);
  },

  release: function (p) {
    if (!p) return;
    p.hasBall = false;
    this.possessionTeam = -1;
  },

  // ------------------------------------------------------------
  // ACTIONS
  // ------------------------------------------------------------
  passTo: function (src, target, opts) {
    var U = LG.Util;
    var ball = this.ball;
    var perfect = LG.Abilities.isPerfectPassReady(src);
    var speed = perfect ? 21 : LG.Config.physics.passPower;
    // optional lead: aim where a moving receiver will be when the ball arrives
    var px = target.x, pz = target.z;
    if (opts && opts.lead) {
      var dx0 = target.x - src.x, dz0 = target.z - src.z;
      var dd0 = Math.sqrt(dx0 * dx0 + dz0 * dz0) || 1;
      var tArr = dd0 / speed;
      px = target.x + target.vx * tArr;
      pz = target.z + target.vz * tArr;
    }
    var sx = px - src.x, sz = pz - src.z;
    var d = Math.sqrt(sx * sx + sz * sz) || 1;
    if (perfect) LG.Abilities.consumePerfectPass(src);
    this.release(src);
    ball.kick((sx / d) * speed, perfect ? 0 : 2.5, (sz / d) * speed);
    if (perfect) ball._guided = { target: target, settle: 0 };
    ball.lastKicker = src;
    ball.kickT = 0.3;
    this.award(src, 'pass', 0.1);
    LG.Audio.sfx.pass();
    LG.Particles.dust(src.x, src.z, 1.6);
    this.bus.emit('pass', { src: src, target: target, perfect: perfect });
    if (perfect) this.bus.emit('perfectPass', { src: src });
  },

  shootDirect: function (p, power, goal) {
    var U = LG.Util;
    var ball = this.ball;
    var perfect = LG.Abilities.isPowerShotReady(p);
    var gx = goal.x + (U.rand() - 0.5) * 1.2 * (1 - p.stats.shoot / 12);
    var gz = goal.z + (U.rand() - 0.5) * 1.2 * (1 - p.stats.shoot / 12);
    var dx = gx - p.x, dz = gz - p.z;
    var d = Math.sqrt(dx * dx + dz * dz) || 1;
    var sp = perfect ? LG.Config.physics.maxBallSpeed * 0.98 : LG.Config.physics.shootPower * power * (0.8 + p.stats.shoot * 0.04);
    this.release(p);
    ball.kick((dx / d) * sp, perfect ? 0.3 : 0.5 + power * 0.5, (dz / d) * sp);
    ball.lastKicker = p;
    ball.kickT = 0.3;
    if (perfect) LG.Abilities.consumePowerShot(p);
    this.award(p, 'shot', 0.12);
    LG.Audio.sfx.kick(sp / LG.Config.physics.maxBallSpeed);
    this.bus.emit('shoot', { player: p, power: power, perfect: perfect });
    if (perfect) {
      LG.Particles.speedLines(p.x, 0.5, p.z, dx / d, dz / d, 0xffb62e, 16);
      this.camera && this.camera.pulse(0.6);
    }
  },

  autoPowerShot: function (p) {
    var goal = this.enemyGoal(p.team);
    var U = LG.Util;
    var dx = goal.x - p.x, dz = goal.z - p.z;
    var d = Math.sqrt(dx * dx + dz * dz) || 1;
    this.release(p);
    this.ball.kick((dx / d) * LG.Config.physics.maxBallSpeed, 0.35, (dz / d) * LG.Config.physics.maxBallSpeed);
    this.ball.lastKicker = p;
    this.ball.kickT = 0.4;
    this.award(p, 'shot', 0.12);
    LG.Particles.speedLines(p.x, 0.5, p.z, dx / d, dz / d, 0xffb62e, 22);
    this.shakeEffect(0.5, 0.5);
    if (this.camera) this.camera.pulse(1.0);
  },

  fireHumanShotReal: function (h, charge) {
    var U = LG.Util;
    var goal = this.enemyGoal(h.team);
    if (h.hasBall) {
      var power = U.lerp(0.35, 1, charge);
      var perfect = LG.Abilities.isPowerShotReady(h);
      var dx = goal.x - h.x, dz = goal.z - h.z;
      var d = Math.sqrt(dx * dx + dz * dz) || 1;
      var a = perfect ? 0.85 : (0.75 + h.stats.shoot * 0.03);
      a *= power;
      var sp = perfect ? LG.Config.physics.maxBallSpeed * 0.96 : LG.Config.physics.shootPower * a * 1.15;
      var aimErr = (1 - h.stats.shoot / 12) * (0.25 * (1 - power) + 0.15);
      dx += (U.rand() - 0.5) * aimErr * d;
      dz += (U.rand() - 0.5) * aimErr * d;
      var dd = Math.sqrt(dx * dx + dz * dz) || 1;
      this.release(h);
      this.ball.kick((dx / dd) * sp, (0.25 + power * 0.35), (dz / dd) * sp);
      this.ball.lastKicker = h;
      this.ball.kickT = 0.35;
      if (perfect) LG.Abilities.consumePowerShot(h);
      this.award(h, 'shot', 0.12);
      if (power > 0.8) { this.shakeEffect(0.25, 0.3); this.camera && this.camera.pulse(0.4); }
      this.bus.emit('shoot', { player: h, power: power, perfect: perfect });
    } else {
      // kick a nearby loose ball toward goal
      this.pokeLoose(h);
    }
  },

  pokeLoose: function (p) {
    var ball = this.ball;
    if (ball.owner) return;
    var dx = ball.x - p.x, dz = ball.z - p.z;
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d < 2.6) {
      var goal = this.enemyGoal(p.team);
      var gx = goal.x - ball.x, gz = goal.z - ball.z;
      var gd = Math.sqrt(gx * gx + gz * gz) || 1;
      ball.kick((gx / gd) * 10, 1.2, (gz / gd) * 10);
      ball.lastKicker = p;
      ball.kickT = 0.2;
      this.bus.emit('shoot', { player: p, power: 0.4 });
    }
  },

  // ------------------------------------------------------------
  tryTackle: function (p) {
    if (p.tackleCd > 0) return;
    p.tackleCd = 0.5;
    var U = LG.Util;
    var opps = this.opponents(p);
    var victim = null, bestD = 1e9;
    var RANGE = 2.3;
    for (var i = 0; i < opps.length; i++) {
      var o = opps[i];
      var d = o.distTo(p.x, p.z);
      // arcade-friendly: any close opponent can be challenged, tighter battles
      // still win the ball more often (see angle/chance below)
      if (d < RANGE && d < bestD) { bestD = d; victim = o; }
    }
    LG.Particles.dust(p.x, p.z, 3);
    LG.Audio.sfx.tackle();

    if (victim) {
      // direction check: tackling into the carrier is rewarded, but a perfectly
      // perpendicular/lean challenge is still a contest (no pixel-perfect needed)
      var dvx = victim.x - p.x, dvz = victim.z - p.z;
      var dd = Math.sqrt(dvx * dvx + dvz * dvz) || 1;
      var face = (dvx / dd) * Math.sin(p.facing) + (dvz / dd) * Math.cos(p.facing);
      var angleMul = U.lerp(0.62, 1.18, Math.max(-0.3, Math.min(1, face))); // behind you is harder
      var closeMul = U.clamp(1.18 - bestD * 0.16, 0.85, 1.18);              // closer = stronger
      var chance = (0.68 + (p.stats.defense - victim.stats.dribble) * 0.05) * angleMul * closeMul;
      chance = U.clamp(chance, 0.45, 0.96);

      if (victim.hasBall && Math.random() < chance) {
        // won the ball -> pop it loose back toward the tackler's momentum
        // so the challenge is rewarded naturally (NOT toward the victim)
        victim.hasBall = false;
        this.possessionTeam = -1;
        this.ball.owner = null;
        this.ball.lastKicker = p;
        this.ball.kickT = 0.2;
        // previous carrier cannot instantly scoop it back
        this.ball.noPk = victim;
        this.ball.noPkT = 0.45;
        var kdx = p.x - victim.x, kdz = p.z - victim.z;
        var kd = Math.sqrt(kdx * kdx + kdz * kdz) || 1;
        var jitter = (this.t || 0) * 17.3 + victim.idx * 4.1;
        this.ball.kick((kdx / kd) * 5.2 + Math.cos(jitter) * 1.2, 2.3 + (U.rand() - 0.3) * 0.6, (kdz / kd) * 5.2 + Math.sin(jitter) * 1.2);
        this.award(p, 'tackle', 0.16);
        this.gainMetersQuickly(p, 0.02);
        this.bus.emit('tackleWin', { src: p, victim: victim });
      }
      victim.stun = Math.max(victim.stun, 0.5);
      victim.stomp = 0.32;
      LG.Particles.burst(victim.x, 0.8, victim.z, 0xffeecc, 14, 4, 4);
      LG.Particles.ring(victim.x, victim.z, 0xfff3c0, 3.4, 0.4);
    } else {
      // lunge at a loose ball
      var bd = p.distTo(this.ball.x, this.ball.z);
      if (bd < 2.2 && !this.ball.owner) {
        this.tryIntercept(p);
      }
    }
    this.bus.emit('tackle', { player: p });
  },

  tryIntercept: function (p) {
    var ball = this.ball;
    if (ball.owner) return;
    ball.vx *= 0.4; ball.vz *= 0.4; ball.vy = 0;
    this.possess(ball, p);
  },

  gainMetersQuickly: function (p, extra) { /* placeholder for combo */ },

  // tackle / ability helpers
  nearestOpponent: function (p, maxD) {
    var opps = this.opponents(p);
    var best = null, bd = maxD || 1e9, d;
    for (var i = 0; i < opps.length; i++) {
      d = opps[i].distTo(p.x, p.z);
      if (d < bd) { bd = d; best = opps[i]; }
    }
    return best;
  },

  superTackle: function (p) {
    var U = LG.Util;
    var opps = this.opponents(p);
    var thrown = false;
    for (var i = 0; i < opps.length; i++) {
      var o = opps[i];
      var d = o.distTo(p.x, p.z);
      if (d < 8) {
        o.stun = Math.max(o.stun, 0.7);
        o.stomp = 0.5;
        var dx = o.x - p.x, dz = o.z - p.z;
        var dd = Math.sqrt(dx * dx + dz * dz) || 1;
        o.x += (dx / dd) * 1.6;
        o.z += (dz / dd) * 1.6;
        if (o.hasBall) { thrown = true; o.hasBall = false; this.possessionTeam = -1; }
        LG.Particles.burst(o.x, 0.8, o.z, 0xff8a4d, 16, 6, 5);
      }
    }
    LG.Particles.ring(p.x, p.z, 0xff8a4d, 10, 0.85);
    LG.Particles.dust(p.x, p.z, 6);
    this.shakeEffect(0.4, 0.5);
    LG.Audio.sfx.special();
    if (thrown) {
      this.ball.lastKicker = p;
      this.ball.kickT = 0.2;
      this.ball.kick(Math.sin(p.facing) * 10, 3, Math.cos(p.facing) * 10);
      this.award(p, 'tackle', 0.16);
      this.bus.emit('tackleWin', { src: p, victim: null });
    }
  },

  shockwave: function (p) {
    var U = LG.Util;
    var opps = this.opponents(p);
    var ball = this.ball;
    for (var i = 0; i < opps.length; i++) {
      var o = opps[i];
      var d = o.distTo(p.x, p.z);
      if (d < 7.5) {
        o.stun = Math.max(o.stun, 0.6);
        var dx = o.x - p.x, dz = o.z - p.z;
        var dd = Math.sqrt(dx * dx + dz * dz) || 1;
        o.x += (dx / dd) * 2.0;
        o.z += (dz / dd) * 2.0;
        if (o.hasBall) { o.hasBall = false; this.possessionTeam = -1; }
      }
    }
    // grab loose ball nearby
    if (!ball.owner && p.distTo(ball.x, ball.z) < 6) {
      this.possess(ball, p);
    }
    LG.Particles.ring(p.x, p.z, 0x7dffbf, 11, 0.9);
    LG.Particles.burst(p.x, 0.5, p.z, 0x7dffbf, 26, 7, 5);
    this.shakeEffect(0.45, 0.5);
    LG.Audio.sfx.special();
  },

  // ------------------------------------------------------------
  // POSSESSION
  // ------------------------------------------------------------
  resolvePossession: function () {
    var ball = this.ball;
    var U = LG.Util;

    // guided pass (perfect/laser)
    if (ball._guided) {
      this.guideBall(ball.dt || 0.016);
      return;
    }

    var i, p, d;
    var R;
    for (i = 0; i < this.all.length; i++) {
      p = this.all[i];
      if (p.hasBall) continue;
      // a freshly-tackled player can't instantly scoop the ball back
      if (ball.noPk === p && ball.noPkT > 0) continue;
      d = p.distTo(ball.x, ball.z);
      R = p.radius + ball.r + 0.06;
      if (d < R) {
        if (ball.owner) continue;      // already moving with an owner elsewhere (shouldn't happen)
        if (ball.lastKicker === p && ball.kickT > 0) continue;  // self-hit protection
        var speed = ball.speed();
        if (speed < 16.5) {
          this.possess(ball, p);
          return;
        } else {
          // bounce off the player
          var nx = (ball.x - p.x) / (d || 1), nz = (ball.z - p.z) / (d || 1);
          ball.vx = nx * ball.speed() * 0.7;
          ball.vz = nz * ball.speed() * 0.7;
          LG.Audio.sfx.tackle();
        }
      }
    }
  },

  possess: function (ball, p) {
    if (p.hasBall) return;
    var before = this.possessionTeam;
    var fromOpponent = (before === 1 - p.team);
    var fromLoose = (before === -1 && this.state === 'PLAY');
    p.hasBall = true;
    ball.owner = p;
    this.possessionTeam = p.team;
    this.gainMetersQuickly(p, 0); // no-op
    this.bus.emit('possession', { player: p });

    // AUTOMATIC SWITCH: when HOME wins the ball back from the opponent (or
    // scoops a loose ball in open play), jump human control straight onto the
    // new carrier so counterattacks feel responsive. Ordinary home<->home
    // passes keep possessionTeam unchanged (before === 0) and never yank
    // control, and the cooldown stops auto-switch from fighting manual X.
    if (p.team === 0 && p !== this.active && this._autoSwitchT <= 0) {
      if (fromOpponent || fromLoose) this.activatePlayer(p, true);
    }
  },

  placeBallOnCarrier: function (p, dt) {
    var ball = this.ball;
    ball.owner = p;
    var ahead = 0.72;
    var bx = p.x + Math.sin(p.facing) * ahead;
    var bz = p.z + Math.cos(p.facing) * ahead;
    var wantY = ball.r + (p.sprinting || p.active ? 0.05 : 0);
    if (p.active && p.active.type === 'DRIBBLE_RUSH') wantY = ball.r + 0.16;
    ball.y = LG.Util.lerp(ball.y, wantY, Math.min(1, dt * 14));
    ball.x = bx;
    ball.z = bz;
    ball.vx = p.vx;
    ball.vz = p.vz;
    ball.vy = 0;
    ball.mesh.position.set(ball.x, ball.y, ball.z);
    this.possessionTeam = p.team;
  },

  guideBall: function (dt) {
    var ball = this.ball;
    var g = ball._guided;
    var t = g.target;
    if (!t) { ball._guided = null; return; }
    var dx = t.x - ball.x, dz = t.z - ball.z;
    var d = Math.sqrt(dx * dx + dz * dz) || 1;
    var speed = Math.max(LG.Config.physics.passPower * 1.35, ball.speed());
    ball.vx = (dx / d) * speed;
    ball.vz = (dz / d) * speed;
    ball.vy *= 0.9;
    ball.y = LG.Util.lerp(ball.y, ball.r + 0.05, Math.min(1, dt * 6));
    ball.mesh.position.set(ball.x, ball.y, ball.z);

    if (d < 0.7) {
      // snap to receiver
      if (t.hasBall === false) {
        this.possess(ball, t);
      }
      ball._guided = null;
    } else {
      ball.x += ball.vx * dt;
      ball.z += ball.vz * dt;
    }
  },

  // ------------------------------------------------------------
  // GOALS
  // ------------------------------------------------------------
  checkGoal: function () {
    var ball = this.ball;
    var C = LG.Config.court;
    var halfL = C.length / 2;
    var gw = C.goalWidth / 2;

    if (Math.abs(ball.x) > gw) return;
    if (ball.y > C.goalHeight + 0.05) return; // over the bar

    var goalZ = null;
    if (ball.z < -halfL) goalZ = 'away';   // north goal is AWAY team's goal -> home scores
    if (ball.z > halfL) goalZ = 'home';    // south goal is HOME's goal -> away scores

    if (!goalZ) return;
    if (ball.lastKicker && ball.lastKicker.team === 0 && goalZ === 'home') return; // own goal not allowed for arcade simplicity
    if (ball.lastKicker && ball.lastKicker.team === 1 && goalZ === 'away') return;

    var scorer = ball.lastKicker;
    var teamGot = goalZ === 'home' ? 1 : 0;  // which team scores
    if (teamGot === 0) this.score[0]++;
    else this.score[1]++;
    this.ball.kickT = 10; // freeze resets
    this.state = 'GOAL';
    this.stateT = LG.Config.match.goalDelay;

    // celebration FX
    var gx = goalZ === 'away' ? -halfL - 0.5 : halfL + 0.5;
    LG.Particles.confetti(ball.x, 2.2, gzOf(goalZ), scorer ? (scorer.team === 0 ? 0x35e0ff : 0xff4d5e) : 0xffffff, 70);
    LG.Particles.ring(ball.x, gzOf(goalZ), 0xffffff, 7, 0.7);
    this.shakeEffect(0.6, 0.7);
    this.camera && this.camera.pulse(1);

    LG.Audio.sfx.goal(teamGot === 0);
    // meter for scoring side
    var scorers = this.teamPlayers(teamGot);
    scorers.forEach(function (pp) { pp.fillMeter(0.3); });
    if (scorer) this.award(scorer, 'goal', 0.3);

    this.bus.emit('goal', { team: teamGot, scorer: scorer, score: [this.score[0], this.score[1]] });

    if (this.score[teamGot] >= 1) {
      // celebration burst
      LG.Particles.confetti(scorer ? scorer.x : 0, 1.5, scorer ? scorer.z : 0, teamGot === 0 ? 0x35e0ff : 0xff4d5e, 44);
    }
  },

  // ------------------------------------------------------------
  endMatch: function () {
    this.state = 'END';
    this.stateT = LG.Config.match.endDelay;
    LG.Audio.crowdStop();
    LG.Audio.sfx.whistle(0.7);
    var won;
    if (this.score[0] > this.score[1]) won = 1;
    else if (this.score[1] > this.score[0]) won = -1;
    else won = 0;

    var base = won === 1 ? 120 : won === 0 ? 60 : 35;
    var adds = this.score[0] * 12 + this.score[1] * 5 + Math.max(0, this.score[0] - this.score[1]) * 8;
    var coins = Math.round((base + adds) / 10) * 10;
    LG.Progression.addCoins(coins);
    LG.Progression.recordResult(this.score[0], this.score[1], won === 1);

    this.bus.emit('matchEnd', {
      score: [this.score[0], this.score[1]],
      won: won,
      coins: coins,
      activeName: this.active.name,
    });
  },

  // ------------------------------------------------------------
  // COLLISIONS & helpers
  // ------------------------------------------------------------
  resolvePlayerCollisions: function () {
    var U = LG.Util;
    var a, b, i, j, dx, dz, d, minD, push;
    for (i = 0; i < this.all.length; i++) {
      a = this.all[i];
      for (j = i + 1; j < this.all.length; j++) {
        b = this.all[j];
        dx = b.x - a.x; dz = b.z - a.z;
        minD = a.radius + b.radius;
        d = Math.sqrt(dx * dx + dz * dz);
        if (d < minD && d > 0.0001) {
          push = (minD - d) * 0.5;
          var nx = dx / d, nz = dz / d;
          var am = a.immovable ? 0 : 1, bm = b.immovable ? 0 : 1;
          var ta = push * (bm === 0 ? 1 : (am === 0 ? 0 : 0.5));
          var tb = push * (am === 0 ? 1 : (bm === 0 ? 0 : 0.5));
          a.x -= nx * ta; a.z -= nz * ta;
          b.x += nx * tb; b.z += nz * tb;
          var rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
          a.vx -= rel * nx * 0.6; a.vz -= rel * nz * 0.6;
          b.vx += rel * nx * 0.6; b.vz += rel * nz * 0.6;
        }
      }
    }
  },

  // AI helpers
  openness: function (p, threatTeam, radius) {
    var opps = this.teamPlayers(threatTeam);
    var score = 1;
    for (var i = 0; i < opps.length; i++) {
      var d = opps[i].distTo(p.x, p.z);
      if (d < radius) score -= (radius - d) / radius * 0.5;
    }
    return Math.max(0.1, score);
  },

  lineClear: function (a, b) {
    var opps = this.opponents(a);
    var ax = a.x, az = a.z, bx = b.x, bz = b.z;
    var len2 = (bx - ax) * (bx - ax) + (bz - az) * (bz - az);
    if (len2 < 0.01) return true;
    for (var i = 0; i < opps.length; i++) {
      var o = opps[i];
      var t = ((o.x - ax) * (bx - ax) + (o.z - az) * (bz - az)) / len2;
      t = LG.Util.clamp(t, 0, 1);
      var cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
      var d = o.distTo(cx, cz);
      if (d < 1.3) return false;
    }
    return true;
  },

  aiShootPulse: function () {
    this._lastAiShoot = LG.Util.now();
  },

  award: function (p, key, amount) {
    if (!p) return;
    p.fillMeter(amount);
  },

  shakeEffect: function (dur, amp) {
    if (this.camera) this.camera.shake(dur, amp);
  },

  showToast: function (msg, dur) {
    if (LG.HUD && LG.HUD.toast) LG.HUD.toast(msg, dur);
  },

  // ------------------------------------------------ PLAYER SWITCHING
  // Make `next` the human-controlled player; AI takes over everyone else.
  activatePlayer: function (next, isAuto) {
    if (!next || !this.home.length) return;
    if (this.active === next) return;
    this.active = next;
    var i, m;
    for (i = 0; i < this.home.length; i++) {
      m = this.home[i];
      m.isHuman = (m === this.active);
      if (m.isHuman) { m.ai = null; }
      else if (!m.ai) { m.ai = new LG.AIBrain(m); }
      // clear leftover inputs so the old human doesn't drift from stale intents
      if (!m.isHuman) { m.want.x = 0; m.want.z = 0; m.want.sprint = false; }
      m.setSelected(m === this.active);
    }
    // a cooldown (longer after auto) stops automatic switching from ping-ponging
    // control right back; a manual switch also suppresses auto for a beat.
    this._autoSwitchT = isAuto ? 1.4 : 0.8;
    this.bus.emit('switchPlayer', { player: this.active, auto: !!isAuto });
  },

  // Manual switch (X / E / Tab / mobile SWITCH): pick the most useful teammate
  // for the current situation instead of cycling blindly.
  switchPlayer: function () {
    if (!this.home.length) return;
    var cur = this.active;
    var ball = this.ball;
    var carrier = this.ownerPlayer();
    var goalEnemy = this.enemyGoal(0);    // home = team 0
    var goalMine = this.myGoal(0);
    var best = null, bscore = -1e9;
    var i;

    for (i = 0; i < this.home.length; i++) {
      var p = this.home[i];
      if (p === cur) continue;
      var sc = 0;
      var dBall = p.distTo(ball.x, ball.z);

      if (this.possessionTeam === 1) {
        // DEFENDING: get on the threat — closest to the carrier/ball wins,
        // lightly biased goalside so we don't abandon the goal line.
        var dangerX = (carrier && carrier.team === 1) ? carrier.x : ball.x;
        var dangerZ = (carrier && carrier.team === 1) ? carrier.z : ball.z;
        sc = -p.distTo(dangerX, dangerZ);
        sc -= p.distTo(goalMine.x, goalMine.z) * 0.08;
      } else if (this.possessionTeam === 0) {
        // ATTACKING: grab the carrier right away, otherwise an open, advanced
        // player already heading toward goal.
        if (p.hasBall) sc += 50;
        sc -= dBall * 0.5;
        sc += this.openness(p, 1, 2.6) * 6;
        sc += (goalEnemy.z > 0 ? p.z : -p.z) * 0.4;  // ahead = better
      } else {
        // LOOSE BALL: closest teammate to the ball is the obvious pick.
        sc = -dBall;
      }

      if (sc > bscore) { bscore = sc; best = p; }
    }

    if (!best) {
      // fallback: next in lineup
      var idx = Math.max(0, this.home.indexOf(cur));
      best = this.home[(idx + 1) % this.home.length];
    }
    this.activatePlayer(best, false);
  },

  showToastInit: function (el) { /* hud owns toasts */ },

  // ------------------------------------------------------------
  selectActive: function () {
    if (!this.home.length) return;
    if (!this.active) this.active = this.home[0];
    var i, m;
    for (i = 0; i < this.home.length; i++) {
      m = this.home[i];
      m.isHuman = (m === this.active);
      if (m.isHuman) { m.ai = null; }
      else if (!m.ai) { m.ai = new LG.AIBrain(m); }
      m.setSelected(m === this.active);
    }
    this.bus.emit('switchPlayer', { player: this.active });
  },
};

// helper
function gzOf(goalZ) {
  var C = LG.Config.court;
  return goalZ === 'away' ? -C.length / 2 - 0.5 : C.length / 2 + 0.5;
}