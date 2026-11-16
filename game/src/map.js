// map.js — the Port of Sable terminal: geometry, colliders, waypoints, spawns.
// One job: build the original map (a dusk container port with a loading
// dock as site A and a freezer hall as site B) and hand the simulation the
// data it needs: box colliders for physics, a waypoint graph for the bots,
// spawn points and the two bomb sites. All art is procedural: canvas
// textures painted here, geometry from boxes — nothing is copied from any
// existing game.

import * as THREE from 'three';

// ---------------------------------------------------------------- palette
export const PALETTE = {
  sky: 0x2e3d55, horizon: 0xd98a4a, fog: 0x3a4356,
  asphalt: 0x3b3f45, concrete: 0x767c84, wallPanel: 0x5d6a76,
  containerBlue: 0x2f5f8a, containerRust: 0xa5502c, containerGreen: 0x3f7355,
  containerGrey: 0x707880, accent: 0xf2a33c, teal: 0x39c2b0,
  warden: 0x2e7fb8, jackal: 0xc8542a,
};

// ------------------------------------------------------- canvas textures
function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function groundTexture() {
  return canvasTexture(1024, 1024, (g, w, h) => {
    g.fillStyle = '#3b3f45'; g.fillRect(0, 0, w, h);
    // asphalt noise
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${20 + Math.random() * 40},${22 + Math.random() * 40},${26 + Math.random() * 40},0.25)`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // worn patches, oil stains and cracks — the yard has worked hard
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(18,19,22,${0.05 + Math.random() * 0.13})`;
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 70, 12 + Math.random() * 40, Math.random() * 3, 0, 7);
      g.fill();
    }
    g.strokeStyle = 'rgba(16,17,20,0.5)'; g.lineWidth = 1.6;
    for (let i = 0; i < 22; i++) {
      let x = Math.random() * w, y = Math.random() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 5; s++) { x += (Math.random() - 0.5) * 90; y += (Math.random() - 0.5) * 90; g.lineTo(x, y); }
      g.stroke();
    }
    // faded painted arrows and bay numbers under the grime
    g.fillStyle = 'rgba(226,222,205,0.20)';
    g.font = 'bold 90px system-ui, sans-serif';
    g.fillText('07', w * 0.72, h * 0.3);
    g.fillText('SLOW', w * 0.08, h * 0.82);
    // lane lines
    g.strokeStyle = 'rgba(230,230,220,0.5)'; g.lineWidth = 4; g.setLineDash([26, 20]);
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    g.setLineDash([]);
    // hazard stripes near the dock edge
    g.save(); g.translate(60, 60); g.rotate(-0.0);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? '#c9a227' : '#22242a';
      g.beginPath();
      g.moveTo(i * 28, 0); g.lineTo(i * 28 + 14, 0); g.lineTo(i * 28 + 28, 22); g.lineTo(i * 28 + 14, 22);
      g.fill();
    }
    g.restore();
  });
}

