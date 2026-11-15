// bots.js — the bot fighters: perception, plans and gunfights.
// One job: give every computer fighter a brain. Bots see through a vision
// cone with line of sight, hear gunfire, follow waypoint routes to a team
// plan (rush a site, hold a site, retake and defuse), and fight the way
// the gunplay rules reward: move, stop, burst — because spread punishes
// firing on the move for them exactly as for the human.

import { slideMove, lineClear } from './physics.js';
import { findPath, nearestWaypoint } from './map.js';
import { tryFire, startReload, throwGrenade, visionBlockedBySmoke, WEAPONS, GRENADE_PRICE } from './weapons.js';
import { TEAM, PHASE, otherTeam, aliveOf } from './state.js';
import { WALK_SPEED } from './player.js';
import { clamp, angleDelta, dist2D } from './rng.js';

const SIGHT_RANGE = 44;
const SIGHT_HALF_ANGLE = 1.15; // ~66 degrees
const HEAR_RANGE = 20;
// Attackers pushing a lane do not stop to trade potshots across the whole
// yard: they commit to a fight inside this range and keep moving outside
// it. Defenders on a post have no such hurry and engage at any range.
const ENGAGE_RANGE = 27;

export function createBrain(rng) {
  return {
    mode: 'advance',        // advance | engage | hold | plant | defuse | retake
    path: [], pathI: 0,
    goalX: 0, goalZ: 0, hasGoal: false,
    plan: null,             // per-round assignment from assignRoundPlans
    nextThink: 0, nextBurstAt: 0, burstLeft: 0, movePhaseUntil: 0,
    reactAt: 0, targetId: null,
    lastSeenX: 0, lastSeenZ: 0, lastSeenAt: -99,
    strafeDir: 1, strafeUntil: 0,
    lastHp: 100, skill: 0.5 + rng.next() * 0.5,
    reaction: 0.42 - rng.next() * 0.14,
    holdX: 0, holdZ: 0, holdYaw: 0,
    threwUtility: false,
  };
}

// ------------------------------------------------------------- planning
// Called once per round by rounds.js. Attackers pick a site and split into
// a hit squad and a lurk; defenders take posts (2-1-2 by default) and the
// flex reads the round. The human's teammates get plans too, so the round
// reads as a team effort whichever side the player picked.
export function assignRoundPlans(state, mapData, rng) {
  const site = rng.chance(0.5) ? 'A' : 'B';
  const siteWp = site === 'A' ? 11 : 15;
  const otherWp = site === 'A' ? 15 : 11;
  const bots = state.fighters.filter((f) => !f.isPlayer);
  const jackals = bots.filter((f) => f.team === TEAM.JACKALS);
  const wardens = bots.filter((f) => f.team === TEAM.WARDENS);

  jackals.forEach((f, i) => {
    const b = f.brain;
    b.threwUtility = false;
    if (f.hasBomb) {
      b.plan = { role: 'carrier', site, wp: siteWp };
    } else if (i % 3 === 2) {
      // the lurk stages at the far lane and only commits late, so the
      // defence cannot read the hit from the first seconds
      const lurkSite = site === 'A' ? 'B' : 'A';
      b.plan = { role: 'lurk', site: lurkSite, wp: lurkSite === 'A' ? 8 : 12, finalWp: otherWp, released: false };
    } else {
      b.plan = { role: 'hit', site, wp: siteWp };
    }
    setGoal(state, mapData, f, mapData.waypoints[b.plan.wp].x, mapData.waypoints[b.plan.wp].z);
    b.mode = 'advance';
  });

  const posts = [
    { wp: 19, yaw: 2.6 }, { wp: 11, yaw: 0.6 },   // A post pair
    { wp: 20, yaw: -2.6 }, { wp: 15, yaw: -0.6 }, // B post pair
    { wp: 7, yaw: 3.14 },                          // mid watch
  ];
  wardens.forEach((f, i) => {
    const b = f.brain;
    b.threwUtility = false;
    const post = posts[i % posts.length];
    const w = mapData.waypoints[post.wp];
    b.plan = { role: 'hold', wp: post.wp };
    b.holdX = w.x; b.holdZ = w.z; b.holdYaw = post.yaw;
    setGoal(state, mapData, f, w.x, w.z);
    b.mode = 'advance'; // walks to post, then holds (see think())
  });
  state.teamPlan = { attackSite: site };
}

