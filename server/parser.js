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
  // Support both v5 (raw.data) and SCDS v1 (raw.data or raw directly)
  const d = raw.data || raw;

  const stats = parseStats(d);
  const hp = parseHP(d, getConMod(stats));
  const weapons = parseWeapons(d);
  const classes = parseClasses(d);
  const profBonus = getProficiencyBonus(classes);
  const skills = parseSkills(d, stats, profBonus);
  const bonusActions = parseBonusActions(d, classes, weapons);

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
    proficiencyBonus: profBonus,
    speed: parseSpeed(d),
    weapons,
    skills,
    bonusActions,
  };
}

const SKILL_MAP = {
  acrobatics: { name: "Acrobatics", ability: "DEX" },
  "animal-handling": { name: "Animal Handling", ability: "WIS" },
  arcana: { name: "Arcana", ability: "INT" },
  athletics: { name: "Athletics", ability: "STR" },
  deception: { name: "Deception", ability: "CHA" },
  history: { name: "History", ability: "INT" },
  insight: { name: "Insight", ability: "WIS" },
  intimidation: { name: "Intimidation", ability: "CHA" },
  investigation: { name: "Investigation", ability: "INT" },
  medicine: { name: "Medicine", ability: "WIS" },
  nature: { name: "Nature", ability: "INT" },
  perception: { name: "Perception", ability: "WIS" },
  performance: { name: "Performance", ability: "CHA" },
  persuasion: { name: "Persuasion", ability: "CHA" },
  religion: { name: "Religion", ability: "INT" },
  "sleight-of-hand": { name: "Sleight of Hand", ability: "DEX" },
  stealth: { name: "Stealth", ability: "DEX" },
  survival: { name: "Survival", ability: "WIS" },
};

function parseSkills(d, stats, profBonus) {
  const proficient = new Set();
  const expertise = new Set();

  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
    ...(d.modifiers?.condition || []),
  ];

  for (const mod of allMods) {
    if (!mod.subType || !(mod.subType in SKILL_MAP)) continue;
    if (mod.type === "proficiency") proficient.add(mod.subType);
    else if (mod.type === "expertise") expertise.add(mod.subType);
  }

  return Object.entries(SKILL_MAP).map(([key, info]) => {
    const abilityMod = stats.find((s) => s.name === info.ability)?.modifier || 0;
    const isProf = proficient.has(key);
    const isExp = expertise.has(key);
    let modifier = abilityMod;
    if (isExp) modifier += profBonus * 2;
    else if (isProf) modifier += profBonus;
    return {
      key,
      name: info.name,
      ability: info.ability,
      modifier,
      proficient: isProf,
      expertise: isExp,
    };
  });
}

function parseBonusActions(d, classes, weapons) {
  const actions = [];
  const classNames = classes.map((c) => c.name.toLowerCase());

  // Off-hand attack if dual wielding (light weapon equipped that's not the primary)
  const equippedWeapons = weapons.filter((w) => w.equipped);
  if (equippedWeapons.length > 1) {
    const offhand = equippedWeapons.find((w) => w.properties?.includes("Light")) || equippedWeapons[1];
    if (offhand) {
      actions.push({
        key: "offhand-attack",
        name: `Off-Hand: ${offhand.name}`,
        description: `Bonus attack with ${offhand.name} (no ability mod to damage)`,
        type: "attack",
        weapon: offhand,
      });
    }
  }

  // Class-specific bonus actions
  if (classNames.includes("rogue")) {
    actions.push(
      { key: "cunning-dash", name: "Cunning Action: Dash", description: "Double movement this turn", type: "movement" },
      { key: "cunning-disengage", name: "Cunning Action: Disengage", description: "Movement doesn't provoke attacks of opportunity", type: "movement" },
      { key: "cunning-hide", name: "Cunning Action: Hide", description: "Roll Stealth to hide", type: "skill", skill: "stealth" },
    );
  }
  if (classNames.includes("monk")) {
    actions.push(
      { key: "flurry-of-blows", name: "Flurry of Blows", description: "Two unarmed strikes (1 ki)", type: "attack" },
      { key: "patient-defense", name: "Patient Defense", description: "Dodge action (1 ki)", type: "defense" },
      { key: "step-of-the-wind", name: "Step of the Wind", description: "Disengage or Dash + jump x2 (1 ki)", type: "movement" },
    );
  }
  if (classNames.includes("ranger")) {
    actions.push(
      { key: "hunters-mark", name: "Hunter's Mark", description: "Mark target: +1d6 damage from your attacks (concentration)", type: "spell" },
      { key: "two-weapon-fighting", name: "Two-Weapon Fighting", description: "Off-hand attack with light weapon", type: "attack" },
    );
  }
  if (classNames.includes("paladin")) {
    actions.push({ key: "divine-favor", name: "Divine Favor", description: "Weapon attacks deal +1d4 radiant (concentration)", type: "spell" });
  }
  if (classNames.includes("bard")) {
    actions.push({ key: "bardic-inspiration", name: "Bardic Inspiration", description: "Grant ally a Bardic Inspiration die", type: "support" });
  }
  if (classNames.includes("cleric")) {
    actions.push({ key: "healing-word", name: "Healing Word", description: "Heal ally 1d4+spell mod (60ft)", type: "spell" });
  }
  if (classNames.includes("sorcerer")) {
    actions.push({ key: "quickened-spell", name: "Quickened Spell", description: "Cast 1-action spell as bonus action (2 sorcery points)", type: "spell" });
  }
  if (classNames.includes("warlock")) {
    actions.push({ key: "hex", name: "Hex", description: "Curse target: +1d6 necrotic from your attacks (concentration)", type: "spell" });
  }

  // Universal bonus actions
  actions.push(
    { key: "potion", name: "Drink Potion", description: "Quaff a potion (bonus action with feat)", type: "item" },
    { key: "second-wind", name: "Second Wind (Fighter)", description: "Heal 1d10+level (1/short rest)", type: "heal", healDice: "1d10" },
  );

  return actions;
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
