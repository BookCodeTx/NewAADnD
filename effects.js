// ════════════════════════════════════════
// effects.js — Attack visual effects per damage type
// CSS-based particle bursts + screen shake
// ════════════════════════════════════════

const DAMAGE_COLORS = {
  slashing:    { primary: "#cccccc", secondary: "#888888", glow: "rgba(200,200,200,0.6)" },
  piercing:    { primary: "#aabbcc", secondary: "#667788", glow: "rgba(170,190,200,0.5)" },
  bludgeoning: { primary: "#997755", secondary: "#665533", glow: "rgba(150,120,80,0.5)" },
  fire:        { primary: "#ff6600", secondary: "#ffcc00", glow: "rgba(255,100,0,0.7)" },
  cold:        { primary: "#66ccff", secondary: "#ffffff", glow: "rgba(100,200,255,0.6)" },
  lightning:   { primary: "#ffff44", secondary: "#aaeeff", glow: "rgba(255,255,100,0.8)" },
  thunder:     { primary: "#8866cc", secondary: "#ccbbff", glow: "rgba(130,100,200,0.6)" },
  poison:      { primary: "#44cc44", secondary: "#88ff88", glow: "rgba(70,200,70,0.6)" },
  acid:        { primary: "#99ff00", secondary: "#ccff66", glow: "rgba(150,255,0,0.6)" },
  necrotic:    { primary: "#884488", secondary: "#220022", glow: "rgba(130,70,130,0.6)" },
  radiant:     { primary: "#ffd700", secondary: "#ffffcc", glow: "rgba(255,215,0,0.8)" },
  force:       { primary: "#aa44ff", secondary: "#dd99ff", glow: "rgba(170,70,255,0.6)" },
  psychic:     { primary: "#ff44aa", secondary: "#ffaadd", glow: "rgba(255,70,170,0.6)" },
};

function getColors(damageType) {
  const key = (damageType || "").toLowerCase();
  return DAMAGE_COLORS[key] || DAMAGE_COLORS.slashing;
}

// ── Inject effect styles once ──
let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.textContent = `
    .fx-container {
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 99999;
    }

    .fx-particle {
      position: absolute;
      border-radius: 50%;
      pointer-events: none;
    }

    .fx-slash {
      position: absolute;
      width: 80px; height: 4px;
      border-radius: 2px;
      transform-origin: center;
      pointer-events: none;
    }

    .fx-flash {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none;
      z-index: 99998;
      opacity: 0;
    }

    @keyframes fx-burst {
      0%   { transform: translate(0,0) scale(1); opacity: 1; }
      100% { opacity: 0; }
    }

    @keyframes fx-slash-swipe {
      0%   { transform: scaleX(0) rotate(var(--angle)); opacity: 0.9; }
      30%  { transform: scaleX(1) rotate(var(--angle)); opacity: 1; }
      100% { transform: scaleX(1.2) rotate(var(--angle)); opacity: 0; }
    }

    @keyframes fx-flash-in {
      0%   { opacity: 0; }
      15%  { opacity: var(--flash-opacity, 0.3); }
      100% { opacity: 0; }
    }

    @keyframes fx-ring {
      0%   { transform: translate(-50%,-50%) scale(0.2); opacity: 0.8; border-width: 4px; }
      100% { transform: translate(-50%,-50%) scale(1.5); opacity: 0; border-width: 1px; }
    }

    .fx-ring {
      position: absolute;
      width: 100px; height: 100px;
      border-radius: 50%;
      border: 4px solid currentColor;
      top: 50%; left: 50%;
      pointer-events: none;
    }

    /* Screen shake */
    @keyframes shake-light {
      0%, 100% { transform: translate(0,0); }
      10% { transform: translate(-2px, 1px); }
      30% { transform: translate(2px, -1px); }
      50% { transform: translate(-1px, 2px); }
      70% { transform: translate(1px, -2px); }
      90% { transform: translate(-1px, 1px); }
    }
    @keyframes shake-medium {
      0%, 100% { transform: translate(0,0); }
      10% { transform: translate(-4px, 2px); }
      30% { transform: translate(4px, -3px); }
      50% { transform: translate(-3px, 4px); }
      70% { transform: translate(3px, -2px); }
      90% { transform: translate(-2px, 3px); }
    }
    @keyframes shake-heavy {
      0%, 100% { transform: translate(0,0); }
      10% { transform: translate(-6px, 4px); }
      20% { transform: translate(5px, -6px); }
      30% { transform: translate(-7px, 2px); }
      40% { transform: translate(6px, -4px); }
      50% { transform: translate(-4px, 6px); }
      60% { transform: translate(7px, -3px); }
      70% { transform: translate(-5px, 5px); }
      80% { transform: translate(4px, -5px); }
      90% { transform: translate(-3px, 4px); }
    }
    @keyframes shake-crit {
      0%, 100% { transform: translate(0,0); }
      5%  { transform: translate(-8px, 6px) rotate(-1deg); }
      15% { transform: translate(7px, -8px) rotate(1deg); }
      25% { transform: translate(-9px, 4px) rotate(-0.5deg); }
      35% { transform: translate(8px, -6px) rotate(0.8deg); }
      45% { transform: translate(-6px, 8px) rotate(-0.8deg); }
      55% { transform: translate(9px, -4px) rotate(0.5deg); }
      65% { transform: translate(-7px, 7px) rotate(-1deg); }
      75% { transform: translate(6px, -7px) rotate(0.7deg); }
      85% { transform: translate(-5px, 5px) rotate(-0.5deg); }
      95% { transform: translate(4px, -4px); }
    }

    .shake-light  { animation: shake-light 0.3s ease-out; }
    .shake-medium { animation: shake-medium 0.35s ease-out; }
    .shake-heavy  { animation: shake-heavy 0.45s ease-out; }
    .shake-crit   { animation: shake-crit 0.6s ease-out; }
  `;
  document.head.appendChild(style);
}

