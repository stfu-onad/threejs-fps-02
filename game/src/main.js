// main.js — boot, the fixed-step loop, effects and the camera.
// One job: conduct. It owns the renderer and the clock, steps the
// simulation at a fixed 60 Hz (rendering is decoupled and interpolates
// nothing — the sim is cheap), feeds events from the sim to sound and
// effects, and poses the deterministic ?shot= scenes the screenshots
// are taken from.

import * as THREE from 'three';
import { createState, PHASE, TEAM, otherTeam } from './state.js';
import { buildMap } from './map.js';
import { Rng } from './rng.js';
import { createInput } from './input.js';
import { updatePlayer } from './player.js';
import { updateBot } from './bots.js';
import { setupMatch, startRound, updateRounds, buyItem } from './rounds.js';
import { updateGrenades, finishReload, eyeHeight, WEAPONS } from './weapons.js';
import { makeFighterMesh, syncMesh, makeViewmodel } from './characters.js';
import { createHud, BUY_ITEMS } from './hud.js';
import * as SFX from './audio.js';

const SIM_DT = 1 / 60;
const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');
const shotSeed = parseInt(params.get('seed') || '1', 10);

// ------------------------------------------------------------------ boot
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 400);
scene.add(camera);

const mapData = buildMap(scene);
const state = createState();
const rng = new Rng((Math.random() * 1e9) | 0);
const input = createInput(renderer.domElement);

let player = null;
let viewmodel = null;
let viewmodelDef = null;
let shake = 0;
let prevPhase = state.phase;
let stepCount = 0;

// ---------------------------------------------------------------- effects
const fx = {
  tracers: [],
  particles: null,
  particleData: [],
  muzzleLight: new THREE.PointLight(0xffc37a, 0, 13, 1.6),
  smokes: new Map(),
  bombMesh: null,
  bombLight: null,
};
scene.add(fx.muzzleLight);

{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
  fx.particles = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffd9a0, size: 0.14, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  fx.particles.frustumCulled = false;
  scene.add(fx.particles);
  for (let i = 0; i < 600; i++) fx.particleData.push({ life: 0, vx: 0, vy: 0, vz: 0 });
}

const tracerMat = new THREE.LineBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85 });
function spawnTracer(x0, y0, z0, x1, y1, z1) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1)]);
  const line = new THREE.Line(geo, tracerMat);
  scene.add(line);
  fx.tracers.push({ line, until: state.time + 0.07 });
}

function spawnParticles(x, y, z, n, color, speed = 3.4, up = 2.2) {
  fx.particles.material.color.setHex(color);
  const pos = fx.particles.geometry.attributes.position;
  let placed = 0;
  for (let i = 0; i < fx.particleData.length && placed < n; i++) {
    const p = fx.particleData[i];
    if (p.life > 0) continue;
    p.life = 0.4 + Math.random() * 0.4;
    p.vx = (Math.random() - 0.5) * speed;
    p.vy = Math.random() * up;
    p.vz = (Math.random() - 0.5) * speed;
    pos.setXYZ(i, x, y, z);
    placed++;
  }
  pos.needsUpdate = true;
}

