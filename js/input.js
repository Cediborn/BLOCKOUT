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

  var AXIS_DEAD = 0.18;

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
      case 'KeyI': case 'KeyA': case 'Space': case 'KeyJ': return 'pass';
      case 'KeyS': case 'KeyK': return 'shoot';
      case 'KeyD': case 'KeyL': case 'KeyC': return 'tackle';
      case 'KeyQ': return 'special';
      case 'KeyX': case 'KeyE': case 'Tab': return 'switch';
      case 'KeyP': case 'Escape': return 'pause';
      case 'KeyR': return 'rematch';
    }
    return null;
  }

  function onKeyDown(e) {
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

  function onJoyDown(e) {
    if (joyActive) return;
    if (!enabled) return;
    joyActive = true;
    joyId = e.pointerId;
    if (joystickEl.setPointerCapture && e.pointerId != null) {
      try { joystickEl.setPointerCapture(e.pointerId); } catch (e) {}
    }
    var zone = joystickEl;
    var br = zone.getBoundingClientRect();
    joyOx = e.clientX - br.left;
    joyOy = e.clientY - br.top;
    knobEl.style.left = joyOx + 'px';
    knobEl.style.top = joyOy + 'px';
    knobEl.style.transform = 'translate(-50%,-50%)';
    JX = 0; JY = 0;
    useKeyboard = false;
  }
  function onJoyMove(e) {
    if (!joyActive || e.pointerId !== joyId) return;
    var br = joystickEl.getBoundingClientRect();
    var hw = br.width / 2;
    var dx = (e.clientX - br.left - joyOx) / hw;
    var dy = (e.clientY - br.top - joyOy) / hw;
    dx = LG.Util.clamp(dx, -1, 1);
    dy = LG.Util.clamp(dy, -1, 1);
    JX = dx; JY = -dy;
    knobEl.style.left = (joyOx + dx * hw) + 'px';
    knobEl.style.top = (joyOy - dy * hw) + 'px';
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
      var el = document.getElementById('btn-' + ids[i]);
      if (!el) continue;
      el.addEventListener('pointerdown', function (name, e) {
        e.preventDefault(); useKeyboard = false;
        if (!enabled) return;
        if (el.setPointerCapture && e.pointerId != null) {
          try { el.setPointerCapture(e.pointerId); } catch (e) {}
        }
        setBool(name, true);
      }.bind(null, ids[i]));
      el.addEventListener('pointerup', function (name) { setBool(name, false); }.bind(null, ids[i]));
      el.addEventListener('pointercancel', function (name) { setBool(name, false); }.bind(null, ids[i]));
      el.addEventListener('pointerleave', function (name) { setBool(name, false); }.bind(null, ids[i]));
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
