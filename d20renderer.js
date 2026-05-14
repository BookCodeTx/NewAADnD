// ════════════════════════════════════════
// d20renderer.js — Multi-dice renderer (d4, d6, d8, d10, d12, d20)
// Black glossy dice with white numbers, bouncing animation
// ════════════════════════════════════════

const PHI = (1 + Math.sqrt(5)) / 2;
const INV_PHI = 1 / PHI;

// ── Math utilities ──
function rotateX(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1]*c - v[2]*s, v[1]*s + v[2]*c]; }
function rotateY(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0]*c + v[2]*s, v[1], -v[0]*s + v[2]*c]; }
function rotateZ(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0]*c - v[1]*s, v[0]*s + v[1]*c, v[2]]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function norm(v) { const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); return len > 0 ? [v[0]/len, v[1]/len, v[2]/len] : [0,0,0]; }
function lerp(a, b, t) { return a + (b - a) * t; }

function normalizeVerts(raw) {
  return raw.map(([x, y, z]) => {
    const len = Math.sqrt(x*x + y*y + z*z);
    return [x/len, y/len, z/len];
  });
}

// ════════════════════════════════════════
// DICE GEOMETRY DEFINITIONS
// ════════════════════════════════════════

// ── d4 (Tetrahedron) ──
const D4_VERTS = normalizeVerts([
  [1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1],
]);
const D4_FACES = [[0,1,2], [0,3,1], [0,2,3], [1,3,2]];
const D4_NUMBERS = [4, 3, 2, 1];

// ── d6 (Cube) ──
const D6_RAW = [
  [-1,-1,-1], [1,-1,-1], [1,1,-1], [-1,1,-1],
  [-1,-1,1], [1,-1,1], [1,1,1], [-1,1,1],
];
const D6_VERTS = normalizeVerts(D6_RAW);
const D6_FACES = [
  [4,5,6,7], [1,0,3,2], [5,1,2,6], [0,4,7,3], [7,6,2,3], [0,1,5,4],
];
const D6_NUMBERS = [1, 6, 2, 5, 3, 4];

// ── d8 (Octahedron) ──
const D8_VERTS = normalizeVerts([
  [1,0,0], [-1,0,0], [0,1,0], [0,-1,0], [0,0,1], [0,0,-1],
]);
const D8_FACES = [
  [0,2,4], [0,4,3], [0,3,5], [0,5,2], [1,4,2], [1,3,4], [1,5,3], [1,2,5],
];
const D8_NUMBERS = [1, 8, 3, 6, 4, 5, 2, 7];

// ── d10 (Pentagonal Trapezohedron) ──
function buildD10() {
  const h = 1.15, r = 0.95, yu = 0.35, yl = -0.35;
  const verts = [[0, h, 0], [0, -h, 0]];
  for (let i = 0; i < 5; i++) {
    const a = (i * 72) * Math.PI / 180;
    verts.push([r * Math.cos(a), yu, r * Math.sin(a)]);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 + 36) * Math.PI / 180;
    verts.push([r * Math.cos(a), yl, r * Math.sin(a)]);
  }
  const faces = [];
  for (let i = 0; i < 5; i++) {
    faces.push([0, 2 + (i + 1) % 5, 7 + i, 2 + i]);
  }
  for (let i = 0; i < 5; i++) {
    faces.push([1, 7 + i, 2 + (i + 1) % 5, 7 + (i + 1) % 5]);
  }
  return { verts: normalizeVerts(verts), faces };
}
const D10_DATA = buildD10();
const D10_VERTS = D10_DATA.verts;
const D10_FACES = D10_DATA.faces;
const D10_NUMBERS = [2, 4, 6, 8, 10, 1, 3, 5, 7, 9];