function setGoal(state, mapData, f, gx, gz) {
  const b = f.brain;
  b.goalX = gx; b.goalZ = gz; b.hasGoal = true;
  const from = nearestWaypoint(mapData.waypoints, f.x, f.z);
  const to = nearestWaypoint(mapData.waypoints, gx, gz);
  b.path = findPath(mapData.waypoints, from, to) || [to];
  b.pathI = 0;
}

// ------------------------------------------------------------ perception
function canSee(state, colliders, f, e, now) {
  if (now < f.blindUntil) return false;
  const d = dist2D(f.x, f.z, e.x, e.z);
  if (d > SIGHT_RANGE) return false;
  const toE = Math.atan2(-(e.x - f.x), -(e.z - f.z));
  if (d > 4 && Math.abs(angleDelta(f.yaw, toE)) > SIGHT_HALF_ANGLE) return false;
  if (!lineClear(colliders, f.x, f.z, e.x, e.z, 1.35)) return false;
  if (visionBlockedBySmoke(state, f.x, f.z, e.x, e.z)) return false;
  return true;
}

function hearShots(state, f, now) {
  for (const n of state.noise) {
    if (now - n.t > 2.2) continue;
    if (n.team === f.team) continue;
    if (dist2D(f.x, f.z, n.x, n.z) < HEAR_RANGE) return n;
  }
  return null;
}

