export const CONDITIONS = {
  poisoned: {
    name: "Poisoned",
    icon: "☠️",
    color: "#44aa44",
    effect: "Disadvantage on attack rolls and ability checks",
    attackDisadvantage: true,
    checkDisadvantage: true,
  },
  prone: {
    name: "Prone",
    icon: "⬇️",
    color: "#aa8844",
    effect: "Disadvantage on attack rolls. Melee attacks against have advantage",
    attackDisadvantage: true,
    grantMeleeAdvantage: true,
    grantRangedDisadvantage: true,
  },
  paralyzed: {
    name: "Paralyzed",
    icon: "⚡",
    color: "#ffaa00",
    effect: "Incapacitated. Auto-fail STR/DEX saves. Melee hits are auto-crits",
    incapacitated: true,
    autoFailSaves: ["STR", "DEX"],
    grantAdvantage: true,
    grantMeleeAutoCrit: true,
  },
  stunned: {
    name: "Stunned",
    icon: "💫",
    color: "#ff8800",
    effect: "Incapacitated. Auto-fail STR/DEX saves. Attacks against have advantage",
    incapacitated: true,
    autoFailSaves: ["STR", "DEX"],
    grantAdvantage: true,
  },
  blinded: {
    name: "Blinded",
    icon: "🌑",
    color: "#333333",
    effect: "Auto-fail sight checks. Disadvantage on attacks. Attacks against have advantage",
    attackDisadvantage: true,
    grantAdvantage: true,
  },
  frightened: {
    name: "Frightened",
    icon: "😨",
    color: "#884488",
    effect: "Disadvantage on ability checks and attacks while source is in sight",
    attackDisadvantage: true,
    checkDisadvantage: true,
  },
  restrained: {
    name: "Restrained",
    icon: "🔗",
    color: "#888888",
    effect: "Speed 0. Disadvantage on DEX saves and attacks. Attacks against have advantage",
    attackDisadvantage: true,
    saveDisadvantage: ["DEX"],
    grantAdvantage: true,
  },
  charmed: {
    name: "Charmed",
    icon: "💖",
    color: "#ff66aa",
    effect: "Can't attack the charmer. Charmer has advantage on social checks",
  },
  invisible: {
    name: "Invisible",
    icon: "👻",
    color: "#aaccff",
    effect: "Advantage on attacks. Attacks against have disadvantage",
    attackAdvantage: true,
    grantDisadvantage: true,
  },
  concentrating: {
    name: "Concentrating",
    icon: "🔮",
    color: "#a045e9",
    effect: "Maintaining concentration on a spell",
  },
  incapacitated: {
    name: "Incapacitated",
    icon: "😵",
    color: "#aa4444",
    effect: "Can't take actions or reactions",
    incapacitated: true,
  },
  dodging: {
    name: "Dodging",
    icon: "🏃",
    color: "#44aaaa",
    effect: "Attacks against have disadvantage. Advantage on DEX saves",
    grantDisadvantage: true,
    saveAdvantage: ["DEX"],
  },
  raging: {
    name: "Raging",
    icon: "🔥",
    color: "#ff4400",
    effect: "Advantage on STR checks/saves. Resistance to physical damage. +2 melee damage",
    checkAdvantage: ["STR"],
    saveAdvantage: ["STR"],
    meleeDamageBonus: 2,
  },
};

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
