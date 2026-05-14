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

// 20 triangular faces
const FACES = [
  [0,11,5], [0,5,1], [0,1,7], [0,7,10], [0,10,11],
  [1,5,9], [5,11,4], [11,10,2], [10,7,6], [7,1,8],
  [3,9,4], [3,4,2], [3,2,6], [3,6,8], [3,8,9],
  [4,9,5], [2,4,11], [6,2,10], [8,6,7], [9,8,1],
];

const FACE_NUMBERS = [20, 1, 18, 3, 16, 5, 14, 7, 12, 9, 2, 19, 4, 17, 6, 15, 8, 13, 10, 11];

// ── Math helpers ──
function rotateX(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0], v[1]*c - v[2]*s, v[1]*s + v[2]*c];
}
function rotateY(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0]*c + v[2]*s, v[1], -v[0]*s + v[2]*c];
}
function rotateZ(v, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0]*c - v[1]*s, v[0]*s + v[1]*c, v[2]];
}
function cross(a, b) {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function normalize(v) {
  const len = Math.sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
  return len > 0 ? [v[0]/len, v[1]/len, v[2]/len] : [0,0,0];
}
function centroid(pts) {
  const n = pts.length;
  return [
    pts.reduce((s,p) => s+p[0], 0)/n,
    pts.reduce((s,p) => s+p[1], 0)/n,
    pts.reduce((s,p) => s+p[2], 0)/n,
  ];
}

// ── Color & lighting ──
const LIGHT_DIR = normalize([0.3, 0.6, 1]);
const BASE_COLOR = { r: 160, g: 110, b: 40 };       // Gold/copper base
const SPECULAR_COLOR = { r: 255, g: 230, b: 150 };   // Bright gold specular
const EDGE_COLOR = "rgba(255, 200, 100, 0.5)";
const GLOW_COLOR = "rgba(255, 180, 60, 0.15)";

// ── Particle system ──
class Particle {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.vx = (Math.random() - 0.5) * 4;
    this.vy = (Math.random() - 0.5) * 4 - 2;
    this.life = 1.0;
    this.decay = 0.02 + Math.random() * 0.03;
    this.size = 1 + Math.random() * 3;
    // Gold/orange/white color
    const colorChoice = Math.random();
    if (colorChoice < 0.3) {
      this.color = { r: 255, g: 220, b: 80 };  // Gold
    } else if (colorChoice < 0.6) {
      this.color = { r: 255, g: 160, b: 40 };   // Orange
    } else if (colorChoice < 0.85) {
      this.color = { r: 255, g: 100, b: 30 };   // Fire
    } else {
      this.color = { r: 255, g: 255, b: 220 };  // White-hot
    }
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.05; // slight gravity
    this.life -= this.decay;
    this.size *= 0.98;
  }

  draw(ctx) {
    if (this.life <= 0) return;
    const alpha = this.life * 0.8;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${alpha})`;
    ctx.fill();

    // Glow around particle
    if (this.size > 1.5) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${this.color.r}, ${this.color.g}, ${this.color.b}, ${alpha * 0.15})`;
      ctx.fill();
    }
  }
}