// ---------------------------------------------------------------- think
function think(state, mapData, f, rng, now) {
  const b = f.brain;
  const colliders = mapData.colliders;
  // --- perception: nearest visible enemy
  let seen = null, seenD = Infinity;
  for (const e of state.fighters) {
    if (!e.alive || e.team === f.team) continue;
    if (canSee(state, colliders, f, e, now)) {
      const d = dist2D(f.x, f.z, e.x, e.z);
      if (d < seenD) { seenD = d; seen = e; }
    }
  }
  if (seen) {
    if (b.targetId !== seen.id) {
      b.targetId = seen.id;
      b.reactAt = now + b.reaction * (0.7 + rng.next() * 0.6);
      b.trackHp = seen.hp;
      b.stallSince = now;
    }
    b.lastSeenX = seen.x; b.lastSeenZ = seen.z; b.lastSeenAt = now;
    b.nearestSeenD = seenD;
    const holding = b.mode === 'hold' || (b.plan && b.plan.role === 'hold' && !b.hasGoal);
    // the bomb carrier has one job: it only stops to fight in self-defence
    // at close range; its escorts handle the mid-yard scrum
    const commitRange = f.hasBomb ? 15 : ENGAGE_RANGE;
    const suppressed = now < (b.suppressEngageUntil || 0) && seenD >= 16;
    if (b.mode !== 'plant' && b.mode !== 'defuse' && !suppressed && (holding || seenD <= commitRange)) {
      b.mode = 'engage';
    }
    // a duel that is going nowhere at range is a stall: if the target's
    // health has not moved for a few seconds, push closer and finish it
    if (seen.hp < b.trackHp) { b.trackHp = seen.hp; b.stallSince = now; }
    if (b.mode === 'engage' && !holding && seenD > 14 && now - b.stallSince > 4) {
      b.mode = 'advance';
      b.suppressEngageUntil = now + 2.5;
      setGoal(state, mapData, f, seen.x, seen.z);
    }
    // ...but a pusher who drifted into a long-range duel breaks off and
    // resumes the plan instead of farming a stalemate at 40 metres
    if (b.mode === 'engage' && !holding && seenD > ENGAGE_RANGE + 9
        && f.team === TEAM.JACKALS && !state.bomb.planted) {
      b.mode = 'advance';
      b.targetId = null;
      if (b.plan && b.plan.wp !== undefined) {
        const w = mapData.waypoints[b.plan.wp];
        setGoal(state, mapData, f, w.x, w.z);
      }
    }
  } else if (b.mode === 'engage' && now - b.lastSeenAt > 2.6) {
    b.targetId = null;
    if (state.bomb.planted && f.team === TEAM.WARDENS) {
      b.mode = 'retake';
      const s = mapData.sites[state.bomb.site];
      setGoal(state, mapData, f, s.x, s.z);
    } else if (f.team === TEAM.WARDENS && b.plan && b.plan.role === 'hold') {
      // walk back to the post; arrival flips the mode to hold (below)
      b.mode = 'advance';
      const w = mapData.waypoints[b.plan.wp];
      setGoal(state, mapData, f, w.x, w.z);
    } else if (f.team === TEAM.JACKALS && b.plan && b.plan.wp !== undefined && !state.bomb.planted) {
      // resume the push: re-path to the plan's site from wherever the
      // fight left this bot
      b.mode = 'advance';
      const w = mapData.waypoints[b.plan.wp];
      setGoal(state, mapData, f, w.x, w.z);
    } else {
      b.mode = 'advance';
    }
  }
  // --- being shot at and not seeing anyone: turn toward the fight
  if (!seen && f.hp < b.lastHp) {
    const n = hearShots(state, f, now);
    if (n) { b.lastSeenX = n.x; b.lastSeenZ = n.z; b.lastSeenAt = now; }
  }
  b.lastHp = f.hp;
  // --- hearing gunfire while holding: the flex rotates, posts stay
  if (!seen && b.mode === 'hold') {
    const n = hearShots(state, f, now);
    if (n && b.plan && b.plan.role === 'hold' && f.id % 3 === 0) {
      b.mode = 'advance';
      setGoal(state, mapData, f, n.x, n.z);
    }
  }
  // --- bomb logic
  // the lurk commits once the round clock runs low (or the bomb is down)
  if (b.plan && b.plan.role === 'lurk' && !b.plan.released && !state.bomb.planted
      && state.phaseT <= 55 && state.phase === PHASE.LIVE) {
    b.plan.released = true;
    b.plan.wp = b.plan.finalWp;
    if (b.mode === 'hold' || b.mode === 'advance') {
      b.mode = 'advance';
      const w = mapData.waypoints[b.plan.wp];
      setGoal(state, mapData, f, w.x, w.z);
    }
  }
  if (f.hasBomb && !state.bomb.planted) {
    const s = mapData.sites[b.plan ? b.plan.site : 'A'];
    // plant when on the site and nobody is close enough to stop it: a
    // distant duel across the yard is the escorts' problem, not the plant's
    const siteClear = !seen || (b.nearestSeenD !== undefined && b.nearestSeenD > 13);
    if (dist2D(f.x, f.z, s.x, s.z) < s.r - 1.5 && siteClear) b.mode = 'plant';
    else if (b.mode === 'plant') b.mode = 'advance';
  }
  // a dropped bomb is worth recovering: the nearest attackers go for it
  if (!state.bomb.planted && state.bomb.dropped && f.team === TEAM.JACKALS
      && b.mode !== 'engage' && !f.hasBomb) {
    const d = dist2D(f.x, f.z, state.bomb.dropped.x, state.bomb.dropped.z);
    const mateCloser = state.fighters.some((m) => m.alive && !m.isPlayer && m.team === TEAM.JACKALS
      && m !== f && dist2D(m.x, m.z, state.bomb.dropped.x, state.bomb.dropped.z) < d - 2);
    if (!mateCloser) {
      b.mode = 'advance';
      setGoal(state, mapData, f, state.bomb.dropped.x, state.bomb.dropped.z);
    }
  }
  // attackers who reached their site without the bomb hold its angles
  if (!state.bomb.planted && f.team === TEAM.JACKALS && !f.hasBomb
      && b.mode === 'advance' && !b.hasGoal && b.plan && b.plan.wp !== undefined) {
    const w = mapData.waypoints[b.plan.wp];
    if (dist2D(f.x, f.z, w.x, w.z) < 4) {
      b.mode = 'hold';
      b.holdX = f.x; b.holdZ = f.z;
      b.holdYaw = f.team === TEAM.JACKALS ? 0 : f.yaw;
    }
  }
  if (state.bomb.planted) {
    if (f.team === TEAM.JACKALS && b.mode !== 'engage') {
      b.mode = 'hold';
      b.holdX = f.x; b.holdZ = f.z;
      b.holdYaw = Math.atan2(-(state.bomb.x - f.x), -(state.bomb.z - f.z));
    }
    if (f.team === TEAM.WARDENS && b.mode !== 'engage' && b.mode !== 'defuse') {
      const s = mapData.sites[state.bomb.site];
      const nearBomb = dist2D(f.x, f.z, state.bomb.x, state.bomb.z) < 2.2;
      const anyWardenNear = aliveOf(state, TEAM.WARDENS).some((w) => dist2D(w.x, w.z, state.bomb.x, state.bomb.z) < 3);
      if (nearBomb && !seen) b.mode = 'defuse';
      else if (b.mode !== 'retake' || !b.hasGoal) {
        b.mode = 'retake';
        setGoal(state, mapData, f, s.x + rng.range(-2, 2), s.z + rng.range(-2, 2));
      }
      void anyWardenNear;
    }
  }
  // --- arrived at a defender post: settle into hold
  if (!state.bomb.planted && f.team === TEAM.WARDENS && b.plan && b.plan.role === 'hold'
      && b.mode === 'advance' && !b.hasGoal) {
    b.mode = 'hold';
    b.holdX = f.x; b.holdZ = f.z;
  }
  // --- utility: throw one grenade toward a seen enemy at mid range
  if (seen && !b.threwUtility && seenD > 9 && seenD < 24 && rng.chance(0.5)) {
    const kind = f.grenades.frag > 0 ? 'frag' : f.grenades.flash > 0 ? 'flash' : null;
    if (kind) {
      f.yaw = Math.atan2(-(seen.x - f.x), -(seen.z - f.z));
      f.pitch = 0.08;
      if (throwGrenade(state, f, kind, now)) b.threwUtility = true;
    }
  }
}

