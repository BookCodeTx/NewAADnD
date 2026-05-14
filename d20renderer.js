// ════════════════════════════════════════
// d20renderer.js — Realistic black glossy d20 with red numbers
// Bouncing icosahedron with depth shading, specular highlights, and beveled edges
// ════════════════════════════════════════

const PHI = (1 + Math.sqrt(5)) / 2;

const RAW_VERTS = [
  [-1,  PHI, 0], [ 1,  PHI, 0], [-1, -PHI, 0], [ 1, -PHI, 0],
  [0, -1,  PHI], [0,  1,  PHI], [0, -1, -PHI], [0,  1, -PHI],
  [ PHI, 0, -1], [ PHI, 0,  1], [-PHI, 0, -1], [-PHI, 0,  1],
];

const VERTS = RAW_VERTS.map(([x, y, z]) => {
  const len = Math.sqrt(x*x + y*y + z*z);
  return [x/len, y/len, z/len];
});

const FACES = [
  [0,11,5], [0,5,1], [0,1,7], [0,7,10], [0,10,11],
  [1,5,9], [5,11,4], [11,10,2], [10,7,6], [7,1,8],
  [3,9,4], [3,4,2], [3,2,6], [3,6,8], [3,8,9],
  [4,9,5], [2,4,11], [6,2,10], [8,6,7], [9,8,1],
];

const FACE_NUMBERS = [20, 1, 18, 3, 16, 5, 14, 7, 12, 9, 2, 19, 4, 17, 6, 15, 8, 13, 10, 11];

// ── Math ──
function rotateX(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1]*c - v[2]*s, v[1]*s + v[2]*c]; }
function rotateY(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0]*c + v[2]*s, v[1], -v[0]*s + v[2]*c]; }
function rotateZ(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0]*c - v[1]*s, v[0]*s + v[1]*c, v[2]]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function normalize(v) { const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); return len > 0 ? [v[0]/len, v[1]/len, v[2]/len] : [0,0,0]; }
function lerp(a, b, t) { return a + (b - a) * t; }

// Two light sources for more depth
const LIGHT_MAIN = normalize([0.4, 0.7, 0.9]);   // Front-top-right
const LIGHT_RIM  = normalize([-0.5, -0.3, 0.4]);  // Back-left rim light

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

