// ============================================================
// INPUT — keyboard + virtual joystick + action buttons
// ============================================================
var LG = window.LG = window.LG || {};

LG.Input = (function () {
  var keys = {};
  var t = 0;
  var lastT = 0;
  var edges = {};       // {name: true if fired this frame}
  var held = {};        // continuous held flags
  var queue = {};       // pending edge events from DOM events

  // joystick
  var joyActive = false, joyId = -1, joyOx = 0, joyOy = 0;
  var JX = 0, JY = 0;
  var joystickEl = null, knobEl = null;

  var useKeyboard = false;
  var enabled = false;  // gates gameplay input during menus/transitions

  var AXIS_DEAD = 0.06;   // residual axis dead zone (the stick already has a px one)

  function setBool(name, val) {
    if (val && !held[name]) { queue[name] = true; }
    held[name] = val;
  }

  function keyMap(code) {
    switch (code) {
      case 'ArrowUp': return 'up';
      case 'ArrowDown': return 'down';
      case 'ArrowLeft': return 'left';
      case 'ArrowRight': return 'right';
      case 'KeyW': case 'ShiftLeft': case 'ShiftRight': return 'sprint';
      // CONTEXT-SENSITIVE: PASS | SHOOT while your team has the ball, SWITCH |
      // TACKLE while the opponent does. There are no separate switch/tackle keys.
      case 'KeyA': case 'KeyI': case 'Space': case 'KeyJ': return 'pass';
      case 'KeyS': case 'KeyK': return 'shoot';
      case 'KeyQ': return 'special';
      case 'KeyP': case 'Escape': return 'pause';
      case 'KeyR': return 'rematch';
    }
    return null;
  }

  // bug-report / any focused field must keep typing, not trigger match keys
  function isTypingTarget(e) {
    var t = e.target;
    if (!t || !t.tagName) return false;
    var tag = String(t.tagName).toLowerCase();
    return tag === 'textarea' || tag === 'input' || !!t.isContentEditable;
  }

  function onKeyDown(e) {
    if (isTypingTarget(e)) return;
    var k = keyMap(e.code);
    if (!k) return;
    if (!enabled) return; // menus/transitions: keys fall through to native behavior
    if (e.code === 'Tab' || e.code === 'Space' || k === 'up' || k === 'down' || k === 'left' || k === 'right') {
      e.preventDefault();
    }
    useKeyboard = true;
    setBool(k, true);
    if (!keys[e.code]) { keys[e.code] = true; }
  }
  function onKeyUp(e) {
    if (isTypingTarget(e)) return;
    var k = keyMap(e.code);
    if (!k) return;
    setBool(k, false);
    keys[e.code] = false;
  }

  function onBlur() {
    reset();
  }

  // ---------------- joystick ----------------
  function elPos(el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top }; }

  // Full tilt should need a short, comfortable thumb travel — not a long drag
  // across the whole pad. Dead zone and travel are measured in PIXELS of finger
  // movement, so the stick feels identical on every screen size.
  function stickFullRadius(hw) {
    var T = LG.Config.touch || {};
    var frac = T.stickFullTilt != null ? T.stickFullTilt : 0.58;
    return LG.Util.clamp(hw * frac, T.stickFullMin || 34, T.stickFullMax || 84);
  }

  function onJoyDown(e) {
    if (joyActive) return;
    if (!enabled) return;
    joyActive = true;
    joyId = e.pointerId;
    if (joystickEl.setPointerCapture && e.pointerId != null) {
      try { joystickEl.setPointerCapture(e.pointerId); } catch (e) {}
    }
    var br = joystickEl.getBoundingClientRect();
    joyOx = e.clientX - br.left;
    joyOy = e.clientY - br.top;
    // the knob snaps under the thumb; the stick VALUE is left alone so a quick
    // re-touch continues the run instead of stalling the player for a frame
    if (knobEl) {
      knobEl.style.left = joyOx + 'px';
      knobEl.style.top = joyOy + 'px';
      knobEl.style.transform = 'translate(-50%,-50%)';
    }
    useKeyboard = false;
  }
  function onJoyMove(e) {
    if (!joyActive || e.pointerId !== joyId) return;
    var br = joystickEl.getBoundingClientRect();
    var hw = br.width / 2;
    var T = LG.Config.touch || {};
    var dead = T.stickDeadZone != null ? T.stickDeadZone : 7;
    var fullR = stickFullRadius(hw);
    var rx = e.clientX - br.left - joyOx;      // px travelled since the touch
    var ry = e.clientY - br.top - joyOy;
    var dist = Math.sqrt(rx * rx + ry * ry);
    var m = 0;
    if (dist > dead) {
      m = Math.min(1, (dist - dead) / Math.max(1, fullR - dead));
      m = m * (1.16 - 0.16 * m);              // gentle ease — snappy, not jumpy
    }
    if (dist > 0.001) {
      var ux = rx / dist, uy = ry / dist;
      JX = ux * m;
      JY = -uy * m;
      if (knobEl) {
        var travel = Math.min(dist, fullR);   // knob pins at full tilt
        knobEl.style.left = (joyOx + ux * travel) + 'px';
        knobEl.style.top = (joyOy + uy * travel) + 'px';
      }
    } else {
      JX = 0; JY = 0;
    }
  }
  function onJoyUp(e) {
    if (!joyActive || e.pointerId !== joyId) return;
    resetJoystick();
  }
  function resetJoystick() {
    joyActive = false;
    JX = 0; JY = 0;
    if (knobEl) { knobEl.style.left = '27%'; knobEl.style.top = '27%'; }
  }

  function bindButtons() {
    var ids = ['pass', 'shoot', 'tackle', 'sprint', 'switch'];
    for (var i = 0; i < ids.length; i++) {
      (function (name, btn) {
        if (!btn) return;
        btn.addEventListener('pointerdown', function (e) {
          e.preventDefault(); useKeyboard = false;
          if (!enabled) return;
          if (btn.setPointerCapture && e.pointerId != null) {
            try { btn.setPointerCapture(e.pointerId); } catch (err) {}
          }
          btn.classList.add('held');
          setBool(name, true);
        });
        var up = function () { btn.classList.remove('held'); setBool(name, false); };
        btn.addEventListener('pointerup', up);
        btn.addEventListener('pointercancel', up);
        btn.addEventListener('pointerleave', up);
      })(ids[i], document.getElementById('btn-' + ids[i]));
    }
    // the special ability button uses a different DOM id (special-btn)
    var sp = document.getElementById('special-btn');
    if (sp) {
      var pressSpecial = function (e) { e.preventDefault(); useKeyboard = false; if (!enabled) return; setBool('special', true); };
      var relSpecial = function () { setBool('special', false); };
      sp.addEventListener('pointerdown', pressSpecial);
      sp.addEventListener('pointerup', relSpecial);
      sp.addEventListener('pointercancel', relSpecial);
      sp.addEventListener('pointerleave', relSpecial);
    }
  }

  function init() {
    joystickEl = document.getElementById('joystick-zone');
    knobEl = document.getElementById('joy-knob');
    if (joystickEl) {
      joystickEl.addEventListener('pointerdown', onJoyDown);
      joystickEl.addEventListener('pointermove', onJoyMove);
      joystickEl.addEventListener('pointerup', onJoyUp);
      joystickEl.addEventListener('pointercancel', onJoyUp);
    }
    bindButtons();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
  }

  // called each frame by the game loop
  function update(frameT) {
    t = frameT;
    edges = {};
    for (var k in queue) { if (queue[k]) { edges[k] = true; queue[k] = false; } }
    lastT = t;
  }

  function reset() {
    for (var k in held) held[k] = false;
    for (var k in queue) queue[k] = false;
    keys = {};
    edges = {};
    useKeyboard = false;
    resetJoystick();
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!enabled) reset();
  }

  function pressed(name) { return !!edges[name]; }
  function down(name) { return !!held[name]; }
  function axisDead(v) { return Math.abs(v) < AXIS_DEAD ? 0 : v; }

  // combined (touch + keyboard) move vector: x right+=, y up+=
  function moveVec() {
    var x = axisDead(JX), y = axisDead(JY);
    if (down('left')) x = -1;
    if (down('right')) x = 1;
    if (down('up')) y = 1;
    if (down('down')) y = -1;
    // normalize
    var m = Math.sqrt(x * x + y * y);
    if (m > 1) { x /= m; y /= m; }
    return { x: x, y: y };
  }

  return {
    init: init, update: update, reset: reset, setEnabled: setEnabled,
    pressed: pressed, down: down, moveVec: moveVec, keyMap: keyMap,
    isUsingKeyboard: function () { return useKeyboard; },
  };
})();
