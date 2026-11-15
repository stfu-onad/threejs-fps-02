// weapons.js — the arsenal and the firing model.
// One job: define every weapon, resolve hitscan shots (spread, recoil,
// range falloff, head/chest/limb zones, armour) and run grenade
// projectiles. It reports what happened as events; main.js turns those
// into tracers, sounds and particles.

import { rayHitDistance } from './physics.js';
import { clamp } from './rng.js';

export const WEAPONS = {
  p9: {
    name: 'P9 Sidearm', price: 0, slot: 'sidearm', damage: 33, rpm: 340,
    mag: 12, reserve: 96, reloadS: 1.6, pellets: 1, auto: false,
    spreadStill: 0.35, spreadMove: 1.5, kick: 0.011, range: 42,
    moveSpeed: 1.0,
  },
  breacher: {
    name: 'Breacher-12', price: 1100, slot: 'primary', damage: 13, rpm: 75,
    mag: 6, reserve: 36, reloadS: 2.6, pellets: 8, auto: false,
    spreadStill: 2.6, spreadMove: 3.4, kick: 0.05, range: 16,
    moveSpeed: 0.94,
  },
  raptor: {
    name: 'Raptor-9 SMG', price: 1250, slot: 'primary', damage: 25, rpm: 780,
    mag: 30, reserve: 120, reloadS: 2.1, pellets: 1, auto: true,
    spreadStill: 0.8, spreadMove: 2.3, kick: 0.008, range: 34,
    moveSpeed: 1.0,
  },
  vk7: {
    name: 'VK-7 Rifle', price: 2700, slot: 'primary', damage: 36, rpm: 640,
    mag: 30, reserve: 90, reloadS: 2.4, pellets: 1, auto: true,
    spreadStill: 0.32, spreadMove: 1.9, kick: 0.014, range: 60,
    moveSpeed: 0.96,
  },
  longbow: {
    name: 'Longbow DMR', price: 4300, slot: 'primary', damage: 96, rpm: 50,
    mag: 5, reserve: 30, reloadS: 3.0, pellets: 1, auto: false,
    spreadStill: 0.05, spreadMove: 3.2, kick: 0.09, range: 90,
    moveSpeed: 0.9, scoped: true,
  },
};

export const GRENADE_PRICE = { frag: 300, flash: 200, smoke: 300 };

export function makeWeapon(defId) {
  const def = WEAPONS[defId];
  return { defId, ammo: def.mag, reserve: def.reserve };
}

export function currentDef(fighter) {
  const w = fighter.weapons[fighter.current];
  return w ? WEAPONS[w.defId] : null;
}

export function eyeHeight(fighter) {
  return fighter.crouch ? 1.12 : 1.6;
}

export function bodyHeight(fighter) {
  return fighter.crouch ? 1.3 : 1.78;
}

// How wide a shot sprays, in radians, from the shooter's current state:
// standing still and crouched is tight; running or airborne is wild. This
// is the rule that makes stopping to aim pay.
export function spreadOf(fighter, def) {
  const speed = Math.hypot(fighter.vx, fighter.vz);
  let deg = def.spreadStill;
  if (speed > 0.4) deg = def.spreadMove;
  if (!fighter.grounded) deg = Math.max(deg, 3.4);
  if (fighter.crouch && speed <= 0.4) deg *= 0.65;
  // sustained fire blooms the spread a little
  deg *= 1 + Math.min(fighter.shotsFired * 0.05, 0.6);
  return (deg * Math.PI) / 180;
}

function rayFighter(fighter, ox, oy, oz, dx, dy, dz, maxDist) {
  // Head: a sphere near the top. Body: a vertical capsule as a cylinder.
  const h = bodyHeight(fighter);
  const headY = fighter.y + h - 0.16;
  let best = null;
  // sphere test
  {
    const cx = fighter.x - ox, cy = headY - oy, cz = fighter.z - oz;
    const tca = cx * dx + cy * dy + cz * dz;
    const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
    const r = 0.23;
    if (d2 < r * r && tca > 0 && tca < maxDist) best = { t: tca, zone: 'head' };
  }
  // cylinder test (ignore caps; fighters stand on the ground plane)
  {
    const cx = fighter.x - ox, cz = fighter.z - oz;
    const tca = cx * dx + cz * dz;
    if (tca > 0 && tca < maxDist) {
      const px = ox + dx * tca, pz = oz + dz * tca;
      const dd = Math.hypot(px - fighter.x, pz - fighter.z);
      if (dd < 0.42) {
        const py = oy + dy * tca;
        if (py > fighter.y && py < fighter.y + h) {
          if (!best || tca < best.t) {
            const zone = py > fighter.y + h * 0.62 ? 'chest' : 'limb';
            best = { t: tca, zone };
          }
        }
      }
    }
  }
  return best;
}

