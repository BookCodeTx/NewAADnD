import OBR from "@owlbear-rodeo/sdk";
import DiceBox from "@3d-dice/dice-box";
import { playDiceHit, playCrit, playMiss } from "./sfx.js";

const CHANNEL = "com.dnd-hotbar/dice";
const MODAL_ID = "com.dnd-hotbar/dice-modal";
const rollLabel = document.getElementById("roll-label");
const resultDisplay = document.getElementById("result-display");

let diceBox = null;
let isRolling = false;

OBR.onReady(async () => {
  diceBox = new DiceBox("#dice-box", {
    assetPath: "/dice-assets/assets/",
    origin: "/dice-assets/",
    scale: 6,
    theme: "default",
    gravity: 2,
    mass: 1,
    friction: 0.8,
    restitution: 0.5,
    linearDamping: 0.5,
    angularDamping: 0.4,
    settleTimeout: 5000,
  });

  await diceBox.init();

  OBR.broadcast.onMessage(CHANNEL, async (event) => {
    const { notation, label, modifier, charName, rollId } = event.data;
    if (isRolling) return;
    await performRoll(notation, label, modifier, charName, rollId);
  });
});

async function performRoll(notation, label, modifier = 0, charName = "", rollId = null) {
  isRolling = true;

  // Show roll label
  rollLabel.textContent = label || notation;
  rollLabel.classList.add("visible");
  resultDisplay.classList.remove("visible", "fade-out");

  // Roll the 3D dice
  const results = await diceBox.roll(notation);

  // SFX: dice landing
  playDiceHit();

  // Calculate totals
  const diceTotal = results.reduce((sum, r) => sum + r.value, 0);
  const finalTotal = diceTotal + modifier;

  // Check for nat 20/1 on single d20
  const isD20 = results.length === 1 && results[0].sides === 20;
  const natValue = isD20 ? results[0].value : null;

  let cssClass = "";
  let extraText = "";
  if (natValue === 20) {
    cssClass = "nat-crit";
    extraText = "NATURAL 20!";
    playCrit();
  } else if (natValue === 1) {
    cssClass = "nat-fail";
    extraText = "NATURAL 1...";
    playMiss();
  }

  // Build math display string
  const modStr = modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` - ${Math.abs(modifier)}` : "";
  const detail = modifier !== 0 ? `${diceTotal}${modStr} = ${finalTotal}` : "";

  // Show result overlay
  resultDisplay.className = cssClass;
  resultDisplay.innerHTML = `
    ${extraText ? `<div style="font-size:18px;margin-bottom:4px">${extraText}</div>` : ""}
    ${finalTotal}
    ${detail ? `<div class="result-detail">${detail}</div>` : ""}
  `;
  resultDisplay.classList.add("visible");
  rollLabel.classList.remove("visible");

  // Broadcast result back to main extension
  await OBR.broadcast.sendMessage(`${CHANNEL}/result`, {
    notation,
    diceTotal,
    modifier,
    finalTotal,
    natValue,
    charName,
    label,
    rollId,
  });

  // Broadcast SFX to all players
  const sfxName = natValue === 20 ? "crit" : natValue === 1 ? "miss" : "dice-hit";
  await OBR.broadcast.sendMessage("com.dnd-hotbar/sfx", { sound: sfxName });

  // Show OBR notification so all players see it
  const notifText = charName
    ? `${charName} rolled ${notation}${modStr}: ${finalTotal}${extraText ? ` (${extraText})` : ""}`
    : `Rolled ${notation}${modStr}: ${finalTotal}`;
  await OBR.notification.show(notifText, natValue === 20 ? "SUCCESS" : natValue === 1 ? "ERROR" : "INFO");

  // Cleanup: fade out → clear dice → close modal
  await new Promise((resolve) => {
    setTimeout(() => {
      resultDisplay.classList.add("fade-out");

      setTimeout(async () => {
        resultDisplay.classList.remove("visible", "fade-out");
        diceBox.clear();
        isRolling = false;

        // Close the modal so the battlemap is clickable again
        await OBR.modal.close(MODAL_ID);
        resolve();
      }, 600);
    }, 2500);
  });
}