// ── Renderer ──
export function renderD20(canvas, rx, ry, rz, scale = 1, resultNumber = null, options = {}) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const cx = options.offsetX ?? w / 2;
  const cy = options.offsetY ?? h / 2;
  const sz = (w * 0.28) * scale;

  // Don't clear — caller handles clearing (for particles/trail effect)

  // Transform all vertices
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
    const cen = centroid(pts3d);
    const avgZ = cen[2];
    const diffuse = Math.max(0, dot(normal, LIGHT_DIR));
    const ambient = 0.3;
    const brightness = ambient + diffuse * 0.7;
    const reflect = [
      2 * normal[0] * dot(normal, LIGHT_DIR) - LIGHT_DIR[0],
      2 * normal[1] * dot(normal, LIGHT_DIR) - LIGHT_DIR[1],
      2 * normal[2] * dot(normal, LIGHT_DIR) - LIGHT_DIR[2],
    ];
    const spec = Math.pow(Math.max(0, dot(normalize(reflect), [0, 0, 1])), 24) * 0.7;

    return { pts2d, pts3d, normal, avgZ, brightness, spec, number: FACE_NUMBERS[fi], cen, faceIdx: fi };
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

  // Sort back to front
  faceData.sort((a, b) => a.avgZ - b.avgZ);

  // ── Outer glow behind dice ──
  const glowRadius = sz * 1.6;
  const glowGrad = ctx.createRadialGradient(cx, cy, sz * 0.3, cx, cy, glowRadius);
  glowGrad.addColorStop(0, "rgba(255, 180, 60, 0.12)");
  glowGrad.addColorStop(0.5, "rgba(255, 140, 30, 0.06)");
  glowGrad.addColorStop(1, "transparent");
  ctx.fillStyle = glowGrad;
  ctx.fillRect(cx - glowRadius, cy - glowRadius, glowRadius * 2, glowRadius * 2);

  // ── Draw faces ──
  for (const f of faceData) {
    if (f.normal[2] < -0.1) continue;

    const { pts2d, brightness, spec, number } = f;

    const r = Math.min(255, Math.round(BASE_COLOR.r * brightness + SPECULAR_COLOR.r * spec));
    const g = Math.min(255, Math.round(BASE_COLOR.g * brightness + SPECULAR_COLOR.g * spec));
    const b = Math.min(255, Math.round(BASE_COLOR.b * brightness + SPECULAR_COLOR.b * spec));

    ctx.beginPath();
    ctx.moveTo(pts2d[0][0], pts2d[0][1]);
    ctx.lineTo(pts2d[1][0], pts2d[1][1]);
    ctx.lineTo(pts2d[2][0], pts2d[2][1]);
    ctx.closePath();

    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fill();

    // Golden edges
    ctx.strokeStyle = EDGE_COLOR;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Number on face
    if (f.normal[2] > 0.15) {
      const cenX = (pts2d[0][0] + pts2d[1][0] + pts2d[2][0]) / 3;
      const cenY = (pts2d[0][1] + pts2d[1][1] + pts2d[2][1]) / 3;
      const fontSize = Math.round(12 * scale * (0.6 + f.normal[2] * 0.4));
      const alpha = Math.min(1, f.normal[2] * 1.5);

      ctx.font = `bold ${fontSize}px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Dark text shadow for readability on gold
      ctx.fillStyle = `rgba(40, 20, 0, ${alpha * 0.6})`;
      ctx.fillText(String(number), cenX + 1, cenY + 1);

      ctx.fillStyle = `rgba(255, 255, 240, ${alpha})`;
      ctx.fillText(String(number), cenX, cenY);
    }
  }
}

// ════════════════════════════════════════
// BOUNCING ANIMATED ROLL
// ════════════════════════════════════════

let animFrame = null;
let particles = [];

export function startD20Roll(canvas, duration = 2800, resultNumber = null, onDone = null) {
  cancelAnimationFrame(animFrame);
  particles = [];

  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const startTime = performance.now();

  // Random spin axes
  const axisSpeed = {
    x: 5 + Math.random() * 4,
    y: 4 + Math.random() * 5,
    z: 3 + Math.random() * 3,
  };

  // ── Physics for bouncing ──
  const diceRadius = w * 0.28;
  const margin = diceRadius * 0.7;

  // Start position: random side
  let posX = margin + Math.random() * (w - margin * 2);
  let posY = h * 0.3;

  // Random initial velocity — fast!
  const speed = 6 + Math.random() * 4;
  const angle = Math.random() * Math.PI * 2;
  let velX = Math.cos(angle) * speed;
  let velY = Math.sin(angle) * speed;

  // Bounce targets — pre-generate random bounce points for natural feel
  const bounceCount = 4 + Math.floor(Math.random() * 3); // 4-6 bounces
  const bounceTimes = [];
  for (let i = 0; i < bounceCount; i++) {
    bounceTimes.push((i + 1) / (bounceCount + 1));
  }

  let lastBounceT = 0;
  let flashAlpha = 0;

  function frame(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);

    // ── Decay: fast → slow ──
    const decay = 1 - Math.pow(t, 1.5); // Energy decay
    const speedMult = Math.max(0.01, decay);

    // ── Update position with bouncing ──
    posX += velX * speedMult;
    posY += velY * speedMult;

    // Bounce off walls
    if (posX < margin) { posX = margin; velX = Math.abs(velX) * (0.7 + Math.random() * 0.3); spawnBounceParticles(posX, posY); }
    if (posX > w - margin) { posX = w - margin; velX = -Math.abs(velX) * (0.7 + Math.random() * 0.3); spawnBounceParticles(posX, posY); }
    if (posY < margin) { posY = margin; velY = Math.abs(velY) * (0.7 + Math.random() * 0.3); spawnBounceParticles(posX, posY); }
    if (posY > h - margin) { posY = h - margin; velY = -Math.abs(velY) * (0.7 + Math.random() * 0.3); spawnBounceParticles(posX, posY); }

    // Random direction changes at bounce times for chaotic feel
    for (let i = 0; i < bounceTimes.length; i++) {
      if (t >= bounceTimes[i] && lastBounceT < bounceTimes[i]) {
        const newAngle = Math.random() * Math.PI * 2;
        const newSpeed = (4 + Math.random() * 3) * speedMult;
        velX = Math.cos(newAngle) * newSpeed;
        velY = Math.sin(newAngle) * newSpeed;
        spawnBounceParticles(posX, posY);
      }
    }
    lastBounceT = t;

    // ── Settle toward center in last 25% ──
    if (t > 0.75) {
      const settleT = (t - 0.75) / 0.25;
      const ease = settleT * settleT; // Accelerate toward center
      posX += (w / 2 - posX) * ease * 0.15;
      posY += (h / 2 - posY) * ease * 0.15;
      velX *= 0.92;
      velY *= 0.92;
    }

    // ── Rotation ──
    const rotSpeed = speedMult * 8;
    const rx = rotSpeed * axisSpeed.x + t * 2;
    const ry = rotSpeed * axisSpeed.y + t * 3;
    const rz = rotSpeed * axisSpeed.z + t * 1.5;

    // ── Scale bounce effect ──
    let scale;
    if (t < 0.1) {
      scale = 0.6 + 0.4 * (t / 0.1); // Pop in
    } else {
      scale = 1 + Math.sin(t * Math.PI * bounceCount * 2) * 0.08 * decay; // Wobble
    }

    // Show result in last 20%
    const showResult = t > 0.8 ? resultNumber : null;

    // ── Spawn trail particles while moving fast ──
    if (speedMult > 0.15 && Math.random() < speedMult * 0.7) {
      particles.push(new Particle(posX, posY));
    }

    // ── Update & draw particles ──
    ctx.clearRect(0, 0, w, h);

    // Draw dark background with subtle radial gradient
    const bgGrad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, w * 0.7);
    bgGrad.addColorStop(0, "rgba(20, 15, 30, 0.3)");
    bgGrad.addColorStop(1, "rgba(10, 8, 18, 0.5)");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Particles behind dice
    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].update();
      particles[i].draw(ctx);
      if (particles[i].life <= 0) particles.splice(i, 1);
    }

    // ── Flash effect on final settle ──
    if (flashAlpha > 0) {
      ctx.fillStyle = `rgba(255, 220, 100, ${flashAlpha})`;
      ctx.fillRect(0, 0, w, h);
      flashAlpha *= 0.9;
    }

    // ── Draw the d20 ──
    renderD20(canvas, rx, ry, rz, scale, showResult, { offsetX: posX, offsetY: posY });

    if (t < 1) {
      animFrame = requestAnimationFrame(frame);
    } else {
      // ── Final frame: flash + settle ──
      flashAlpha = 0.4;

      // Burst of particles at final position
      for (let i = 0; i < 20; i++) {
        const p = new Particle(posX, posY);
        p.vx = (Math.random() - 0.5) * 8;
        p.vy = (Math.random() - 0.5) * 8;
        p.size = 2 + Math.random() * 4;
        p.decay = 0.015;
        particles.push(p);
      }

      // Final settle animation (just particles fading + flash)
      let settleFrames = 0;
      function settleFrame() {
        settleFrames++;
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Particles
        for (let i = particles.length - 1; i >= 0; i--) {
          particles[i].update();
          particles[i].draw(ctx);
          if (particles[i].life <= 0) particles.splice(i, 1);
        }

        // Flash
        if (flashAlpha > 0.005) {
          ctx.fillStyle = `rgba(255, 220, 100, ${flashAlpha})`;
          ctx.fillRect(0, 0, w, h);
          flashAlpha *= 0.88;
        }

        // Final dice at center
        renderD20(canvas, rx, ry, rz, 1, resultNumber, { offsetX: w/2, offsetY: h/2 });

        // Steady glow ring around final dice
        const glowPulse = 0.1 + Math.sin(settleFrames * 0.1) * 0.04;
        const ringGrad = ctx.createRadialGradient(w/2, h/2, diceRadius * 0.5, w/2, h/2, diceRadius * 1.8);
        ringGrad.addColorStop(0, `rgba(255, 180, 60, ${glowPulse})`);
        ringGrad.addColorStop(0.6, `rgba(255, 140, 30, ${glowPulse * 0.4})`);
        ringGrad.addColorStop(1, "transparent");
        ctx.fillStyle = ringGrad;
        ctx.fillRect(0, 0, w, h);

        if (settleFrames < 30 || particles.length > 0) {
          animFrame = requestAnimationFrame(settleFrame);
        } else {
          // Done — final static render with glow
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = bgGrad;
          ctx.fillRect(0, 0, w, h);
          renderD20(canvas, rx, ry, rz, 1, resultNumber, { offsetX: w/2, offsetY: h/2 });

          // Persistent glow
          const finalGlow = ctx.createRadialGradient(w/2, h/2, diceRadius * 0.4, w/2, h/2, diceRadius * 1.5);
          finalGlow.addColorStop(0, "rgba(255, 180, 60, 0.1)");
          finalGlow.addColorStop(1, "transparent");
          ctx.fillStyle = finalGlow;
          ctx.fillRect(0, 0, w, h);

          if (onDone) onDone();
        }
      }
      animFrame = requestAnimationFrame(settleFrame);
    }
  }

  function spawnBounceParticles(x, y) {
    const count = 6 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
      const p = new Particle(x, y);
      p.vx = (Math.random() - 0.5) * 6;
      p.vy = (Math.random() - 0.5) * 6;
      p.size = 1.5 + Math.random() * 3;
      particles.push(p);
    }
  }

  animFrame = requestAnimationFrame(frame);
}

export function stopD20Roll() {
  cancelAnimationFrame(animFrame);
  particles = [];
}