// Fire one trigger pull. Returns true when a shot actually left the gun.
// Events: shot, tracer {x,y,z -> x,y,z}, hit {victim, zone, damage},
// kill {victim}, wallhit {x,y,z}.
export function tryFire(state, colliders, shooter, rng, events, now) {
  const w = shooter.weapons[shooter.current];
  if (!w || !shooter.alive) return false;
  const def = WEAPONS[w.defId];
  if (now < shooter.nextShotAt || now < shooter.reloadingUntil) return false;
  if (w.ammo <= 0) {
    events.push({ type: 'dryfire', fighter: shooter });
    shooter.nextShotAt = now + 0.3;
    return false;
  }
  w.ammo -= 1;
  shooter.shotsFired += 1;
  shooter.nextShotAt = now + 60 / def.rpm;
  shooter.flashUntil = now + 0.05;

  const spread = spreadOf(shooter, def);
  const ox = shooter.x, oy = shooter.y + eyeHeight(shooter), oz = shooter.z;
  const eventsBefore = events.length;
  events.push({ type: 'shot', fighter: shooter, defId: w.defId });

  for (let p = 0; p < def.pellets; p++) {
    // random cone around the aim direction
    const yaw = shooter.yaw + rng.gauss(spread);
    const pitch = shooter.pitch + rng.gauss(spread * 0.8);
    const dx = -Math.sin(yaw) * Math.cos(pitch);
    const dz = -Math.cos(yaw) * Math.cos(pitch);
    const dy = Math.sin(pitch);
    const wallDist = rayHitDistance(colliders, ox, oy, oz, dx, dy, dz, def.range + 30);
    let bestT = wallDist, bestFighter = null, bestZone = null;
    for (const f of state.fighters) {
      if (f === shooter || !f.alive || f.team === shooter.team) continue;
      const hit = rayFighter(f, ox, oy, oz, dx, dy, dz, Math.min(wallDist, def.range + 30));
      if (hit && hit.t < bestT) { bestT = hit.t; bestFighter = f; bestZone = hit.zone; }
    }
    const ex = ox + dx * bestT, ey = oy + dy * bestT, ez = oz + dz * bestT;
    events.push({ type: 'tracer', x0: ox, y0: oy - 0.12, z0: oz, x1: ex, y1: ey, z1: ez });
    if (bestFighter) {
      const falloff = clamp(1 - Math.max(0, bestT - def.range * 0.5) / (def.range * 1.4), 0.35, 1);
      let dmg = def.damage * falloff;
      if (bestZone === 'head') dmg *= bestFighter.helmet ? 3.0 : 4.0;
      else if (bestZone === 'limb') dmg *= 0.75;
      if (bestFighter.armor > 0 && bestZone !== 'head') {
        dmg *= 0.55;
        bestFighter.armor = Math.max(0, bestFighter.armor - dmg * 0.5);
      } else if (bestFighter.armor > 0 && bestZone === 'head' && bestFighter.helmet) {
        dmg *= 0.6;
      }
      dmg = Math.max(1, Math.round(dmg));
      bestFighter.hp -= dmg;
      events.push({ type: 'hit', victim: bestFighter, attacker: shooter, zone: bestZone, damage: dmg });
      if (bestFighter.hp <= 0 && bestFighter.alive) {
        bestFighter.hp = 0;
        bestFighter.alive = false;
        bestFighter.deaths += 1;
        shooter.kills += 1;
        shooter.money += 300;
        events.push({ type: 'kill', victim: bestFighter, attacker: shooter, zone: bestZone, defId: w.defId });
      }
    } else if (wallDist < def.range + 30) {
      events.push({ type: 'wallhit', x: ex, y: ey, z: ez });
    }
  }
  return events.length > eventsBefore;
}

export function startReload(fighter, now) {
  const w = fighter.weapons[fighter.current];
  if (!w) return false;
  const def = WEAPONS[w.defId];
  if (w.ammo >= def.mag || w.reserve <= 0 || now < fighter.reloadingUntil) return false;
  fighter.reloadingUntil = now + def.reloadS;
  fighter.reloadWeapon = w;
  return true;
}

export function finishReload(fighter) {
  const w = fighter.reloadWeapon;
  if (!w) return;
  const def = WEAPONS[w.defId];
  const need = def.mag - w.ammo;
  const take = Math.min(need, w.reserve);
  w.ammo += take;
  w.reserve -= take;
  fighter.reloadWeapon = null;
}

// ------------------------------------------------------------ grenades
// Projectiles fly on a simple arc and resolve on landing. Smoke clouds
// linger and block bot vision (checked in bots.js through visionBlocked).