// ── Particle burst ──
function spawnParticles(count, colors, { size = 6, spread = 80, duration = 600 } = {}) {
  injectStyles();
  const container = document.createElement("div");
  container.className = "fx-container";
  document.body.appendChild(container);

  for (let i = 0; i < count; i++) {
    const p = document.createElement("div");
    p.className = "fx-particle";
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const dist = spread * (0.5 + Math.random() * 0.5);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const s = size * (0.5 + Math.random());
    const color = Math.random() > 0.4 ? colors.primary : colors.secondary;

    Object.assign(p.style, {
      width: `${s}px`, height: `${s}px`,
      background: color,
      boxShadow: `0 0 ${s * 2}px ${colors.glow}`,
      left: "0px", top: "0px",
      animation: `fx-burst ${duration}ms cubic-bezier(0.2,0.8,0.3,1) forwards`,
    });

    // Drive position via custom property
    p.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: `translate(${dx}px,${dy}px) scale(0.3)`, opacity: 0 },
    ], { duration, easing: "cubic-bezier(0.2,0.8,0.3,1)", fill: "forwards" });

    container.appendChild(p);
  }

  setTimeout(() => container.remove(), duration + 50);
}

// ── Slash lines (for slashing/piercing) ──
function spawnSlashes(count, colors, duration = 400) {
  injectStyles();
  const container = document.createElement("div");
  container.className = "fx-container";
  document.body.appendChild(container);

  for (let i = 0; i < count; i++) {
    const s = document.createElement("div");
    s.className = "fx-slash";
    const angle = -30 + Math.random() * 60;
    const offsetY = (i - count / 2) * 12;

    Object.assign(s.style, {
      background: `linear-gradient(90deg, transparent, ${colors.primary}, ${colors.secondary}, transparent)`,
      boxShadow: `0 0 8px ${colors.glow}`,
      top: `${offsetY}px`,
      left: "-40px",
      "--angle": `${angle}deg`,
      animation: `fx-slash-swipe ${duration}ms ease-out forwards`,
      animationDelay: `${i * 60}ms`,
    });
    container.appendChild(s);
  }

  setTimeout(() => container.remove(), duration + count * 60 + 50);
}

// ── Expanding ring ──
function spawnRing(colors, { size = 100, duration = 500 } = {}) {
  injectStyles();
  const container = document.createElement("div");
  container.className = "fx-container";
  document.body.appendChild(container);

  const ring = document.createElement("div");
  ring.className = "fx-ring";
  ring.style.color = colors.primary;
  ring.style.width = `${size}px`;
  ring.style.height = `${size}px`;
  ring.style.boxShadow = `0 0 16px ${colors.glow}, inset 0 0 16px ${colors.glow}`;
  ring.style.animation = `fx-ring ${duration}ms ease-out forwards`;
  container.appendChild(ring);

  setTimeout(() => container.remove(), duration + 50);
}

// ── Full-screen flash ──
function flash(color, opacity = 0.3, duration = 350) {
  injectStyles();
  const el = document.createElement("div");
  el.className = "fx-flash";
  el.style.background = color;
  el.style.setProperty("--flash-opacity", opacity);
  el.style.animation = `fx-flash-in ${duration}ms ease-out forwards`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), duration + 50);
}

// ── Screen Shake ──
export function screenShake(intensity = "medium") {
  injectStyles();
  const el = document.body;
  // Remove any existing shake
  el.classList.remove("shake-light", "shake-medium", "shake-heavy", "shake-crit");
  void el.offsetWidth; // trigger reflow
  el.classList.add(`shake-${intensity}`);
  const durations = { light: 300, medium: 350, heavy: 450, crit: 600 };
  setTimeout(() => el.classList.remove(`shake-${intensity}`), durations[intensity] || 400);
}

// ════════════════════════════════════════
// PUBLIC API — damage-type-specific effects
// ════════════════════════════════════════

