// physics.js — collision and ray queries against the map's box colliders.
// One job: answer "where can this circle go" and "what does this ray hit"
// for movement, line of sight and hitscan fire. Colliders are axis-aligned
// boxes: {x0, z0, x1, z1, h} where h is the top height (Infinity = a wall).

// Move a circle (x, z, radius) by (dx, dz), sliding along boxes it meets.
// Returns the corrected position; mutates nothing. The resolve is a
// closest-point push-out per box, which slides around corners instead of
// sticking on them the way per-axis clamping does.
export function slideMove(colliders, x, z, radius, dx, dz) {
  let nx = x + dx;
  let nz = z + dz;
  for (let pass = 0; pass < 2; pass++) {
    for (const c of colliders) {
      const cx = nx < c.x0 ? c.x0 : nx > c.x1 ? c.x1 : nx;
      const cz = nz < c.z0 ? c.z0 : nz > c.z1 ? c.z1 : nz;
      const px = nx - cx, pz = nz - cz;
      const d2 = px * px + pz * pz;
      if (d2 > radius * radius) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = cx + (px / d) * radius;
        nz = cz + (pz / d) * radius;
      } else {
        // centre inside the box: leave by the cheapest exit
        const exits = [nx - c.x0 + radius, c.x1 - nx + radius, nz - c.z0 + radius, c.z1 - nz + radius];
        const m = Math.min(exits[0], exits[1], exits[2], exits[3]);
        if (m === exits[0]) nx = c.x0 - radius;
        else if (m === exits[1]) nx = c.x1 + radius;
        else if (m === exits[2]) nz = c.z0 - radius;
        else nz = c.z1 + radius;
      }
    }
  }
  return { x: nx, z: nz };
}

// True when the segment (ax, az) -> (bx, bz) stays clear of every box at
// the given height (a low crate does not block a standing eye line at 1.6 m
// when its top is below that; pass height = eye height to model that).
export function lineClear(colliders, ax, az, bx, bz, height) {
  const dx = bx - ax, dz = bz - az;
  for (const c of colliders) {
    if (c.h <= height) continue; // the line passes over this box
    if (segmentHitsBox(ax, az, dx, dz, c)) return false;
  }
  return true;
}

function segmentHitsBox(ax, az, dx, dz, c) {
  // Slab test on the 2D segment, t in [0, 1].
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < c.x0 || ax > c.x1) return false;
  } else {
    let ta = (c.x0 - ax) / dx, tb = (c.x1 - ax) / dx;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < c.z0 || az > c.z1) return false;
  } else {
    let ta = (c.z0 - az) / dz, tb = (c.z1 - az) / dz;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

// Distance along a 3D ray to the first box it enters, or maxDist.
// origin (ox, oy, oz), direction (dx, dy, dz) normalised, boxes use their
// real height: a ray above a crate's top passes over it.
export function rayHitDistance(colliders, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = maxDist;
  for (const c of colliders) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, c);
    if (t !== null && t < best) best = t;
  }
  return best;
}

function rayBox(ox, oy, oz, dx, dy, dz, c) {
  let t0 = 0, t1 = Infinity;
  if (Math.abs(dx) < 1e-9) {
    if (ox < c.x0 || ox > c.x1) return null;
  } else {
    let ta = (c.x0 - ox) / dx, tb = (c.x1 - ox) / dx;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  if (Math.abs(dz) < 1e-9) {
    if (oz < c.z0 || oz > c.z1) return null;
  } else {
    let ta = (c.z0 - oz) / dz, tb = (c.z1 - oz) / dz;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  // Height slab: the box spans y in [0, h].
  if (Math.abs(dy) < 1e-9) {
    if (oy < 0 || oy > c.h) return null;
  } else {
    let ta = (0 - oy) / dy, tb = (c.h - oy) / dy;
    if (ta > tb) { const s = ta; ta = tb; tb = s; }
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}
