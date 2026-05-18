export const CONDITIONS = {
  // ── Standard D&D 5e Conditions ──
  blinded: {
    name: "Blinded",
    icon: "🌑",
    color: "#333333",
    effect: "Auto-fail sight checks. Disadvantage on attacks. Attacks against have advantage",
    tags: ["atk disadv", "grant adv"],
    attackDisadvantage: true,
    grantAdvantage: true,
  },
  charmed: {
    name: "Charmed",
    icon: "💖",
    color: "#ff66aa",
    effect: "Can't attack the charmer. Charmer has advantage on social checks",
    tags: ["social"],
  },
  deafened: {
    name: "Deafened",
    icon: "🔇",
    color: "#667788",
    effect: "Can't hear. Auto-fail any check that requires hearing",
    tags: ["sense"],
  },
  exhaustion: {
    name: "Exhaustion",
    icon: "😩",
    color: "#886644",
    effect: "Disadvantage on ability checks (Lv1). Speed halved (Lv2). Disadvantage on attacks & saves (Lv3)",
    tags: ["check disadv", "atk disadv", "save disadv"],
    attackDisadvantage: true,
    checkDisadvantage: true,
    saveDisadvantageAll: true,
  },
  frightened: {
    name: "Frightened",
    icon: "😨",
    color: "#884488",
    effect: "Disadvantage on ability checks and attacks while source is in sight",
    tags: ["atk disadv", "check disadv"],
    attackDisadvantage: true,
    checkDisadvantage: true,
  },
  grappled: {
    name: "Grappled",
    icon: "🤼",
    color: "#aa6633",
    effect: "Speed becomes 0. Can't benefit from bonus to speed",
    tags: ["speed 0"],
  },
  incapacitated: {
    name: "Incapacitated",
    icon: "😵",
    color: "#aa4444",
    effect: "Can't take actions or reactions",
    tags: ["no action"],
    incapacitated: true,
  },
  invisible: {
    name: "Invisible",
    icon: "👻",
    color: "#aaccff",
    effect: "Advantage on attacks. Attacks against have disadvantage",
    tags: ["atk adv", "grant disadv"],
    attackAdvantage: true,
    grantDisadvantage: true,
  },
  paralyzed: {
    name: "Paralyzed",
    icon: "⚡",
    color: "#ffaa00",
    effect: "Incapacitated. Auto-fail STR/DEX saves. Melee hits are auto-crits",
    tags: ["no action", "auto-fail STR/DEX", "grant adv", "melee auto-crit"],
    incapacitated: true,
    autoFailSaves: ["STR", "DEX"],
    grantAdvantage: true,
    grantMeleeAutoCrit: true,
  },
  petrified: {
    name: "Petrified",
    icon: "🪨",
    color: "#999999",
    effect: "Incapacitated. Auto-fail STR/DEX saves. Resistance to all damage. Attacks against have advantage",
    tags: ["no action", "auto-fail STR/DEX", "grant adv", "resist all"],
    incapacitated: true,
    autoFailSaves: ["STR", "DEX"],
    grantAdvantage: true,
    resistAll: true,
  },
  poisoned: {
    name: "Poisoned",
    icon: "☠️",
    color: "#44aa44",
    effect: "Disadvantage on attack rolls and ability checks",
    tags: ["atk disadv", "check disadv"],
    attackDisadvantage: true,
    checkDisadvantage: true,
  },
  prone: {
    name: "Prone",
    icon: "⬇️",
    color: "#aa8844",
    effect: "Disadvantage on attack rolls. Melee attacks against have advantage, ranged have disadvantage",
    tags: ["atk disadv", "grant melee adv", "grant ranged disadv"],
    attackDisadvantage: true,
    grantMeleeAdvantage: true,
    grantRangedDisadvantage: true,
  },
  restrained: {
    name: "Restrained",
    icon: "🔗",
    color: "#888888",
    effect: "Speed 0. Disadvantage on DEX saves and attacks. Attacks against have advantage",
    tags: ["speed 0", "atk disadv", "DEX save disadv", "grant adv"],
    attackDisadvantage: true,
    saveDisadvantage: ["DEX"],
    grantAdvantage: true,
  },
  stunned: {
    name: "Stunned",
    icon: "💫",
    color: "#ff8800",
    effect: "Incapacitated. Auto-fail STR/DEX saves. Attacks against have advantage",
    tags: ["no action", "auto-fail STR/DEX", "grant adv"],
    incapacitated: true,
    autoFailSaves: ["STR", "DEX"],
    grantAdvantage: true,
  },
  unconscious: {
    name: "Unconscious",
    icon: "💤",
    color: "#443355",
    effect: "Incapacitated. Drop items. Auto-fail STR/DEX saves. Melee hits are auto-crits",
    tags: ["no action", "auto-fail STR/DEX", "grant adv", "melee auto-crit"],
    incapacitated: true,
    autoFailSaves: ["STR", "DEX"],
    grantAdvantage: true,
    grantMeleeAutoCrit: true,
  },

  // ── Combat States ──
  concentrating: {
    name: "Concentrating",
    icon: "🔮",
    color: "#a045e9",
    effect: "Maintaining concentration on a spell",
    tags: ["spell"],
  },
  dodging: {
    name: "Dodging",
    icon: "🏃",
    color: "#44aaaa",
    effect: "Attacks against have disadvantage. Advantage on DEX saves",
    tags: ["grant disadv", "DEX save adv"],
    grantDisadvantage: true,
    saveAdvantage: ["DEX"],
  },
  raging: {
    name: "Raging",
    icon: "🔥",
    color: "#ff4400",
    effect: "Advantage on STR checks/saves. Resistance to physical damage. +2 melee damage",
    tags: ["STR adv", "resist phys", "+2 melee"],
    checkAdvantage: ["STR"],
    saveAdvantage: ["STR"],
    meleeDamageBonus: 2,
  },
  haste: {
    name: "Haste",
    icon: "⚡",
    color: "#ffdd44",
    effect: "+2 AC. Advantage on DEX saves. Double speed. Extra action (attack/dash/disengage/hide)",
    tags: ["+2 AC", "DEX save adv", "x2 speed"],
    saveAdvantage: ["DEX"],
    acBonus: 2,
  },
  blessed: {
    name: "Blessed",
    icon: "✨",
    color: "#ffeeaa",
    effect: "Add 1d4 to attack rolls and saving throws",
    tags: ["+1d4 atk", "+1d4 save"],
    attackBonusDice: "1d4",
    saveBonusDice: "1d4",
  },
  hexed: {
    name: "Hexed",
    icon: "🎯",
    color: "#9933cc",
    effect: "Extra 1d6 necrotic on hits. Disadvantage on chosen ability checks",
    tags: ["+1d6 necrotic", "check disadv"],
    extraDamage: "1d6",
    extraDamageType: "necrotic",
  },
  hunters_mark: {
    name: "Hunter's Mark",
    icon: "🏹",
    color: "#33aa55",
    effect: "Extra 1d6 damage on weapon hits. Advantage on tracking checks",
    tags: ["+1d6 dmg", "track adv"],
    extraDamage: "1d6",
  },
};