export function playHitEffect(damageType) {
  const colors = getColors(damageType);
  const key = (damageType || "").toLowerCase();

  switch (key) {
    case "slashing":
      spawnSlashes(3, colors);
      spawnParticles(8, colors, { size: 4, spread: 50 });
      screenShake("medium");
      break;

    case "piercing":
      spawnSlashes(1, { ...colors, primary: "#ddeeff" }, 300);
      spawnParticles(6, colors, { size: 3, spread: 40 });
      screenShake("light");
      break;

    case "bludgeoning":
      spawnParticles(12, colors, { size: 8, spread: 70 });
      spawnRing(colors, { size: 80, duration: 400 });
      screenShake("heavy");
      break;

    case "fire":
      spawnParticles(18, colors, { size: 7, spread: 90, duration: 800 });
      flash("#ff4400", 0.2);
      screenShake("medium");
      break;

    case "cold":
      spawnParticles(14, colors, { size: 5, spread: 70, duration: 900 });
      flash("#aaddff", 0.15);
      spawnRing(colors, { size: 120, duration: 700 });
      screenShake("light");
      break;

    case "lightning":
      spawnParticles(10, colors, { size: 4, spread: 100, duration: 400 });
      flash("#ffffaa", 0.35, 200);
      setTimeout(() => flash("#ffffcc", 0.15, 150), 100);
      screenShake("heavy");
      break;

    case "thunder":
      spawnRing(colors, { size: 150, duration: 600 });
      spawnParticles(16, colors, { size: 6, spread: 100 });
      flash("#8866cc", 0.2);
      screenShake("heavy");
      break;

    case "poison":
      spawnParticles(12, colors, { size: 6, spread: 60, duration: 1000 });
      flash("#22aa22", 0.12);
      screenShake("light");
      break;

    case "acid":
      spawnParticles(14, colors, { size: 5, spread: 65, duration: 900 });
      flash("#88ff00", 0.15);
      screenShake("light");
      break;

    case "necrotic":
      spawnParticles(10, colors, { size: 8, spread: 50, duration: 1000 });
      flash("#330033", 0.25);
      spawnRing({ primary: "#662266", secondary: "#330033", glow: "rgba(100,30,100,0.5)" }, { size: 100, duration: 800 });
      screenShake("medium");
      break;

    case "radiant":
      spawnParticles(20, colors, { size: 5, spread: 100, duration: 700 });
      flash("#ffd700", 0.25);
      spawnRing(colors, { size: 130, duration: 600 });
      screenShake("medium");
      break;

    case "force":
      spawnParticles(12, colors, { size: 5, spread: 80 });
      spawnRing(colors, { size: 100, duration: 500 });
      flash("#7722cc", 0.2);
      screenShake("medium");
      break;

    case "psychic":
      spawnParticles(8, colors, { size: 6, spread: 50, duration: 800 });
      flash("#ff44aa", 0.2, 500);
      screenShake("light");
      break;

    default:
      spawnParticles(10, colors, { size: 5, spread: 60 });
      screenShake("medium");
      break;
  }
}

export function playCritEffect(damageType) {
  const colors = getColors(damageType);

  // Big dramatic burst
  spawnParticles(25, colors, { size: 10, spread: 120, duration: 900 });
  spawnParticles(15, { primary: "#ffd700", secondary: "#ffee88", glow: "rgba(255,215,0,0.7)" }, { size: 6, spread: 90, duration: 700 });

  // Double ring
  spawnRing(colors, { size: 140, duration: 600 });
  setTimeout(() => spawnRing({ primary: "#ffd700", secondary: "#fff", glow: "rgba(255,215,0,0.5)" }, { size: 100, duration: 500 }), 100);

  // Bright flash
  flash("#ffd700", 0.35, 400);

  // Big shake
  screenShake("crit");
}

export function playMissEffect() {
  // Subtle — just a faint whoosh particle
  const colors = { primary: "#666666", secondary: "#444444", glow: "rgba(100,100,100,0.3)" };
  spawnParticles(4, colors, { size: 3, spread: 30, duration: 400 });
}

export function playHealEffect() {
  const colors = { primary: "#44ff88", secondary: "#aaffcc", glow: "rgba(70,255,130,0.6)" };
  spawnParticles(14, colors, { size: 5, spread: 70, duration: 800 });
  spawnRing(colors, { size: 100, duration: 600 });
  flash("#44ff88", 0.12, 400);
}

export function playSpellEffect(damageType) {
  // Spell effects are similar to hit but with rings
  const colors = getColors(damageType || "force");
  spawnParticles(16, colors, { size: 5, spread: 80, duration: 700 });
  spawnRing(colors, { size: 110, duration: 600 });
  flash(colors.primary, 0.15, 350);
  screenShake("light");
}

// ── Dice color mapping (for 3D dice theming) ──
export const DICE_THEME_COLORS = {
  slashing:    "#cccccc",
  piercing:    "#aabbcc",
  bludgeoning: "#997755",
  fire:        "#ff6600",
  cold:        "#66ccff",
  lightning:   "#ffff44",
  thunder:     "#8866cc",
  poison:      "#44cc44",
  acid:        "#99ff00",
  necrotic:    "#884488",
  radiant:     "#ffd700",
  force:       "#aa44ff",
  psychic:     "#ff44aa",
};

export function getDiceColor(damageType) {
  return DICE_THEME_COLORS[(damageType || "").toLowerCase()] || "#e94560";
}
