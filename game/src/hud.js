// hud.js — everything drawn in the DOM: vitals, buy menu, banners, feeds.
// One job: present state. It never changes the simulation; it reads the
// state and the human's fighter and paints HTML over the canvas.

import { PHASE, TEAM } from './state.js';
import { WEAPONS, GRENADE_PRICE, currentDef } from './weapons.js';

const $ = (id) => document.getElementById(id);

export const BUY_ITEMS = [
  { id: 'vk7', label: 'VK-7 Rifle', key: '1' },
  { id: 'raptor', label: 'Raptor-9 SMG', key: '2' },
  { id: 'breacher', label: 'Breacher-12', key: '3' },
  { id: 'longbow', label: 'Longbow DMR', key: '4' },
  { id: 'armorhelm', label: 'Armour + Helmet', key: '5', price: 1000 },
  { id: 'armor', label: 'Armour', key: '6', price: 650 },
  { id: 'frag', label: 'Frag Grenade', key: '7' },
  { id: 'flash', label: 'Flash Grenade', key: '8' },
  { id: 'smoke', label: 'Smoke Grenade', key: '9' },
  { id: 'kit', label: 'Defuse Kit', key: '0', price: 400, wardensOnly: true },
];

function priceOf(item) {
  if (item.price) return item.price;
  if (item.id in GRENADE_PRICE) return GRENADE_PRICE[item.id];
  return WEAPONS[item.id].price;
}

