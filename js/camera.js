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
  this._dbgMode = null;
};

LG.MatchCamera.prototype = {
  isLandscape: function () {
    return !!(LG.Settings && LG.Settings.isLandscape && LG.Settings.isLandscape());
  },

  // Framing follows the player's VIEW choice, not the device's current aspect.
  // PORTRAIT keeps the original broadcast camera (behind the play on +z,
  // looking along −z); LANDSCAPE uses a genuinely different pose — the camera
  // sits off the EAST touchline (+x) and looks back across the pitch WIDTH, so
  // the goal-to-goal axis runs left-to-right on screen (gameplay mode, not a
  // zoomed portrait). The projection matrix still tracks the real canvas, so
  // rotating the phone or resizing the window adapts live without ever
  // stretching or cropping the world. This is what makes the VIEW buttons
  // visibly change the gameplay on every device (desktop included).
  cfg: function () {
    var C = LG.Config.camera;
    if (this.isLandscape() && C.landscape) return C.landscape;
    return C;
  },

  reset: function () {
    var C = this.cfg();
    var land = this.isLandscape();
    this.followX = 0; this.followZ = 0;
    this.shakeT = 0; this.zoomPulse = 0;
    this.camera.fov = C.fov;
    if (land) {
      // east touchline, level across the width: the pitch runs horizontally
      this.camera.position.set(C.distance, C.height, 0);
      this.camera.lookAt(0, 1, 0);
    } else {
      this.camera.position.set(0, C.height, C.distance);
      this.camera.lookAt(0, 0, 0);
    }
    this.camera.updateProjectionMatrix();
  },

  shake: function (dur, amp) {
    if (LG.Settings && LG.Settings.reducedMotion && LG.Settings.reducedMotion()) return;
    this.shakeT = Math.max(this.shakeT, dur);
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  },
  pulse: function (v) {
    if (LG.Settings && LG.Settings.reducedMotion && LG.Settings.reducedMotion()) return;
    this.zoomPulse = Math.max(this.zoomPulse, v);
  },

  update: function (dt, targetX, targetZ, ballX, ballZ) {
    var U = LG.Util;
    var C = this.cfg();
    var land = this.isLandscape();

    // log the applied framing once per view switch
    if (land !== this._dbgMode) {
      this._dbgMode = land;
      if (LG.DBG) LG.DBG.log('[camera] ' + (land ? 'LANDSCAPE' : 'PORTRAIT') + ' configuration applied');
    }

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
    if (land) {
      // side-on framing: follow the action along the length (goals keep a
      // comfortable margin) but barely drift across the width, so neither
      // touchline dominates the frame
      this.followX = U.clamp(this.followX, -C.xClamp, C.xClamp);
      this.followZ = U.clamp(this.followZ, -C.zClamp, C.zClamp);

      // hard guarantee: the controlled player never leaves the visible area,
      // even when the ball is far on the other side of the pitch
      this.followX = U.clamp(this.followX, targetX - 20, targetX + 20);
      this.followZ = U.clamp(this.followZ, targetZ - 20, targetZ + 20);
    } else {
      this.followX = U.clamp(this.followX, -C.xClamp, C.xClamp);
      this.followZ = U.clamp(this.followZ, -C.zClamp, C.zClamp);

      // hard guarantee: the controlled player never leaves the visible area,
      // even when the ball is far on the other side of the pitch
      this.followX = U.clamp(this.followX, targetX - 13, targetX + 13);
      this.followZ = U.clamp(this.followZ, targetZ - 15, targetZ + 30);
    }

    // shake offsets
    var sx = 0, sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      var a = this.shakeAmp * Math.max(0, this.shakeT);
      sx = (Math.random() - 0.5) * 2 * a;
      sy = (Math.random() - 0.5) * 2 * a;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }

    if (land) {
      // camera off the EAST touchline looking back across the width:
      // screen-right = the away goal (−z), screen-up = the far touchline (−x)
      this.camera.position.set(this.followX + C.distance + sx, C.height + sy * 0.6, this.followZ + sx * 0.4);
      this.camera.lookAt(this.followX, 1.0, this.followZ);
    } else {
      // elevated broadcast camera behind the play (+z, own-goal side), always
      // looking toward the opponent goal (-z): screen-up = attack direction
      this.camera.position.set(this.followX + sx, C.height + sy * 0.6, this.followZ + C.distance + sx * 0.4);
      this.camera.lookAt(this.followX, 1.0, this.followZ - 2.5);
    }

    // zoom pulse
    this.zoomPulse = Math.max(0, this.zoomPulse - dt * 0.5);
    var fov = C.fov - this.zoomPulse * 7;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = U.lerp(this.camera.fov, fov, Math.min(1, dt * 10));
      this.camera.updateProjectionMatrix();
    }
  },
};