const ABILITY_NAMES = [
  "STR", "DEX", "CON", "INT", "WIS", "CHA"
];

const WEAPON_TYPES = [
  "Martial Melee",
  "Martial Ranged",
  "Simple Melee",
  "Simple Ranged",
];

export function parseCharacter(raw) {
  const d = raw.data;

  const stats = parseStats(d);
  const hp = parseHP(d, getConMod(stats));
  const weapons = parseWeapons(d);
  const classes = parseClasses(d);

  return {
    id: d.id,
    name: d.name,
    avatarUrl: d.decorations?.avatarUrl || null,
    race: d.race?.fullName || "Unknown",
    classes,
    level: classes.reduce((sum, c) => sum + c.level, 0),
    hp,
    stats,
    ac: parseAC(d, stats),
    proficiencyBonus: getProficiencyBonus(classes),
    speed: parseSpeed(d),
    weapons,
  };
}

function parseStats(d) {
  const base = {};
  for (const stat of d.stats) {
    base[stat.id] = stat.value || 10;
  }

  const bonuses = {};
  for (const mod of d.modifiers?.race || []) {
    if (mod.type === "bonus" && mod.entityId && mod.value) {
      bonuses[mod.entityId] = (bonuses[mod.entityId] || 0) + mod.value;
    }
  }

  const overrides = {};
  for (const ov of d.overrideStats || []) {
    if (ov.value !== null) {
      overrides[ov.id] = ov.value;
    }
  }

  const result = [];
  for (let i = 0; i < 6; i++) {
    const statId = i + 1;
    const total = overrides[statId] ?? (base[statId] + (bonuses[statId] || 0));
    const mod = Math.floor((total - 10) / 2);
    result.push({
      name: ABILITY_NAMES[i],
      value: total,
      modifier: mod,
    });
  }

  return result;
}

function getConMod(stats) {
  const con = stats.find((s) => s.name === "CON");
  return con ? con.modifier : 0;
}

function parseHP(d, conMod) {
  const base = d.baseHitPoints || 0;
  const bonus = d.bonusHitPoints || 0;
  const removed = d.removedHitPoints || 0;
  const temp = d.temporaryHitPoints || 0;

  const classHP = base;
  const conHP = conMod * getTotalLevel(d);
  const max = classHP + conHP + bonus;

  return {
    current: max - removed,
    max,
    temp,
  };
}

function getTotalLevel(d) {
  return (d.classes || []).reduce((sum, c) => sum + (c.level || 0), 0);
}

function parseClasses(d) {
  return (d.classes || []).map((c) => ({
    name: c.definition?.name || "Unknown",
    level: c.level || 1,
    subclass: c.subclassDefinition?.name || null,
  }));
}

function parseAC(d, stats) {
  const dexMod = stats.find((s) => s.name === "DEX")?.modifier || 0;
  const baseAC = 10 + dexMod;

  let armorAC = null;
  for (const item of d.inventory || []) {
    const def = item.definition;
    if (!item.equipped || !def) continue;
    if (def.armorClass) {
      armorAC = def.armorClass;
      if (def.type === "Heavy Armor") {
        return armorAC;
      }
      if (def.type === "Medium Armor") {
        return armorAC + Math.min(dexMod, 2);
      }
      if (def.type === "Light Armor") {
        return armorAC + dexMod;
      }
    }
  }

  return armorAC ?? baseAC;
}

function parseSpeed(d) {
  const walking = d.race?.weightSpeeds?.normal?.walk || 30;
  return walking;
}

function parseWeapons(d) {
  const weapons = [];

  for (const item of d.inventory || []) {
    const def = item.definition;
    if (!def) continue;

    const isWeapon = WEAPON_TYPES.includes(def.type);
    if (!isWeapon) continue;

    const damage = def.damage;
    weapons.push({
      name: def.name,
      equipped: item.equipped || false,
      type: def.type,
      damage: damage ? `${damage.diceString}` : "—",
      damageType: damage?.type?.name || "Unknown",
      range: def.range ? `${def.range}/${def.longRange || def.range}` : "5",
      properties: (def.properties || []).map((p) => p.name),
    });
  }

  return weapons;
}

function getProficiencyBonus(classes) {
  const level = classes.reduce((sum, c) => sum + c.level, 0);
  return Math.ceil(level / 4) + 1;
}
