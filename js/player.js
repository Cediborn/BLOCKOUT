// ============================================================
// PLAYER — one football character (shared by human + AI)
// ============================================================
var LG = window.LG = window.LG || {};

LG.Player = function (def, team, idx) {
  var U = LG.Util;
  this.def = def;
  this.id = def.id;
  this.name = def.name;
  this.team = team;          // 0 = home (player), 1 = away
  this.idx = idx;
  this.stats = def.stats;

  this.maxSpeed = 5.0 + this.stats.speed * 0.34;
  this.accel = LG.Config.physics.playerAccel || 52;   // responsive: no skating, no drag
  this.sprintMul = LG.Config.physics.sprintMul || 1.55;

  var wide = (def.body && def.body.wide) || 1;
  this.radius = 0.42 * wide;
  this.height = 1.62 * ((def.body && def.body.tall) || 1);

  this.model = LG.Models.buildCharacter(def);
  this.x = 0; this.z = 0;
  this.y = 0;               // for buffs / effects lifts
  this.vx = 0; this.vz = 0;
  this.facing = U.rand() * Math.PI * 2;
  this.phase = U.rand() * 6.3;

  this.stamina = 1;
  this.meter = 0;           // special meter 0..1
  this.meterFull = false;
  this.active = null;       // {type, t, id} current ability effect
  this.activeColor = 0xffffff;

  this.hasBall = false;
  this.shotCharge = 0;
  this.wasShooting = false;
  this.tackleCd = 0;
  this.stun = 0;
  this.stomp = 0;           // small jump effect on tackle hit
  this.kickAnim = 0;        // 1 -> 0 strike pose timer (set whenever we kick)
  this.immovable = false;   // WALL ability

  this.isHuman = false;
  this.isGoalkeeper = false;  // dedicated keeper — never human-controlled
  this.ai = null;
  this.distributeT = 0;       // keeper hold time before distributing possession

  // per-frame intents (written by controller/AI)
  this.want = { x: 0, z: 0, sprint: false, pass: false, shoot: false, tackle: false, special: false };

  // selection ring (match attaches)
  this.ring = null;
  this.auraMesh = null;
};

LG.Player.prototype.setupModel = function () {
  // used to reposition model group once
  this.model.group.position.set(this.x, this.y, this.z);
};

LG.Player.prototype.setAura = function (mesh) {
  this.auraMesh = mesh;
};

LG.Player.prototype.speedMul = function () {
  var m = 1;
  if (this.active && this.active.type === 'BURST') m *= 1.9;
  if (this.active && this.active.type === 'DRIBBLE_RUSH') m *= 1.3;
  if (this.active && this.active.type === 'WALL') m = 0;
  if (LG.Match && LG.Match.slowOwner && LG.Match.slowOwner.team !== this.team && LG.Match.slowOwner.t > 0) m *= 0.55;
  if (this.hasBall) m *= 0.86;
  if (this.stun > 0) m = 0;
  return m;
};

