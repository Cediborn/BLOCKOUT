// ============================================================
// BALL — real physics: roll, bounce, spin, walls, posts
// ============================================================
var LG = window.LG = window.LG || {};

LG.Ball = function () {
  var C = LG.Config.court;
  var P = LG.Config.physics;
  this.r = C.ballRadius;
  this.x = 0; this.y = C.ballRadius; this.z = 0;
  this.vx = 0; this.vy = 0; this.vz = 0;
  this.mesh = LG.Models.buildBall();
  this.mesh.position.set(0, C.ballRadius, 0);
  this.owner = null;          // player id currently controlling the ball
  this.lastHolderTeam = null; // who to credit kickoff after out
  this.noPk = null;           // player temporarily blocked from picking the ball up
  this.noPkT = 0;
  this.atRest = true;
  this.spin = 0;
  this.container = null;
  this.posts = [];            // {x,z} set by arena
};

LG.Ball.prototype = {
  reset: function (x, z) {
    this.x = x; this.z = z !== undefined ? z : 0;
    this.y = this.r;
    this.vx = this.vy = this.vz = 0;
    this.owner = null;
    this.noPk = null;
    this.noPkT = 0;
    this.atRest = true;
    this._kickSeq = (this._kickSeq || 0) + 1;   // invalidate old keeper save rolls
    if (this.mesh) this.mesh.position.set(this.x, this.y, this.z);
  },

  speed: function () { return Math.sqrt(this.vx * this.vx + this.vz * this.vz); },
  speed3: function () { return Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz); },

  kick: function (vx, vy, vz) {
    this._kickSeq = (this._kickSeq || 0) + 1;
    var max = LG.Config.physics.maxBallSpeed;
    var m = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (m > max) { vx *= max / m; vy *= max / m; vz *= max / m; }
    this.vx = vx; this.vy = vy; this.vz = vz;
    this.owner = null;
    this.atRest = false;
    LG.Audio.sfx.kick(m / max);
  },

  // ------------------------------------------------------------
  step: function (dt, arena) {
    var C = LG.Config.court;
    var P = LG.Config.physics;
    var U = LG.Util;

    if (this.owner) return; // moving with the carrier — position set by player

    var halfW = C.width / 2 - this.r;
    var halfL = C.length / 2 - this.r;
    var gw = C.goalWidth / 2;

    // gravity & height
    this.vy += P.gravity * dt;
    this.y += this.vy * dt;

    // horizontal integration
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // ground
    if (this.y <= this.r) {
      this.y = this.r;
      if (this.vy < 0) {
        var impact = -this.vy;
        this.vy *= -P.bounce;
        if (impact > 4) {
          LG.Audio.sfx.ballBounce(Math.min(1, impact / 14));
          LG.Particles.dust(this.x, this.z, 2);
          if (this.vy < 0.4) this.vy = 0;
        }
      }
      // rolling friction
      this.vx *= Math.pow(P.groundDrag, dt * 60);
      this.vz *= Math.pow(P.groundDrag, dt * 60);
    }
    // high bounces slow a touch in air
    this.vx *= Math.pow(P.airDrag, dt * 60);
    this.vz *= Math.pow(P.airDrag, dt * 60);

    // ----- fences (outside the goal mouths) -----
    var inHomeMouth = Math.abs(this.x) < gw && this.z < -halfL;
    var inAwayMouth = Math.abs(this.x) < gw && this.z > halfL;

    if (!inHomeMouth && !inAwayMouth) {
      if (this.x > halfW) { this.x = halfW; if (this.vx > 0) { this.vx *= -P.bounce * 0.8; this.hitWall(); } }
      if (this.x < -halfW) { this.x = -halfW; if (this.vx < 0) { this.vx *= -P.bounce * 0.8; this.hitWall(); } }
      if (this.z > halfL) { this.z = halfL; if (this.vz > 0) { this.vz *= -P.bounce * 0.8; this.hitWall(); } }
      if (this.z < -halfL) { this.z = -halfL; if (this.vz < 0) { this.vz *= -P.bounce * 0.8; this.hitWall(); } }
    } else {
      // inside a goal mouth: constrain by net pocket
      var goalZ = this.z < 0 ? -C.length / 2 : C.length / 2;
      var netZ = goalZ + Math.sign(goalZ) * C.goalDepth;
      if (Math.abs(this.z - goalZ) > C.goalDepth) {
        this.z = netZ;
        this.vz *= -0.25;
        this.vx *= 0.7;
      }
      // side net panels within the goal
      if (Math.abs(this.x) > gw && this.z * this.z > (C.length / 2 - 0.3) * (C.length / 2 - 0.3)) {
        this.x = Math.sign(this.x) * gw;
        this.vx *= -0.25;
      }
      if (this.y > C.goalHeight) { this.y = Math.min(this.y, C.goalHeight + this.r); this.vy *= -0.3; }
    }

    // ----- goal posts -----
    var posts = this.posts;
    if (posts) {
      for (var i = 0; i < posts.length; i++) {
        var p = posts[i];
        var dx = this.x - p.x, dz = this.z - p.z;
        var rr = this.r + 0.05;
        var d2 = dx * dx + dz * dz;
        if (d2 < rr * rr && d2 > 0.0001) {
          var d = Math.sqrt(d2);
          var nx = dx / d, nz = dz / d;
          this.x = p.x + nx * rr;
          this.z = p.z + nz * rr;
          var vndot = this.vx * nx + this.vz * nz;
          if (vndot < 0) {
            this.vx -= 2 * vndot * nx;
            this.vz -= 2 * vndot * nz;
            LG.Audio.sfx.post();
            LG.Particles.burst(p.x, 0.6, p.z, 0xfff3c0, 8, 3, 3);
          }
        }
      }
    }

    // at rest?
    var s = this.speed();
    this.atRest = s < 0.6 && this.y < this.r + 0.05;
    if (this.atRest && this.vy < 0.1) { this.vx = 0; this.vz = 0; this.vy = 0; }

    this.mesh.position.set(this.x, this.y, this.z);
    // rolling spin
    if (s > 0.1) {
      this.mesh.rotation.x += this.vz * dt / this.r;
      this.mesh.rotation.z -= this.vx * dt / this.r;
    }
  },

  hitWall: function () {
    // throttle wall sound
    var t = LG.Util.now();
    if (!this._lastWall || t - this._lastWall > 0.09) {
      this._lastWall = t;
      LG.Audio.sfx.wall();
    }
  },
};