// ============================================================
// ABILITIES — gameplay effects for each special
// ============================================================
var LG = window.LG = window.LG || {};

LG.Abilities.run = function (p) {
  var M = LG.Match;
  var U = LG.Util;
  var def = LG.Abilities[p.active.id];

  switch (p.active.id) {
    case 'BURST':
      LG.Particles.speedLines(p.x, 0.6, p.z, Math.sin(p.facing) || 0, Math.cos(p.facing) || 1, def.color, 26);
      LG.Particles.ring(p.x, p.z, def.color, 5, 0.6);
      LG.Audio.sfx.special();
      break;

    case 'POWER_SHOT':
      LG.Particles.burst(p.x, 0.4, p.z, def.color, 30, 8, 5);
      LG.Particles.ring(p.x, p.z, def.color, 6, 0.7);
      LG.Audio.sfx.special();
      if (p.hasBall) {
        M.autoPowerShot(p);
      } else {
        // enable power on next shot
        p._powerShot = true;
        M.showToast('POWER SHOT LOADED');
      }
      break;

    case 'DRIBBLE_RUSH':
      LG.Particles.ring(p.x, p.z, def.color, 5, 0.6);
      LG.Particles.burst(p.x, 0.3, p.z, def.color, 18, 4, 3);
      LG.Audio.sfx.special();
      break;

    case 'SUPER_TACKLE':
      M.superTackle(p);
      break;

    case 'PERFECT_PASS':
      p._perfectPass = true;
      p._perfectPassT = def.dur;
      LG.Particles.ring(p.x, p.z, def.color, 4, 0.55);
      LG.Audio.sfx.special();
      M.showToast('LASER PASS READY');
      break;

    case 'FREEZE':
      M.slowOwner = { team: 1 - p.team, t: def.dur };
      LG.Particles.burst(p.x, 3, p.z, def.color, 26, 5, 2);
      LG.Particles.ring(p.x, p.z, def.color, 9, 0.7);
      LG.Audio.sfx.special();
      M.shakeEffect(0.5, 0.35);
      break;

    case 'SHOCKWAVE':
      M.shockwave(p);
      break;

    case 'WALL':
      p.immovable = true;
      LG.Particles.ring(p.x, p.z, def.color, 5, 0.65);
      LG.Particles.dust(p.x, p.z, 4);
      LG.Audio.sfx.special();
      break;
  }

  // visual aura on the player while the effect runs
  if (p.active && p.auraMesh) {
    p.auraMesh.material.color.setHex(def.color);
    p.auraMesh.visible = true;
  }
};

// called on meter fill — audio + aura flah
LG.Abilities.onReady = function (p) {
  LG.Audio.sfx.specialReady();
};

LG.Abilities.cleanupEffect = function (p, type) {
  if (p.auraMesh) p.auraMesh.visible = false;
};

LG.Abilities.tickPerfectPass = function (p, dt) {
  if (p._perfectPass) {
    p._perfectPassT -= dt;
    if (p._perfectPassT <= 0) p._perfectPass = false;
  }
};

LG.Abilities.isPerfectPassReady = function (p) { return !!p._perfectPass; };
LG.Abilities.consumePerfectPass = function (p) { p._perfectPass = false; return true; };
LG.Abilities.isPowerShotReady = function (p) { return !!p._powerShot; };
LG.Abilities.consumePowerShot = function (p) { p._powerShot = false; return true; };