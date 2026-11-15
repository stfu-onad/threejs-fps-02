// characters.js — how fighters look: low-poly soldiers and the gun viewmodel.
// One job: build and animate the visible bodies. The simulation never reads
// these meshes; it only writes positions into them, so the look can change
// without touching the game logic.

import * as THREE from 'three';
import { PALETTE } from './map.js';
import { bodyHeight } from './weapons.js';

const geoCache = {
  leg: new THREE.BoxGeometry(0.17, 0.78, 0.2),
  torso: new THREE.BoxGeometry(0.46, 0.62, 0.26),
  vest: new THREE.BoxGeometry(0.5, 0.4, 0.32),
  arm: new THREE.BoxGeometry(0.13, 0.6, 0.15),
  head: new THREE.BoxGeometry(0.26, 0.28, 0.26),
  helmet: new THREE.BoxGeometry(0.32, 0.14, 0.32),
  gunBody: new THREE.BoxGeometry(0.09, 0.16, 0.78),
  gunBarrel: new THREE.BoxGeometry(0.045, 0.045, 0.4),
  gunStock: new THREE.BoxGeometry(0.07, 0.13, 0.24),
};

const matCache = {};
function mat(color, rough = 0.85) {
  if (!matCache[color]) {
    matCache[color] = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
  }
  return matCache[color];
}

const TEAM_STYLE = {
  wardens: { uniform: 0x33566e, vest: PALETTE.warden, skin: 0xc9a189, helmet: 0x24455c },
  jackals: { uniform: 0x6e4633, vest: PALETTE.jackal, skin: 0xb98a68, helmet: 0x54331f },
};

export function makeFighterMesh(team) {
  const s = TEAM_STYLE[team];
  const g = new THREE.Group();
  const parts = {};
  const add = (name, geo, material, x, y, z) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    parts[name] = m;
    return m;
  };
  add('legL', geoCache.leg, mat(s.uniform), -0.13, 0.39, 0);
  add('legR', geoCache.leg, mat(s.uniform), 0.13, 0.39, 0);
  add('torso', geoCache.torso, mat(s.uniform), 0, 1.09, 0);
  add('vest', geoCache.vest, mat(s.vest), 0, 1.12, 0);
  add('armL', geoCache.arm, mat(s.uniform), -0.32, 1.12, -0.08);
  add('armR', geoCache.arm, mat(s.uniform), 0.32, 1.12, -0.08);
  parts.armL.rotation.x = -1.15;
  parts.armR.rotation.x = -1.25;
  add('head', geoCache.head, mat(s.skin, 0.6), 0, 1.56, 0);
  add('helmet', geoCache.helmet, mat(s.helmet), 0, 1.72, 0);
  // the gun, held forward (-z is the facing direction)
  const gun = new THREE.Group();
  const gb = new THREE.Mesh(geoCache.gunBody, mat(0x1d1f23, 0.5));
  gb.castShadow = true;
  gun.add(gb);
  const barrel = new THREE.Mesh(geoCache.gunBarrel, mat(0x101114, 0.4));
  barrel.position.set(0, 0.03, -0.55);
  gun.add(barrel);
  const stock = new THREE.Mesh(geoCache.gunStock, mat(0x2a2118, 0.7));
  stock.position.set(0, -0.02, 0.45);
  gun.add(stock);
  gun.position.set(0.18, 1.32, -0.3);
  g.add(gun);
  parts.gun = gun;
  // muzzle point, main.js flashes a light/sprite here when firing
  parts.muzzle = new THREE.Object3D();
  parts.muzzle.position.set(0, 0.03, -0.78);
  gun.add(parts.muzzle);
  g.userData.parts = parts;
  g.userData.walkPhase = 0;
  return g;
}

// Pose a fighter's mesh from its simulation state. `now` is sim time.
export function syncMesh(fighter, dt, now) {
  const g = fighter.mesh;
  if (!g) return;
  const parts = g.userData.parts;
  g.position.set(fighter.x, fighter.y, fighter.z);
  // the model is built facing -z, and a fighter's facing direction is
  // (-sin yaw, -cos yaw): exactly what rotation.y = yaw produces
  g.rotation.y = fighter.yaw;
  const targetH = bodyHeight(fighter);
  const speed = Math.hypot(fighter.vx, fighter.vz);
  if (fighter.alive) {
    g.rotation.x = 0;
    g.position.y = fighter.y;
    g.userData.walkPhase += dt * (2 + speed * 1.9);
    const swing = Math.min(speed / 4, 1) * 0.55;
    parts.legL.rotation.x = Math.sin(g.userData.walkPhase) * swing;
    parts.legR.rotation.x = -Math.sin(g.userData.walkPhase) * swing;
    const crouchDrop = (1.78 - targetH) * 0.7;
    parts.torso.position.y = 1.09 - crouchDrop;
    parts.vest.position.y = 1.12 - crouchDrop;
    parts.head.position.y = 1.56 - crouchDrop;
    parts.helmet.position.y = 1.72 - crouchDrop;
    parts.gun.position.y = 1.32 - crouchDrop;
    parts.gun.rotation.x = -fighter.pitch * 0.7;
    g.visible = true;
  } else {
    // dead: fall flat, then sink away after a few seconds
    g.rotation.x = -Math.PI / 2;
    g.position.y = fighter.y + 0.16;
    const sinceDeath = fighter.deathT !== undefined ? now - fighter.deathT : 0;
    g.visible = sinceDeath < 6;
  }
}

// ------------------------------------------------------------ viewmodel
const vmMats = {
  gun: new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.45, metalness: 0.55 }),
  accent: new THREE.MeshStandardMaterial({ color: 0x8a5a24, roughness: 0.6, metalness: 0.2 }),
  hand: new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.9 }),
};

export function makeViewmodel(defId) {
  const g = new THREE.Group();
  const bodyLen = defId === 'longbow' ? 1.05 : defId === 'p9' ? 0.34 : 0.8;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.13, bodyLen), vmMats.gun);
  g.add(body);
  const barrel = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.04, defId === 'longbow' ? 0.5 : 0.3), vmMats.gun);
  barrel.position.set(0, 0.035, -bodyLen / 2 - 0.12);
  g.add(barrel);
  if (defId !== 'p9') {
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.09), vmMats.gun);
    mag.position.set(0, -0.15, 0.02);
    mag.rotation.x = 0.25;
    g.add(mag);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.16, 0.07), vmMats.accent);
    grip.position.set(0, -0.13, 0.22);
    grip.rotation.x = 0.4;
    g.add(grip);
  }
  if (defId === 'breacher') {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.22), vmMats.accent);
    pump.position.set(0, -0.05, -0.3);
    g.add(pump);
  }
  if (defId === 'longbow') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.22, 10), vmMats.gun);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.11, -0.05);
    g.add(scope);
  }
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.16), vmMats.hand);
  hand.position.set(0.01, -0.12, 0.2);
  g.add(hand);
  const hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.16), vmMats.hand);
  hand2.position.set(0, -0.09, -0.28);
  g.add(hand2);
  g.position.set(0.24, -0.22, -0.45);
  g.userData.basePos = g.position.clone();
  return g;
}