// ── d12 (Dodecahedron) ──
const D12_RAW = [
  [1,1,1], [1,1,-1], [1,-1,1], [1,-1,-1],
  [-1,1,1], [-1,1,-1], [-1,-1,1], [-1,-1,-1],
  [0, INV_PHI, PHI], [0, INV_PHI, -PHI], [0, -INV_PHI, PHI], [0, -INV_PHI, -PHI],
  [INV_PHI, PHI, 0], [INV_PHI, -PHI, 0], [-INV_PHI, PHI, 0], [-INV_PHI, -PHI, 0],
  [PHI, 0, INV_PHI], [PHI, 0, -INV_PHI], [-PHI, 0, INV_PHI], [-PHI, 0, -INV_PHI],
];
const D12_VERTS = normalizeVerts(D12_RAW);
const D12_FACES = [
  [0,8,10,2,16], [0,16,17,1,12], [0,12,14,4,8],
  [1,17,3,11,9], [1,9,5,14,12], [2,10,6,15,13],
  [2,13,3,17,16], [3,13,15,7,11], [4,14,5,19,18],
  [4,18,6,10,8], [5,9,11,7,19], [6,18,19,7,15],
];
const D12_NUMBERS = [1, 12, 2, 11, 3, 10, 4, 9, 5, 8, 6, 7];

