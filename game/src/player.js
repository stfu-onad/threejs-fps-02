// player.js — the human fighter: mouse look, acceleration movement, fire.
// One job: turn input into the same fighter fields the bots use, so the
// human plays by identical rules (same speeds, same spread, same physics).

import { slideMove } from './physics.js';
import { tryFire, startReload, throwGrenade, currentDef } from './weapons.js';
import { clamp } from './rng.js';

export const WALK_SPEED = 5.2;
const ACCEL = 42;
const AIR_ACCEL = 6;
const JUMP_VEL = 4.6;
const GRAVITY = 13.5;

export function updatePlayer(state, f, input, colliders, rng, events, now, dt) {
  if (!f.alive) return;
  // --- look
  const { dx, dy } = input.consumeMouse();
  const sens = f.scoped ? 0.0011 : 0.0021;
  f.yaw -= dx * sens;
  f.pitch = clamp(f.pitch - dy * sens, -1.45, 1.45);

  // --- wish direction: input axes rotated into world space by yaw.
  // Facing is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw).
  let ix = 0, iz = 0;
  if (input.keys.has('KeyW')) iz -= 1;
  if (input.keys.has('KeyS')) iz += 1;
  if (input.keys.has('KeyA')) ix -= 1;
  if (input.keys.has('KeyD')) ix += 1;
  const len = Math.hypot(ix, iz) || 1;
  ix /= len; iz /= len;
  const cos = Math.cos(f.yaw), sin = Math.sin(f.yaw);
  const wishX = ix * cos + iz * sin;
  const wishZ = -ix * sin + iz * cos;

  f.crouch = input.keys.has('ControlLeft') || input.keys.has('KeyC');
  const def = currentDef(f);
  const topSpeed = WALK_SPEED * (def ? def.moveSpeed : 1) * (f.crouch ? 0.45 : 1) * (f.scoped ? 0.5 : 1);
  const accel = f.grounded ? ACCEL : AIR_ACCEL;
  f.vx += wishX * accel * dt;
  f.vz += wishZ * accel * dt;
  // ground friction bleeds speed fast: stopping dead is how you aim
  if (f.grounded && ix === 0 && iz === 0) {
    const damp = Math.max(0, 1 - 11 * dt);
    f.vx *= damp; f.vz *= damp;
  }
  const sp = Math.hypot(f.vx, f.vz);
  if (sp > topSpeed) {
    f.vx = (f.vx / sp) * topSpeed;
    f.vz = (f.vz / sp) * topSpeed;
  }

  // --- vertical
  if (input.keys.has('Space') && f.grounded) {
    f.vy = JUMP_VEL;
    f.grounded = false;
  }
  if (!f.grounded) {
    f.vy -= GRAVITY * dt;
    f.y += f.vy * dt;
    if (f.y <= 0) { f.y = 0; f.vy = 0; f.grounded = true; }
  }

  const moved = slideMove(colliders, f.x, f.z, f.radius, f.vx * dt, f.vz * dt);
  f.x = moved.x; f.z = moved.z;

  // --- combat
  f.scoped = !!(def && def.scoped && input.aiming);
  if (input.consumePress('KeyR')) startReload(f, now);
  if (input.firing && def && now >= f.reloadingUntil) {
    // full-auto weapons fire while held; semi-auto once per click
    if (def.auto || !f.mouseHeld) {
      if (tryFire(state, colliders, f, rng, events, now)) {
        f.pitch = clamp(f.pitch + def.kick, -1.45, 1.45); // recoil climbs
      }
    }
  }
  f.mouseHeld = input.firing;
  // weapon slots 1/2, grenades on 3/4/5
  for (const [code, idx] of [['Digit1', 0], ['Digit2', 1]]) {
    if (input.consumePress(code) && f.weapons[idx]) {
      f.current = idx;
      f.reloadingUntil = 0;
      f.scoped = false;
    }
  }
  for (const [code, kind] of [['Digit3', 'frag'], ['Digit4', 'flash'], ['Digit5', 'smoke']]) {
    if (input.consumePress(code)) throwGrenade(state, f, kind, now);
  }
  // bomb interaction is handled by rounds.js (it reads KeyE near a site)
}