// ── Tag color mapping ──
export function getTagColor(tag) {
  if (tag.includes("adv") && !tag.includes("disadv")) return { bg: "#22aa5522", color: "#22aa55", border: "#22aa5544" };
  if (tag.includes("disadv")) return { bg: "#ff444422", color: "#ff6666", border: "#ff444444" };
  if (tag.includes("auto-fail") || tag.includes("auto-crit")) return { bg: "#ff880022", color: "#ffaa44", border: "#ff880044" };
  if (tag.includes("no action")) return { bg: "#aa444422", color: "#cc6666", border: "#aa444444" };
  if (tag.includes("speed")) return { bg: "#aa884422", color: "#ccaa66", border: "#aa884444" };
  if (tag.includes("resist")) return { bg: "#4488aa22", color: "#66aacc", border: "#4488aa44" };
  if (tag.includes("+")) return { bg: "#aa44ff22", color: "#bb77ff", border: "#aa44ff44" };
  return { bg: "#66668822", color: "#8888aa", border: "#66668844" };
}

// ── Attacker's conditions → how they affect the attacker's own rolls ──
export function getAttackerConditionEffects(conditions) {
  let advantage = false;
  let disadvantage = false;

  for (const key of conditions || []) {
    const c = CONDITIONS[key];
    if (!c) continue;
    if (c.attackAdvantage) advantage = true;
    if (c.attackDisadvantage) disadvantage = true;
  }

  // Advantage + Disadvantage cancel out
  if (advantage && disadvantage) return { advantage: false, disadvantage: false };
  return { advantage, disadvantage };
}