function containerTexture(base, label) {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    // corrugation
    for (let x = 0; x < w; x += 32) {
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, 0, 8, h);
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x + 14, 0, 5, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 18, w, 18);
    // stencil label
    g.fillStyle = 'rgba(240,240,235,0.85)';
    g.font = 'bold 44px monospace'; g.fillText(label, 28, 74);
    g.font = '24px monospace'; g.fillText('MAX 30480 KG', 28, 116);
    g.fillText('CSLU ' + (100000 + Math.floor(Math.random() * 899999)), 28, 152);
    // rust streaks
    for (let i = 0; i < 26; i++) {
      g.fillStyle = 'rgba(60,32,18,0.20)';
      const x = Math.random() * w;
      g.fillRect(x, Math.random() * 40, 3 + Math.random() * 5, 40 + Math.random() * 120);
    }
    // heavy rust bloom along the bottom edge + scratches and dent shading
    const rust = g.createLinearGradient(0, h - 60, 0, h);
    rust.addColorStop(0, 'rgba(74,38,16,0)'); rust.addColorStop(1, 'rgba(74,38,16,0.55)');
    g.fillStyle = rust; g.fillRect(0, h - 60, w, 60);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(235,235,230,${0.05 + Math.random() * 0.1})`;
      g.fillRect(Math.random() * w, Math.random() * h, 14 + Math.random() * 60, 1.6);
    }
    for (let i = 0; i < 10; i++) {
      g.fillStyle = 'rgba(0,0,0,0.13)';
      g.beginPath();
      g.ellipse(Math.random() * w, Math.random() * h, 16 + Math.random() * 30, 8 + Math.random() * 16, 0, 0, 7);
      g.fill();
    }
  });
}

function signTexture(text, sub, color) {
  return canvasTexture(512, 192, (g, w, h) => {
    g.fillStyle = '#23262c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 8; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = color; g.font = 'bold 64px system-ui, sans-serif';
    const tw = g.measureText(text).width;
    if (tw > w - 60) g.font = `bold ${Math.floor(64 * (w - 60) / tw)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.fillText(text, w / 2, 92);
    g.fillStyle = 'rgba(235,235,230,0.8)'; g.font = '28px system-ui, sans-serif';
    g.fillText(sub, w / 2, 146);
  });
}

function wallTexture() {
  return canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#5d6a76'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 64) {
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 3, h);
      g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(x + 30, 0, 2, h);
    }
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = 'rgba(0,0,0,0.10)';
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    // rain grime running down from the panel seams
    for (let i = 0; i < 34; i++) {
      g.fillStyle = 'rgba(24,26,30,0.16)';
      const x = Math.random() * w;
      g.fillRect(x, 0, 2 + Math.random() * 4, 60 + Math.random() * 150);
    }
    g.fillStyle = 'rgba(20,22,26,0.55)'; g.fillRect(0, h - 26, w, 26);
  });
}

// ------------------------------------------------------------------ map
const WALL_H = 6;

