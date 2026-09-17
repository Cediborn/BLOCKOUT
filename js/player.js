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
  this.accel = 30;
  this.sprintMul = 1.55;

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
  this.immovable = false;   // WALL ability

  this.isHuman = false;
  this.ai = null;

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

  // sprint / stamina
  var wantsSprint = this.want.sprint && this.active && this.active.type === 'WALL' ? false : this.want.sprint;
  var sprinting = wantsSprint && this.stamina > 0.02 && Math.abs(this.want.x) + Math.abs(this.want.z) > 0.01;
  if (sprinting) this.stamina = Math.max(0, this.stamina - dt * 0.32);
  else this.stamina = Math.min(1, this.stamina + dt * 0.14);
  this.sprinting = sprinting;

  // desired velocity
  var mv = this.want.x * this.maxSpeed * this.speedMul() * (sprinting ? this.sprintMul : 1);
  var mz = this.want.z * this.maxSpeed * this.speedMul() * (sprinting ? this.sprintMul : 1);

  if (this.immovable) { mv = 0; mz = 0; }

  // acceleration toward desired
  var k = Math.min(1, dt * this.accel / this.maxSpeed);
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

  // autorotate via movement dir
  var sp = this.vx * this.vx + this.vz * this.vz;
  if (sp > 0.04) {
    var target = Math.atan2(this.vx, this.vz);
    // facing is rotation.y of the model; character model faces +Z at rot 0
    this.facing = U.angleLerp(this.facing, target, Math.min(1, dt * 14));
  }

  this.phase += dt * (2.2 + sp * 0.55);
  var speedFrac = Math.min(1, Math.sqrt(sp) / this.maxSpeed);

  LG.Models.animateChar(this.model, speedFrac > 0.08, this.phase, speedFrac);

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

  // ring pulse
  if (this.ring) {
    this.ring.position.set(this.x, 0.04, this.z);
    var sc = 1 + Math.sin(this.phase * 1.6) * 0.12;
    this.ring.scale.set(sc, sc, 1);
    this.ring.rotation.y += dt * 1.5;
  }
};

LG.Player.prototype.faceBallLoose = function () {
  // slight lean toward loose ball while idle-ish
};

// ---------- ability ----------
LG.Player.prototype.fillMeter = function (amount) {
  if (this.meterFull || this.active) return;
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
