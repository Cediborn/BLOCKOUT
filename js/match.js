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
  this._autoSwitchT = 0;       // cooldown so automatic switching never fights a manual switch
  this._ctrlMode = null;       // last control mode shown on the on-screen buttons
  this._switchedThisFrame = false;  // once-per-frame manual switch (loop re-resolves)

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

    // Apply outfit color to human team if selected
    var outfit = O.outfitColor;
    if (outfit) {
      mateDefs = mateDefs.map(function(d) {
        var clone = JSON.parse(JSON.stringify(d));
        clone.palette = JSON.parse(JSON.stringify(clone.palette));
        clone.palette.shirt = outfit.color;
        clone.palette.shoe = outfit.color;
        return clone;
      });
    }

    var team0 = this.teamOf(mateDefs, 0);
    var oppIds = U.choose([['blaze', 'cannon', 'volt'], ['stone', 'echo', 'pulse'], ['frenzy', 'brute', 'pulse'], ['volt', 'echo', 'stone'], ['cannon', 'frenzy', 'blaze']]);
    if ((playerDef.team || []).some(function (id) { return oppIds.indexOf(id) >= 0; })) {
      oppIds = ['blaze', 'volt', 'stone'];
      // avoid duplicating the same 3 as player team
    }

    // Apply opponent kit color if selected (independent of the human kit)
    var awayKit = O.awayColor;
    var awayDefs = oppIds.map(function (id) { return LG.byId(id); });
    if (awayKit) {
      awayDefs = awayDefs.map(function (d) {
        var clone = JSON.parse(JSON.stringify(d));
        clone.palette = JSON.parse(JSON.stringify(clone.palette));
        clone.palette.shirt = awayKit.color;
        clone.palette.shoe = awayKit.color;
        return clone;
      });
    }
    var team1 = this.teamOf(awayDefs, 1);

    // one dedicated goalkeeper per team (outfield stays 3v3)
    team0.push(this.makeGoalkeeper(0));
    team1.push(this.makeGoalkeeper(1));

    this.home = team0;
    this.away = team1;
    this.all = team0.concat(team1);
    this.active = team0[0];
    this.active.isHuman = true;

    var i;
    for (i = 0; i < this.all.length; i++) {
      this.ensureAI(this.all[i]);
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

  // Guarded AI attachment: a goalkeeper always gets the dedicated keeper
  // brain, outfield players get the normal match brain, humans get none.
  ensureAI: function (p) {
    if (p.isHuman) { p.ai = null; return; }
    if (!p.ai) {
      p.ai = p.isGoalkeeper ? new LG.KeeperBrain(p) : new LG.AIBrain(p);
    }
  },

  // Goalkeeper roster definition — a functionally-distinct "keeper" role
  // with a high-visibility kit (gloves via def.body.gloves).
  makeGoalkeeper: function (team) {
    var def = {
      id: team === 0 ? 'guard' : 'wall',
      name: team === 0 ? 'GUARD' : 'WALL',
      role: 'GOALKEEPER',
      emoji: '🧤',
      stats: { speed: 5, shoot: 4, pass: 8, dribble: 3, defense: 9, stamina: 8 },
      ability: null,
      body: { wide: 1.15, tall: 1.06, gloves: team === 0 ? 0xffffff : 0x1a1e26 },
      palette: team === 0 ?
        { skin: 0xd99f72, hair: 0x20242c, shirt: 0x2ee65a, trim: 0xffffff, pants: 0x141a12, shoe: 0x171c14 } :
        { skin: 0x8a5a3c, hair: 0x1d2026, shirt: 0xffa62e, trim: 0x2b1500, pants: 0x23201a, shoe: 0x181c22 },
    };
    // away keeper wears the selected opponent kit if there is one
    if (team === 1 && this.opts.awayColor) {
      def.palette.shirt = this.opts.awayColor.color;
      def.palette.shoe = this.opts.awayColor.color;
    }
    var p = new LG.Player(def, team, 3);
    p.isHuman = false;
    p.isGoalkeeper = true;
    return p;
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
  // shortest distance from point (px,pz) to the segment (ax,az)-(bx,bz)
  segToPoint: function (ax, az, bx, bz, px, pz) {
    var abx = bx - ax, abz = bz - az;
    var l2 = abx * abx + abz * abz;
    if (l2 < 1e-8) return Math.sqrt((px - ax) * (px - ax) + (pz - az) * (pz - az)); // degenerate
    var t = ((px - ax) * abx + (pz - az) * abz) / l2;
    t = LG.Util.clamp(t, 0, 1);
    var cx = ax + abx * t, cz = az + abz * t;
    var dx = px - cx, dz = pz - cz;
    return Math.sqrt(dx * dx + dz * dz);
  },
  // Is a one-frame ball segment genuine flight (swept collision should judge it)
  // or a reset/teleport (kickoff, goal reset, snap-to-carrier — must be ignored)?
  // Resets snap the ball across the pitch with zero velocity; real flight covers
  // ~speed*dt per frame. The guard is judged off the ACTUAL speed, so a long
  // frame (low FPS / coarse physics step) still registers the hit — otherwise a
  // full-speed strike phases through a body the moment dt grows.
  isGenuineFlight: function (segLen2) {
    var sp = this.ball.speed();
    var dt = this._dt || (1 / 60);
    if (sp < 0.5) return segLen2 < 0.81;       // slow/loose: only short real rolls
    var maxMove = sp * dt * 1.6 + 0.3;
    return segLen2 <= maxMove * maxMove;
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

  // Who should be chasing the ball for a team? Re-evaluated on a cadence set by
  // the difficulty's playerSwitchSpeed, then cached per team, so the whole
  // back line agrees on whose job it is. A passive side is slow to hand the
  // chase to the teammate who is actually closest; a sharp side switches at
  // once. Nothing here touches speed, position or the ball — it is decision
  // making only.
  chaserOf: function (team) {
    var D = LG.Difficulty.forTeam(team);
    var speed = Math.max(0.2, D.playerSwitchSpeed || 1);
    var interval = 0.26 / speed;
    var cache = this._chaser || (this._chaser = {});
    var c = cache[team];
    var now = this.t || 0;
    if (c && c.p && now - c.t < interval && !c.p.hasBall) return c.p;
    var players = this.teamPlayers(team);
    var ball = this.ball;
    var best = null, bd = 1e9;
    for (var i = 0; i < players.length; i++) {
      if (players[i].isGoalkeeper) continue;   // the keeper never chases
      var d = players[i].distTo(ball.x, ball.z);
      if (d < bd) { bd = d; best = players[i]; }
    }
    cache[team] = { p: best, t: now };
    return best;
  },

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
    var i, p, pos;
    var homePos = [[0, 9], [-6, 13], [6, 13]];
    var awayPos = [[0, -9], [-6, -13], [6, -13]];
    for (i = 0; i < this.home.length; i++) {
      p = this.home[i];
      if (p.isGoalkeeper) { this.repositionGoalkeeper(p); continue; }
      pos = homePos[i % homePos.length];
      p.x = LG.Util.clamp(pos[0], -halfW + 0.4, halfW - 0.4);
      p.z = pos[1];
      p.vx = p.vz = 0;
      p.stamina = 1;
      p.model.group.position.set(p.x, 0, p.z);
    }
    for (i = 0; i < this.away.length; i++) {
      p = this.away[i];
      if (p.isGoalkeeper) { this.repositionGoalkeeper(p); continue; }
      pos = awayPos[i % awayPos.length];
      p.x = LG.Util.clamp(pos[0], -halfW + 0.4, halfW - 0.4);
      p.z = pos[1];
      p.vx = p.vz = 0;
      p.stamina = 1;
      p.model.group.position.set(p.x, 0, p.z);
    }
    this.ball.reset(0, 0);
    this.possessionTeam = -1;
    this.owner = null;
    this.slowOwner = null;
    this.bus.emit('kickoff', { match: this });
  },

  // Reset a goalkeeper to their own goal mouth, facing the field.
  repositionGoalkeeper: function (p) {
    var halfL = LG.Config.court.length / 2;
    p.x = 0;
    p.z = p.team === 0 ? halfL - 0.8 : -halfL + 0.8;
    p.vx = p.vz = 0;
    p.facing = p.team === 0 ? Math.PI : 0;   // toward the field
    p.stamina = 1;
    p.distributeT = 0;
    p.model.group.position.set(p.x, p.y, p.z);
    p.model.group.rotation.y = p.facing;
  },

  // ------------------------------------------------------------
  update: function (dt) {
    this.stateT -= dt;
    this._dt = dt;   // frame length — swept-collision guards are speed-aware
    this._switchedThisFrame = false;
    this.updateControlMode();
    var U = LG.Util;

    if (this.ball.noPkT > 0) this.ball.noPkT -= dt;
    if (this.ball.kickT > 0) this.ball.kickT -= dt;
    if (this.ball.intendedT > 0) {
      this.ball.intendedT -= dt;
      if (this.ball.intendedT <= 0) this.ball.intendedReceiver = null;
    }
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
        // remember where the ball was BEFORE the step — a fast ball can cross
        // the goal plane between frames and needs the whole segment judged
        this._ballPrevX = this.ball.x;
        this._ballPrevZ = this.ball.z;
        this._ballPrevY = this.ball.y;
        this.ball.step(dt, this.arena);
        this.updateKeepers(dt);    // goalkeepers save/parry BEFORE the goal check
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
  // Screen input -> world movement. PORTRAIT maps 1:1 (screen-right = +x,
  // screen-up = -z toward the away goal). The LANDSCAPE camera looks across
  // the pitch from the east touchline, so there screen-right = -z (still the
  // attack direction!) and screen-up = -x (toward the far side) — the stick
  // always follows the SCREEN, so controls feel identical in both views while
  // the world underneath is never altered. Pure function so the harness can
  // pin the mapping for both views.
  screenToWorldMove: function (mv) {
    var land = !!(LG.Settings && LG.Settings.isLandscape && LG.Settings.isLandscape());
    if (land) return { x: -mv.y, z: -mv.x };
    return { x: mv.x, z: -mv.y };
  },

  resolveHuman: function (h, dt) {
    var inp = LG.Input;
    var mv = inp.moveVec();
    var wv = this.screenToWorldMove(mv);

    h.want.x = wv.x;
    h.want.z = wv.z;
    h.want.sprint = inp.down('sprint');

    if (inp.pressed('pause')) this.bus.emit('pauseRequested');
    if (inp.pressed('special') && h.meterFull) {
      h.activateAbility();
    }

    if (this.state !== 'PLAY') { h.want.x = h.want.z = 0; h.want.sprint = false; return; }

    // CONTEXT-SENSITIVE CONTROLS — one control does both jobs depending on who
    // has the ball. While MY team carries it (any teammate, not just the human)
    // the pass/shoot keys and buttons are PASS | SHOOT. While the opponent
    // carries it the same presses become SWITCH | TACKLE. The dedicated switch
    // and tackle keys are gone — nothing duplicates the contextual action.
    var attack = this.currentPossessionTeam() === h.team;

    if (attack) {
      if (inp.pressed('pass')) {
        if (h.hasBall) this.humanPass(h);
        this.bus.emit('actionPerformed', { type: 'pass', player: h });
      }
      // shoot: charge while held, fire on release
      if (inp.down('shoot')) {
        if (h.hasBall) h.shotCharge = Math.min(1, h.shotCharge + dt * (LG.Config.physics.shootChargeRate || 2.8));
        h.wasShooting = true;
      } else if (h.wasShooting) {
        this.fireHumanShot(h);
        h.shotCharge = 0;
        h.wasShooting = false;
      }
    } else {
      // a charge interrupted when the ball was lost must not misfire later
      if (h.wasShooting) { h.wasShooting = false; h.shotCharge = 0; }
      // PASS/attack-key presses now switch players; SHOOT/attack-key = tackle.
      // A switch must fire once per frame: the loop re-resolves whoever just
      // became active, who would otherwise see the SAME switch edge and flip
      // straight back.
      if ((inp.pressed('switch') || inp.pressed('pass')) && !this._switchedThisFrame) {
        this._switchedThisFrame = true;
        this.switchPlayer();
      }
      if (inp.pressed('tackle') || inp.pressed('shoot')) this.tryTackle(h);
    }
  },

  // The team that effectively has the ball for the control-mode decision. A
  // ball in flight has no OWNER but is far from neutral: the last kicker still
  // directs play, so OUR lofted pass or shot must NOT flip the buttons to
  // SWITCH|TACKLE while it is in the air. Only a truly never-touched ball
  // falls back to the neutral (-1) mode.
  currentPossessionTeam: function () {
    var b = this.ball;
    if (b.owner) return b.owner.team;
    if (this.possessionTeam >= 0) return this.possessionTeam;
    if (b.lastKicker) return b.lastKicker.team;
    return -1;
  },

  // Reflect the current possession state on the on-screen controls: PASS | SHOOT
  // when our team has the ball, SWITCH | TACKLE when the opponent does. Runs
  // once per change (cheap no-op the rest of the time).
  updateControlMode: function () {
    var attack = this.currentPossessionTeam() === (this.active ? this.active.team : 0);
    var mode = attack ? 'attack' : 'defend';
    if (this._ctrlMode === mode) return;
    this._ctrlMode = mode;
    if (typeof LG.HUD === 'object' && typeof LG.HUD.setControlMode === 'function') {
      LG.HUD.setControlMode(mode);
    }
  },

  // Aim-based passing: the pass goes where the player is pointing. Direction
  // dominates the score, so "I pointed at that player" always holds — it is
  // never a lottery between the mathematically nearest options.
  humanPass: function (h) {
    var t = this.directionalPassTarget(h, h.aimDir());
    if (!t) t = this.bestHumanPass(h);
    if (t) {
      var press = this.pressure(h, 3.2);
      var err = press * (1 - h.stats.pass / 12) * 0.45;
      this.passTo(h, t.player, { lead: true, error: err });
    }
  },

  directionalPassTarget: function (h, aim) {
    var U = LG.Util;
    var goal = this.enemyGoal(h.team);
    aim = aim || h.aimDir();
    var dirX = aim.x, dirZ = aim.z;
    var mates = this.teamPlayers(h.team);
    var best = null, fallback = null, i, m;
    for (i = 0; i < mates.length; i++) {
      m = mates[i];
      if (m === h || m.isGoalkeeper) continue;
      var d = m.distTo(h.x, h.z);
      if (d < 0.9) continue;                        // a mate on our toes isn't a pass
      var tx = m.x - h.x, tz = m.z - h.z;
      var td = Math.sqrt(tx * tx + tz * tz) || 1;
      var dot = (tx * dirX + tz * dirZ) / td;       // alignment with the aim line
      if (dot < 0.2) continue;                      // never force a blind back-pass
      var forward = (m.z - h.z) * (goal.z > 0 ? 1 : -1);
      var open = this.openness(m, 1 - h.team, 2.3);
      var score = dot * 0.75 + open * 0.15 + U.clamp(forward * 0.04, -0.15, 0.25) - d * 0.012;
      if (!fallback || d < fallback.d) fallback = { player: m, score: score, d: d };
      if (!best || score > best.score) best = { player: m, score: score, d: d };
    }
    // direction is king; only fall back to "nearest mate" when nothing at all
    // is anywhere near the aim line (dot >= 0.2 gracefully covers 78° cones)
    return best || fallback;
  },

  // 0..1 how much a player is being closed down (shared by human + AI passes)
  pressure: function (p, radius) {
    var opps = this.opponents(p);
    var min = 1e9;
    for (var i = 0; i < opps.length; i++) {
      var d = opps[i].distTo(p.x, p.z);
      if (d < min) min = d;
    }
    if (min > radius) return 0;
    return Math.min(1, (radius - min) / radius);
  },

  bestHumanPass: function (h) {
    var U = LG.Util;
    var goal = this.enemyGoal(h.team);
    var mates = this.teamPlayers(h.team);
    var best = null;
    for (var i = 0; i < mates.length; i++) {
      var m = mates[i];
      if (m === h || m.isGoalkeeper) continue;
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
  // Launch speed for a pass of a given distance. Rolling friction eats about
  // half the ball's speed every second, so a single fixed power died short of
  // any pass beyond ~20m — which is exactly why long balls and the keeper's
  // distribution drifted "in the general direction" and never arrived. Solve
  // the speed from the distance instead, with a small cushion, so the ball
  // reaches the intended teammate with legs left over.
  passSpeedFor: function (dist) {
    var P = LG.Config.physics;
    return LG.Util.clamp(
      dist * (P.passSpeedPerM || 1.15) + (P.passSpeedBase || 2.6),
      P.passSpeedMin || 6.5,
      P.maxBallSpeed * 0.95
    );
  },

  // How long a struck ball actually takes to cover `dist`. The ball hops for a
  // moment (weak air drag) and then rolls against heavy friction, so the naive
  // dist/speed estimate is badly short: a 14m pass takes ~1.05s, not (14/18.7)=
  // 0.75s. Using the naive number aimed the lead a metre or two behind any
  // moving receiver. Returns Infinity when the ball dies before arriving.
  ballTravelTime: function (dist, speed, vy) {
    var P = LG.Config.physics;
    var kAir = -60 * Math.log(P.airDrag || 0.994);
    var kRoll = -60 * Math.log(P.groundDrag || 0.984);
    var g = Math.abs(P.gravity) || 17;
    if (!(speed > 0.01)) return Infinity;
    var tAir = 2 * Math.max(0, vy || 0) / g;
    var dAir = speed * (1 - Math.exp(-kAir * tAir)) / kAir;
    if (dist <= dAir) return -Math.log(1 - dist * kAir / speed) / kAir;
    var v = speed * Math.exp(-kAir * tAir);
    var rest = dist - dAir;
    if (rest * kRoll >= v) return Infinity;
    return tAir + (-Math.log(1 - rest * kRoll / v) / kRoll);
  },

  passTo: function (src, target, opts) {
    var U = LG.Util;
    var ball = this.ball;
    var perfect = LG.Abilities.isPerfectPassReady(src);
    var d = src.distTo(target.x, target.z);
    // contextual power: quick for short, stronger for long — no input gymnastics
    var speed = this.passSpeedFor(d);
    var vy = perfect ? 0 : 2.2;
    var px = target.x, pz = target.z;
    if (opts && opts.lead) {
      // Meet the runner where they will actually be. The lead TIME comes from
      // how long the ball really takes, not from dist/speed; the aim point is
      // still a fixed straight-line target, so a pass never homes onto anyone.
      // Two passes of the estimate converge (each one re-solves the power).
      for (var it = 0; it < 2; it++) {
        var tGo = this.ballTravelTime(src.distTo(px, pz), speed, vy);
        if (!isFinite(tGo)) tGo = 0.5;
        tGo = U.clamp(tGo, 0, 1.1);                 // a sensible lead, never a chase
        var nx = U.clamp(target.x + target.vx * tGo, -12.5, 12.5);
        var nz = U.clamp(target.z + target.vz * tGo, -21.5, 21.5);
        if (Math.abs(nx - px) < 0.03 && Math.abs(nz - pz) < 0.03) { px = nx; pz = nz; break; }
        px = nx;
        pz = nz;
        speed = this.passSpeedFor(src.distTo(px, pz));
      }
    }
    if (opts && opts.power) speed *= opts.power;
    if (perfect) speed = Math.max(speed, 22);
    var sx = px - src.x, sz = pz - src.z;
    var dd = Math.sqrt(sx * sx + sz * sz) || 1;
    // pressure error rotates the direction slightly — predictable, no magic
    if (opts && opts.error) {
      var err = U.clamp(opts.error, 0, 0.7) * (perfect ? 0.15 : 1);
      var ang = Math.atan2(sx, sz) + (Math.random() - 0.5) * 2 * err;
      sx = Math.sin(ang) * dd;
      sz = Math.cos(ang) * dd;
    }
    if (perfect) LG.Abilities.consumePerfectPass(src);
    this.release(src);
    ball.kick((sx / dd) * speed, perfect ? 0 : 2.2, (sz / dd) * speed);
    src.kickAnim = 1;
    if (perfect) ball._guided = { target: target, settle: 0 };
    // the pass BELONGS to its receiver for a moment: they can take it cleanly
    // even at pace, while everyone else still has to knock it down
    ball.intendedReceiver = target;
    ball.intendedT = LG.Config.physics.passIntentTime || 1.5;
    ball.lastKicker = src;
    ball.kickT = 0.3;
    this.award(src, 'pass', 0.1);
    LG.Audio.sfx.pass();
    LG.Particles.dust(src.x, src.z, 1.6);
    this.bus.emit('pass', { src: src, target: target, perfect: perfect });
    if (perfect) this.bus.emit('perfectPass', { src: src });
  },

  shootDirect: function (p, power, goal, opts) {
    var U = LG.Util;
    var ball = this.ball;
    var perfect = LG.Abilities.isPowerShotReady(p);
    // spread across the whole mouth: good shooters pick their spot, weaker ones
    // spray it around the goalkeeper instead of always hitting the middle.
    // Difficulty divides the spray — a sloppy side misses the target far more
    // often, a sharp side picks its corner. The physics of the strike are
    // identical at every level, so a Hard shot is never a magic rocket.
    var acc = (opts && opts.accuracy != null) ? opts.accuracy : 1;
    var spray = (1 - p.stats.shoot / 12) / (acc || 1);
    var gx = goal.x + (U.rand() - 0.5) * 2.3 * spray;
    var gz = goal.z + (U.rand() - 0.5) * 1.2 * spray;
    var dx = gx - p.x, dz = gz - p.z;
    var d = Math.sqrt(dx * dx + dz * dz) || 1;
    var sp = perfect ? LG.Config.physics.maxBallSpeed * 0.98 : LG.Config.physics.shootPower * power * (0.8 + p.stats.shoot * 0.04);
    this.release(p);
    ball.kick((dx / d) * sp, perfect ? 0.3 : 0.5 + power * 0.5, (dz / d) * sp);
    p.kickAnim = 1;
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
    p.kickAnim = 1;
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
      var R = LG.Config;
      var P = R.physics;
      var C = R.court;
      // tap = controlled finish, full charge = a genuine strike. The spread is
      // wide enough that the two really do feel different.
      var power = U.lerp(P.shotPowerTap || 0.42, P.shotPowerFull || 1, charge);
      var perfect = LG.Abilities.isPowerShotReady(h);
      // aim: the live stick/body direction, projected onto the goal line, so the
      // shot picks out a post or the middle instead of drifting at the keeper
      var aim = h.aimDir();
      var dirX = aim.x, dirZ = aim.z;
      var gz = goal.z;
      var gx = goal.x;
      // aiming into the attacking half projects onto the goal line and the
      // result is clamped to the mouth, so "aim at the right post" lands on the
      // right post instead of being nudged back at the keeper
      if (dirZ * (goal.z > 0 ? 1 : -1) > 0.12) {
        var t = (gz - h.z) / dirZ;
        if (t > 0) {
          gx = U.clamp(h.x + dirX * t, -C.goalWidth / 2 * 0.95, C.goalWidth / 2 * 0.95);
        }
      }
      var dx = gx - h.x, dzl = gz - h.z;
      var d = Math.sqrt(dx * dx + dzl * dzl) || 1;
      var a = perfect ? 0.97 : (0.82 + h.stats.shoot * 0.03);
      var sp = perfect ? P.maxBallSpeed * 0.97 : P.shootPower * 1.08 * a * (0.55 + power * 0.62);
      // running shots carry the player's momentum and stay on the aim line
      dx += h.vx * 0.22;
      dzl += h.vz * 0.22;
      var dd = Math.sqrt(dx * dx + dzl * dzl) || 1;
      // accuracy: good shooters & calm feet are tidy; pressure adds wobble
      var aimErr = (1 - h.stats.shoot / 12) * (0.045 + power * 0.1) + this.pressure(h, 3.0) * 0.09;
      var ang = Math.atan2(dx, dzl) + (U.rand() - 0.5) * 2 * aimErr;
      var sx = Math.sin(ang) * dd, szl = Math.cos(ang) * dd;
      this.release(h);
      this.ball.kick((sx / dd) * sp, (0.18 + power * 0.26), (szl / dd) * sp);
      h.kickAnim = 1;
      this.ball.lastKicker = h;
      this.ball.kickT = 0.35;
      if (perfect) LG.Abilities.consumePowerShot(h);
      this.award(h, 'shot', 0.12);
      // shot feedback: a real strike reads louder and heavier than a pass,
      // without throwing the camera around
      if (power > 0.72) {
        this.shakeEffect(0.22, 0.24);
        this.camera && this.camera.pulse(0.32);
      }
      if (power > 0.85 || perfect) {
        LG.Particles.speedLines(h.x, 0.5, h.z, sx / dd, szl / dd, 0xffffff, power > 0.95 ? 10 : 6);
      }
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
      p.kickAnim = 1;
      ball.lastKicker = p;
      ball.kickT = 0.2;
      this.bus.emit('shoot', { player: p, power: 0.4 });
    }
  },

  // ------------------------------------------------------------
  // TACKLING — rewards reaching the BALL from a legitimate angle.
  // Shared by the human and the AI: no asymmetric rules anywhere.
  tryTackle: function (p, opts) {
    if (p.tackleCd > 0) return;
    p.tackleCd = 0.5;
    // Difficulty scales only how well an AI times its challenge. The human
    // always attacks the ball at full ability, and the angle rules below are
    // identical in both directions — no asymmetric tackling anywhere.
    var acc = (opts && opts.accuracy != null) ? opts.accuracy : 1;
    var U = LG.Util;
    var P = LG.Config.physics;
    var opps = this.opponents(p);
    var ball = this.ball;
    var bx = ball.x, bz = ball.z;
    var victim = null, bestD = 1e9, bestDb = 1e9;
    var RANGE = P.tackleRange || 2.4;
    var BRANGE = P.tackleBallRange || 2.5;
    var dbToBall = p.distTo(bx, bz);
    for (var i = 0; i < opps.length; i++) {
      var o = opps[i];
      var d = o.distTo(p.x, p.z);
      // must be within reach of BOTH the carrier and the ball
      if (d < RANGE && dbToBall < BRANGE && d < bestD) { bestD = d; bestDb = dbToBall; victim = o; }
    }
    LG.Particles.dust(p.x, p.z, 3);
    LG.Audio.sfx.tackle();

    if (victim) {
      var dvx = victim.x - p.x, dvz = victim.z - p.z;   // tackler -> carrier
      var dd = Math.sqrt(dvx * dvx + dvz * dvz) || 1;
      // 1) is the challenge actually going THROUGH the ball?  face ~ +1 when
      // the lunging direction points at the ball.
      var bdx = bx - p.x, bdz = bz - p.z;
      var bd = Math.sqrt(bdx * bdx + bdz * bdz) || 1;
      var face = (bdx / bd) * Math.sin(p.facing) + (bdz / bd) * Math.cos(p.facing);
      var angleMul = U.lerp(0.4, 1.3, Math.max(-0.5, Math.min(1, face)));
      var closeMul = U.clamp(1.15 - bestDb * 0.16, 0.85, 1.15);
      var chance = (0.66 + (p.stats.defense - victim.stats.dribble) * 0.04) * angleMul * closeMul * acc;

      // 2) WHERE is the challenge coming from? Front = the tackler is on the
      // ball side of the carrier (great tackle). Rear = the tackler is behind
      // the carrier, away from the ball: no clean steal, only a bump. The ball
      // (carried in front of the body) is the reference, so this stays correct
      // even when the carrier is standing still with a stale facing.
      var fx = bx - victim.x, fz = bz - victim.z;
      var fl = Math.sqrt(fx * fx + fz * fz);
      var rear;
      if (fl > 0.05) {
        rear = ((victim.x - p.x) * (fx / fl) + (victim.z - p.z) * (fz / fl)) / dd;
      } else {
        var vDirX = Math.sin(victim.facing), vDirZ = Math.cos(victim.facing);
        rear = (dvx * vDirX + dvz * vDirZ) / dd;
      }
      if (rear > 0.25) {
        // from behind: possession is never simply handed over
        chance = Math.min(chance, P.tackleRearBlock || 0.04);
      } else if (rear < -0.2) {
        chance *= 1.15;            // meeting the carrier head-on is a fair fight
      }
      chance = U.clamp(chance, 0.04, 0.96);

      // goalkeepers in possession are protected
      if (victim.isGoalkeeper && victim.distributeT > 0) chance = Math.min(chance, 0.18);

      var won = victim.hasBall && Math.random() < chance;
      if (won) {
        victim.hasBall = false;
        this.possessionTeam = -1;
        this.ball.owner = null;
        this.ball.lastKicker = p;
        this.ball.kickT = 0.18;
        this.ball.noPk = victim;
        this.ball.noPkT = 0.4;
        this.ball.intendedReceiver = null;
        // short, contestable knock — NOT a teleport
        var kdx = p.x - victim.x, kdz = p.z - victim.z;
        var kd = Math.sqrt(kdx * kdx + kdz * kdz) || 1;
        var jitter = (this.t || 0) * 17.3 + victim.idx * 4.1;
        this.ball.kick((kdx / kd) * 4.4 + Math.cos(jitter) * 1.4, 1.2 + (U.rand() - 0.3) * 0.4, (kdz / kd) * 4.4 + Math.sin(jitter) * 1.4);
        victim.stun = Math.max(victim.stun, 0.35);
        this.award(p, 'tackle', 0.16);
        this.gainMetersQuickly(p, 0.02);
        this.bus.emit('tackleWin', { src: p, victim: victim });
      } else {
        // a failed challenge is contact, not a freeze: the carrier stumbles for
        // a moment and play keeps flowing
        victim.stun = Math.max(victim.stun, P.tackleBumpStun || 0.12);
      }
      victim.stomp = Math.max(victim.stomp, won ? 0.3 : 0.14);
      LG.Particles.burst(victim.x, 0.8, victim.z, 0xffeecc, won ? 12 : 6, 4, 4);
      if (won) LG.Particles.ring(victim.x, victim.z, 0xfff3c0, 3.2, 0.4);
    } else {
      var bd2 = p.distTo(bx, bz);
      if (bd2 < 2.0 && !ball.owner) {
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
    var P = LG.Config.physics;
    for (i = 0; i < this.all.length; i++) {
      p = this.all[i];
      if (p.hasBall) continue;
      // a freshly-tackled player can't instantly scoop the ball back
      if (ball.noPk === p && ball.noPkT > 0) continue;
      d = p.distTo(ball.x, ball.z);
      R = p.radius + ball.r + 0.06;
      // swept contact: a fast ball can cross a standing body entirely within a
      // single frame, so judge the whole segment (prev -> now), not just the
      // endpoint — otherwise a rocket skips right over a defender's feet.
      // The sweeping radius is the TRUE body contact (no control slack): the
      // pickup radius above is a generous "reach out and grab it" circle, but a
      // ball passing through a player's body mid-flight must physically contact
      // that body — a fat tube around everyone would block every attack.
      var onSeg = d < R;
      if (!onSeg && this._ballPrevX !== undefined && this._ballPrevZ !== undefined) {
        var sdx = ball.x - this._ballPrevX, sdz = ball.z - this._ballPrevZ;
        var segLen2 = sdx * sdx + sdz * sdz;
        // only a genuine in-flight segment counts (a kickoff/goal reset moves the
        // ball many metres instantly and must not be judged as motion). The guard
        // is now speed-aware: a fast ball moving ~speed*dt each frame stays
        // "genuine" even on a long, low-FPS frame and still touches the body it
        // flies through.
        if (this.isGenuineFlight(segLen2)) {
          var contact = p.radius + ball.r;
          onSeg = this.segToPoint(this._ballPrevX, this._ballPrevZ, ball.x, ball.z, p.x, p.z) < contact;
        }
      }
      if (onSeg) {
        if (ball.owner) continue;      // already moving with an owner elsewhere (shouldn't happen)
        if (ball.lastKicker === p && ball.kickT > 0) continue;  // self-hit protection
        var speed = ball.speed();
        // the player a pass was aimed at takes it cleanly even when it is
        // travelling fast; anyone else has to knock a hard ball down first
        var limit = (ball.intendedReceiver === p)
          ? (P.passReceiveSpeed || 24)
          : (P.looseBallControl || 16.5);
        if (speed < limit) {
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
    ball.intendedReceiver = null;
    ball.intendedT = 0;
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
    if (p.team === 0 && p !== this.active && !p.isGoalkeeper && this._autoSwitchT <= 0) {
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
  // GOALKEEPERS — shot detection, saves, parries
  // ------------------------------------------------------------

  // signed goal-line the keeper defends (team0 defends +z, team1 defends -z)
  gkLine: function (gk) {
    var halfL = LG.Config.court.length / 2;
    return gk.team === 0 ? halfL : -halfL;
  },

  // Is an inbound, unowned ball realistically threatening this keeper's goal?
  // Returns prediction data {px, pz, dist0, sp} or null.  dist0 is the signed
  // distance to the line (>=0 in front, small negative = just past it).
  keeperThreat: function (gk) {
    var ball = this.ball;
    var C = LG.Config.court;
    var K = LG.Config.keeper;
    if (!ball || ball.owner) return null;
    var line = this.gkLine(gk);
    var sign = gk.team === 0 ? 1 : -1;
    var vzT = ball.vz * sign;
    if (vzT < 1.0) return null;                          // not heading this way (yet)
    var dist0 = (line - ball.z) * sign;                  // front of the line = positive
    // How early a keeper picks up the flight of the ball is their reaction.
    var seeMul = 0.62 + 0.38 * (LG.Difficulty.forTeam(gk.team).goalkeeperReaction || 1);
    if (dist0 > K.seeDist * seeMul) return null;         // too early to react
    if (dist0 < -K.saveWindow) return null;              // fully over the line = goal
    if (ball.y > C.goalHeight + 0.05) return null;       // over the bar
    var tt = Math.max(0, dist0) / vzT;
    var px = ball.x + ball.vx * tt;
    if (Math.abs(px) > C.goalWidth / 2 + 1.4) return null; // heading wide
    var pz = line - sign * 0.1;
    return { px: px, pz: pz, dist0: dist0, sp: ball.speed3() };
  },

  // 0..1 save likelihood — harder/placed shots and closer shots beat the
  // keeper more often.  Rerolled once per kick, not per frame.
  keeperSaveChance: function (gk, th) {
    var U = LG.Util;
    var C = LG.Config.court;
    var K = LG.Config.keeper;
    var gw = C.goalWidth / 2;
    var sp = th.sp;
    var reaction = U.clamp(th.dist0 / Math.max(sp, 6) / K.rxnWindow, 0, 1);
    var hard = U.clamp((sp - 12) / 20, 0, 1);
    var centered = U.clamp(1 - Math.abs(th.px) / (gw * 1.15), 0.15, 1);
    var agility = U.clamp(1.4 - Math.abs(gk.x - th.px) * 0.38, 0.15, 1);
    // Reflex roll on top of the keeper's physical block: placed shots beat the
    // keeper, a shot straight at him does not, and pace always helps the shooter
    var chance = (0.42 + reaction * 0.26) * (0.5 + centered * 0.4) * (0.5 + agility * 0.35) - hard * 0.1;
    // difficulty multiplies the reflex roll — never the shot's flight
    chance *= (LG.Difficulty.forTeam(gk.team).goalkeeperSaveAbility || 1);
    return U.clamp(chance, 0.03, 0.92);
  },

  // Per-frame keeper pass: run save prediction + one-shot save roll.
  // A keeper already holding the ball skips this (he is distributing).
  updateKeepers: function (dt) {
    var ball = this.ball;
    var K = LG.Config.keeper;
    var i, gk;
    for (i = 0; i < this.all.length; i++) {
      gk = this.all[i];
      if (!gk.isGoalkeeper || gk.hasBall) continue;
      var th = this.keeperThreat(gk);
      if (!th) continue;
      // The reflex roll arms at a FIXED distance from the line. It used to arm
      // on first sight instead, which meant a keeper with a longer sight radius
      // (a better keeper) rolled while still standing at his spot — punishing
      // good reactions for being early. Skill now decides WHERE he gets to,
      // never WHEN the roll happens.
      if (th.dist0 > K.commitDist) continue;
      // one save roll per kick (shooter + kick sequence) so a keeper can't
      // "win the lottery" by rolling multiple frames on the same shot
      var sig = (ball.lastKicker ? 'p' + ball.lastKicker.idx + '.' + ball.lastKicker.team : 'n') + '-' + (ball._kickSeq || 0);
      // a keeper who just made a save needs a beat to get back set: within the
      // SAME kick sequence a loose rebound can beat him before he recovers.
      // A new kick (fresh attack) always resets the clock.
      if (gk._recoverT > 0) gk._recoverT = Math.max(0, gk._recoverT - dt);
      if (gk._saveSig !== sig) { gk._saveSig = sig; gk._saveRoll = Math.random(); gk._recoverT = 0; }
      if (gk._recoverT > 0) continue;
      if (gk._saveRoll < this.keeperSaveChance(gk, th)) {
        this.doKeeperSave(gk, th);
        continue;
      }
      // PHYSICAL BODY BLOCK — the reflex roll is the keeper READING the shot
      // (which a corner-bound shot can genuinely beat), but a ball that
      // actually crosses AROUND the keeper and slams into his body is stopped:
      // he is not a ghost. Judge the whole segment the ball travelled this
      // frame, so a full-speed strike crossing in a single step is still halted.
      var pAx = (this._ballPrevX !== undefined) ? this._ballPrevX : ball.x;
      var pAz = (this._ballPrevZ !== undefined) ? this._ballPrevZ : ball.z;
      var bgx = ball.x - pAx, bgz = ball.z - pAz;
      var bSeg2 = bgx * bgx + bgz * bgz;
      var reach = gk.radius + ball.r + 0.06;
      // (speed-aware: a kickoff/goal teleport is not real motion, but a fast
      // ball that moved a metre this frame — a coarse low-FPS frame — still is,
      // and must still be stopped when it crosses the keeper's body: a keeper
      // in front of a central shot is not a ghost)
      if (this.isGenuineFlight(bSeg2) && this.segToPoint(pAx, pAz, ball.x, ball.z, gk.x, gk.z) <= reach) {
        this.doKeeperSave(gk, th);
      }
    }
  },

  // Stop the shot at the mouth: catch (possess → distribute) or parry wide.
  doKeeperSave: function (gk, th) {
    var U = LG.Util;
    var ball = this.ball;
    var C = LG.Config.court;
    var line = this.gkLine(gk);
    var sign = gk.team === 0 ? 1 : -1;
    var K = LG.Config.keeper;
    // NOTE: the save roll is NOT re-armed here. One roll per kick (see the sig
    // in updateKeepers) — re-rolling every frame turned every shot into a save.

    // fast shots + lucky parries knock it clear instead of a clean catch
    if (th.sp > 19 || Math.random() < 0.3) {
      ball._guided = null;
      ball.lastKicker = gk;                       // own-goal protection for the parry
      if (ball.noPk !== gk) { ball.noPk = ball.lastKicker; ball.noPkT = 0.5; }
      ball.x = U.clamp(ball.x, -C.goalWidth / 2, C.goalWidth / 2);
      ball.z = line - sign * 0.12;
      ball.y = ball.r;
      ball.vy = 1.5 + Math.random() * 0.8;
      // deflect it AWAY from the middle — punch toward the nearest wing or, for
      // a shot through the middle, the side the keeper is already diving toward.
      // A straight-out parry sat the ball up on the penalty spot for the rebound.
      var side = Math.abs(th.px) < 0.8 ? (Math.random() < 0.5 ? -1 : 1) : (th.px > 0 ? 1 : -1);
      ball.vx = side * (4 + Math.random() * 3);
      ball.vz = -sign * (5 + Math.random() * 3);
      ball.mesh.position.set(ball.x, ball.y, ball.z);
      this.possessionTeam = -1;
      gk._recoverT = 0.6;                         // scramble before the next save
    } else {
      // clean catch: freeze, hold, then distribute
      ball._guided = null;
      ball.x = U.clamp(ball.x, -C.goalWidth / 2, C.goalWidth / 2);
      ball.z = line - sign * 0.07;
      ball.y = ball.r;
      ball.vx = ball.vy = ball.vz = 0;
      ball.mesh.position.set(ball.x, ball.y, ball.z);
      gk.distributeT = K.distributeDelay;
      this.possess(ball, gk);
    }

    // visible/audible feedback for the save
    LG.Particles.ring(ball.x, ball.z, 0xffffff, 4, 0.5);
    LG.Particles.dust(ball.x, ball.z, 3.2);
    LG.Audio.sfx.tackle();
    this.shakeEffect(0.2, 0.22);
    this.bus.emit('keeperSave', { gk: gk, parry: !gk.hasBall });
  },

  // ------------------------------------------------------------
  // GOALS
  // ------------------------------------------------------------
  checkGoal: function () {
    var ball = this.ball;
    var C = LG.Config.court;
    var halfL = C.length / 2;
    var gw = C.goalWidth / 2;
    var r = ball.r;

    // a fast ball can cross the goal plane between frames, so judge the whole
    // step: the highest the ball got (bar clearance) and the farthest the
    // segment reached (goal line). prevZ/prevY are captured before ball.step.
    var prevZ = (this._ballPrevZ !== undefined) ? this._ballPrevZ : ball.z;
    var prevY = (this._ballPrevY !== undefined) ? this._ballPrevY : ball.y;

    // mouth check is center-based with a little body allowance: the ball can
    // ride just past the post plane when it is still physically inside the goal
    if (Math.abs(ball.x) > gw + r * 0.5) return;
    if (Math.max(prevY, ball.y) > C.goalHeight + 0.05) return; // over the bar

    var goalZ = null;
    if (prevZ >= -halfL && ball.z <= -halfL) goalZ = 'away';  // north goal: home scores
    else if (prevZ <= halfL && ball.z >= halfL) goalZ = 'home';  // south goal: away scores
    if (!goalZ) {
      // already parked in the net from an earlier frame that slipped the check
      if (ball.z < -halfL) goalZ = 'away';
      else if (ball.z > halfL) goalZ = 'home';
    }

    if (!goalZ) return;

    // Goal attribution is by NET: whichever goal the ball crossed into, the
    // OTHER team scores. A genuine own goal counts too — a defender's deflection
    // or a keeper's parry that trickles over the line is a real goal for the
    // attacking side. (It used to be swallowed, which left the ball dead in the
    // net with no goal event and no reset — the match simply stalled.) The
    // individual scorer is only credited when their own team gained the goal.
    var src = ball.lastKicker;
    var defensiveTeam = goalZ === 'home' ? 0 : 1;   // keeper who owns that net
    var teamGot = goalZ === 'home' ? 1 : 0;          // which team scores
    var isOwnGoal = !!(src && src.team === defensiveTeam);
    var scorer = (!isOwnGoal && src && src.team === teamGot) ? src : null;

    if (teamGot === 0) this.score[0]++;
    else this.score[1]++;
    this.ball.kickT = 10; // freeze resets
    this.state = 'GOAL';
    this.stateT = LG.Config.match.goalDelay;

    // celebration FX
    var gx = goalZ === 'away' ? -halfL - 0.5 : halfL + 0.5;
    LG.Particles.confetti(ball.x, 2.2, gzOf(goalZ), teamGot === 0 ? 0x35e0ff : 0xff4d5e, 70);
    LG.Particles.ring(ball.x, gzOf(goalZ), 0xffffff, 7, 0.7);
    this.shakeEffect(0.6, 0.7);
    this.camera && this.camera.pulse(1);

    LG.Audio.sfx.goal(teamGot === 0);
    // meter for scoring side
    var scorers = this.teamPlayers(teamGot);
    scorers.forEach(function (pp) { pp.fillMeter(0.3); });
    if (scorer) this.award(scorer, 'goal', 0.3);

    this.bus.emit('goal', { team: teamGot, scorer: scorer, isOwnGoal: !!isOwnGoal, score: [this.score[0], this.score[1]] });

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
      var o = opps[i];
      if (o.isGoalkeeper) continue;   // a keeper sitting in goal isn't pressure
      var d = o.distTo(p.x, p.z);
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
      if (o.isGoalkeeper) continue;
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
    if (next.isGoalkeeper) return;          // the human never takes the keeper
    if (this.active === next) return;
    this.active = next;
    var i, m;
    for (i = 0; i < this.home.length; i++) {
      m = this.home[i];
      m.isHuman = (m === this.active) && !m.isGoalkeeper;
      if (m.isHuman) { m.ai = null; }
      else { this.ensureAI(m); }
      // clear leftover inputs so the old human doesn't drift from stale intents
      if (!m.isHuman) { m.want.x = 0; m.want.z = 0; m.want.sprint = false; }
      m.setSelected(m === this.active);
    }
    // a cooldown (longer after auto) stops automatic switching from ping-ponging
    // control right back; a manual switch also suppresses auto for a beat.
    this._autoSwitchT = isAuto ? 1.4 : 0.8;
    this.bus.emit('switchPlayer', { player: this.active, auto: !!isAuto });
  },

  // Manual switch (PASS/I press on mobile / mobile SWITCH button — the context
  // keys while the OPPONENT has the ball): pick the most useful teammate for the
  // current situation instead of cycling blindly.
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
      if (p === cur || p.isGoalkeeper) continue;
      var sc = 0;
      var dBall = p.distTo(ball.x, ball.z);
      // time-to-reach beats raw distance: a quick teammate on a slightly longer
      // path is a more useful pick than a slow one standing beside the ball
      var pace = Math.max(1, p.maxSpeed * (p.stamina > 0.15 ? 1 : 0.85));
      var tReach = dBall / pace;

      if (this.possessionTeam === 1) {
        // DEFENDING: get on the threat — soonest to the carrier/ball wins,
        // lightly biased goalside so we don't abandon the goal line.
        var dangerX = (carrier && carrier.team === 1) ? carrier.x : ball.x;
        var dangerZ = (carrier && carrier.team === 1) ? carrier.z : ball.z;
        sc = -(p.distTo(dangerX, dangerZ) / pace) * 1.8;
        sc -= p.distTo(goalMine.x, goalMine.z) * 0.08;
      } else if (this.possessionTeam === 0) {
        // ATTACKING: grab the carrier right away, otherwise an open, advanced
        // player already heading toward goal.
        if (p.hasBall) sc += 50;
        sc -= tReach * 2.4;
        sc += this.openness(p, 1, 2.6) * 6;
        sc += (goalEnemy.z > 0 ? p.z : -p.z) * 0.4;  // ahead = better
      } else {
        // LOOSE BALL: whoever can actually get there first is the pick.
        sc = -tReach * 4;
      }

      if (sc > bscore) { bscore = sc; best = p; }
    }

    if (!best) {
      // fallback: next OUTFIELD player in lineup (never the keeper)
      var idx = Math.max(0, this.home.indexOf(cur));
      var k, nxt;
      for (k = 1; k <= this.home.length; k++) {
        nxt = this.home[(idx + k) % this.home.length];
        if (!nxt.isGoalkeeper) { best = nxt; break; }
      }
    }
    this.activatePlayer(best, false);
  },

  showToastInit: function (el) { /* hud owns toasts */ },

  // ------------------------------------------------------------
  selectActive: function () {
    if (!this.home.length) return;
    if (!this.active || this.active.isGoalkeeper) this.active = this.home[0];
    var i, m;
    for (i = 0; i < this.home.length; i++) {
      m = this.home[i];
      m.isHuman = (m === this.active) && !m.isGoalkeeper;
      if (m.isHuman) { m.ai = null; }
      else { this.ensureAI(m); }
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