// ── Target's conditions → how they affect attacks AGAINST the target ──
export function getTargetConditionEffects(targetConditions, attackType = "melee") {
  let advantage = false;
  let disadvantage = false;
  let autoCrit = false;

  for (const key of targetConditions || []) {
    const c = CONDITIONS[key];
    if (!c) continue;
    if (c.grantAdvantage) advantage = true;
    if (c.grantDisadvantage) disadvantage = true;
    if (c.grantMeleeAdvantage && attackType === "melee") advantage = true;
    if (c.grantMeleeAutoCrit && attackType === "melee") autoCrit = true;
    if (c.grantRangedDisadvantage && attackType === "ranged") disadvantage = true;
  }

  if (advantage && disadvantage) return { advantage: false, disadvantage: false, autoCrit };
  return { advantage, disadvantage, autoCrit };
}

// ── Saving throw condition effects ──
export function getSaveConditionEffects(conditions, saveType) {
  let autoFail = false;
  let advantage = false;
  let disadvantage = false;

  for (const key of conditions || []) {
    const c = CONDITIONS[key];
    if (!c) continue;
    if (c.autoFailSaves?.includes(saveType)) autoFail = true;
    if (c.saveAdvantage?.includes(saveType)) advantage = true;
    if (c.saveDisadvantage?.includes(saveType)) disadvantage = true;
    if (c.saveDisadvantageAll) disadvantage = true;
  }

  if (advantage && disadvantage) return { autoFail, advantage: false, disadvantage: false };
  return { autoFail, advantage, disadvantage };
}

// ── Ability check condition effects ──
export function getCheckConditionEffects(conditions, ability = null) {
  let advantage = false;
  let disadvantage = false;

  for (const key of conditions || []) {
    const c = CONDITIONS[key];
    if (!c) continue;
    if (c.checkDisadvantage) disadvantage = true;
    if (c.checkAdvantage?.includes(ability)) advantage = true;
  }

  if (advantage && disadvantage) return { advantage: false, disadvantage: false };
  return { advantage, disadvantage };
}

// ── Is incapacitated? ──
export function isIncapacitated(conditions) {
  for (const key of conditions || []) {
    const c = CONDITIONS[key];
    if (c?.incapacitated) return true;
  }
  return false;
}

// ── Melee damage bonus (e.g. Rage) ──
export function getMeleeDamageBonus(conditions) {
  let bonus = 0;
  for (const key of conditions || []) {
    const c = CONDITIONS[key];
    if (c?.meleeDamageBonus) bonus += c.meleeDamageBonus;
  }
  return bonus;
}

// Legacy compat
export function shouldAutoFailSave(conditions, saveType) {
  return getSaveConditionEffects(conditions, saveType).autoFail;
}

export function getConditionPenalty(conditions) {
  const fx = getAttackerConditionEffects(conditions);
  return { penalty: fx.disadvantage ? -5 : 0, bonus: fx.advantage ? 5 : 0 };
}