// ----------------------------------------------------------------- act
export function updateBot(state, mapData, f, rng, events, now, dt) {
  const b = f.brain;
  if (!f.alive || !b) return;
  if (now >= b.nextThink) {
    b.nextThink = now + 0.12;
    think(state, mapData, f, rng, now);
  }
  const colliders = mapData.colliders;
  let moveX = 0, moveZ = 0, wantSpeed = 0;

  if (b.mode === 'engage') {
    const t = state.fighters.find((e) => e.id === b.targetId && e.alive);
    const tx = t ? t.x : b.lastSeenX;
    const tz = t ? t.z : b.lastSeenZ;
    const d = dist2D(f.x, f.z, tx, tz);
    // face the target, leading it slightly as it moves; the aim error
    // settles the longer the target is tracked
    const lead = t ? clamp(d / 55, 0, 0.55) : 0;
    const aimX = tx + (t ? t.vx * lead : 0);
    const aimZ = tz + (t ? t.vz * lead : 0);
    const trackTime = clamp(now - (b.reactAt - b.reaction), 0, 1.6);
    const err = (1 - trackTime / 1.6) * 0.045 + 0.006;
    f.yaw = Math.atan2(-(aimX - f.x), -(aimZ - f.z)) + rng.gauss(err);
    f.pitch = clamp(Math.atan2(1.35 - 1.6, Math.max(d, 1)) + rng.gauss(err * 0.6), -0.5, 0.5);
    // counter-strafe: move, then stop and burst — the spread model pays off
    if (now >= b.strafeUntil) {
      b.strafeDir = rng.chance(0.5) ? 1 : -1;
      b.strafeUntil = now + rng.range(0.45, 0.95);
      b.burstLeft = 0;
    }
    const stopping = b.burstLeft > 0 || (t && now >= b.reactAt && d < SIGHT_RANGE);
    if (t && now >= b.reactAt && lineClear(colliders, f.x, f.z, t.x, t.z, 1.35)
        && !visionBlockedBySmoke(state, f.x, f.z, t.x, t.z)) {
      if (b.burstLeft <= 0 && now >= b.nextBurstAt) {
        const def = WEAPONS[f.weapons[f.current].defId];
        // automatics fire a burst; semi-autos fire a quick string of
        // aimed shots — the weapon's own rpm still spaces them
        b.burstLeft = def.auto ? rng.int(4, 8) : rng.int(2, 3);
      }
      if (b.burstLeft > 0) {
        if (tryFire(state, colliders, f, rng, events, now)) b.burstLeft -= 1;
        if (b.burstLeft <= 0) b.nextBurstAt = now + rng.range(0.2, 0.42);
      }
      f.crouch = d > 16 && b.burstLeft > 0;
    } else {
      // lost sight mid-fight: push the last seen point
      moveX = tx - f.x; moveZ = tz - f.z;
      wantSpeed = 1;
      f.crouch = false;
    }
    if (!stopping || b.burstLeft <= 0 || now < f.reloadingUntil) {
      // strafe sideways while between bursts or reloading — a slow,
      // readable sway, not a sprint: a target that must also stop to
      // shoot straight
      const px = Math.cos(f.yaw) * b.strafeDir, pz = -Math.sin(f.yaw) * b.strafeDir;
      if (b.burstLeft <= 0 || now < f.reloadingUntil) { moveX = px; moveZ = pz; wantSpeed = 0.26; }
    }
    if (d < 5) { moveX = f.x - tx; moveZ = f.z - tz; wantSpeed = 0.7; } // don't hug
  } else if (b.mode === 'hold') {
    f.yaw += clamp(angleDelta(f.yaw, b.holdYaw + Math.sin(now * 0.4 + f.id) * 0.5) , -dt, dt) * 1.4;
    f.crouch = f.id % 2 === 0;
  } else if (b.mode === 'plant' || b.mode === 'defuse') {
    // rounds.js runs the channel; the bot stands (crouches) on the spot
    f.crouch = true;
    const faceX = state.bomb.planted ? state.bomb.x : f.x + -Math.sin(f.yaw) * 4;
    const faceZ = state.bomb.planted ? state.bomb.z : f.z + -Math.cos(f.yaw) * 4;
    f.yaw = Math.atan2(-(faceX - f.x), -(faceZ - f.z));
  } else {
    // advance / retake: walk the path
    f.crouch = false;
    if (b.pathI < b.path.length) {
      const wp = mapData.waypoints[b.path[b.pathI]];
      if (dist2D(f.x, f.z, wp.x, wp.z) < 0.9) b.pathI += 1;
    }
    let gx = b.goalX, gz = b.goalZ;
    if (b.pathI < b.path.length) {
      gx = mapData.waypoints[b.path[b.pathI]].x;
      gz = mapData.waypoints[b.path[b.pathI]].z;
    }
    // unstick: if we have barely moved while trying to walk, sidestep the
    // target point briefly — corners of crates can trap a sliding circle
    if (b.lastX === undefined) { b.lastX = f.x; b.lastZ = f.z; b.lastMoveAt = now; b.wiggleUntil = 0; }
    if (now - b.lastMoveAt > 0.8) {
      if (dist2D(f.x, f.z, b.lastX, b.lastZ) < 0.35) b.wiggleUntil = now + 0.55;
      b.lastX = f.x; b.lastZ = f.z; b.lastMoveAt = now;
    }
    if (now < b.wiggleUntil) {
      const px = Math.cos(f.yaw), pz = -Math.sin(f.yaw);
      gx += px * 2.2; gz += pz * 2.2;
    }
    const d = dist2D(f.x, f.z, gx, gz);
    if (b.pathI >= b.path.length && dist2D(f.x, f.z, b.goalX, b.goalZ) < 1.1) {
      b.hasGoal = false;
    } else {
      moveX = gx - f.x; moveZ = gz - f.z;
      wantSpeed = 1;
      if (d > 0.2) f.yaw = Math.atan2(-moveX, -moveZ);
    }
  }

  // reload whenever the magazine runs dry — including mid-fight, where a
  // bot that never reloads freezes forever with an empty gun — and
  // opportunistically at a quiet post when the mag is nearly out
  const w = f.weapons[f.current];
  if (w && w.ammo === 0) startReload(f, now);
  else if (w && w.ammo <= 4 && b.mode === 'hold') startReload(f, now);

  // --- integrate movement with the same rules as the human
  const def = w ? WEAPONS[w.defId] : null;
  const top = WALK_SPEED * (def ? def.moveSpeed : 1) * (f.crouch ? 0.45 : 1) * wantSpeed;
  const ml = Math.hypot(moveX, moveZ);
  let tvx = 0, tvz = 0;
  if (ml > 0.01 && top > 0) { tvx = (moveX / ml) * top; tvz = (moveZ / ml) * top; }
  const blend = clamp(dt * 9, 0, 1);
  f.vx += (tvx - f.vx) * blend;
  f.vz += (tvz - f.vz) * blend;
  if (Math.hypot(f.vx, f.vz) > 0.05 || ml > 0.01) {
    const moved = slideMove(colliders, f.x, f.z, f.radius, f.vx * dt, f.vz * dt);
    f.x = moved.x; f.z = moved.z;
  }
}

