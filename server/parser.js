const ABILITY_NAMES = [
  "STR", "DEX", "CON", "INT", "WIS", "CHA"
];

// categoryId: 1=Simple, 2=Martial; attackType: 1=Melee, 2=Ranged
const CATEGORY_NAMES = { 1: "Simple", 2: "Martial" };
const ATTACK_TYPE_NAMES = { 1: "Melee", 2: "Ranged" };

export function parseCharacter(raw) {
  // Support both v5 (raw.data) and SCDS v1 (raw.data or raw directly)
  const d = raw.data || raw;

  const stats = parseStats(d);
  const hp = parseHP(d, getConMod(stats));
  const classes = parseClasses(d);
  const profBonus = getProficiencyBonus(classes);
  const weapons = parseWeapons(d, stats, profBonus);
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
    savingThrows: parseSavingThrows(d, stats, profBonus),
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

function parseSavingThrows(d, stats, profBonus) {
  // Gather saving throw proficiencies from modifiers
  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
    ...(d.modifiers?.condition || []),
  ];

  const proficient = new Set();
  const bonuses = {};

  for (const mod of allMods) {
    // Proficiency: subType like "strength-saving-throws"
    if (mod.type === "proficiency" && mod.subType?.endsWith("-saving-throws")) {
      const ability = mod.subType.replace("-saving-throws", "").toUpperCase().slice(0, 3);
      // Map full name to abbreviation
      const nameMap = { STR: "STR", DEX: "DEX", CON: "CON", INT: "INT", WIS: "WIS", CHA: "CHA",
                        STRENGTH: "STR", DEXTERITY: "DEX", CONSTITUTION: "CON",
                        INTELLIGENCE: "INT", WISDOM: "WIS", CHARISMA: "CHA" };
      const key = nameMap[ability] || ability;
      if (ABILITY_NAMES.includes(key)) proficient.add(key);
    }
    // Bonus to saving throws (e.g. Ring of Protection, Paladin Aura)
    if (mod.type === "bonus" && mod.value) {
      if (mod.subType === "saving-throws") {
        // Global bonus to all saves
        for (const ab of ABILITY_NAMES) {
          bonuses[ab] = (bonuses[ab] || 0) + mod.value;
        }
      }
    }
  }

  return ABILITY_NAMES.map((name) => {
    const stat = stats.find((s) => s.name === name);
    const abilityMod = stat?.modifier || 0;
    const isProf = proficient.has(name);
    const bonus = bonuses[name] || 0;
    const modifier = abilityMod + (isProf ? profBonus : 0) + bonus;
    return { name, modifier, proficient: isProf };
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

// Map subType strings like "dexterity-score" → stat ID 2
const SUBTYPE_TO_STAT_ID = {
  "strength-score": 1,
  "dexterity-score": 2,
  "constitution-score": 3,
  "intelligence-score": 4,
  "wisdom-score": 5,
  "charisma-score": 6,
};

function parseStats(d) {
  const base = {};
  for (const stat of d.stats) {
    base[stat.id] = stat.value || 10;
  }

  // Gather bonuses from ALL modifier sources (race, class, feat, item, background, condition)
  const bonuses = {};
  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
    ...(d.modifiers?.condition || []),
  ];

  for (const mod of allMods) {
    if (mod.type !== "bonus" || !mod.value) continue;
    // Try entityId first (maps directly to stat ID 1-6)
    let statId = mod.entityId;
    // If no entityId, try parsing subType (e.g. "dexterity-score" → 2)
    if (!statId && mod.subType) {
      statId = SUBTYPE_TO_STAT_ID[mod.subType];
    }
    if (statId >= 1 && statId <= 6) {
      bonuses[statId] = (bonuses[statId] || 0) + mod.value;
    }
  }

  // Also add bonusStats (manual bonuses set on character sheet)
  for (const bs of d.bonusStats || []) {
    if (bs.value) {
      bonuses[bs.id] = (bonuses[bs.id] || 0) + bs.value;
    }
  }

  const overrides = {};
  for (const ov of d.overrideStats || []) {
    if (ov.value !== null && ov.value !== undefined) {
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

// armorTypeId: 1=Light, 2=Medium, 3=Heavy, 4=Shield
function parseAC(d, stats) {
  const dexMod = stats.find((s) => s.name === "DEX")?.modifier || 0;
  const baseAC = 10 + dexMod;

  let armorAC = null;
  let shieldBonus = 0;

  for (const item of d.inventory || []) {
    const def = item.definition;
    if (!item.equipped || !def || !def.armorClass) continue;

    const armorType = def.armorTypeId || 0;
    const typeStr = (def.type || "").toLowerCase();

    if (armorType === 4 || typeStr.includes("shield")) {
      shieldBonus += def.armorClass;
      continue;
    }

    if (armorType === 3 || typeStr.includes("heavy")) {
      armorAC = def.armorClass;
    } else if (armorType === 2 || typeStr.includes("medium")) {
      armorAC = def.armorClass + Math.min(dexMod, 2);
    } else {
      // Light armor (armorTypeId=1) or unknown → add full DEX
      armorAC = def.armorClass + dexMod;
    }
  }

  // Gather ALL AC bonuses from modifier sources:
  // d.modifiers.item  → magic armor/shield bonuses (+1 chain mail, Ring of Protection, etc.)
  // d.modifiers.class → Fighting Style: Defense (+1 AC while wearing armor)
  // d.modifiers.feat  → feat-based AC bonuses
  // d.modifiers.race  → racial AC bonuses
  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
    ...(d.modifiers?.condition || []),
  ];

  let modifierBonus = 0;
  for (const mod of allMods) {
    if (mod.type === "bonus" && mod.subType === "armor-class" && mod.value) {
      modifierBonus += mod.value;
    }
  }

  return (armorAC ?? baseAC) + shieldBonus + modifierBonus;
}

function parseSpeed(d) {
  const walking = d.race?.weightSpeeds?.normal?.walk || 30;
  return walking;
}

const MASTERY_PROPERTIES = ["Nick", "Vex", "Slow", "Graze", "Cleave", "Topple", "Push", "Sap"];

function parseWeapons(d, stats, profBonus) {
  const weapons = [];
  const strMod = stats.find((s) => s.name === "STR")?.modifier || 0;
  const dexMod = stats.find((s) => s.name === "DEX")?.modifier || 0;

  // Gather global attack/damage bonuses from modifiers
  const allMods = [
    ...(d.modifiers?.race || []),
    ...(d.modifiers?.class || []),
    ...(d.modifiers?.background || []),
    ...(d.modifiers?.item || []),
    ...(d.modifiers?.feat || []),
    ...(d.modifiers?.condition || []),
  ];
  let globalAtkBonus = 0;
  let globalDmgBonus = 0;
  for (const mod of allMods) {
    if (mod.type === "bonus" && mod.value) {
      if (mod.subType === "weapon-attacks") globalAtkBonus += mod.value;
      if (mod.subType === "weapon-damage") globalDmgBonus += mod.value;
    }
  }

  for (const item of d.inventory || []) {
    const def = item.definition;
    if (!def) continue;

    const isWeapon = def.filterType === "Weapon" || def.type === "Weapon" || def.damage;
    if (!isWeapon) continue;

    const damage = def.damage;
    const props = (def.properties || []).map((p) => p.name);
    const isFinesse = props.includes("Finesse");
    const isRanged = (def.attackType === 2) || def.type?.includes("Ranged");
    const abilityMod = isRanged ? dexMod : isFinesse ? Math.max(strMod, dexMod) : strMod;
    const attackBonus = abilityMod + profBonus + globalAtkBonus;
    const damageMod = abilityMod + globalDmgBonus;

    // Separate regular properties and weapon mastery
    const regularProps = props.filter((p) => !MASTERY_PROPERTIES.includes(p));
    const mastery = props.filter((p) => MASTERY_PROPERTIES.includes(p));

    // Damage type from def.damageType (string) or def.damage.damageType or def.damage.type.name
    const damageType = def.damageType
      || damage?.damageType
      || damage?.type?.name
      || "Unknown";

    const catName = CATEGORY_NAMES[def.categoryId] || "";
    const atkName = ATTACK_TYPE_NAMES[def.attackType] || "Melee";
    const weaponType = catName ? `${catName} ${atkName}` : `${def.type} ${atkName}`;

    weapons.push({
      name: def.name,
      equipped: item.equipped || false,
      type: weaponType,
      attackType: isRanged ? "ranged" : "melee",
      damage: damage ? damage.diceString : "1",
      damageType,
      damageMod,
      abilityMod,
      attackBonus,
      range: def.range || 5,
      longRange: def.longRange || def.range || 5,
      properties: regularProps,
      mastery,
    });
  }

  // Always add Unarmed Strike
  weapons.push({
    name: "Unarmed Strike",
    equipped: true,
    type: "Simple Melee",
    attackType: "melee",
    damage: "1",
    damageType: "Bludgeoning",
    damageMod: strMod,
    abilityMod: strMod,
    attackBonus: strMod + profBonus,
    range: 5,
    longRange: 5,
    properties: [],
    mastery: [],
  });

  return weapons;
}

function getProficiencyBonus(classes) {
  const level = classes.reduce((sum, c) => sum + c.level, 0);
  return Math.ceil(level / 4) + 1;
}