LG.Player.prototype.update = function (dt) {
  var U = LG.Util;

  this.tackleCd = Math.max(0, this.tackleCd - dt);
  this.stun = Math.max(0, this.stun - dt);
  this.stomp = Math.max(0, this.stomp - dt);
  this.kickAnim = Math.max(0, this.kickAnim - dt * 5);

  // sprint / stamina
  var P = LG.Config.physics;
  var wantsSprint = this.want.sprint && this.active && this.active.type === 'WALL' ? false : this.want.sprint;
  var moving = Math.abs(this.want.x) + Math.abs(this.want.z) > 0.01;
  // empty the tank and you jog until you have recovered a little — no flickering
  // between sprint and walk, and never a speed penalty below normal pace
  if (this._sprintLocked && this.stamina > 0.45) this._sprintLocked = false;
  var canSprint = this._sprintLocked ? false : this.stamina > 0.02;
  var sprinting = wantsSprint && moving && canSprint;
  if (sprinting) {
    this.stamina = Math.max(0, this.stamina - dt * (P.sprintDrain || 0.2));
    if (this.stamina <= 0.02) this._sprintLocked = true;
  } else {
    // stamina comes back slower while you keep mashing SPRINT
    var regen = (wantsSprint && moving) ? 0.5 : 1;
    this.stamina = Math.min(1, this.stamina + dt * (P.sprintRecover || 0.22) * regen);
  }
  this.sprinting = sprinting;

  // desired velocity
  var mv = this.want.x * this.maxSpeed * this.speedMul() * (sprinting ? this.sprintMul : 1);
  var mz = this.want.z * this.maxSpeed * this.speedMul() * (sprinting ? this.sprintMul : 1);

  if (this.immovable) { mv = 0; mz = 0; }

  // acceleration toward desired: DIRECT input response, but released sticks
  // brake harder so the player plants instead of gliding past the ball.
  var accelRate = this.accel * (moving ? 1 : (P.stopBoost || 1.8));
  var k = Math.min(1, dt * accelRate / this.maxSpeed);
  this.vx = U.lerp(this.vx, mv, k);
  this.vz = U.lerp(this.vz, mz, k);

  this.x += this.vx * dt;
  this.z += this.vz * dt;

  // court bounds
  var C = LG.Config.court;
  var halfW = C.width / 2 - this.radius - 0.02;
  var halfL = C.length / 2 - 0.25;
  var gw = C.goalWidth / 2;
  this.x = U.clamp(this.x, -halfW, halfW);
  if (Math.abs(this.x) < gw) {
    // inside goal mouth: allowed slightly into the net zone
    this.z = U.clamp(this.z, -halfL - C.goalDepth * 0.85, halfL + C.goalDepth * 0.85);
    // push back out of the net pocket
    if (this.z < -halfL - C.goalDepth * 0.8 && Math.abs(this.x) < gw) this.z = -halfL - C.goalDepth * 0.8;
    if (this.z > halfL + C.goalDepth * 0.8 && Math.abs(this.x) < gw) this.z = halfL + C.goalDepth * 0.8;
  } else {
    this.z = U.clamp(this.z, -halfL, halfL);
  }

  // autorotate via movement dir — fast turn so the body (and the ball) points
  // where the player is heading without feeling sluggish
  var sp = this.vx * this.vx + this.vz * this.vz;
  if (sp > 0.04) {
    var target = Math.atan2(this.vx, this.vz);
    // facing is rotation.y of the model; character model faces +Z at rot 0
    this.facing = U.angleLerp(this.facing, target, Math.min(1, dt * 16));
  }

  this.phase += dt * (2.2 + sp * 0.55);
  var speedFrac = Math.min(1, Math.sqrt(sp) / this.maxSpeed);

  LG.Models.animateChar(this.model, speedFrac > 0.08, this.phase, speedFrac, this.kickAnim);

  this.model.group.position.set(this.x, this.y, this.z);
  this.model.group.rotation.y = this.facing;

  // carry the ball if owner
  if (this.hasBall && LG.Match) {
    LG.Match.placeBallOnCarrier(this, dt);
  }

  // effects while ability is active
  if (this.active) {
    this.active.t -= dt;
    if (this.active.t <= 0) {
      this.onAbilityEnd();
    } else if (this.active.type === 'BURST') {
      var tx = Math.sin(this.facing), tz = Math.cos(this.facing);
      LG.Particles.trail(this.x - tx * 0.4, 0.3, this.z - tz * 0.4, tx, tz, 0x35e0ff);
    } else if (this.active.type === 'DRIBBLE_RUSH') {
      LG.Particles.trail(this.x, 0.3, this.z, this.vx, this.vz, 0x62ff8a);
    } else if (this.active.type === 'WALL') {
      LG.Particles.trail(this.x, 0.2, this.z, 0, 0, 0xc9c9d1);
    }
  }

  if (!this.hasBall) this.faceBallLoose();

  // selection ring: keeps its true circular shape, hugs the ground under the
  // player, chevron points the heading, and only the opacity pulses so it
  // reads as a crisp marker instead of a wobbling blob.
  if (this.ring) {
    this.ring.position.set(this.x, 0, this.z);
    this.ring.rotation.y = this.facing;
    var ann = this.ring.userData ? this.ring.userData.ann : null;
    if (ann && ann.material) ann.material.opacity = 0.78 + Math.sin(this.phase * 2.2) * 0.18;
  }
};

LG.Player.prototype.faceBallLoose = function () {
  // slight lean toward loose ball while idle-ish
};

// The direction this player is ACTUALLY asking to go right now, in world space.
// Live stick/keys beat the smoothed body rotation, so a pass or shot leaves in
// the direction the player is pointing instead of where the model happened to
// be turning a moment ago. AI players write the same `want` fields.
LG.Player.prototype.aimDir = function () {
  var mx = this.want.x, mz = this.want.z;
  var m = Math.sqrt(mx * mx + mz * mz);
  if (m > 0.25) return { x: mx / m, z: mz / m };
  return { x: Math.sin(this.facing), z: Math.cos(this.facing) };
};

// ---------- ability ----------
LG.Player.prototype.fillMeter = function (amount) {
  if (this.isGoalkeeper || this.meterFull || this.active) return;
  this.meter = Math.min(1, this.meter + amount);
  if (this.meter >= 1) {
    this.meterFull = true;
    this.meter = 1;
    LG.eventBus.emit('abilityReady', this);
  }
};

LG.Player.prototype.activateAbility = function () {
  if (!this.meterFull || this.active) return;
  var def = LG.Abilities[this.def.ability];
  this.active = { type: this.def.ability, t: def.dur, id: this.def.ability };
  this.activeColor = def.color;
  this.meter = 0;
  this.meterFull = false;
  LG.eventBus.emit('abilityActivated', this);
  LG.Abilities.run(this); // gameplay effect hook
};

LG.Player.prototype.onAbilityEnd = function () {
  var type = this.active.type;
  this.active = null;
  if (type === 'WALL') this.immovable = false;
  LG.eventBus.emit('abilityEnd', { player: this, type: type });
};

// ---------- help ----------
LG.Player.prototype.distTo = function (x, z) {
  var dx = x - this.x, dz = z - this.z;
  return Math.sqrt(dx * dx + dz * dz);
};

// ring visuals
LG.Player.prototype.setSelected = function (on) {
  if (this.ring) this.ring.visible = !!on;
};