export function throwGrenade(state, fighter, kind, now) {
  if (fighter.grenades[kind] <= 0) return false;
  if (!state.projectiles) state.projectiles = [];
  fighter.grenades[kind] -= 1;
  const speed = 17;
  const cp = Math.cos(fighter.pitch + 0.32);
  state.projectiles.push({
    kind, team: fighter.team, owner: fighter.id,
    x: fighter.x, y: fighter.y + eyeHeight(fighter), z: fighter.z,
    vx: -Math.sin(fighter.yaw) * cp * speed,
    vy: Math.sin(fighter.pitch + 0.32) * speed + 3.2,
    vz: -Math.cos(fighter.yaw) * cp * speed,
    born: now,
  });
  return true;
}

export function updateGrenades(state, colliders, rng, events, now, dt) {
  if (!state.projectiles) state.projectiles = [];
  if (!state.smokes) state.smokes = [];
  const GRAV = 16;
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    p.vy -= GRAV * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    let landed = p.y <= 0.15;
    // bounce off walls cheaply: stop horizontal motion inside a collider
    for (const c of colliders) {
      if (p.x > c.x0 && p.x < c.x1 && p.z > c.z0 && p.z < c.z1 && p.y < c.h) {
        p.vx = 0; p.vz = 0; p.x -= p.vx * dt; p.z -= p.vz * dt;
        landed = true;
      }
    }
    if (p.y < 0.15) { p.y = 0.15; p.vy = Math.abs(p.vy) > 2 ? -p.vy * 0.35 : 0; p.vx *= 0.6; p.vz *= 0.6; }
    const settled = landed && Math.abs(p.vy) < 0.1 && Math.hypot(p.vx, p.vz) < 0.4;
    const fuseDone = now - p.born > 1.6;
    if ((p.kind === 'frag' && fuseDone) || (p.kind !== 'frag' && settled) || now - p.born > 4) {
      resolveGrenade(state, colliders, p, events, now);
      state.projectiles.splice(i, 1);
    }
  }
  for (let i = state.smokes.length - 1; i >= 0; i--) {
    if (now > state.smokes[i].until) state.smokes.splice(i, 1);
  }
}

function resolveGrenade(state, colliders, p, events, now) {
  if (p.kind === 'frag') {
    events.push({ type: 'explode', x: p.x, y: p.y, z: p.z });
    for (const f of state.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      if (d > 6.5) continue;
      // walls soak the blast
      const clear = rayHitDistance(colliders, p.x, 0.8, p.z,
        (f.x - p.x) / (d || 1), 0, (f.z - p.z) / (d || 1), d) >= d - 0.1;
      if (!clear) continue;
      let dmg = Math.round(92 * (1 - d / 7.2));
      if (f.armor > 0) dmg = Math.round(dmg * 0.6);
      if (dmg <= 0) continue;
      f.hp -= dmg;
      events.push({ type: 'hit', victim: f, attacker: null, zone: 'blast', damage: dmg });
      if (f.hp <= 0 && f.alive) {
        f.hp = 0; f.alive = false; f.deaths += 1;
        events.push({ type: 'kill', victim: f, attacker: null, zone: 'blast', defId: 'frag' });
      }
    }
  } else if (p.kind === 'flash') {
    events.push({ type: 'flashpop', x: p.x, y: p.y, z: p.z });
    for (const f of state.fighters) {
      if (!f.alive || f.team === p.team) continue;
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      if (d > 22) continue;
      // blinded when looking toward the pop with a clear line
      const toPop = Math.atan2(-(p.x - f.x), -(p.z - f.z));
      const facing = Math.abs(Math.atan2(Math.sin(toPop - f.yaw), Math.cos(toPop - f.yaw)));
      if (facing > 1.9) continue;
      const clear = rayHitDistance(colliders, f.x, 1.4, f.z,
        (p.x - f.x) / (d || 1), 0, (p.z - f.z) / (d || 1), d) >= d - 0.1;
      if (clear) f.blindUntil = Math.max(f.blindUntil, now + (d < 9 ? 2.6 : 1.4));
    }
  } else if (p.kind === 'smoke') {
    state.smokes.push({ x: p.x, z: p.z, r: 3.4, until: now + 13 });
    events.push({ type: 'smokepop', x: p.x, y: p.y, z: p.z });
  }
}

// Does a smoke cloud sit on the segment between two ground points?
export function visionBlockedBySmoke(state, ax, az, bx, bz) {
  if (!state.smokes) return false;
  for (const s of state.smokes) {
    // distance from the cloud centre to the segment
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((s.x - ax) * dx + (s.z - az) * dz) / len2;
    t = clamp(t, 0, 1);
    const px = ax + dx * t, pz = az + dz * t;
    if (Math.hypot(s.x - px, s.z - pz) < s.r) return true;
  }
  return false;
}
