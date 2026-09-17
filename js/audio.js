// ============================================================
// AUDIO — fully procedural WebAudio. No samples, no APIs.
// ============================================================
var LG = window.LG = window.LG || {};

LG.Audio = (function () {
  var ctx = null, master = null, crowdGain = null, enabled = true;
  var noiseBuf = null;
  var crowdActive = false;
  var UI = LG.Util;

  function init() {
    if (ctx) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
      noiseBuf = makeNoise(ctx, 1.5);
    } catch (e) { ctx = null; }
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function makeNoise(c, dur) {
    var n = Math.floor(c.sampleRate * dur);
    var b = c.createBuffer(1, n, c.sampleRate);
    var d = b.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function toggle() { enabled = !enabled; if (master) master.gain.value = enabled ? 0.55 : 0; return enabled; }

  function blip(freq, dur, type, vol, delay, slideTo) {
    if (!ctx || !master || !enabled) return;
    var t0 = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol || 0.2, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function thump(freq, dur, vol, delay) {
    if (!ctx || !master || !enabled) return;
    var t0 = ctx.currentTime + (delay || 0);
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(40, t0 + dur);
    g.gain.setValueAtTime(vol || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  function noiseHit(dur, vol, filterFreq, delay, type) {
    if (!ctx || !master || !enabled) return;
    var t0 = ctx.currentTime + (delay || 0);
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.value = filterFreq || 800;
    f.Q.value = 0.9;
    var g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  function crowd(density) {
    if (!ctx || !master) return;
    if (!crowdActive) {
      if (!crowdGain) {
        var s = ctx.createBufferSource();
        s.buffer = noiseBuf;
        s.loop = true;
        var f = ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 900; f.Q.value = 0.4;
        crowdGain = ctx.createGain();
        crowdGain.gain.value = 0.0;
        s.connect(f); f.connect(crowdGain); crowdGain.connect(master);
        s.start();
      }
      crowdActive = true;
    }
    if (crowdGain) crowdGain.gain.setTargetAtTime(UI.clamp(density, 0, 1) * 0.12, ctx.currentTime, 0.8);
  }

  function crowdStop() {
    crowdActive = false;
    if (crowdGain) crowdGain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
  }

  function crowdCheer(intensity) {
    // layered applause-like blips
    var n = Math.floor(UI.lerp(18, 40, intensity));
    for (var i = 0; i < n; i++) {
      noiseHit(0.08, 0.03 + Math.random() * 0.03, 400 + Math.random() * 2600, Math.random() * 0.5);
    }
  }

  // ---------- game sounds ----------
  var S = {
    // velocity-aware strike: a soft pass-control touch is a light tap, a
    // full-power shot is a heavy crack — the two never sound the same
    kick: function (p) {
      var pw = UI.clamp(p != null ? p : 0.6, 0, 1);
      thump(105 + pw * 70, 0.09 + pw * 0.13, 0.26 + pw * 0.36);
      noiseHit(0.05 + pw * 0.07, 0.12 + pw * 0.2, 520 + pw * 980);
      blip(150 + pw * 140, 0.05, 'triangle', 0.07 + pw * 0.11, 0, 60);
    },
    pass: function () { thump(300, 0.07, 0.22); blip(620, 0.05, 'triangle', 0.1, 0, 400); },
    tackle: function () { noiseHit(0.16, 0.4, 300, 0, 'lowpass'); thump(90, 0.22, 0.5); },
    ballBounce: function (v) { var d = UI.clamp(v, 0, 1); thump(140, 0.06, 0.06 + d * 0.2); },
    post: function () { thump(260, 0.28, 0.5); blip(420, 0.25, 'square', 0.18, 0, 300); },
    wall: function () { noiseHit(0.06, 0.1, 500); },
    goal: function (own) {
      blip(523, 0.12, 'square', 0.16); blip(659, 0.12, 'square', 0.16, 0.1);
      blip(784, 0.14, 'square', 0.18, 0.2); blip(1046, 0.4, 'square', 0.2, 0.3);
      crowdCheer(own ? 0.5 : 0.95);
      thump(100, 0.5, 0.3);
    },
    whistle: function (longDur) {
      blip(1500, longDur || 0.28, 'square', 0.2);
      if (longDur > 0.3) blip(2000, longDur, 'square', 0.12, 0.02);
    },
    click: function () { blip(700, 0.04, 'square', 0.12); },
    special: function () {
      blip(300, 0.5, 'sawtooth', 0.2, 0, 1800);
      noiseHit(0.5, 0.3, 900, 0, 'bandpass');
      blip(1400, 0.2, 'sawtooth', 0.1, 0.15, 300);
    },
    specialReady: function () { blip(880, 0.16, 'square', 0.16); blip(1320, 0.3, 'square', 0.16, 0.12); },
    matchStart: function () { S.whistle(0.5); }
  };

  function unlock() { init(); resume(); if (ctx) crowd(0.4); }

  return {
    init: init, resume: resume, unlock: unlock, toggle: toggle,
    crowd: crowd, crowdStop: crowdStop, crowdCheer: crowdCheer,
    sfx: S,
  };
})();