// state.js — the single place match state lives.
// One job: hold every mutable fact about the match (phase, clock, economy,
// fighters, the bomb) so the simulation modules read and write one object
// instead of scattering state across the codebase.

export const TEAM = { WARDENS: 'wardens', JACKALS: 'jackals' };

export const PHASE = {
  MENU: 'menu',       // title screen, camera drifting over the yard
  BUY: 'buy',         // round freeze: buy menu open, nobody moves
  LIVE: 'live',       // round in play
  PLANTED: 'planted', // bomb is down, its fuse is the clock now
  END: 'end',         // round decided, banner up, short pause
  OVER: 'over',       // match decided, final scoreboard
};

export const WIN_SCORE = 7;      // first to 7 rounds takes the match
export const MAX_ROUNDS = 12;
export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const BOMB_SECONDS = 40;
export const END_SECONDS = 6;
export const START_MONEY = 800;

export function createState() {
  return {
    phase: PHASE.MENU,
    phaseT: 0,                 // seconds left in the current phase
    round: 0,
    score: { wardens: 0, jackals: 0 },
    playerTeam: TEAM.WARDENS,
    fighters: [],              // every combatant, the human included (index 0)
    bomb: {
      carrier: null,           // fighter id holding the bomb, or null
      planted: false,
      site: null,              // 'A' | 'B' once planted
      x: 0, z: 0,
      channelBy: null,         // fighter id planting or defusing
      channelT: 0,
    },
    noise: [],                 // recent gunfire events {x, z, t} bots can hear
    radio: [],                 // queued team radio callouts {name, text} for the HUD feed
    time: 0,                   // match clock, seconds of simulated time
    roundResult: null,         // {winner, reason} for the end banner
    matchWinner: null,
    lossStreak: { wardens: 0, jackals: 0 },
    paused: false,
  };
}

// A fighter is one combatant: the human player or a bot. Movement, combat
// and inventory fields all live here; bots.js and player.js drive them.
export function createFighter(id, team, isPlayer, name) {
  return {
    id, team, isPlayer, name,
    // kinematics
    x: 0, z: 0, y: 0,          // feet position; y is the eye-level base (0 = ground)
    vx: 0, vz: 0, vy: 0,
    yaw: 0, pitch: 0,
    crouch: false, grounded: true,
    radius: 0.42, height: 1.78,
    // vitals
    hp: 100, armor: 0, helmet: false, alive: true,
    // inventory
    money: START_MONEY,
    weapons: [],               // weapon instance objects, see weapons.js
    current: 0,                // index into weapons
    grenades: { frag: 0, flash: 0, smoke: 0 },
    kit: false,                // defuse kit (Wardens)
    hasBomb: false,
    // combat bookkeeping
    reloadingUntil: 0, nextShotAt: 0, shotsFired: 0,
    kills: 0, deaths: 0,
    // bot brain (unused for the human)
    brain: null,
    // presentation
    mesh: null, flashUntil: 0, blindUntil: 0,
  };
}

export function otherTeam(team) {
  return team === TEAM.WARDENS ? TEAM.JACKALS : TEAM.WARDENS;
}

export function aliveOf(state, team) {
  return state.fighters.filter((f) => f.alive && f.team === team);
}

export function fighterById(state, id) {
  return state.fighters.find((f) => f.id === id) || null;
}
