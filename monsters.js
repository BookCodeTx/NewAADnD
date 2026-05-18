// ══════════════════════════════════════
// D&D 5e Monster Templates
// ══════════════════════════════════════

export const MONSTER_TEMPLATES = {
  // ── CR 0 ──
  commoner: {
    name: "Commoner", ac: 10, hp: 4, speed: 30, cr: 0, type: "Humanoid",
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    actions: [{ name: "Club", damage: "1d4", damageType: "Bludgeoning", attackBonus: 2 }],
  },

  // ── CR 1/8 ──
  bandit: {
    name: "Bandit", ac: 12, hp: 11, speed: 30, cr: 0.125, type: "Humanoid",
    stats: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    actions: [
      { name: "Scimitar", damage: "1d6+1", damageType: "Slashing", attackBonus: 3 },
      { name: "Light Crossbow", damage: "1d8+1", damageType: "Piercing", attackBonus: 3, type: "Simple Ranged", range: 80 },
    ],
  },

  // ── CR 1/4 ──
  goblin: {
    name: "Goblin", ac: 15, hp: 7, speed: 30, cr: 0.25, type: "Humanoid",
    stats: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    saves: ["DEX"], skills: ["stealth"],
    actions: [
      { name: "Scimitar", damage: "1d6+2", damageType: "Slashing", attackBonus: 4 },
      { name: "Shortbow", damage: "1d6+2", damageType: "Piercing", attackBonus: 4, type: "Simple Ranged", range: 80 },
    ],
    features: [{ name: "Nimble Escape", description: "Disengage or Hide as bonus action" }],
  },
  skeleton: {
    name: "Skeleton", ac: 13, hp: 13, speed: 30, cr: 0.25, type: "Undead",
    stats: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },
    actions: [
      { name: "Shortsword", damage: "1d6+2", damageType: "Piercing", attackBonus: 4 },
      { name: "Shortbow", damage: "1d6+2", damageType: "Piercing", attackBonus: 4, type: "Simple Ranged", range: 80 },
    ],
    features: [{ name: "Vulnerability", description: "Vulnerable to Bludgeoning damage" }],
  },
  zombie: {
    name: "Zombie", ac: 8, hp: 22, speed: 20, cr: 0.25, type: "Undead",
    stats: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 },
    saves: ["WIS"],
    actions: [{ name: "Slam", damage: "1d6+1", damageType: "Bludgeoning", attackBonus: 3 }],
    features: [{ name: "Undead Fortitude", description: "If reduced to 0 HP, CON save (DC 5 + damage taken) to drop to 1 HP instead. Doesn't work vs radiant/crit." }],
  },
  kobold: {
    name: "Kobold", ac: 12, hp: 5, speed: 30, cr: 0.125, type: "Humanoid",
    stats: { str: 7, dex: 15, con: 9, int: 8, wis: 7, cha: 8 },
    actions: [
      { name: "Dagger", damage: "1d4+2", damageType: "Piercing", attackBonus: 4 },
      { name: "Sling", damage: "1d4+2", damageType: "Bludgeoning", attackBonus: 4, type: "Simple Ranged", range: 30 },
    ],
    features: [{ name: "Pack Tactics", description: "Advantage on attack if an ally is within 5ft of the target" }],
  },

  // ── CR 1/2 ──
  orc: {
    name: "Orc", ac: 13, hp: 15, speed: 30, cr: 0.5, type: "Humanoid",
    stats: { str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10 },
    skills: ["intimidation"],
    actions: [
      { name: "Greataxe", damage: "1d12+3", damageType: "Slashing", attackBonus: 5 },
      { name: "Javelin", damage: "1d6+3", damageType: "Piercing", attackBonus: 5, type: "Simple Ranged", range: 30 },
    ],
    features: [{ name: "Aggressive", description: "Bonus action to move up to speed toward hostile creature" }],
  },
  hobgoblin: {
    name: "Hobgoblin", ac: 18, hp: 11, speed: 30, cr: 0.5, type: "Humanoid",
    stats: { str: 13, dex: 12, con: 12, int: 10, wis: 10, cha: 9 },
    actions: [
      { name: "Longsword", damage: "1d8+1", damageType: "Slashing", attackBonus: 3 },
      { name: "Longbow", damage: "1d8+1", damageType: "Piercing", attackBonus: 3, type: "Martial Ranged", range: 150 },
    ],
    features: [{ name: "Martial Advantage", description: "Once per turn, +2d6 damage if ally within 5ft of target" }],
  },

  // ── CR 1 ──
  bugbear: {
    name: "Bugbear", ac: 16, hp: 27, speed: 30, cr: 1, type: "Humanoid",
    stats: { str: 15, dex: 14, con: 13, int: 8, wis: 11, cha: 9 },
    skills: ["stealth", "survival"],
    actions: [
      { name: "Morningstar", damage: "2d8+2", damageType: "Piercing", attackBonus: 4 },
      { name: "Javelin", damage: "2d6+2", damageType: "Piercing", attackBonus: 4, type: "Simple Ranged", range: 30 },
    ],
    features: [
      { name: "Surprise Attack", description: "Extra 2d6 damage if target is surprised (first round)" },
      { name: "Brute", description: "Extra damage die on melee hits (included)" },
    ],
  },
  dire_wolf: {
    name: "Dire Wolf", ac: 14, hp: 37, speed: 50, cr: 1, type: "Beast",
    stats: { str: 17, dex: 15, con: 15, int: 3, wis: 12, cha: 7 },
    skills: ["perception", "stealth"],
    actions: [{ name: "Bite", damage: "2d6+3", damageType: "Piercing", attackBonus: 5 }],
    features: [
      { name: "Pack Tactics", description: "Advantage on attack if an ally is within 5ft of the target" },
      { name: "Knockdown", description: "Target must succeed DC 13 STR save or be knocked prone on bite hit" },
    ],
  },
  ghoul: {
    name: "Ghoul", ac: 12, hp: 22, speed: 30, cr: 1, type: "Undead",
    stats: { str: 13, dex: 15, con: 10, int: 7, wis: 10, cha: 6 },
    actions: [
      { name: "Bite", damage: "2d6+2", damageType: "Piercing", attackBonus: 2 },
      { name: "Claws", damage: "2d4+2", damageType: "Slashing", attackBonus: 4 },
    ],
    features: [{ name: "Paralyzing Touch", description: "Claws hit: target DC 10 CON save or Paralyzed for 1 min (repeat save end of turn). Elves immune." }],
  },

  // ── CR 2 ──
  ogre: {
    name: "Ogre", ac: 11, hp: 59, speed: 40, cr: 2, type: "Giant",
    stats: { str: 19, dex: 8, con: 16, int: 5, wis: 7, cha: 7 },
    actions: [
      { name: "Greatclub", damage: "2d8+4", damageType: "Bludgeoning", attackBonus: 6 },
      { name: "Javelin", damage: "2d6+4", damageType: "Piercing", attackBonus: 6, type: "Simple Ranged", range: 30 },
    ],
  },
  ghast: {
    name: "Ghast", ac: 13, hp: 36, speed: 30, cr: 2, type: "Undead",
    stats: { str: 16, dex: 17, con: 10, int: 11, wis: 10, cha: 8 },
    actions: [
      { name: "Bite", damage: "2d8+3", damageType: "Piercing", attackBonus: 3 },
      { name: "Claws", damage: "2d6+3", damageType: "Slashing", attackBonus: 5 },
    ],
    features: [
      { name: "Stench", description: "Creatures within 5ft: DC 10 CON save or Poisoned until start of their next turn" },
      { name: "Paralyzing Touch", description: "Claws hit: DC 10 CON save or Paralyzed 1 min. Elves immune." },
    ],
  },
  mimic: {
    name: "Mimic", ac: 12, hp: 58, speed: 15, cr: 2, type: "Monstrosity",
    stats: { str: 17, dex: 12, con: 15, int: 5, wis: 13, cha: 8 },
    skills: ["stealth"],
    actions: [
      { name: "Pseudopod", damage: "1d8+3", damageType: "Bludgeoning", attackBonus: 5 },
      { name: "Bite", damage: "1d8+3", damageType: "Piercing", attackBonus: 5 },
    ],
    features: [
      { name: "Shapechanger", description: "Can polymorph into an object or revert. Stats same in each form." },
      { name: "Adhesive", description: "Adheres to anything that touches it. Grappled (escape DC 13)." },
    ],
  },

  // ── CR 3 ──
  owlbear: {
    name: "Owlbear", ac: 13, hp: 59, speed: 40, cr: 3, type: "Monstrosity",
    stats: { str: 20, dex: 12, con: 17, int: 3, wis: 12, cha: 7 },
    skills: ["perception"],
    actions: [
      { name: "Beak", damage: "1d10+5", damageType: "Piercing", attackBonus: 7 },
      { name: "Claws", damage: "2d8+5", damageType: "Slashing", attackBonus: 7 },
    ],
  },
  manticore: {
    name: "Manticore", ac: 14, hp: 68, speed: 30, cr: 3, type: "Monstrosity",
    stats: { str: 17, dex: 16, con: 17, int: 7, wis: 12, cha: 8 },
    actions: [
      { name: "Bite", damage: "1d8+3", damageType: "Piercing", attackBonus: 5 },
      { name: "Claw", damage: "1d6+3", damageType: "Slashing", attackBonus: 5 },
      { name: "Tail Spike", damage: "1d8+3", damageType: "Piercing", attackBonus: 5, type: "Natural Ranged", range: 100 },
    ],
    features: [{ name: "Tail Spike Regrowth", description: "Has 24 tail spikes. Regrows 1d12 used spikes after long rest." }],
  },
  minotaur: {
    name: "Minotaur", ac: 14, hp: 76, speed: 40, cr: 3, type: "Monstrosity",
    stats: { str: 18, dex: 11, con: 16, int: 6, wis: 16, cha: 9 },
    skills: ["perception"],
    actions: [
      { name: "Greataxe", damage: "2d12+4", damageType: "Slashing", attackBonus: 6 },
      { name: "Gore", damage: "2d8+4", damageType: "Piercing", attackBonus: 6 },
    ],
    features: [
      { name: "Charge", description: "If moves 10ft straight then gore hits: +2d8 piercing and DC 14 STR save or knocked prone" },
      { name: "Reckless", description: "At start of turn, can gain advantage on all melee attacks but attacks against it have advantage" },
    ],
  },

  // ── CR 4-5 ──
  troll: {
    name: "Troll", ac: 15, hp: 84, speed: 30, cr: 5, type: "Giant",
    stats: { str: 18, dex: 13, con: 20, int: 7, wis: 9, cha: 7 },
    skills: ["perception"],
    actions: [
      { name: "Bite", damage: "1d6+4", damageType: "Piercing", attackBonus: 7 },
      { name: "Claw", damage: "2d6+4", damageType: "Slashing", attackBonus: 7 },
    ],
    features: [{ name: "Regeneration", description: "Regains 10 HP at start of turn. Stops if it takes acid or fire damage. Dies only if starts turn at 0 HP and can't regenerate." }],
  },
  hill_giant: {
    name: "Hill Giant", ac: 13, hp: 105, speed: 40, cr: 5, type: "Giant",
    stats: { str: 21, dex: 8, con: 19, int: 5, wis: 9, cha: 6 },
    skills: ["perception"],
    actions: [
      { name: "Greatclub", damage: "3d8+5", damageType: "Bludgeoning", attackBonus: 8 },
      { name: "Rock", damage: "3d10+5", damageType: "Bludgeoning", attackBonus: 8, type: "Natural Ranged", range: 60 },
    ],
  },

  // ── CR 5+ ──
  young_white_dragon: {
    name: "Young White Dragon", ac: 17, hp: 133, speed: 40, cr: 6, type: "Dragon",
    stats: { str: 18, dex: 10, con: 18, int: 6, wis: 11, cha: 12 },
    saves: ["DEX", "CON", "WIS", "CHA"],
    skills: ["perception", "stealth"],
    actions: [
      { name: "Bite", damage: "2d10+4", damageType: "Piercing", attackBonus: 7 },
      { name: "Claw", damage: "2d6+4", damageType: "Slashing", attackBonus: 7 },
    ],
    spells: [
      { name: "Cold Breath", level: 0, damage: "10d8", damageType: "Cold", save: "CON", isAoE: true, aoeRadius: 15, dc: 15, description: "15ft cone, DC 15 CON save, half on success" },
    ],
    features: [{ name: "Ice Walk", description: "Can move across icy surfaces without checks. Difficult ice terrain doesn't cost extra movement." }],
  },
  young_red_dragon: {
    name: "Young Red Dragon", ac: 18, hp: 178, speed: 40, cr: 10, type: "Dragon",
    stats: { str: 23, dex: 10, con: 21, int: 14, wis: 11, cha: 19 },
    saves: ["DEX", "CON", "WIS", "CHA"],
    skills: ["perception", "stealth"],
    actions: [
      { name: "Bite", damage: "2d10+6", damageType: "Piercing", attackBonus: 10 },
      { name: "Claw", damage: "2d6+6", damageType: "Slashing", attackBonus: 10 },
    ],
    spells: [
      { name: "Fire Breath", level: 0, damage: "16d6", damageType: "Fire", save: "DEX", isAoE: true, aoeRadius: 15, dc: 17, description: "30ft cone, DC 17 DEX save, half on success" },
    ],
  },

  // ── Bosses ──
  beholder: {
    name: "Beholder", ac: 18, hp: 180, speed: 0, cr: 13, type: "Aberration",
    stats: { str: 10, dex: 14, con: 18, int: 17, wis: 15, cha: 17 },
    saves: ["INT", "WIS", "CHA"],
    skills: ["perception"],
    actions: [
      { name: "Bite", damage: "4d6", damageType: "Piercing", attackBonus: 5 },
      { name: "Eye Ray (random)", damage: "varies", damageType: "Force", attackBonus: 0 },
    ],
    features: [
      { name: "Antimagic Cone", description: "150ft cone from central eye. Antimagic field, spells suppressed." },
      { name: "Eye Rays", description: "Shoots 3 random eye rays per turn. Various effects (charm, telekinesis, disintegrate, etc.)" },
    ],
  },
};

// Group monsters by CR for the dropdown
export function getMonsterGroups() {
  const groups = {};
  for (const [key, m] of Object.entries(MONSTER_TEMPLATES)) {
    const cr = m.cr ?? 0;
    let label;
    if (cr === 0) label = "CR 0";
    else if (cr < 1) label = `CR ${cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : "1/2"}`;
    else label = `CR ${cr}`;
    if (!groups[label]) groups[label] = [];
    groups[label].push({ key, name: m.name, cr });
  }
  return groups;
}
