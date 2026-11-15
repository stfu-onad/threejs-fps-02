// rounds.js — match flow: rounds, the bomb, the economy, the buy.
// One job: run the phase machine (buy -> live -> planted -> end -> next)
// and the money. It owns when rounds start and end and why; bots.js and
// player.js only decide what individual fighters do inside a round.

import {
  PHASE, TEAM, WIN_SCORE, MAX_ROUNDS, BUY_SECONDS, ROUND_SECONDS,
  BOMB_SECONDS, END_SECONDS, createFighter, otherTeam, aliveOf, fighterById,
} from './state.js';
import { makeWeapon, WEAPONS, GRENADE_PRICE } from './weapons.js';
import { createBrain, assignRoundPlans, botBuy, buyWeapon } from './bots.js';
import { dist2D } from './rng.js';

const BOT_NAMES = {
  wardens: ['Vex', 'Hollis', 'Marsh', 'Ivers', 'Pike'],
  jackals: ['Rook', 'Sable', 'Cutler', 'Nyx', 'Vandal'],
};

export const PLANT_SECONDS = 3;
export const DEFUSE_WITH_KIT = 5;
export const DEFUSE_NO_KIT = 8;

export function setupMatch(state, rng, playerTeam) {
  state.playerTeam = playerTeam;
  state.fighters = [createFighter(0, playerTeam, true, 'YOU')];
  let id = 1;
  for (const team of [TEAM.WARDENS, TEAM.JACKALS]) {
    const needed = 5 - state.fighters.filter((f) => f.team === team).length;
    for (let i = 0; i < needed; i++) {
      const bot = createFighter(id++, team, false, BOT_NAMES[team][i]);
      bot.brain = createBrain(rng);
      state.fighters.push(bot);
    }
  }
  for (const f of state.fighters) {
    f.weapons = [makeWeapon('p9')];
    f.current = 0;
  }
  state.score = { wardens: 0, jackals: 0 };
  state.round = 0;
  state.matchWinner = null;
}

export function startRound(state, mapData, rng) {
  state.round += 1;
  state.phase = PHASE.BUY;
  state.phaseT = BUY_SECONDS;
  state.roundResult = null;
  state.noise = [];
  state.projectiles = [];
  state.smokes = [];
  state.bomb = { carrier: null, planted: false, site: null, x: 0, z: 0, channelBy: null, channelT: 0, dropped: null };

  const spawnIdx = { wardens: 0, jackals: 0 };
  for (const f of state.fighters) {
    const wasAlive = f.alive;
    f.alive = true;
    f.hp = 100;
    f.vx = 0; f.vz = 0; f.vy = 0; f.y = 0;
    f.crouch = false; f.scoped = false;
    f.reloadingUntil = 0; f.nextShotAt = 0; f.shotsFired = 0;
    f.blindUntil = 0; f.flashUntil = 0;
    if (!wasAlive) {
      // a fighter who died last round comes back with the starter kit
      f.weapons = [makeWeapon('p9')];
      f.armor = 0; f.helmet = false;
      f.grenades = { frag: 0, flash: 0, smoke: 0 };
      f.kit = false;
    } else {
      // survivors keep their gear but top up the current magazine's reserve
      for (const w of f.weapons) w.ammo = WEAPONS[w.defId].mag;
    }
    f.current = f.weapons.length - 1; // sidearm in hand during buy is fine; bots switch below
    const primary = f.weapons.findIndex((w) => WEAPONS[w.defId].slot === 'primary');
    if (primary >= 0) f.current = primary;
    const s = mapData.spawns[f.team][spawnIdx[f.team]++ % 5];
    f.x = s.x; f.z = s.z; f.yaw = s.yaw; f.pitch = 0;
    f.hasBomb = false;
    if (f.brain) { f.brain.mode = 'advance'; f.brain.targetId = null; }
  }
  // the bomb goes to a random attacking bot (never forced on the human)
  const jackalBots = state.fighters.filter((f) => f.team === TEAM.JACKALS && !f.isPlayer);
  const carrier = jackalBots[Math.floor(rng.next() * jackalBots.length)];
  carrier.hasBomb = true;
  state.bomb.carrier = carrier.id;
  // bots shop, then plans are drawn
  for (const f of state.fighters) if (!f.isPlayer) botBuy(f, rng);
  assignRoundPlans(state, mapData, rng);
}