// ── d20 (Icosahedron) ──
const D20_VERTS = normalizeVerts([
  [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
  [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
  [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
]);
const D20_FACES = [
  [0,11,5], [0,5,1], [0,1,7], [0,7,10], [0,10,11],
  [1,5,9], [5,11,4], [11,10,2], [10,7,6], [7,1,8],
  [3,9,4], [3,4,2], [3,2,6], [3,6,8], [3,8,9],
  [4,9,5], [2,4,11], [6,2,10], [8,6,7], [9,8,1],
];
const D20_NUMBERS = [20, 1, 18, 3, 16, 5, 14, 7, 12, 9, 2, 19, 4, 17, 6, 15, 8, 13, 10, 11];

// ── Registry ──
const DICE = {
  d4:  { verts: D4_VERTS,  faces: D4_FACES,  numbers: D4_NUMBERS,  scale: 0.36, fontScale: 1.2 },
  d6:  { verts: D6_VERTS,  faces: D6_FACES,  numbers: D6_NUMBERS,  scale: 0.26, fontScale: 1.3 },
  d8:  { verts: D8_VERTS,  faces: D8_FACES,  numbers: D8_NUMBERS,  scale: 0.32, fontScale: 1.1 },
  d10: { verts: D10_VERTS, faces: D10_FACES, numbers: D10_NUMBERS, scale: 0.30, fontScale: 1.0 },
  d12: { verts: D12_VERTS, faces: D12_FACES, numbers: D12_NUMBERS, scale: 0.26, fontScale: 0.85 },
  d20: { verts: D20_VERTS, faces: D20_FACES, numbers: D20_NUMBERS, scale: 0.30, fontScale: 1.0 },
};

// ── Lighting ──
const LIGHT_MAIN = norm([0.4, 0.7, 0.9]);
const LIGHT_RIM  = norm([-0.5, -0.3, 0.4]);

// ── Particles ──
const MAX_PARTICLES = 60;
let particles = [];

function spawnParticle(x, y, spread) {
  if (particles.length >= MAX_PARTICLES) return;
  particles.push({
    x, y,
    vx: (Math.random() - 0.5) * (spread || 4),
    vy: (Math.random() - 0.5) * (spread || 4) - 1,
    life: 1.0,
    decay: 0.03 + Math.random() * 0.02,
    size: 1 + Math.random() * 2.5,
    bright: Math.random() > 0.5,
  });
}

function updateParticles(ctx) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += 0.04;
    p.life -= p.decay; p.size *= 0.97;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    const a = p.life * 0.7;
    const color = p.bright ? `rgba(255,120,80,${a})` : `rgba(200,60,40,${a})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

function spawnBurst(x, y, n) {
  for (let i = 0; i < n; i++) spawnParticle(x, y, 6);
}

// ════════════════════════════════════════
// GENERIC DICE RENDERER
// ════════════════════════════════════════

function drawDice(ctx, dieType, w, h, cx, cy, rx, ry, rz, scale, resultNumber) {
  const die = DICE[dieType] || DICE.d20;
  const sz = (w * die.scale) * scale;

  const transformed = die.verts.map(v => {
    let p = rotateX(v, rx);
    p = rotateY(p, ry);
    p = rotateZ(p, rz);
    return p;
  });

  const faceData = die.faces.map((face, fi) => {
    const pts3d = face.map(vi => transformed[vi]);
    const pts2d = pts3d.map(p => [cx + p[0] * sz, cy - p[1] * sz]);
    const faceNormal = norm(cross(sub(pts3d[1], pts3d[0]), sub(pts3d[2], pts3d[0])));
    const avgZ = pts3d.reduce((s, p) => s + p[2], 0) / pts3d.length;

    const diff = Math.max(0, dot(faceNormal, LIGHT_MAIN));
    const rim = Math.pow(Math.max(0, dot(faceNormal, LIGHT_RIM)), 2) * 0.3;
    const R = [
      2 * faceNormal[0] * dot(faceNormal, LIGHT_MAIN) - LIGHT_MAIN[0],
      2 * faceNormal[1] * dot(faceNormal, LIGHT_MAIN) - LIGHT_MAIN[1],
      2 * faceNormal[2] * dot(faceNormal, LIGHT_MAIN) - LIGHT_MAIN[2],
    ];
    const spec = Math.pow(Math.max(0, dot(norm(R), [0, 0, 1])), 40) * 0.9;
    const viewDot = Math.abs(faceNormal[2]);
    const fresnel = Math.pow(1 - viewDot, 3) * 0.15;

    return { pts2d, pts3d, normal: faceNormal, avgZ, diff, rim, spec, fresnel, number: die.numbers[fi] };
  });

  // Swap result onto front-facing face
  if (resultNumber !== null && resultNumber !== undefined) {
    let bestIdx = 0, bestZ = -Infinity;
    for (let i = 0; i < faceData.length; i++) {
      if (faceData[i].normal[2] > bestZ) { bestZ = faceData[i].normal[2]; bestIdx = i; }
    }
    const resultIdx = faceData.findIndex(f => f.number === resultNumber);
    if (resultIdx >= 0 && resultIdx !== bestIdx) {
      const tmp = faceData[bestIdx].number;
      faceData[bestIdx].number = faceData[resultIdx].number;
      faceData[resultIdx].number = tmp;
    }
  }

  faceData.sort((a, b) => a.avgZ - b.avgZ);

  // Shadow
  const shadowGrad = ctx.createRadialGradient(cx + 4, cy + 8, 0, cx + 4, cy + 8, sz * 1.2);
  shadowGrad.addColorStop(0, "rgba(0,0,0,0.3)");
  shadowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = shadowGrad;
  ctx.fillRect(cx - sz * 1.5, cy - sz * 1.5, sz * 3, sz * 3);

  // Draw each face
  for (const f of faceData) {
    if (f.normal[2] < -0.05) continue;

    const { pts2d, diff, rim, spec, fresnel, number } = f;

    // Black glossy surface
    const ambient = 0.08;
    const light = ambient + diff * 0.35 + rim;
    const r = Math.min(255, Math.round(lerp(8, 50, light) + 200 * spec + 60 * fresnel));
    const g = Math.min(255, Math.round(lerp(8, 45, light) + 200 * spec + 60 * fresnel));
    const b = Math.min(255, Math.round(lerp(12, 55, light) + 220 * spec + 80 * fresnel));

    // Draw polygon (triangle, quad, or pentagon)
    ctx.beginPath();
    ctx.moveTo(pts2d[0][0], pts2d[0][1]);
    for (let i = 1; i < pts2d.length; i++) {
      ctx.lineTo(pts2d[i][0], pts2d[i][1]);
    }
    ctx.closePath();

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();

    // Edge highlight
    const edgeAlpha = 0.15 + spec * 0.3 + fresnel;
    ctx.strokeStyle = `rgba(120, 130, 150, ${Math.min(0.5, edgeAlpha)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Specular spot
    if (spec > 0.1) {
      const cenX = pts2d.reduce((s, p) => s + p[0], 0) / pts2d.length;
      const cenY = pts2d.reduce((s, p) => s + p[1], 0) / pts2d.length;
      const spotR = sz * 0.15 * spec;
      const spotGrad = ctx.createRadialGradient(cenX - spotR * 0.5, cenY - spotR * 0.5, 0, cenX, cenY, spotR * 2);
      spotGrad.addColorStop(0, `rgba(255,255,255,${spec * 0.25})`);
      spotGrad.addColorStop(1, "transparent");
      ctx.fillStyle = spotGrad;
      ctx.fill();
    }

    // Number
    if (f.normal[2] > 0.12) {
      const cenX = pts2d.reduce((s, p) => s + p[0], 0) / pts2d.length;
      const cenY = pts2d.reduce((s, p) => s + p[1], 0) / pts2d.length;
      const fontSize = Math.round(14 * scale * die.fontScale * (0.55 + f.normal[2] * 0.45));
      const alpha = Math.min(1, (f.normal[2] - 0.12) * 2.5);

      ctx.font = `bold ${fontSize}px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.8})`;
      ctx.fillText(String(number), cenX + 0.8, cenY + 0.8);

      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fillText(String(number), cenX, cenY);

      if (spec > 0.2) {
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * spec * 0.3})`;
        ctx.fillText(String(number), cenX, cenY);
      }
    }
  }
}

// ════════════════════════════════════════
// BOUNCING ANIMATED ROLL (supports multiple dice)
// ════════════════════════════════════════

let animFrame = null;

// resultNumbers: single number OR array of numbers (one per die)
export function startDiceRoll(canvas, duration, dieType, resultNumbers, onDone) {
  cancelAnimationFrame(animFrame);
  animFrame = null;
  particles = [];
  duration = duration || 2800;
  dieType = dieType || "d20";

  // Normalize to array
  const results = Array.isArray(resultNumbers) ? resultNumbers : [resultNumbers];
  const diceCount = results.length;

  const ctx = canvas.getContext("2d");
  if (!ctx) { if (onDone) onDone(); return; }

  const w = canvas.width;
  const h = canvas.height;
  const startTime = performance.now();

  // Scale down dice when there are multiple
  const sizeMultiplier = diceCount === 1 ? 1 : diceCount === 2 ? 0.75 : diceCount <= 4 ? 0.6 : 0.5;

  // Create independent physics for each die
  const dice = [];
  for (let di = 0; di < diceCount; di++) {
    const ang = (di / diceCount) * Math.PI * 2 + Math.random() * 0.5;
    // Settle positions: spread evenly around center
    const settleAngle = diceCount === 1 ? 0 : (di / diceCount) * Math.PI * 2 - Math.PI / 2;
    const settleRadius = diceCount === 1 ? 0 : w * 0.12;
    dice.push({
      posX: w * 0.2 + Math.random() * w * 0.6,
      posY: h * 0.2 + Math.random() * h * 0.6,
      velX: Math.cos(ang) * (8 + Math.random() * 6),
      velY: Math.sin(ang) * (6 + Math.random() * 5),
      bounceScale: 1,
      bounceVel: 0,
      axisSpeed: {
        x: 6 + Math.random() * 6,
        y: 5 + Math.random() * 7,
        z: 3 + Math.random() * 5,
      },
      finalRx: 0, finalRy: 0, finalRz: 0,
      dirChanges: Array.from({ length: 6 }, (_, i) => 0.08 + i * 0.12 + Math.random() * 0.06),
      lastDirChange: -1,
      result: results[di],
      settleX: w / 2 + Math.cos(settleAngle) * settleRadius,
      settleY: h / 2 + Math.sin(settleAngle) * settleRadius,
    });
  }

  const margin = w * 0.18;
  let phase = "rolling";
  let settleStart = 0;
  let flashAlpha = 0;

  function clearBg() {
    ctx.clearRect(0, 0, w, h);
    const bg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.7);
    bg.addColorStop(0, "#141218");
    bg.addColorStop(1, "#08060a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }

  function tick(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    clearBg();

    if (phase === "rolling") {
      const decay = 1 - t * t;
      const speed = Math.max(0.03, decay);

      for (const d of dice) {
        d.posX += d.velX * speed;
        d.posY += d.velY * speed;

        if (d.posX < margin) { d.posX = margin; d.velX = Math.abs(d.velX) * 0.9; d.bounceVel = 0.15; spawnBurst(d.posX, d.posY, 5); }
        if (d.posX > w - margin) { d.posX = w - margin; d.velX = -Math.abs(d.velX) * 0.9; d.bounceVel = 0.15; spawnBurst(d.posX, d.posY, 5); }
        if (d.posY < margin) { d.posY = margin; d.velY = Math.abs(d.velY) * 0.9; d.bounceVel = 0.15; spawnBurst(d.posX, d.posY, 5); }
        if (d.posY > h - margin) { d.posY = h - margin; d.velY = -Math.abs(d.velY) * 0.9; d.bounceVel = 0.15; spawnBurst(d.posX, d.posY, 5); }

        d.bounceVel += (1 - d.bounceScale) * 0.3;
        d.bounceVel *= 0.7;
        d.bounceScale += d.bounceVel;

        for (let i = 0; i < d.dirChanges.length; i++) {
          if (t >= d.dirChanges[i] && d.lastDirChange < i) {
            d.lastDirChange = i;
            const ang = Math.random() * Math.PI * 2;
            const spd = (5 + Math.random() * 7) * speed;
            d.velX = Math.cos(ang) * spd;
            d.velY = Math.sin(ang) * spd;
            d.bounceVel = 0.1;
            spawnBurst(d.posX, d.posY, 6);
          }
        }

        if (t > 0.15 && t < 0.65) d.velY += 0.5 * speed;

        if (t > 0.8) {
          const s = (t - 0.8) / 0.2;
          d.posX += (d.settleX - d.posX) * s * 0.15;
          d.posY += (d.settleY - d.posY) * s * 0.15;
        }

        const rotP = speed * 10;
        d.finalRx = rotP * d.axisSpeed.x + t * 2;
        d.finalRy = rotP * d.axisSpeed.y + t * 3;
        d.finalRz = rotP * d.axisSpeed.z + t * 1.5;
      }

      updateParticles(ctx);

      for (const d of dice) {
        const baseScale = t < 0.08 ? (0.5 + 0.5 * (t / 0.08)) : (1 + Math.sin(t * 25) * 0.08 * decay);
        const scale = baseScale * d.bounceScale * sizeMultiplier;
        const showResult = t > 0.82 ? d.result : null;
        if (speed > 0.15 && Math.random() < speed * 0.3) spawnParticle(d.posX, d.posY, 2);
        drawDice(ctx, dieType, w, h, d.posX, d.posY, d.finalRx, d.finalRy, d.finalRz, scale, showResult);
      }

      if (t < 1) {
        animFrame = requestAnimationFrame(tick);
      } else {
        phase = "settling";
        settleStart = now;
        flashAlpha = 0.3;
        spawnBurst(w / 2, h / 2, 15);
        animFrame = requestAnimationFrame(tick);
      }

    } else if (phase === "settling") {
      const sElapsed = now - settleStart;
      const sT = Math.min(1, sElapsed / 500);

      if (flashAlpha > 0.01) {
        ctx.fillStyle = `rgba(220, 60, 30, ${flashAlpha})`;
        ctx.fillRect(0, 0, w, h);
        flashAlpha *= 0.85;
      }

      updateParticles(ctx);
      for (const d of dice) {
        drawDice(ctx, dieType, w, h, d.settleX, d.settleY, d.finalRx, d.finalRy, d.finalRz, sizeMultiplier, d.result);
      }

      const ga = 0.06 + Math.sin(sElapsed * 0.008) * 0.02;
      const ring = ctx.createRadialGradient(w/2, h/2, w * 0.08, w/2, h/2, w * 0.42);
      ring.addColorStop(0, `rgba(200, 50, 30, ${ga})`);
      ring.addColorStop(1, "transparent");
      ctx.fillStyle = ring;
      ctx.fillRect(0, 0, w, h);

      if (sT < 1 || particles.length > 0) {
        animFrame = requestAnimationFrame(tick);
      } else {
        phase = "done";
        clearBg();
        for (const d of dice) {
          drawDice(ctx, dieType, w, h, d.settleX, d.settleY, d.finalRx, d.finalRy, d.finalRz, sizeMultiplier, d.result);
        }
        const fg = ctx.createRadialGradient(w/2, h/2, w * 0.06, w/2, h/2, w * 0.38);
        fg.addColorStop(0, "rgba(180, 40, 20, 0.08)");
        fg.addColorStop(1, "transparent");
        ctx.fillStyle = fg;
        ctx.fillRect(0, 0, w, h);
        if (onDone) onDone();
      }
    }
  }

  animFrame = requestAnimationFrame(tick);
}

export function stopDiceRoll() {
  cancelAnimationFrame(animFrame);
  animFrame = null;
  particles = [];
}

// ── Backward-compatible wrappers ──
export function startD20Roll(canvas, duration, resultNumber, onDone) {
  return startDiceRoll(canvas, duration, "d20", resultNumber, onDone);
}
export function stopD20Roll() { return stopDiceRoll(); }

// ── Utility: parse die type from notation ──
export function parseDieType(notation) {
  if (!notation) return null;
  const match = notation.match(/d(\d+)/i);
  if (!match) return null;
  const sides = parseInt(match[1]);
  if ([4, 6, 8, 10, 12, 20].includes(sides)) return `d${sides}`;
  return "d20";
}
