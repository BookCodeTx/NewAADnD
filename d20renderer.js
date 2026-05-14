// ════════════════════════════════════════
// d20renderer.js — Cinematic bouncing d20 with particles & glow
// Gold/copper icosahedron that bounces around, then settles
// ════════════════════════════════════════

const PHI = (1 + Math.sqrt(5)) / 2;

// Icosahedron vertices (unit sphere)
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

// ── Math helpers ──
function rotateX(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1]*c - v[2]*s, v[1]*s + v[2]*c]; }
function rotateY(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0]*c + v[2]*s, v[1], -v[0]*s + v[2]*c]; }
function rotateZ(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0]*c - v[1]*s, v[0]*s + v[1]*c, v[2]]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function normalize(v) { const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]); return len > 0 ? [v[0]/len, v[1]/len, v[2]/len] : [0,0,0]; }

const LIGHT_DIR = normalize([0.3, 0.6, 1]);

// ── Particle pool ──
const MAX_PARTICLES = 80;
let particles = [];

function spawnParticle(x, y, vxMult, vyMult) {
  if (particles.length >= MAX_PARTICLES) return;
  const colorRoll = Math.random();
  let r, g, b;
  if (colorRoll < 0.3) { r = 255; g = 220; b = 80; }
  else if (colorRoll < 0.6) { r = 255; g = 160; b = 40; }
  else if (colorRoll < 0.85) { r = 255; g = 100; b = 30; }
  else { r = 255; g = 255; b = 220; }

  particles.push({
    x, y,
    vx: (Math.random() - 0.5) * (vxMult || 4),
    vy: (Math.random() - 0.5) * (vyMult || 4) - 1,
    life: 1.0,
    decay: 0.025 + Math.random() * 0.03,
    size: 1 + Math.random() * 3,
    r, g, b,
  });
}

function updateAndDrawParticles(ctx) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.05;
    p.life -= p.decay;
    p.size *= 0.98;
    if (p.life <= 0) { particles.splice(i, 1); continue; }

    const alpha = p.life * 0.8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha})`;
    ctx.fill();

    if (p.size > 1.5) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.r},${p.g},${p.b},${alpha * 0.12})`;
      ctx.fill();
    }
  }
}

function spawnBurst(x, y, count) {
  for (let i = 0; i < count; i++) {
    spawnParticle(x, y, 7, 7);
  }
}

