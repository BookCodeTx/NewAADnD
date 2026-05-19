import OBR from "@owlbear-rodeo/sdk";

// Grid DPI: read dynamically from OBR scene, fallback to 150dpi/5ft = 30
export let DPI_PER_FOOT = 30;

export async function updateGridDpi() {
  try {
    const dpi = await OBR.scene.grid.getDpi();
    const scale = await OBR.scene.grid.getScale();
    const ftPerCell = scale?.parsed?.multiplier || 5;
    DPI_PER_FOOT = dpi / ftPerCell;
  } catch {
    DPI_PER_FOOT = 30; // fallback
  }
}

export const SPELLS = {
  fireball: {
    name: "Fireball",
    level: 3,
    damage: "8d6",
    damageType: "Fire",
    save: "DEX",
    aoeRadius: 20,
    isAoE: true,
    color: "#ff4400",
    description: "20ft radius sphere of flame",
  },
  burning_hands: {
    name: "Burning Hands",
    level: 1,
    damage: "3d6",
    damageType: "Fire",
    save: "DEX",
    aoeRadius: 15,
    isAoE: true,
    color: "#ff6600",
    description: "15ft cone of fire",
  },
  thunderwave: {
    name: "Thunderwave",
    level: 1,
    damage: "2d8",
    damageType: "Thunder",
    save: "CON",
    aoeRadius: 15,
    isAoE: true,
    color: "#4488ff",
    description: "15ft cube of thunder",
  },
  ice_storm: {
    name: "Ice Storm",
    level: 4,
    damage: "2d8+4d6",
    damageType: "Cold",
    save: "DEX",
    aoeRadius: 20,
    isAoE: true,
    color: "#88ccff",
    description: "20ft radius hail and ice",
  },
  shatter: {
    name: "Shatter",
    level: 2,
    damage: "3d8",
    damageType: "Thunder",
    save: "CON",
    aoeRadius: 10,
    isAoE: true,
    color: "#aa44ff",
    description: "10ft radius sonic burst",
  },
  sacred_flame: {
    name: "Sacred Flame",
    level: 0,
    damage: "1d8",
    damageType: "Radiant",
    save: "DEX",
    aoeRadius: 0,
    isAoE: false,
    color: "#ffdd44",
    description: "Single target, DEX save",
  },
  toll_the_dead: {
    name: "Toll the Dead",
    level: 0,
    damage: "1d12",
    damageType: "Necrotic",
    save: "WIS",
    aoeRadius: 0,
    isAoE: false,
    color: "#664488",
    description: "Single target, WIS save",
  },
  poison_spray: {
    name: "Poison Spray",
    level: 0,
    damage: "1d12",
    damageType: "Poison",
    save: "CON",
    aoeRadius: 0,
    isAoE: false,
    color: "#44aa44",
    description: "Single target, CON save",
  },
};

export function getSpellcastingDC(caster) {
  if (!caster) return 13;
  const intMod = caster.stats.find((s) => s.name === "INT")?.modifier || 0;
  const wisMod = caster.stats.find((s) => s.name === "WIS")?.modifier || 0;
  const chaMod = caster.stats.find((s) => s.name === "CHA")?.modifier || 0;
  const castMod = Math.max(intMod, wisMod, chaMod);
  return 8 + caster.proficiencyBonus + castMod;
}

export function getSaveMod(char, ability) {
  const stat = char?.stats?.find((s) => s.name === ability);
  return stat?.modifier ?? 0;
}

export function tokensInRadius(centerPos, radiusFt, tokens) {
  // Add half-cell tolerance (tokens snap to grid center, so ±half cell is acceptable)
  const tolerance = DPI_PER_FOOT * 2.5; // half of a 5ft cell
  const radiusDPI = radiusFt * DPI_PER_FOOT + tolerance;
  return tokens.filter((t) => {
    const dx = t.position.x - centerPos.x;
    const dy = t.position.y - centerPos.y;
    return Math.sqrt(dx * dx + dy * dy) <= radiusDPI;
  });
}

export function rollSave(saveMod) {
  const roll = Math.floor(Math.random() * 20) + 1;
  return { roll, total: roll + saveMod, nat: roll };
}

export function parseDamageNotation(notation) {
  let total = 0;
  const parts = notation.replace(/\s/g, "").split("+");
  for (const part of parts) {
    const diceMatch = part.match(/^(\d+)d(\d+)$/);
    if (diceMatch) {
      const count = parseInt(diceMatch[1]);
      const sides = parseInt(diceMatch[2]);
      for (let i = 0; i < count; i++) {
        total += Math.floor(Math.random() * sides) + 1;
      }
    } else {
      total += parseInt(part) || 0;
    }
  }
  return total;
}