function updateFx(dt) {
  for (let i = fx.tracers.length - 1; i >= 0; i--) {
    if (state.time > fx.tracers[i].until) {
      scene.remove(fx.tracers[i].line);
      fx.tracers[i].line.geometry.dispose();
      fx.tracers.splice(i, 1);
    }
  }
  const pos = fx.particles.geometry.attributes.position;
  let any = false;
  for (let i = 0; i < fx.particleData.length; i++) {
    const p = fx.particleData[i];
    if (p.life <= 0) continue;
    any = true;
    p.life -= dt;
    p.vy -= 6.5 * dt;
    pos.setXYZ(i, pos.getX(i) + p.vx * dt, Math.max(0.03, pos.getY(i) + p.vy * dt), pos.getZ(i) + p.vz * dt);
    if (p.life <= 0) pos.setXYZ(i, 0, -10, 0);
  }
  if (any) pos.needsUpdate = true;
  fx.muzzleLight.intensity = Math.max(0, fx.muzzleLight.intensity - dt * 900);
  // smoke clouds follow state.smokes
  const seen = new Set();
  for (const s of state.smokes || []) {
    seen.add(s);
    if (!fx.smokes.has(s)) {
      const grp = new THREE.Group();
      for (let i = 0; i < 8; i++) {
        const sm = new THREE.Sprite(smokeSpriteMat);
        sm.position.set((Math.random() - 0.5) * 3.4, 0.9 + Math.random() * 1.8, (Math.random() - 0.5) * 3.4);
        const sc = 3.6 + Math.random() * 2.6;
        sm.scale.set(sc, sc, 1);
        grp.add(sm);
      }
      grp.position.set(s.x, 0, s.z);
      scene.add(grp);
      fx.smokes.set(s, grp);
    }
  }
  for (const [s, grp] of fx.smokes) {
    if (!seen.has(s)) { scene.remove(grp); fx.smokes.delete(s); }
  }
  // the bomb: planted (blinking) or dropped (pulsing ring on the ground)
  const bomb = state.bomb;
  const bombPos = bomb.planted ? { x: bomb.x, z: bomb.z }
    : bomb.dropped ? { x: bomb.dropped.x, z: bomb.dropped.z } : null;
  if (bombPos && !fx.bombMesh) {
    fx.bombMesh = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x23252a, roughness: 0.5, metalness: 0.4 }));
    body.position.y = 0.16;
    fx.bombMesh.add(body);
    fx.bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    fx.bombLight.position.y = 0.36;
    fx.bombMesh.add(fx.bombLight);
    scene.add(fx.bombMesh);
  }
  if (fx.bombMesh) {
    if (!bombPos) { scene.remove(fx.bombMesh); fx.bombMesh = null; }
    else {
      fx.bombMesh.position.set(bombPos.x, 0, bombPos.z);
      const rate = bomb.planted ? (state.phaseT < 10 ? 6 : 2.2) : 1.6;
      fx.bombLight.material.color.setHex(Math.sin(state.time * rate * Math.PI) > 0 ? 0xff2a1a : 0x440a06);
    }
  }
}

const smokeSpriteMat = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(196,200,208,0.85)');
  grad.addColorStop(1, 'rgba(196,200,208,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.62, depthWrite: false });
})();

// ------------------------------------------------------------------- hud
const hud = createHud((itemId) => {
  if (player && buyItem(state, player, itemId)) {
    SFX.playBuy();
    hud.renderBuy(state, player);
  }
});

document.getElementById('btn-wardens').addEventListener('click', () => startMatch(TEAM.WARDENS));
document.getElementById('btn-jackals').addEventListener('click', () => startMatch(TEAM.JACKALS));
document.getElementById('btn-again').addEventListener('click', () => startMatch(state.playerTeam));
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') hud.showTabBoard(state, true);
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') hud.showTabBoard(state, false);
});
renderer.domElement.addEventListener('click', () => {
  if ((state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED || state.phase === PHASE.END)
      && !input.locked && !shotMode) input.lockPointer();
});

function startMatch(team) {
  SFX.initAudio();
  // clear old meshes
  for (const f of state.fighters) if (f.mesh) { scene.remove(f.mesh); f.mesh = null; }
  setupMatch(state, rng, team);
  player = state.fighters[0];
  for (const f of state.fighters) {
    f.mesh = makeFighterMesh(f.team);
    scene.add(f.mesh);
    if (f.isPlayer) f.mesh.visible = false;
  }
  startRound(state, mapData, rng);
  hud.renderBuy(state, player);
  hud.banner('ROUND 1', team === TEAM.WARDENS ? 'Defend the bays' : 'Plant the bomb', 2.6);
  prevPhase = state.phase;
}

// ------------------------------------------------------------- events
const REASON_TEXT = {
  elimination: 'Enemy team eliminated',
  explosion: 'Target bombed',
  defused: 'Bomb defused',
  time: 'Target saved — time expired',
};

function processEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'shot': {
        const f = ev.fighter;
        state.noise.push({ x: f.x, z: f.z, t: state.time, team: f.team });
        if (state.noise.length > 24) state.noise.shift();
        const vol = f.isPlayer ? 0.9 : SFX.volumeAt(f.x, f.z, player.x, player.z);
        SFX.playShot(ev.defId, vol);
        // muzzle flash: light at the shooter's muzzle
        if (f.mesh && !f.isPlayer) {
          const p = new THREE.Vector3();
          f.mesh.userData.parts.muzzle.getWorldPosition(p);
          fx.muzzleLight.position.copy(p);
        } else {
          fx.muzzleLight.position.set(f.x, f.y + 1.5, f.z);
        }
        fx.muzzleLight.intensity = 26;
        break;
      }
      case 'tracer':
        spawnTracer(ev.x0, ev.y0, ev.z0, ev.x1, ev.y1, ev.z1);
        break;
      case 'wallhit':
        spawnParticles(ev.x, ev.y, ev.z, 4, 0xd8c9a8, 2.2, 1.4);
        break;
      case 'hit':
        if (ev.attacker && ev.attacker.isPlayer) hud.flashHitmarker(false);
        if (ev.victim.isPlayer) {
          SFX.playHurt();
          shake = Math.max(shake, 0.12);
          const d = document.getElementById('dmg');
          d.style.opacity = '1';
          setTimeout(() => { d.style.opacity = '0'; }, 160);
        }
        break;
      case 'kill': {
        ev.victim.deathT = state.time;
        const wname = ev.defId === 'frag' ? 'Frag' : (WEAPONS[ev.defId] ? WEAPONS[ev.defId].name : '');
        const head = ev.zone === 'head' ? ' ⌖' : '';
        const an = ev.attacker ? ev.attacker.name : '—';
        hud.addFeed(`<b>${an}</b> ▸ ${wname}${head} ▸ <b>${ev.victim.name}</b>`);
        if (ev.attacker && ev.attacker.isPlayer) hud.flashHitmarker(true);
        if (ev.victim.isPlayer) shake = Math.max(shake, 0.3);
        break;
      }
      case 'dryfire':
        if (ev.fighter.isPlayer) SFX.playDryfire(0.8);
        break;
      case 'explode':
        SFX.playExplosion(ev.big ? 1 : SFX.volumeAt(ev.x, ev.z, player.x, player.z));
        spawnParticles(ev.x, 1, ev.z, ev.big ? 90 : 42, 0xffa050, ev.big ? 9 : 6, 7);
        fx.muzzleLight.position.set(ev.x, 2, ev.z);
        fx.muzzleLight.intensity = 120;
        if (player) {
          const d = Math.hypot(player.x - ev.x, player.z - ev.z);
          if (d < 16) shake = Math.max(shake, 0.5 * (1 - d / 16));
        }
        break;
      case 'flashpop':
        if (player && player.blindUntil > state.time) {
          const d = document.getElementById('flashfx');
          d.style.opacity = '0.95';
        }
        break;
      case 'planted':
        hud.banner('BOMB PLANTED', `Bay ${ev.site} — defuse it or clear out`, 2.6);
        SFX.playBeep(1180); SFX.playBeep(1180, 0);
        break;
      case 'defused':
        SFX.playBeep(880);
        break;
      case 'roundlive':
        hud.banner('ROUND ' + state.round, 'Live — good hunting', 1.4);
        break;
      case 'matchover':
        SFX.playSting(ev.winner === state.playerTeam);
        if (input.locked) input.unlockPointer();
        break;
      default:
        break;
    }
  }
}

// ------------------------------------------------------------------ sim
function step(dt) {
  state.time += dt;
  stepCount++;
  const events = [];
  const now = state.time;

  if (state.phase === PHASE.BUY) {
    updateRounds(state, mapData, input, events, rng, now, dt);
    // number-key buying for the human
    if (player) {
      for (const item of BUY_ITEMS) {
        const code = item.key === '0' ? 'Digit0' : 'Digit' + item.key;
        if (input.consumePress(code)) {
          if (buyItem(state, player, item.id)) { SFX.playBuy(); hud.renderBuy(state, player); }
        }
      }
    }
  } else if (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED) {
    if (player && player.alive) updatePlayer(state, player, input, mapData.colliders, rng, events, now, dt);
    for (const f of state.fighters) {
      if (!f.isPlayer) updateBot(state, mapData, f, rng, events, now, dt);
    }
    updateGrenades(state, mapData.colliders, rng, events, now, dt);
    updateRounds(state, mapData, input, events, rng, now, dt);
  } else if (state.phase === PHASE.END || state.phase === PHASE.OVER) {
    updateGrenades(state, mapData.colliders, rng, events, now, dt);
    updateRounds(state, mapData, input, events, rng, now, dt);
  }

  // reloads finish for everyone on the same rule
  for (const f of state.fighters) {
    if (f.reloadWeapon && now >= f.reloadingUntil) {
      finishReload(f);
      if (f.isPlayer) SFX.playReload(0.7);
    }
  }
  // footsteps
  if (player && player.alive && state.phase === PHASE.LIVE) {
    const sp = Math.hypot(player.vx, player.vz);
    if (sp > 2 && player.grounded && stepCount % 21 === 0) SFX.playFootstep(0.5);
  }
  processEvents(events);

  // phase-change announcements
  if (state.phase === PHASE.END && prevPhase !== PHASE.END && state.roundResult) {
    const w = state.roundResult.winner;
    const mine = w === state.playerTeam;
    hud.banner(mine ? 'ROUND WON' : 'ROUND LOST',
      `${w === TEAM.WARDENS ? 'Wardens' : 'Jackals'} — ${REASON_TEXT[state.roundResult.reason] || ''}`, 3.4);
    SFX.playSting(mine);
    hud.renderBuy(state, player);
  }
  if (state.phase === PHASE.BUY && prevPhase !== PHASE.BUY && state.round > 1) {
    hud.banner('ROUND ' + state.round, 'Buy phase', 1.6);
    hud.renderBuy(state, player);
  }
  prevPhase = state.phase;

  // flash overlay decay for the human
  const flashEl = document.getElementById('flashfx');
  if (player && player.blindUntil <= now && flashEl.style.opacity !== '0') {
    flashEl.style.opacity = '0';
  }
}

