// ============================================================
// CAMERA — elevated broadcast follow camera, full-pitch tracking
// ============================================================
var LG = window.LG = window.LG || {};

LG.MatchCamera = function (camera) {
  var U = LG.Util;
  var C = LG.Config.camera;
  this.camera = camera;
  this.followX = 0;
  this.followZ = 0;
  this.shakeT = 0;
  this.shakeAmp = 0;
  this.zoomPulse = 0;
};

LG.MatchCamera.prototype = {
  reset: function () {
    var C = LG.Config.camera;
    this.followX = 0; this.followZ = 0;
    this.shakeT = 0; this.zoomPulse = 0;
    this.camera.fov = C.fov;
    this.camera.position.set(0, C.height, C.distance);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  },

  shake: function (dur, amp) { this.shakeT = Math.max(this.shakeT, dur); this.shakeAmp = Math.max(this.shakeAmp, amp); },
  pulse: function (v) { this.zoomPulse = Math.max(this.zoomPulse, v); },

  update: function (dt, targetX, targetZ, ballX, ballZ) {
    var U = LG.Util;
    var C = LG.Config.camera;

    // blend target: weighted ball + action (ball pulls the frame toward the threat)
    var tx = U.lerp(targetX, ballX, 0.42);
    var tz = U.lerp(targetZ, ballZ, 0.42);

    // damp toward target
    var k = Math.min(1, dt * 6.5);
    this.followX = U.lerp(this.followX, tx, k);
    this.followZ = U.lerp(this.followZ, tz, k);

    // clamp tracking symmetrically across the ENTIRE pitch: the opponent
    // goal (-z) and the player's own goal (+z) are both reachable. No more
    // mid-pitch fence that stranded the camera near midfield.
    this.followX = U.clamp(this.followX, -C.xClamp, C.xClamp);
    this.followZ = U.clamp(this.followZ, -C.zClamp, C.zClamp);

    // hard guarantee: the controlled player never leaves the visible area,
    // even when the ball is far on the other side of the pitch
    this.followX = U.clamp(this.followX, targetX - 13, targetX + 13);
    this.followZ = U.clamp(this.followZ, targetZ - 15, targetZ + 30);

    // elevated broadcast camera behind the play (+z, own-goal side), always
    // looking toward the opponent goal (-z): screen-up = attack direction
    var dx = this.followX;
    var dz = this.followZ + C.distance;

    // shake offsets
    var sx = 0, sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      var a = this.shakeAmp * Math.max(0, this.shakeT);
      sx = (Math.random() - 0.5) * 2 * a;
      sy = (Math.random() - 0.5) * 2 * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }

    this.camera.position.set(dx + sx, C.height + sy * 0.6, dz + sx * 0.4);
    this.camera.lookAt(this.followX, 1.0, this.followZ - 2.5);

    // zoom pulse
    this.zoomPulse = Math.max(0, this.zoomPulse - dt * 0.5);
    var fov = C.fov - this.zoomPulse * 7;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = U.lerp(this.camera.fov, fov, Math.min(1, dt * 10));
      this.camera.updateProjectionMatrix();
    }
  },
};