// -------------------------------------------------------------- buying
// A simple, sensible buy policy the bots share: armour first on a budget,
// rifles when rich, utility with what's left, kits for defenders.
export function botBuy(f, rng) {
  const spend = (fn) => fn();
  void spend;
  const hasPrimary = f.weapons.some((w) => WEAPONS[w.defId].slot === 'primary');
  if (f.money >= 1000 && f.armor < 100) { f.money -= 1000; f.armor = 100; f.helmet = true; }
  else if (f.money >= 650 && f.armor < 100) { f.money -= 650; f.armor = 100; }
  if (!hasPrimary) {
    if (f.money >= 2700) buyWeapon(f, 'vk7');
    else if (f.money >= 1500) buyWeapon(f, rng.chance(0.6) ? 'raptor' : 'breacher');
  }
  if (f.team === TEAM.WARDENS && !f.kit && f.money >= 900) { f.money -= 400; f.kit = true; }
  if (f.money >= 600 && f.grenades.frag === 0 && rng.chance(0.6)) { f.money -= GRENADE_PRICE.frag; f.grenades.frag = 1; }
  if (f.money >= 500 && f.grenades.flash === 0 && rng.chance(0.5)) { f.money -= GRENADE_PRICE.flash; f.grenades.flash = 1; }
  if (f.money >= 500 && f.grenades.smoke === 0 && rng.chance(0.35)) { f.money -= GRENADE_PRICE.smoke; f.grenades.smoke = 1; }
}

export function buyWeapon(f, defId) {
  const def = WEAPONS[defId];
  if (f.money < def.price) return false;
  f.money -= def.price;
  const inst = { defId, ammo: def.mag, reserve: def.reserve };
  if (def.slot === 'primary') {
    const i = f.weapons.findIndex((w) => WEAPONS[w.defId].slot === 'primary');
    if (i >= 0) f.weapons[i] = inst; else f.weapons.unshift(inst);
    f.current = 0;
  } else {
    const i = f.weapons.findIndex((w) => WEAPONS[w.defId].slot === 'sidearm');
    if (i >= 0) f.weapons[i] = inst; else f.weapons.push(inst);
  }
  return true;
}