function endRound(state, winner, reason) {
  state.phase = PHASE.END;
  state.phaseT = END_SECONDS;
  state.roundResult = { winner, reason };
  state.score[winner] += 1;
  const loser = otherTeam(winner);
  // economy
  const objective = reason === 'explosion' || reason === 'defused';
  for (const f of state.fighters) {
    if (f.team === winner) f.money += objective ? 2900 : 2700;
    else f.money += Math.min(1900 + state.lossStreak[loser] * 300, 3100);
    f.money = Math.min(f.money, 16000);
  }
  if (state.bomb.planted && winner === TEAM.JACKALS && reason === 'explosion') {
    // the planter already earned the team's gratitude; small bonus
    const planter = fighterById(state, state.bomb.planterId);
    if (planter) planter.money += 300;
  }
  state.lossStreak[winner] = 0;
  state.lossStreak[loser] += 1;
  state.bomb.channelBy = null;
}

// The buy menu (player) and nothing else calls this; bots use botBuy.
export function buyItem(state, f, item) {
  if (state.phase !== PHASE.BUY) return false;
  if (item === 'armor') {
    if (f.money < 650 || f.armor >= 100) return false;
    f.money -= 650; f.armor = 100; return true;
  }
  if (item === 'armorhelm') {
    if (f.money < 1000 || (f.armor >= 100 && f.helmet)) return false;
    f.money -= 1000; f.armor = 100; f.helmet = true; return true;
  }
  if (item === 'kit') {
    if (f.team !== TEAM.WARDENS || f.kit || f.money < 400) return false;
    f.money -= 400; f.kit = true; return true;
  }
  if (item in GRENADE_PRICE) {
    if (f.money < GRENADE_PRICE[item] || f.grenades[item] >= 1) return false;
    f.money -= GRENADE_PRICE[item]; f.grenades[item] += 1; return true;
  }
  if (item in WEAPONS) return buyWeapon(f, item);
  return false;
}

// -------------------------------------------------------------- channels
function updateChannel(state, mapData, input, now, dt, events) {
  const bomb = state.bomb;
  // who is trying to plant or defuse?
  let actor = null, kind = null;
  if (!bomb.planted) {
    const carrier = fighterById(state, bomb.carrier);
    if (carrier && carrier.alive && carrier.hasBomb) {
      const site = Object.entries(mapData.sites).find(([, s]) => dist2D(carrier.x, carrier.z, s.x, s.z) < s.r);
      if (site) {
        if (carrier.isPlayer) {
          if (input && input.keys.has('KeyE')) { actor = carrier; kind = 'plant'; bomb.pendingSite = site[0]; }
        } else if (carrier.brain && carrier.brain.mode === 'plant') {
          actor = carrier; kind = 'plant'; bomb.pendingSite = site[0];
        }
      }
    }
  } else {
    for (const f of state.fighters) {
      if (!f.alive || f.team !== TEAM.WARDENS) continue;
      if (dist2D(f.x, f.z, bomb.x, bomb.z) > 2.3) continue;
      if (f.isPlayer) {
        if (input && input.keys.has('KeyE')) { actor = f; kind = 'defuse'; break; }
      } else if (f.brain && f.brain.mode === 'defuse') { actor = f; kind = 'defuse'; break; }
    }
  }
  if (!actor) {
    bomb.channelBy = null; bomb.channelT = 0;
    return;
  }
  if (bomb.channelBy !== actor.id) { bomb.channelBy = actor.id; bomb.channelT = 0; }
  bomb.channelT += dt;
  bomb.channelKind = kind;
  const need = kind === 'plant' ? PLANT_SECONDS : (actor.kit ? DEFUSE_WITH_KIT : DEFUSE_NO_KIT);
  bomb.channelNeed = need;
  if (bomb.channelT >= need) {
    if (kind === 'plant') {
      bomb.planted = true;
      bomb.site = bomb.pendingSite;
      bomb.x = actor.x; bomb.z = actor.z;
      bomb.planterId = actor.id;
      actor.hasBomb = false;
      bomb.carrier = null;
      actor.money += 300;
      state.phase = PHASE.PLANTED;
      state.phaseT = BOMB_SECONDS;
      events.push({ type: 'planted', site: bomb.site, x: bomb.x, z: bomb.z });
    } else {
      events.push({ type: 'defused', x: bomb.x, z: bomb.z });
      endRound(state, TEAM.WARDENS, 'defused');
    }
    bomb.channelBy = null; bomb.channelT = 0;
  }
}