// --------------------------------------------------------------- camera
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  if (state.phase === PHASE.MENU || shotMode === 'start') {
    const t = performance.now() / 1000 * 0.05;
    camera.position.set(Math.sin(t) * 30, 13 + Math.sin(t * 0.7) * 2.5, Math.cos(t) * 30 - 4);
    camera.lookAt(0, 1, -8);
    if (viewmodel) viewmodel.visible = false;
    return;
  }
  if (!player) return;
  if (player.alive || shotMode) {
    const eye = eyeHeight(player);
    const bobA = Math.min(Math.hypot(player.vx, player.vz) / 5, 1) * 0.035;
    const bobY = Math.sin(state.time * 9) * bobA;
    camera.position.set(player.x, player.y + eye + bobY, player.z);
    if (shake > 0.003) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
      shake *= Math.pow(0.0015, dt);
    } else shake = 0;
    camTarget.set(
      player.x - Math.sin(player.yaw) * Math.cos(player.pitch),
      camera.position.y + Math.sin(player.pitch),
      player.z - Math.cos(player.yaw) * Math.cos(player.pitch),
    );
    camera.lookAt(camTarget);
    camera.fov = player.scoped ? 38 : 75;
    camera.updateProjectionMatrix();
    // viewmodel follows the held weapon
    const def = player.weapons[player.current];
    const defId = def ? def.defId : 'p9';
    if (defId !== viewmodelDef) {
      if (viewmodel) camera.remove(viewmodel);
      viewmodel = makeViewmodel(defId);
      camera.add(viewmodel);
      viewmodelDef = defId;
    }
    if (viewmodel) {
      viewmodel.visible = true;
      const reloading = player.reloadingUntil > state.time;
      const kickBack = player.flashUntil > state.time ? 0.06 : 0;
      viewmodel.position.set(0.24, -0.22 + bobY * 0.6 + (reloading ? -0.09 : 0), -0.45 + kickBack);
      viewmodel.rotation.x = reloading ? -0.5 : (player.flashUntil > state.time ? 0.05 : 0);
      viewmodel.visible = !player.scoped;
    }
  } else {
    // dead: rise to an overview of the bomb site or mid yard
    const focus = state.bomb.planted ? state.bomb : { x: 0, z: -4 };
    camera.position.lerp(new THREE.Vector3(focus.x + 13, 15, focus.z + 15), 1 - Math.pow(0.2, dt));
    camera.lookAt(focus.x, 0.5, focus.z);
    if (viewmodel) viewmodel.visible = false;
  }
}