// ── Draw d20 ──
function drawD20(ctx, w, h, cx, cy, rx, ry, rz, scale, resultNumber) {
  const sz = (w * 0.30) * scale;

  const transformed = VERTS.map(v => {
    let p = rotateX(v, rx);
    p = rotateY(p, ry);
    p = rotateZ(p, rz);
    return p;
  });

  const faceData = FACES.map((face, fi) => {
    const pts3d = face.map(vi => transformed[vi]);
    const pts2d = pts3d.map(p => [cx + p[0] * sz, cy - p[1] * sz]);
    const normal = normalize(cross(sub(pts3d[1], pts3d[0]), sub(pts3d[2], pts3d[0])));
    const avgZ = (pts3d[0][2] + pts3d[1][2] + pts3d[2][2]) / 3;

    // Main diffuse light
    const diff = Math.max(0, dot(normal, LIGHT_MAIN));
    // Rim light (subtle back-light for depth)
    const rim = Math.pow(Math.max(0, dot(normal, LIGHT_RIM)), 2) * 0.3;
    // Specular (glossy highlight)
    const R = [
      2 * normal[0] * dot(normal, LIGHT_MAIN) - LIGHT_MAIN[0],
      2 * normal[1] * dot(normal, LIGHT_MAIN) - LIGHT_MAIN[1],
      2 * normal[2] * dot(normal, LIGHT_MAIN) - LIGHT_MAIN[2],
    ];
    const spec = Math.pow(Math.max(0, dot(normalize(R), [0, 0, 1])), 40) * 0.9;

    // Fresnel effect — edges glow slightly
    const viewDot = Math.abs(normal[2]);
    const fresnel = Math.pow(1 - viewDot, 3) * 0.15;

    return { pts2d, pts3d, normal, avgZ, diff, rim, spec, fresnel, number: FACE_NUMBERS[fi] };
  });

  // Swap result onto front face
  if (resultNumber !== null) {
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

  // ── Shadow under dice ──
  const shadowGrad = ctx.createRadialGradient(cx + 4, cy + 8, 0, cx + 4, cy + 8, sz * 1.2);
  shadowGrad.addColorStop(0, "rgba(0,0,0,0.3)");
  shadowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = shadowGrad;
  ctx.fillRect(cx - sz * 1.5, cy - sz * 1.5, sz * 3, sz * 3);

  // ── Draw each face ──
  for (const f of faceData) {
    if (f.normal[2] < -0.05) continue;

    const { pts2d, diff, rim, spec, fresnel, number } = f;

    // ── Black glossy surface with subtle dark blue tint ──
    const ambient = 0.08;
    const light = ambient + diff * 0.35 + rim;
    const r = Math.min(255, Math.round(lerp(8, 50, light) + 200 * spec + 60 * fresnel));
    const g = Math.min(255, Math.round(lerp(8, 45, light) + 200 * spec + 60 * fresnel));
    const b = Math.min(255, Math.round(lerp(12, 55, light) + 220 * spec + 80 * fresnel));

    ctx.beginPath();
    ctx.moveTo(pts2d[0][0], pts2d[0][1]);
    ctx.lineTo(pts2d[1][0], pts2d[1][1]);
    ctx.lineTo(pts2d[2][0], pts2d[2][1]);
    ctx.closePath();

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();

    // ── Beveled edge highlight ──
    const edgeAlpha = 0.15 + spec * 0.3 + fresnel;
    ctx.strokeStyle = `rgba(120, 130, 150, ${Math.min(0.5, edgeAlpha)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── Specular spot on face (glossy reflection) ──
    if (spec > 0.1) {
      const cenX = (pts2d[0][0] + pts2d[1][0] + pts2d[2][0]) / 3;
      const cenY = (pts2d[0][1] + pts2d[1][1] + pts2d[2][1]) / 3;
      const spotR = sz * 0.15 * spec;
      const spotGrad = ctx.createRadialGradient(cenX - spotR * 0.5, cenY - spotR * 0.5, 0, cenX, cenY, spotR * 2);
      spotGrad.addColorStop(0, `rgba(255,255,255,${spec * 0.25})`);
      spotGrad.addColorStop(1, "transparent");
      ctx.fillStyle = spotGrad;
      ctx.fill();
    }

    // ── Red numbers ──
    if (f.normal[2] > 0.12) {
      const cenX = (pts2d[0][0] + pts2d[1][0] + pts2d[2][0]) / 3;
      const cenY = (pts2d[0][1] + pts2d[1][1] + pts2d[2][1]) / 3;
      const fontSize = Math.round(14 * scale * (0.55 + f.normal[2] * 0.45));
      const alpha = Math.min(1, (f.normal[2] - 0.12) * 2.5);

      ctx.font = `bold ${fontSize}px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Dark outline for depth
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha * 0.8})`;
      ctx.fillText(String(number), cenX + 0.8, cenY + 0.8);

      // White number
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fillText(String(number), cenX, cenY);

      // Subtle bright highlight on number
      if (spec > 0.2) {
        ctx.fillStyle = `rgba(255, 255, 255, ${alpha * spec * 0.3})`;
        ctx.fillText(String(number), cenX, cenY);
      }
    }
  }
}

// ════════════════════════════════════════
// BOUNCING ANIMATED ROLL
// ════════════════════════════════════════

let animFrame = null;

export function startD20Roll(canvas, duration, resultNumber, onDone) {
  cancelAnimationFrame(animFrame);
  animFrame = null;
  particles = [];
  duration = duration || 2800;

  const ctx = canvas.getContext("2d");
  if (!ctx) { if (onDone) onDone(); return; }

  const w = canvas.width;
  const h = canvas.height;
  const startTime = performance.now();

  const axisSpeed = {
    x: 7 + Math.random() * 5,
    y: 6 + Math.random() * 6,
    z: 4 + Math.random() * 4,
  };

  const margin = w * 0.18;
  let posX = w * 0.2 + Math.random() * w * 0.6;
  let posY = h * 0.2 + Math.random() * h * 0.6;
  let velX = (Math.random() > 0.5 ? 1 : -1) * (10 + Math.random() * 6);
  let velY = (Math.random() > 0.5 ? 1 : -1) * (8 + Math.random() * 5);

  // Bounce scale effect
  let bounceScale = 1;
  let bounceVel = 0;

  const dirChanges = [];
  for (let i = 0; i < 8; i++) dirChanges.push(0.06 + i * 0.1 + Math.random() * 0.04);
  let lastDirChange = -1;

  let phase = "rolling";
  let settleStart = 0;
  let flashAlpha = 0;
  let finalRx = 0, finalRy = 0, finalRz = 0;

  function clearBg() {
    ctx.clearRect(0, 0, w, h);
    // Dark gradient background
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

      posX += velX * speed;
      posY += velY * speed;

      // Wall bounces with squish effect
      if (posX < margin) { posX = margin; velX = Math.abs(velX) * 0.9; bounceVel = 0.15; spawnBurst(posX, posY, 8); }
      if (posX > w - margin) { posX = w - margin; velX = -Math.abs(velX) * 0.9; bounceVel = 0.15; spawnBurst(posX, posY, 8); }
      if (posY < margin) { posY = margin; velY = Math.abs(velY) * 0.9; bounceVel = 0.15; spawnBurst(posX, posY, 8); }
      if (posY > h - margin) { posY = h - margin; velY = -Math.abs(velY) * 0.9; bounceVel = 0.15; spawnBurst(posX, posY, 8); }

      // Bounce scale spring physics
      bounceVel += (1 - bounceScale) * 0.3;
      bounceVel *= 0.7;
      bounceScale += bounceVel;

      // Random direction changes — more aggressive
      for (let i = 0; i < dirChanges.length; i++) {
        if (t >= dirChanges[i] && lastDirChange < i) {
          lastDirChange = i;
          const ang = Math.random() * Math.PI * 2;
          const spd = (6 + Math.random() * 8) * speed;
          velX = Math.cos(ang) * spd;
          velY = Math.sin(ang) * spd;
          bounceVel = 0.12;
          spawnBurst(posX, posY, 10);
        }
      }

      // Gravity-like vertical bounce during mid-roll
      if (t > 0.15 && t < 0.65) {
        velY += 0.6 * speed;
      }

      if (t > 0.8) {
        const s = (t - 0.8) / 0.2;
        posX += (w / 2 - posX) * s * 0.15;
        posY += (h / 2 - posY) * s * 0.15;
      }

      const rotP = speed * 10;
      finalRx = rotP * axisSpeed.x + t * 2;
      finalRy = rotP * axisSpeed.y + t * 3;
      finalRz = rotP * axisSpeed.z + t * 1.5;

      const baseScale = t < 0.08 ? (0.5 + 0.5 * (t / 0.08)) : (1 + Math.sin(t * 25) * 0.08 * decay);
      const scale = baseScale * bounceScale;
      const showResult = t > 0.82 ? resultNumber : null;

      if (speed > 0.1 && Math.random() < speed * 0.5) spawnParticle(posX, posY, 3);

      updateParticles(ctx);
      drawD20(ctx, w, h, posX, posY, finalRx, finalRy, finalRz, scale, showResult);

      if (t < 1) {
        animFrame = requestAnimationFrame(tick);
      } else {
        phase = "settling";
        settleStart = now;
        flashAlpha = 0.3;
        spawnBurst(w / 2, h / 2, 20);
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
      drawD20(ctx, w, h, w / 2, h / 2, finalRx, finalRy, finalRz, 1, resultNumber);

      // Subtle red glow
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
        drawFinalFrame();
        if (onDone) onDone();
      }
    }
  }

  function drawFinalFrame() {
    clearBg();
    drawD20(ctx, w, h, w / 2, h / 2, finalRx, finalRy, finalRz, 1, resultNumber);
    const fg = ctx.createRadialGradient(w/2, h/2, w * 0.06, w/2, h/2, w * 0.38);
    fg.addColorStop(0, "rgba(180, 40, 20, 0.08)");
    fg.addColorStop(1, "transparent");
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, w, h);
  }

  animFrame = requestAnimationFrame(tick);
}

export function stopD20Roll() {
  cancelAnimationFrame(animFrame);
  animFrame = null;
  particles = [];
}

export function renderD20(canvas, rx, ry, rz, scale, resultNumber) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w * 0.7);
  bg.addColorStop(0, "#141218");
  bg.addColorStop(1, "#08060a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  drawD20(ctx, w, h, w / 2, h / 2, rx, ry, rz, scale || 1, resultNumber);
}