// ── Draw one d20 frame ──
function drawD20(ctx, w, h, cx, cy, rx, ry, rz, scale, resultNumber) {
  const sz = (w * 0.28) * scale;

  // Transform vertices
  const transformed = VERTS.map(v => {
    let p = rotateX(v, rx);
    p = rotateY(p, ry);
    p = rotateZ(p, rz);
    return p;
  });

  // Build face data
  const faceData = FACES.map((face, fi) => {
    const pts3d = face.map(vi => transformed[vi]);
    const pts2d = pts3d.map(p => [cx + p[0] * sz, cy - p[1] * sz]);
    const normal = normalize(cross(sub(pts3d[1], pts3d[0]), sub(pts3d[2], pts3d[0])));
    const cen3d = [
      (pts3d[0][0] + pts3d[1][0] + pts3d[2][0]) / 3,
      (pts3d[0][1] + pts3d[1][1] + pts3d[2][1]) / 3,
      (pts3d[0][2] + pts3d[1][2] + pts3d[2][2]) / 3,
    ];

    const diffuse = Math.max(0, dot(normal, LIGHT_DIR));
    const ambient = 0.35;
    const brightness = ambient + diffuse * 0.65;

    const reflect = [
      2 * normal[0] * dot(normal, LIGHT_DIR) - LIGHT_DIR[0],
      2 * normal[1] * dot(normal, LIGHT_DIR) - LIGHT_DIR[1],
      2 * normal[2] * dot(normal, LIGHT_DIR) - LIGHT_DIR[2],
    ];
    const spec = Math.pow(Math.max(0, dot(normalize(reflect), [0, 0, 1])), 20) * 0.8;

    return { pts2d, normal, avgZ: cen3d[2], brightness, spec, number: FACE_NUMBERS[fi] };
  });

  // Swap result number onto front face
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

  // Sort back to front (painter's algorithm)
  faceData.sort((a, b) => a.avgZ - b.avgZ);

  // Glow behind dice
  const glow = ctx.createRadialGradient(cx, cy, sz * 0.2, cx, cy, sz * 1.8);
  glow.addColorStop(0, "rgba(255, 180, 60, 0.15)");
  glow.addColorStop(0.6, "rgba(255, 130, 30, 0.06)");
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, sz * 1.8, 0, Math.PI * 2);
  ctx.fill();

  // Draw faces
  for (const f of faceData) {
    if (f.normal[2] < -0.1) continue;

    const { pts2d, brightness, spec, number } = f;

    // Gold/copper color with lighting
    const r = Math.min(255, Math.round(180 * brightness + 255 * spec));
    const g = Math.min(255, Math.round(130 * brightness + 230 * spec));
    const b = Math.min(255, Math.round(50 * brightness + 150 * spec));

    ctx.beginPath();
    ctx.moveTo(pts2d[0][0], pts2d[0][1]);
    ctx.lineTo(pts2d[1][0], pts2d[1][1]);
    ctx.lineTo(pts2d[2][0], pts2d[2][1]);
    ctx.closePath();

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();

    // Golden edges
    ctx.strokeStyle = "rgba(255, 210, 100, 0.6)";
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Number on visible faces
    if (f.normal[2] > 0.15) {
      const cenX = (pts2d[0][0] + pts2d[1][0] + pts2d[2][0]) / 3;
      const cenY = (pts2d[0][1] + pts2d[1][1] + pts2d[2][1]) / 3;
      const fontSize = Math.round(13 * scale * (0.6 + f.normal[2] * 0.4));
      const alpha = Math.min(1, f.normal[2] * 1.5);

      ctx.font = `bold ${fontSize}px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Dark shadow for readability
      ctx.fillStyle = `rgba(40, 20, 0, ${alpha * 0.7})`;
      ctx.fillText(String(number), cenX + 1, cenY + 1);
      // White number
      ctx.fillStyle = `rgba(255, 255, 240, ${alpha})`;
      ctx.fillText(String(number), cenX, cenY);
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

  // Spin speeds
  const axisSpeed = {
    x: 5 + Math.random() * 4,
    y: 4 + Math.random() * 5,
    z: 3 + Math.random() * 3,
  };

  // Bouncing physics
  const margin = w * 0.22;
  let posX = w * 0.3 + Math.random() * w * 0.4;
  let posY = h * 0.3 + Math.random() * h * 0.4;
  let velX = (Math.random() > 0.5 ? 1 : -1) * (5 + Math.random() * 4);
  let velY = (Math.random() > 0.5 ? 1 : -1) * (4 + Math.random() * 3);

  // Pre-generate random direction change times
  const dirChanges = [];
  for (let i = 0; i < 5; i++) {
    dirChanges.push(0.1 + (i * 0.15) + Math.random() * 0.05);
  }
  let lastDirChange = -1;

  let phase = "rolling"; // "rolling" → "settling" → "done"
  let settleStart = 0;
  let flashAlpha = 0;
  let finalRx = 0, finalRy = 0, finalRz = 0;

  function tick(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);

    ctx.clearRect(0, 0, w, h);

    // Dark background
    ctx.fillStyle = "#0d0a06";
    ctx.fillRect(0, 0, w, h);

    if (phase === "rolling") {
      // ── Decay speed ──
      const decay = 1 - t * t;
      const speed = Math.max(0.02, decay);

      // ── Move dice ──
      posX += velX * speed;
      posY += velY * speed;

      // Bounce off walls
      if (posX < margin) { posX = margin; velX = Math.abs(velX) * 0.85; spawnBurst(posX, posY, 6); }
      if (posX > w - margin) { posX = w - margin; velX = -Math.abs(velX) * 0.85; spawnBurst(posX, posY, 6); }
      if (posY < margin) { posY = margin; velY = Math.abs(velY) * 0.85; spawnBurst(posX, posY, 6); }
      if (posY > h - margin) { posY = h - margin; velY = -Math.abs(velY) * 0.85; spawnBurst(posX, posY, 6); }

      // Random direction changes
      for (let i = 0; i < dirChanges.length; i++) {
        if (t >= dirChanges[i] && lastDirChange < i) {
          lastDirChange = i;
          const ang = Math.random() * Math.PI * 2;
          const spd = (3 + Math.random() * 4) * speed;
          velX = Math.cos(ang) * spd;
          velY = Math.sin(ang) * spd;
          spawnBurst(posX, posY, 8);
        }
      }

      // Settle toward center in last 25%
      if (t > 0.75) {
        const s = (t - 0.75) / 0.25;
        posX += (w / 2 - posX) * s * 0.12;
        posY += (h / 2 - posY) * s * 0.12;
      }

      // Rotation
      const rotProgress = speed * 8;
      finalRx = rotProgress * axisSpeed.x + t * 2;
      finalRy = rotProgress * axisSpeed.y + t * 3;
      finalRz = rotProgress * axisSpeed.z + t * 1.5;

      // Scale wobble
      const scale = t < 0.08 ? (0.5 + 0.5 * (t / 0.08)) : (1 + Math.sin(t * 20) * 0.06 * decay);

      // Show result near end
      const showResult = t > 0.82 ? resultNumber : null;

      // Spawn trail particles
      if (speed > 0.1 && Math.random() < speed * 0.6) {
        spawnParticle(posX, posY, 3, 3);
      }

      // Draw particles
      updateAndDrawParticles(ctx);

      // Draw dice
      drawD20(ctx, w, h, posX, posY, finalRx, finalRy, finalRz, scale, showResult);

      if (t < 1) {
        animFrame = requestAnimationFrame(tick);
      } else {
        // Transition to settling phase
        phase = "settling";
        settleStart = now;
        flashAlpha = 0.5;
        spawnBurst(w / 2, h / 2, 25);
        animFrame = requestAnimationFrame(tick);
      }

    } else if (phase === "settling") {
      const settleElapsed = now - settleStart;
      const settleT = Math.min(1, settleElapsed / 600); // 600ms settle

      // Flash fade
      if (flashAlpha > 0.01) {
        ctx.fillStyle = `rgba(255, 200, 80, ${flashAlpha})`;
        ctx.fillRect(0, 0, w, h);
        flashAlpha *= 0.88;
      }

      // Particles
      updateAndDrawParticles(ctx);

      // Dice at center, locked result
      drawD20(ctx, w, h, w / 2, h / 2, finalRx, finalRy, finalRz, 1, resultNumber);

      // Pulsing glow ring
      const glowAlpha = 0.08 + Math.sin(settleElapsed * 0.008) * 0.03;
      const ring = ctx.createRadialGradient(w/2, h/2, w * 0.1, w/2, h/2, w * 0.45);
      ring.addColorStop(0, `rgba(255, 180, 60, ${glowAlpha})`);
      ring.addColorStop(1, "transparent");
      ctx.fillStyle = ring;
      ctx.fillRect(0, 0, w, h);

      if (settleT < 1 || particles.length > 0) {
        animFrame = requestAnimationFrame(tick);
      } else {
        // Final static frame
        phase = "done";
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#0d0a06";
        ctx.fillRect(0, 0, w, h);
        drawD20(ctx, w, h, w / 2, h / 2, finalRx, finalRy, finalRz, 1, resultNumber);

        // Static glow
        const finalGlow = ctx.createRadialGradient(w/2, h/2, w * 0.08, w/2, h/2, w * 0.4);
        finalGlow.addColorStop(0, "rgba(255, 180, 60, 0.1)");
        finalGlow.addColorStop(1, "transparent");
        ctx.fillStyle = finalGlow;
        ctx.fillRect(0, 0, w, h);

        if (onDone) onDone();
      }
    }
  }

  animFrame = requestAnimationFrame(tick);
}

export function stopD20Roll() {
  cancelAnimationFrame(animFrame);
  animFrame = null;
  particles = [];
}

// Keep renderD20 export for compatibility (static render)
export function renderD20(canvas, rx, ry, rz, scale, resultNumber) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0d0a06";
  ctx.fillRect(0, 0, w, h);
  drawD20(ctx, w, h, w / 2, h / 2, rx, ry, rz, scale || 1, resultNumber);
}
