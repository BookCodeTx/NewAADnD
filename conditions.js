export const CONDITIONS = {
  poisoned: {
    name: "Poisoned",
    icon: "☠️",
    color: "#44aa44",
    effect: "Disadvantage on attack rolls and ability checks",
    attackPenalty: -5,
  },
  prone: {
    name: "Prone",
    icon: "⬇️",
    color: "#aa8844",
    effect: "Disadvantage on attack rolls. Melee attacks against have advantage",
    attackPenalty: -5,
  },
  paralyzed: {
    name: "Paralyzed",
    icon: "⚡",
    color: "#ffaa00",
    effect: "Incapacitated. Auto-fail STR/DEX saves. Melee hits are auto-crits",
    attackPenalty: -999,
    autoFailSaves: ["STR", "DEX"],
  },
  stunned: {
    name: "Stunned",
    icon: "💫",
    color: "#ff8800",
    effect: "Incapacitated. Auto-fail STR/DEX saves. Attacks against have advantage",
    attackPenalty: -999,
    autoFailSaves: ["STR", "DEX"],
  },
  blinded: {
    name: "Blinded",
    icon: "🌑",
    color: "#333333",
    effect: "Auto-fail sight checks. Disadvantage on attacks. Attacks against have advantage",
    attackPenalty: -5,
  },
  frightened: {
    name: "Frightened",
    icon: "😨",
    color: "#884488",
    effect: "Disadvantage on ability checks and attacks while source is in sight",
    attackPenalty: -5,
  },
  restrained: {
    name: "Restrained",
    icon: "🔗",
    color: "#888888",
    effect: "Speed 0. Disadvantage on DEX saves and attacks. Attacks against have advantage",
    attackPenalty: -5,
  },
  charmed: {
    name: "Charmed",
    icon: "💖",
    color: "#ff66aa",
    effect: "Can't attack the charmer. Charmer has advantage on social checks",
    attackPenalty: 0,
  },
  invisible: {
    name: "Invisible",
    icon: "👻",
    color: "#aaccff",
    effect: "Advantage on attacks. Attacks against have disadvantage",
    attackPenalty: 0,
    attackBonus: 5,
  },
  concentrating: {
    name: "Concentrating",
    icon: "🔮",
    color: "#a045e9",
    effect: "Maintaining concentration on a spell",
    attackPenalty: 0,
  },
};

export function getConditionPenalty(conditions) {
  let penalty = 0;
  let bonus = 0;
  for (const key of conditions || []) {
    const c = CONDITIONS[key];
    if (!c) continue;
    if (c.attackPenalty) penalty += c.attackPenalty;
    if (c.attackBonus) bonus += c.attackBonus;
  }
  return { penalty, bonus };
}

export function shouldAutoFailSave(conditions, saveType) {
  for (const key of conditions || []) {
    const c = CONDITIONS[key];
    if (c?.autoFailSaves?.includes(saveType)) return true;
  }
  return false;
}