export function createHud(onBuy, mapData) {
  const els = {
    hud: $('hud'), hp: $('hp-fill'), hpText: $('hp-text'), armor: $('armor-text'),
    ammo: $('ammo'), weapon: $('weapon-name'), money: $('money'),
    timer: $('timer'), score: $('score'), round: $('round-label'),
    feed: $('killfeed'), banner: $('banner'), bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'), buy: $('buymenu'), buyGrid: $('buy-grid'),
    buyMoney: $('buy-money'), menu: $('menu'), over: $('matchover'),
    overTitle: $('over-title'), overBoard: $('over-board'),
    channel: $('channel'), channelFill: $('channel-fill'), channelLabel: $('channel-label'),
    hitmarker: $('hitmarker'), scope: $('scope'), bombTag: $('bomb-tag'),
    hint: $('hint'), scoreTab: $('scoretab'), tabBoard: $('tab-board'),
    radar: $('radar'),
  };
  els.radarCtx = els.radar ? els.radar.getContext('2d') : null;
  let bannerUntil = 0;

  function banner(title, sub, seconds = 3) {
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub || '';
    els.banner.style.opacity = '1';
    bannerUntil = performance.now() / 1000 + seconds;
  }

  function addFeed(html) {
    const div = document.createElement('div');
    div.className = 'feed-line';
    div.innerHTML = html;
    els.feed.appendChild(div);
    while (els.feed.children.length > 5) els.feed.removeChild(els.feed.firstChild);
    setTimeout(() => { div.style.opacity = '0'; }, 4200);
    setTimeout(() => { div.remove(); }, 5000);
  }

  // team radio traffic shares the feed but reads differently: italic,
  // blue tab, the speaker's callsign first
  function addRadio(name, text) {
    const div = document.createElement('div');
    div.className = 'feed-line radio';
    div.textContent = `📻 ${name}: ${text}`;
    els.feed.appendChild(div);
    while (els.feed.children.length > 5) els.feed.removeChild(els.feed.firstChild);
    setTimeout(() => { div.style.opacity = '0'; }, 4200);
    setTimeout(() => { div.remove(); }, 5000);
  }

  // ------------------------------------------------------------- radar
  // A fair radar: teammates always, the bomb when it is down, and enemy
  // dots only where their own gunfire just gave them away (from the same
  // noise events the bots hear). World bounds match the yard in map.js.
  const WORLD = { x0: -38, x1: 38, z0: -34, z1: 34 };
  function drawRadar(state, player) {
    const ctx = els.radarCtx;
    if (!ctx || !mapData) return;
    const W = els.radar.width, H = els.radar.height;
    const px = (x) => ((x - WORLD.x0) / (WORLD.x1 - WORLD.x0)) * W;
    const pz = (z) => ((z - WORLD.z0) / (WORLD.z1 - WORLD.z0)) * H;
    ctx.clearRect(0, 0, W, H);
    // bomb sites
    for (const key of ['A', 'B']) {
      const s = mapData.sites[key];
      ctx.beginPath();
      ctx.arc(px(s.x), pz(s.z), (s.r / (WORLD.x1 - WORLD.x0)) * W, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(242,163,60,0.75)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(242,163,60,0.9)';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(key, px(s.x) - 3, pz(s.z) + 3);
    }
    // enemies revealed by their own recent gunfire
    for (const n of state.noise) {
      if (n.team === player.team) continue;
      const age = state.time - n.t;
      if (age > 2.5) continue;
      ctx.globalAlpha = 1 - age / 2.5;
      ctx.fillStyle = '#ff5f4a';
      ctx.beginPath();
      ctx.arc(px(n.x), pz(n.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // the bomb, once it leaves a carrier's hands
    const bombPos = state.bomb.planted ? state.bomb : state.bomb.dropped;
    if (bombPos) {
      ctx.fillStyle = Math.sin(state.time * 6) > 0 ? '#ff2a1a' : '#ffb0a0';
      ctx.fillRect(px(bombPos.x) - 3, pz(bombPos.z) - 3, 6, 6);
    }
    // teammates
    for (const f of state.fighters) {
      if (!f.alive || f.isPlayer || f.team !== player.team) continue;
      ctx.fillStyle = '#5aa9e6';
      ctx.beginPath();
      ctx.arc(px(f.x), pz(f.z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // the player: a wedge pointing where they face (radar up = -z, and
    // the facing angle on the map works out to exactly -yaw)
    ctx.save();
    ctx.translate(px(player.x), pz(player.z));
    ctx.rotate(-player.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -5.5);
    ctx.lineTo(4, 4.5);
    ctx.lineTo(-4, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function boardRows(state) {
    const rows = [...state.fighters].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    return rows.map((f) => {
      const teamCls = f.team === TEAM.WARDENS ? 'w' : 'j';
      const dead = f.alive ? '' : ' dead';
      const you = f.isPlayer ? ' (you)' : '';
      return `<div class="board-row ${teamCls}${dead}"><span>${f.name}${you}</span>`
        + `<span>${f.team === TEAM.WARDENS ? 'Wardens' : 'Jackals'}</span>`
        + `<span>${f.kills} / ${f.deaths}</span><span>$${f.money}</span></div>`;
    }).join('');
  }

  function renderBuy(state, player) {
    els.buyMoney.textContent = '$' + player.money;
    els.buyGrid.innerHTML = '';
    for (const item of BUY_ITEMS) {
      if (item.wardensOnly && player.team !== TEAM.WARDENS) continue;
      const price = priceOf(item);
      const btn = document.createElement('button');
      btn.className = 'buy-item' + (player.money < price ? ' cant' : '');
      btn.innerHTML = `<span class="buy-key">${item.key}</span> ${item.label}<span class="buy-price">$${price}</span>`;
      btn.addEventListener('click', () => onBuy(item.id));
      els.buyGrid.appendChild(btn);
    }
  }

  function fmtTime(s) {
    s = Math.max(0, Math.ceil(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function update(state, player, nowReal) {
    // banner fade
    if (nowReal > bannerUntil) els.banner.style.opacity = '0';
    const inGame = state.phase !== PHASE.MENU && state.phase !== PHASE.OVER;
    els.hud.style.display = inGame ? 'block' : 'none';
    els.menu.style.display = state.phase === PHASE.MENU ? 'flex' : 'none';
    els.over.style.display = state.phase === PHASE.OVER ? 'flex' : 'none';
    els.buy.style.display = state.phase === PHASE.BUY ? 'block' : 'none';
    // the touch buttons sit over the buy grid on small screens: hide them
    // while the menu is up (buying itself is tap-driven)
    document.body.classList.toggle('buying', state.phase === PHASE.BUY);
    if (!inGame && state.phase !== PHASE.OVER) return;

    if (player) {
      els.hp.style.width = Math.max(0, player.hp) + '%';
      els.hp.style.background = player.hp > 50 ? '#7dd069' : player.hp > 25 ? '#e0a83c' : '#d9534f';
      els.hpText.textContent = Math.ceil(player.hp);
      els.armor.textContent = player.armor > 0 ? '🛡 ' + Math.ceil(player.armor) + (player.helmet ? ' + helmet' : '') : '';
      const def = currentDef(player);
      const w = player.weapons[player.current];
      els.weapon.textContent = def ? def.name : '';
      els.ammo.textContent = w ? (player.reloadingUntil > state.time ? 'RELOADING' : `${w.ammo} / ${w.reserve}`) : '';
      els.money.textContent = '$' + player.money;
      const nades = [];
      if (player.grenades.frag) nades.push('💣 frag');
      if (player.grenades.flash) nades.push('⚡ flash');
      if (player.grenades.smoke) nades.push('☁ smoke');
      if (player.hasBomb) nades.push('🧨 BOMB — hold E at a site');
      if (player.kit) nades.push('✂ kit');
      els.hint.textContent = nades.join('   ');
      els.scope.style.display = player.scoped ? 'block' : 'none';
      drawRadar(state, player);
    }
    els.timer.textContent = state.phase === PHASE.PLANTED ? '💣 ' + fmtTime(state.phaseT) : fmtTime(state.phaseT);
    els.timer.style.color = state.phase === PHASE.PLANTED ? '#ff5f4a' : '';
    els.score.textContent = `WARDENS ${state.score.wardens} — ${state.score.jackals} JACKALS`;
    els.round.textContent = state.phase === PHASE.BUY ? `ROUND ${state.round} — BUY PHASE` : `ROUND ${state.round}`;
    els.bombTag.style.display = state.bomb.planted ? 'block' : 'none';
    if (state.bomb.planted) els.bombTag.textContent = `BOMB PLANTED — BAY ${state.bomb.site}`;

    // plant / defuse channel progress
    const bomb = state.bomb;
    if (bomb.channelBy !== null && bomb.channelBy !== undefined && bomb.channelNeed) {
      els.channel.style.display = 'block';
      els.channelLabel.textContent = bomb.channelKind === 'plant' ? 'PLANTING THE BOMB…' : 'DEFUSING…';
      els.channelFill.style.width = Math.min(100, (bomb.channelT / bomb.channelNeed) * 100) + '%';
    } else {
      els.channel.style.display = 'none';
    }
    if (state.phase === PHASE.OVER) {
      els.overTitle.textContent = state.matchWinner === state.playerTeam ? 'VICTORY' : 'DEFEAT';
      els.overBoard.innerHTML = boardRows(state);
    }
  }

  function flashHitmarker(kill) {
    els.hitmarker.style.opacity = '1';
    els.hitmarker.style.color = kill ? '#ff5f4a' : '#ffffff';
    setTimeout(() => { els.hitmarker.style.opacity = '0'; }, kill ? 220 : 110);
  }

  function showTabBoard(state, show) {
    els.scoreTab.style.display = show ? 'block' : 'none';
    if (show) els.tabBoard.innerHTML = boardRows(state);
  }

  return { els, banner, addFeed, addRadio, renderBuy, update, flashHitmarker, showTabBoard };
}