export function buildMap(scene) {
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);

  const wallTex = wallTexture();
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  const mats = {
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, metalness: 0.08 }),
    concrete: new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.95 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.6, metalness: 0.5 }),
    dock: new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.9 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x39404a, roughness: 0.85, metalness: 0.2 }),
  };

  // box(): one helper adds both the mesh and its collider, so the visible
  // world and the collision world can never drift apart.
  function box(x, z, w, d, h, mat, opts = {}) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, h / 2 + (opts.y || 0), z);
    m.castShadow = !!opts.shadow;
    m.receiveShadow = true;
    group.add(m);
    if (opts.collide !== false) {
      colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h: (opts.y || 0) + h });
    }
    return m;
  }

  // ground
  const gTex = groundTexture();
  gTex.wrapS = gTex.wrapT = THREE.RepeatWrapping; gTex.repeat.set(3, 3);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(96, 76),
    new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.96 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // ---- sky dome: a painted dusk gradient with a low sun glow and a
  // band of cloud, so the horizon reads as sunset, not flat colour
  {
    const skyTex = canvasTexture(1024, 512, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#1d2a44'); grad.addColorStop(0.42, '#3a4a6b');
      grad.addColorStop(0.66, '#8a5a44'); grad.addColorStop(0.8, '#d98a4a');
      grad.addColorStop(0.88, '#e8a35c'); grad.addColorStop(1, '#5a4636');
      g.fillStyle = grad; g.fillRect(0, 0, w, h);
      const sun = g.createRadialGradient(w * 0.22, h * 0.8, 8, w * 0.22, h * 0.8, 190);
      sun.addColorStop(0, 'rgba(255,214,150,0.95)'); sun.addColorStop(0.25, 'rgba(255,170,90,0.45)');
      sun.addColorStop(1, 'rgba(255,150,70,0)');
      g.fillStyle = sun; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 46; i++) { // cloud streaks catching the light
        g.fillStyle = `rgba(${30 + Math.random() * 40},${26 + Math.random() * 26},${40 + Math.random() * 30},${0.10 + Math.random() * 0.16})`;
        const y = h * (0.18 + Math.random() * 0.55);
        g.beginPath(); g.ellipse(Math.random() * w, y, 60 + Math.random() * 170, 4 + Math.random() * 9, 0, 0, 7); g.fill();
      }
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(320, 24, 14),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
    dome.position.y = -6;
    group.add(dome);
  }

  // painted site circles
  for (const [sx, sz, letter, col] of [[-27, -20, 'A', '#f2a33c'], [27, -20, 'B', '#39c2b0']]) {
    const tex = canvasTexture(256, 256, (g) => {
      g.strokeStyle = col; g.lineWidth = 10;
      g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.stroke();
      g.fillStyle = col; g.font = 'bold 130px system-ui, sans-serif';
      g.textAlign = 'center'; g.fillText(letter, 128, 178);
    });
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(5.4, 40),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9 }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(sx, 0.02, sz);
    group.add(disc);
  }

  // ---- perimeter (x in [-46, 46], z in [-36, 36])
  box(0, -36.5, 96, 1, WALL_H, mats.wall);
  box(0, 36.5, 96, 1, WALL_H, mats.wall);
  box(-46.5, 0, 1, 76, WALL_H, mats.wall);
  box(46.5, 0, 1, 76, WALL_H, mats.wall);

  // ---- north warehouse band: two halls with a mid gap
  // west hall (behind site A) and east freezer hall (site B inside its yard)
  box(-27, -31, 34, 9, 7, mats.wall, { shadow: true });        // dock warehouse body
  box(-27, -26.2, 34, 0.8, 5, mats.wall);                      // its front wall
  box(27, -31, 34, 9, 7, mats.wall, { shadow: true });         // freezer hall body
  // freezer hall front wall with two door gaps (at x 21..24 and 30..33)
  box(12.5, -26.2, 7, 0.8, 5, mats.wall);
  box(27, -26.2, 6, 0.8, 5, mats.wall);
  box(39.5, -26.2, 5, 0.8, 5, mats.wall);
  // roofs
  box(-27, -31, 35, 10, 0.4, mats.roof, { y: 7, collide: false });
  box(27, -31, 35, 10, 0.4, mats.roof, { y: 7, collide: false });

  // ---- site A: loading dock — raised platform edge, truck, crate stacks
  box(-38, -20, 10, 12, 1.1, mats.dock);                        // dock platform (low cover)
  const truckMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.5, metalness: 0.4 });
  box(-33, -25.5, 3.2, 8.5, 3.1, truckMat, { shadow: true });   // parked truck trailer
  box(-20.5, -16, 2.4, 2.4, 2.4, mats.concrete, { shadow: true });
  box(-20.5, -16, 2.4, 2.4, 2.4, mats.concrete, { y: 2.4, collide: false });
  box(-24, -23.5, 2.4, 2.4, 1.2, mats.concrete);
  box(-30, -14.5, 3.4, 2.2, 1.2, mats.dock);

  // ---- site B: freezer yard — pillars and cold crates inside the hall line
  box(21, -20, 2, 2, 4.6, mats.concrete, { shadow: true });
  box(33, -20, 2, 2, 4.6, mats.concrete, { shadow: true });
  box(27, -15.5, 4.6, 2.2, 1.3, mats.dock);
  box(23.5, -23, 2.2, 2.2, 2.2, mats.concrete);
  // cold vapour vents (visual only): pale boxes with emissive tops
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x9fb6c4, roughness: 0.4, metalness: 0.6, emissive: 0x1d3a44 });
  box(17.5, -24, 1.4, 1.4, 2.8, ventMat, { collide: false });
  box(36.5, -16, 1.4, 1.4, 2.8, ventMat, { collide: false });

  // ---- containers: the lanes of the yard. Each is one collider however
  // high it is stacked; the second level is pure silhouette.
  const contMats = [
    ['#2f5f8a', 'SABLE LINE'], ['#a5502c', 'PORT OF SABLE'], ['#3f7355', 'NORTH FREIGHT'],
    ['#707880', 'CSLU HEAVY'], ['#2f5f8a', 'SABLE LINE'], ['#a5502c', 'PORT OF SABLE'],
  ].map(([base, label]) => new THREE.MeshStandardMaterial({
    map: containerTexture(base, label), roughness: 0.75, metalness: 0.25,
  }));
  let ci = 0;
  function container(x, z, rotY, stack) {
    const len = 12.2, wid = 2.5, hgt = 2.6;
    const mat = contMats[ci++ % contMats.length];
    for (let s = 0; s < stack; s++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, hgt, wid), mat);
      m.position.set(x, hgt / 2 + s * hgt, z);
      m.rotation.y = rotY;
      m.castShadow = s === stack - 1;
      m.receiveShadow = true;
      group.add(m);
    }
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const hx = (Math.abs(c) * len + Math.abs(s) * wid) / 2;
    const hz = (Math.abs(s) * len + Math.abs(c) * wid) / 2;
    colliders.push({ x0: x - hx, z0: z - hz, x1: x + hx, z1: z + hz, h: hgt * stack });
  }
  container(-8, 6, 0, 2);        // mid west stack
  container(9, 6, 0, 1);         // mid east single
  container(0, -3, Math.PI / 2, 2);   // mid cross (rotated: runs along z)
  container(-16, 16, 0, 1);      // south-west lane cover
  container(17, 17, 0, 2);       // south-east lane cover
  container(-38, -2, Math.PI / 2, 1); // west lane wall
  container(38, -2, Math.PI / 2, 2);  // east lane wall
  container(-14, -12, 0, 1);     // A connector cover
  container(15, -13, 0, 1);      // B connector cover

  // ---- crane silhouette across the north yard (visual landmark)
  const craneMat = mats.darkMetal;
  box(-18, -9, 1.2, 1.2, 13, craneMat, { collide: false });
  box(18, -9, 1.2, 1.2, 13, craneMat, { collide: false });
  const beam = box(0, -9, 38, 1.4, 1.6, craneMat, { y: 12.2, collide: false });
  beam.castShadow = true;

  // ---- yard dressing: barrels, pallets, a cable spool and crates in
  // the dead corners — real cover stays exactly as the colliders say,
  // these sit against walls where nobody fights through them
  {
    const barrelGeo = new THREE.CylinderGeometry(0.31, 0.31, 0.92, 10);
    const barrelMats = [0x707880, 0xa5502c, 0x2f5f8a].map((c) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.35 }));
    let bi = 0;
    for (const [bx, bz] of [[-43, 30], [-42.2, 30.6], [-42.6, 29.2], [43.5, 28], [42.8, 28.7], [-43, -33.5], [8.5, 33.5], [9.3, 33.9]]) {
      const b = new THREE.Mesh(barrelGeo, barrelMats[bi++ % 3]);
      b.position.set(bx, 0.46, bz);
      b.castShadow = true;
      group.add(b);
    }
    const palletMat = new THREE.MeshStandardMaterial({ color: 0x8a6f4d, roughness: 0.95 });
    for (const [px, pz, ry] of [[-44, 8, 0.4], [44.5, -20, 0.2], [-6, 34, 0], [20, 34.2, 0.7]]) {
      for (let s = 0; s < 3; s++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.13, 1.4), palletMat);
        p.position.set(px, 0.08 + s * 0.15, pz);
        p.rotation.y = ry + s * 0.12;
        group.add(p);
      }
    }
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.7, 14), palletMat);
    spool.rotation.z = Math.PI / 2;
    spool.position.set(44, 0.85, 12);
    group.add(spool);
    // sagging cables strung from the crane beam to the lamp poles
    const cableMat = new THREE.MeshBasicMaterial({ color: 0x14161a });
    for (const [x0, x1, z] of [[-18, -27, -8.6], [18, 27, -8.6], [-18, -8, -9.4]]) {
      for (let s = 0; s < 6; s++) {
        const t0 = s / 6, t1 = (s + 1) / 6;
        const sag = (t) => 12.6 - Math.sin(t * Math.PI) * 1.5;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) / 6 + 0.05, 0.05, 0.05), cableMat);
        seg.position.set(x0 + (x1 - x0) * (t0 + t1) / 2, sag((t0 + t1) / 2), z);
        seg.rotation.z = Math.atan2(sag(t1) - sag(t0), (x1 - x0) / 6) * Math.sign(x1 - x0);
        group.add(seg);
      }
    }
  }

  // ---- signs
  function sign(x, y, z, rotY, tex) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.4),
      new THREE.MeshBasicMaterial({ map: tex }));
    m.position.set(x, y, z); m.rotation.y = rotY;
    group.add(m);
  }
  sign(-27, 4.4, -25.7, 0, signTexture('BAY A', 'LOADING DOCK', '#f2a33c'));
  sign(27, 4.4, -25.7, 0, signTexture('BAY B', 'FREEZER HALL', '#39c2b0'));
  sign(0, 4.6, -35.9, 0, signTexture('PORT OF SABLE', 'TERMINAL 7 — EST. 1986', '#e8e4da'));

  // ---- floodlight poles (visual) — their lights live in lights.js setup
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc37a, emissiveIntensity: 2.2 });
  // one tired floodlight gets its own material so main.js can flicker it
  const flickerMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc37a, emissiveIntensity: 2.2 });
  const poleMat = mats.darkMetal;
  const lampPositions = [];
  [[-27, -8], [27, -8], [-8, 22], [12, 22], [0, -14]].forEach(([lx, lz], i) => {
    box(lx, lz, 0.35, 0.35, 8.5, poleMat, { collide: false });
    const head = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 0.6), i === 4 ? flickerMat : lampMat);
    head.position.set(lx, 8.6, lz);
    group.add(head);
    lampPositions.push([lx, lz]);
  });

  // ---- a skein of harbour birds crossing the dusk, far and cheap:
  // two triangles per bird, flapped by main.js from this group
  const birds = new THREE.Group();
  {
    const birdMat = new THREE.MeshBasicMaterial({ color: 0x1c222e, side: THREE.DoubleSide, fog: false });
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1.1, 0.28, 0.3, 1.1, 0.28, -0.3]), 3));
    wingGeo.computeVertexNormals();
    for (let i = 0; i < 6; i++) {
      const bird = new THREE.Group();
      const wl = new THREE.Mesh(wingGeo, birdMat);
      const wr = new THREE.Mesh(wingGeo, birdMat);
      wr.rotation.y = Math.PI;
      bird.add(wl); bird.add(wr);
      bird.position.set(-140 + i * 7, 34 + (i % 3) * 2.4, -70 - i * 5);
      bird.userData.phase = i * 1.3;
      birds.add(bird);
    }
  }
  group.add(birds);

  // distant silhouettes outside the walls, for the skyline in screenshots
  const silMat = new THREE.MeshBasicMaterial({ color: 0x232c3a });
  for (const [sx, sz, sw, sh] of [[-30, -52, 30, 16], [8, -54, 22, 12], [38, -50, 16, 20], [-52, 6, 14, 10], [54, 14, 12, 14]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 8), silMat);
    m.position.set(sx, sh / 2, sz);
    group.add(m);
  }

  // ------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(0x8fa5c8, 0x2c2f36, 0.98);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb877, 1.6);
  sun.position.set(-38, 30, 26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -55; sun.shadow.camera.right = 55;
  sun.shadow.camera.top = 45; sun.shadow.camera.bottom = -45;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x6f87b8, 0.35);
  fill.position.set(30, 24, -30);
  scene.add(fill);
  for (const [lx, lz] of lampPositions) {
    const p = new THREE.PointLight(0xffbe78, 60, 26, 1.8);
    p.position.set(lx, 8.2, lz);
    scene.add(p);
  }
  scene.fog = new THREE.Fog(PALETTE.fog, 55, 165);
  scene.background = new THREE.Color(PALETTE.sky);

  // ------------------------------------------------------- gameplay data
  const sites = {
    A: { x: -27, z: -20, r: 6.5, name: 'Bay A' },
    B: { x: 27, z: -20, r: 6.5, name: 'Bay B' },
  };
  const spawns = {
    wardens: [
      { x: -4, z: -30, yaw: 0 }, { x: -1.5, z: -31, yaw: 0 }, { x: 1.5, z: -31, yaw: 0 },
      { x: 4, z: -30, yaw: 0 }, { x: 0, z: -28.5, yaw: 0 },
    ],
    jackals: [
      { x: -6, z: 29, yaw: Math.PI }, { x: -3, z: 30.5, yaw: Math.PI }, { x: 0, z: 29, yaw: Math.PI },
      { x: 3, z: 30.5, yaw: Math.PI }, { x: 6, z: 29, yaw: Math.PI },
    ],
  };

  // Waypoint graph: lanes a bot can walk. links are filled both ways.
  const W = (x, z) => ({ x, z, links: [] });
  const waypoints = [
    W(-4, 26), W(4, 26),            // 0,1 jackal spawn exits
    W(0, 15),                        // 2 south mid
    W(-17, 13), W(17, 13),           // 3,4 south lane ends
    W(-2, 3), W(6, -1),              // 5,6 mid yard
    W(0, -9),                        // 7 mid north (under the crane)
    W(-34, 13), W(-34, 0),           // 8,9 west lane
    W(-29, -10),                     // 10 A door
    W(-27, -18),                     // 11 A site
    W(34, 13), W(34, 0),             // 12,13 east lane
    W(29, -10),                      // 14 B door
    W(27, -18),                      // 15 B site
    W(-14, -13), W(14, -13),         // 16,17 site connectors
    W(0, -29),                       // 18 warden spawn
    W(-19, -14), W(19, -14),         // 19,20 site holds
    W(-36, -22),                     // 21 dock corner
    W(24, -7), W(-24, -7),           // 22,23 hall / dock approaches
    W(-10, 22), W(11, 22),           // 24,25 spawn-yard cover
  ];
  const edges = [
    [0, 2], [1, 2], [0, 24], [1, 25], [24, 3], [25, 4],
    [2, 5], [3, 5], [4, 6], [5, 6], [5, 7], [6, 7],
    [3, 8], [8, 9], [9, 23], [23, 10], [10, 11], [11, 21],
    [4, 12], [12, 13], [13, 22], [22, 14], [14, 15],
    [7, 16], [7, 17], [16, 19], [17, 20], [19, 11], [20, 15],
    [18, 16], [18, 17], [18, 7], [10, 16], [14, 17], [9, 10], [13, 14],
  ];
  for (const [a, b] of edges) {
    waypoints[a].links.push(b);
    waypoints[b].links.push(a);
  }

  return { colliders, waypoints, spawns, sites, group, flickerMat, birds, lampLightPos: lampPositions[4] };
}

// Breadth-first shortest path over the waypoint graph; returns the list of
// waypoint indices from `from` to `to` (both included), or null.
export function findPath(waypoints, from, to) {
  if (from === to) return [from];
  const prev = new Array(waypoints.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const n of waypoints[cur].links) {
      if (prev[n] === -1) {
        prev[n] = cur;
        if (n === to) {
          const path = [to];
          let c = to;
          while (c !== from) { c = prev[c]; path.unshift(c); }
          return path;
        }
        queue.push(n);
      }
    }
  }
  return null;
}

export function nearestWaypoint(waypoints, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x, dz = waypoints[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