// ------------------------------------------------------------ shot modes
function setupShot(mode, seed) {
  const srng = new Rng(seed * 7919 + 13);
  if (mode === 'start') {
    state.phase = PHASE.MENU;
    return;
  }
  setupMatch(state, srng, TEAM.WARDENS);
  player = state.fighters[0];
  for (const f of state.fighters) {
    f.mesh = makeFighterMesh(f.team);
    scene.add(f.mesh);
    if (f.isPlayer) f.mesh.visible = false;
  }
  startRound(state, mapData, srng);
  const byName = (n) => state.fighters.find((f) => f.name === n);
  if (mode === 'buy') {
    state.phase = PHASE.BUY; state.phaseT = 9;
    hud.renderBuy(state, player);
  } else if (mode === 'play') {
    state.phase = PHASE.LIVE; state.phaseT = 63;
    // posed at the Bay A dock approach: an attacker crossing the dock
    // in the open, a teammate covering the left lane, a body down —
    // the round mid-fight
    player.x = -19; player.z = -19; player.yaw = 1.35; player.pitch = -0.02;
    player.hp = 78; player.money = 3400; player.armor = 100; player.helmet = true;
    player.weapons = [{ defId: 'vk7', ammo: 24, reserve: 90 }, { defId: 'p9', ammo: 12, reserve: 96 }];
    player.current = 0;
    const rook = byName('Rook');
    rook.x = -28; rook.z = -21; rook.yaw = -0.6; rook.vx = -2.2;
    const sable = byName('Sable');
    sable.x = -33; sable.z = -14; sable.yaw = 0.4;
    const cutler = byName('Cutler');
    cutler.x = -24; cutler.z = -18; cutler.alive = false; cutler.hp = 0; cutler.deathT = -2;
    const vex = byName('Vex');
    vex.x = -21; vex.z = -13.5; vex.yaw = 1.1;
    const hollis = byName('Hollis');
    hollis.x = -15; hollis.z = -24; hollis.yaw = 1.8;
    hud.addFeed('<b>Rook</b> ▸ VK-7 Rifle ▸ <b>Marsh</b>');
    hud.addFeed('<b>YOU</b> ▸ VK-7 Rifle ⌖ ▸ <b>Nyx</b>');
  } else if (mode === 'end') {
    state.score.wardens = 4; state.score.jackals = 2;
    state.round = 7;
    state.phase = PHASE.END; state.phaseT = 4;
    state.roundResult = { winner: TEAM.WARDENS, reason: 'defused' };
    state.bomb.planted = true; state.bomb.site = 'B';
    state.bomb.x = 26.4; state.bomb.z = -19.2;
    // standing in the Bay B approach with a clear line onto the site:
    // the defused bomb, a teammate covering, two attackers down
    player.x = 24; player.z = -13.5; player.yaw = -0.4; player.pitch = -0.05;
    player.money = 5200;
    const vex = byName('Vex');
    vex.x = 24.5; vex.z = -16.5; vex.yaw = 2.9;
    const rook = byName('Rook');
    rook.x = 28.5; rook.z = -17; rook.alive = false; rook.hp = 0; rook.deathT = -2;
    const sable = byName('Sable');
    sable.x = 24; sable.z = -22.5; sable.alive = false; sable.hp = 0; sable.deathT = -2;
    hud.banner('ROUND WON', 'Wardens — Bomb defused', 999);
  }
  prevPhase = state.phase;
}

// ----------------------------------------------------------------- loop
let last = performance.now();
let acc = 0;
let frames = 0;
renderer.setAnimationLoop(() => {
  const nowMs = performance.now();
  let frameDt = Math.min((nowMs - last) / 1000, 0.1);
  last = nowMs;
  if (shotMode) {
    // posed scenes: render the still, keep the phase clock pinned to a
    // realistic value so the HUD reads like a real moment of a match
    if (state.phase === PHASE.BUY) state.phaseT = 9;
    if (state.phase === PHASE.END) state.phaseT = 4;
    if (shotMode === 'play' && player) {
      // a frozen firefight: fresh tracers both ways + muzzle light
      if (frames % 3 === 0) {
        const rook = state.fighters.find((f) => f.name === 'Rook');
        if (rook) {
          spawnTracer(player.x, 1.5, player.z, rook.x, 1.3, rook.z);
          spawnTracer(rook.x, 1.45, rook.z, player.x + 0.8, 1.2, player.z);
          fx.muzzleLight.position.set(player.x, 1.55, player.z);
          fx.muzzleLight.intensity = 30;
          player.flashUntil = state.time + 0.05;
        }
      }
      state.time += frameDt;
    }
  } else {
    acc += frameDt;
    while (acc >= SIM_DT) { step(SIM_DT); acc -= SIM_DT; }
  }
  for (const f of state.fighters) if (f.mesh && !f.isPlayer) syncMesh(f, frameDt, state.time);
  updateFx(frameDt);
  updateCamera(frameDt);
  hud.update(state, player, nowMs / 1000);
  document.getElementById('locktip').style.display =
    (!shotMode && (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED) && !input.locked && player && player.alive)
      ? 'block' : 'none';
  renderer.render(scene, camera);
  frames++;
  if (shotMode && frames > 26) window.__shotReady = true;
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

if (shotMode) setupShot(shotMode, shotSeed);
