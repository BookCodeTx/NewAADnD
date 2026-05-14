// ════════════════════════════════════════
// d20renderer.js — Canvas 2D rendered 3D icosahedron
// Real d20 with 20 triangular faces, lighting, and smooth rotation
// ════════════════════════════════════════

const PHI = (1 + Math.sqrt(5)) / 2;

// Icosahedron vertices (unit sphere)
const RAW_VERTS = [
  [-1,  PHI, 0], [ 1,  PHI, 0], [-1, -PHI, 0], [ 1, -PHI, 0],
  [0, -1,  PHI], [0,  1,  PHI], [0, -1, -PHI], [0,  1, -PHI],
  [ PHI, 0, -1], [ PHI, 0,  1], [-PHI, 0, -1], [-PHI, 0,  1],
];

// Normalize to unit sphere
const VERTS = RAW_VERTS.map(([x, y, z]) => {
  const len = Math.sqrt(x*x + y*y + z*z);
  return [x/len, y/len, z/len];
});

// 20 triangular faces (vertex indices)
const FACES = [
  [0,11,5], [0,5,1], [0,1,7], [0,7,10], [0,10,11],
  [1,5,9], [5,11,4], [11,10,2], [10,7,6], [7,1,8],
  [3,9,4], [3,4,2], [3,2,6], [3,6,8], [3,8,9],
  [4,9,5], [2,4,11], [6,2,10], [8,6,7], [9,8,1],
];

// D20 number arrangement (face index → number)
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

// ── Renderer ──
const LIGHT_DIR = normalize([0.3, 0.6, 1]); // Light coming from front-top-right
const BASE_COLOR = { r: 45, g: 45, b: 65 };     // Dark metallic
const EDGE_COLOR = "rgba(180, 190, 210, 0.4)";
const SPECULAR_COLOR = { r: 200, g: 210, b: 230 };

// resultNumber: if set, the most front-facing face will display this number
export function renderD20(canvas, rx, ry, rz, scale = 1, resultNumber = null) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const sz = (w * 0.35) * scale;

  ctx.clearRect(0, 0, w, h);

  // Transform all vertices
  const transformed = VERTS.map(v => {
    let p = rotateX(v, rx);
    p = rotateY(p, ry);
    p = rotateZ(p, rz);
    return p;
  });

  // Project to 2D and build face data
  const faceData = FACES.map((face, fi) => {
    const pts3d = face.map(vi => transformed[vi]);
    const pts2d = pts3d.map(p => [cx + p[0] * sz, cy - p[1] * sz]);

    // Face normal
    const normal = normalize(cross(sub(pts3d[1], pts3d[0]), sub(pts3d[2], pts3d[0])));

    // Average Z for sorting (painter's algorithm)
    const cen = centroid(pts3d);
    const avgZ = cen[2];

    // Lighting
    const diffuse = Math.max(0, dot(normal, LIGHT_DIR));
    const ambient = 0.25;
    const brightness = ambient + diffuse * 0.75;

    // Specular highlight
    const reflect = [
      2 * normal[0] * dot(normal, LIGHT_DIR) - LIGHT_DIR[0],
      2 * normal[1] * dot(normal, LIGHT_DIR) - LIGHT_DIR[1],
      2 * normal[2] * dot(normal, LIGHT_DIR) - LIGHT_DIR[2],
    ];
    const viewDir = [0, 0, 1];
    const spec = Math.pow(Math.max(0, dot(normalize(reflect), viewDir)), 32) * 0.6;

    return { pts2d, pts3d, normal, avgZ, brightness, spec, number: FACE_NUMBERS[fi], cen, faceIdx: fi };
  });

  // If resultNumber is set, swap it onto the most front-facing face
  if (resultNumber !== null) {
    // Find the face with highest z-normal (most front-facing)
    let bestIdx = 0;
    let bestZ = -Infinity;
    for (let i = 0; i < faceData.length; i++) {
      if (faceData[i].normal[2] > bestZ) {
        bestZ = faceData[i].normal[2];
        bestIdx = i;
      }
    }
    // Find the face that currently has the result number
    const resultIdx = faceData.findIndex(f => f.number === resultNumber);
    if (resultIdx >= 0 && resultIdx !== bestIdx) {
      // Swap numbers
      const tmp = faceData[bestIdx].number;
      faceData[bestIdx].number = faceData[resultIdx].number;
      faceData[resultIdx].number = tmp;
    }
  }

  // Sort by Z (back to front)
  faceData.sort((a, b) => a.avgZ - b.avgZ);

  // Draw faces
  for (const f of faceData) {
    // Back-face culling (skip faces pointing away)
    if (f.normal[2] < -0.1) continue;

    const { pts2d, brightness, spec, number } = f;

    // Fill color with lighting
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

    // Edges
    ctx.strokeStyle = EDGE_COLOR;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Number on face (only if face is reasonably front-facing)
    if (f.normal[2] > 0.15) {
      const cenX = (pts2d[0][0] + pts2d[1][0] + pts2d[2][0]) / 3;
      const cenY = (pts2d[0][1] + pts2d[1][1] + pts2d[2][1]) / 3;

      // Size based on how front-facing the triangle is
      const fontSize = Math.round(13 * scale * (0.6 + f.normal[2] * 0.4));
      const alpha = Math.min(1, f.normal[2] * 1.5);

      ctx.font = `bold ${fontSize}px 'Segoe UI', system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fillText(String(number), cenX, cenY);
    }
  }

  // Subtle outer glow
  const gradient = ctx.createRadialGradient(cx, cy, sz * 0.7, cx, cy, sz * 1.3);
  gradient.addColorStop(0, "transparent");
  gradient.addColorStop(1, "rgba(100, 120, 180, 0.08)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

// ── Animated roll ──
let animFrame = null;

export function startD20Roll(canvas, duration = 2200, resultNumber = null, onDone = null) {
  cancelAnimationFrame(animFrame);

  const startTime = performance.now();
  // Random spin axes
  const axisSpeed = {
    x: 4 + Math.random() * 3,
    y: 3 + Math.random() * 4,
    z: 2 + Math.random() * 2,
  };

  function frame(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);

    // Ease-out: fast spin → slow stop
    const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out

    // Rotation angles (spin fast then slow)
    const progress = ease * 8; // total rotations worth
    const rx = progress * axisSpeed.x;
    const ry = progress * axisSpeed.y;
    const rz = progress * axisSpeed.z;

    // Slight scale bounce
    const bounce = t < 0.3 ? 0.85 + 0.15 * (t / 0.3) : 1 + Math.sin(t * Math.PI * 3) * 0.03 * (1 - t);

    // Only show result number on the last ~20% of the animation (settling phase)
    const showResult = t > 0.8 ? resultNumber : null;
    renderD20(canvas, rx, ry, rz, bounce, showResult);

    if (t < 1) {
      animFrame = requestAnimationFrame(frame);
    } else {
      // Final frame with result locked in
      renderD20(canvas, rx, ry, rz, 1, resultNumber);
      if (onDone) onDone();
    }
  }

  animFrame = requestAnimationFrame(frame);
}

export function stopD20Roll() {
  cancelAnimationFrame(animFrame);
}