// ---------------------------------------------------------------- update
export function updateRounds(state, mapData, input, events, rng, now, dt) {
  // bomb drop & pickup
  const bomb = state.bomb;
  if (!bomb.planted && bomb.carrier !== null) {
    const carrier = fighterById(state, bomb.carrier);
    if (carrier && !carrier.alive) {
      bomb.dropped = { x: carrier.x, z: carrier.z };
      bomb.carrier = null;
      carrier.hasBomb = false;
      events.push({ type: 'bombdropped', x: bomb.dropped.x, z: bomb.dropped.z });
    }
  }
  if (!bomb.planted && bomb.dropped) {
    for (const f of state.fighters) {
      if (f.alive && f.team === TEAM.JACKALS && dist2D(f.x, f.z, bomb.dropped.x, bomb.dropped.z) < 1.3) {
        f.hasBomb = true;
        bomb.carrier = f.id;
        bomb.dropped = null;
        events.push({ type: 'bombpickup', fighter: f });
        break;
      }
    }
  }

  state.phaseT -= dt;
  switch (state.phase) {
    case PHASE.BUY:
      if (state.phaseT <= 0) {
        state.phase = PHASE.LIVE;
        state.phaseT = ROUND_SECONDS;
        events.push({ type: 'roundlive' });
      }
      break;
    case PHASE.LIVE: {
      updateChannel(state, mapData, input, now, dt, events);
      if (state.phase !== PHASE.LIVE) break; // planting flipped the phase
      const wardens = aliveOf(state, TEAM.WARDENS).length;
      const jackals = aliveOf(state, TEAM.JACKALS).length;
      if (wardens === 0) endRound(state, TEAM.JACKALS, 'elimination');
      else if (jackals === 0) endRound(state, TEAM.WARDENS, 'elimination');
      else if (state.phaseT <= 0) endRound(state, TEAM.WARDENS, 'time');
      break;
    }
    case PHASE.PLANTED: {
      updateChannel(state, mapData, input, now, dt, events);
      if (state.phase !== PHASE.PLANTED) break; // defused
      if (aliveOf(state, TEAM.WARDENS).length === 0) {
        endRound(state, TEAM.JACKALS, 'elimination');
      } else if (state.phaseT <= 0) {
        events.push({ type: 'explode', x: bomb.x, y: 1, z: bomb.z, big: true });
        // the blast takes anyone standing on the site with it
        for (const f of state.fighters) {
          if (f.alive && dist2D(f.x, f.z, bomb.x, bomb.z) < 7) {
            f.hp = 0; f.alive = false; f.deaths += 1;
          }
        }
        endRound(state, TEAM.JACKALS, 'explosion');
      }
      break;
    }
    case PHASE.END:
      if (state.phaseT <= 0) {
        if (state.score.wardens >= WIN_SCORE || state.score.jackals >= WIN_SCORE
            || state.round >= MAX_ROUNDS) {
          state.phase = PHASE.OVER;
          state.matchWinner = state.score.wardens > state.score.jackals
            ? TEAM.WARDENS : TEAM.JACKALS;
          events.push({ type: 'matchover', winner: state.matchWinner });
        } else {
          startRound(state, mapData, rng);
        }
      }
      break;
    default:
      break;
  }
}
