import OBR from "@owlbear-rodeo/sdk";

const FLOATER_CHANNEL = "com.dnd-hotbar/floater";
const MODAL_ID = "com.dnd-hotbar/floater-modal";

let closeTimer = null;

OBR.onReady(async () => {
  OBR.broadcast.onMessage(FLOATER_CHANNEL, async (event) => {
    const { damage, damageType, worldX, worldY, isCrit, isSpell, isHeal } = event.data;

    let screenX, screenY;
    try {
      const pt = await OBR.viewport.transformPoint({ x: worldX, y: worldY });
      screenX = pt.x;
      screenY = pt.y;
    } catch {
      screenX = window.innerWidth / 2;
      screenY = window.innerHeight / 2;
    }

    const offsetX = (Math.random() - 0.5) * 60;
    screenX += offsetX;

    const el = document.createElement("div");
    let cls = "damage-float";
    if (isCrit) cls += " crit";
    else if (isHeal) cls += " heal";
    else if (isSpell) cls += " spell-dmg";
    el.className = cls;

    const prefix = isHeal ? "+" : "-";
    el.innerHTML = `${prefix}${damage}${damageType ? `<span class="dmg-type">${damageType}</span>` : ""}`;

    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;
    document.body.appendChild(el);

    el.addEventListener("animationend", () => el.remove());

    clearTimeout(closeTimer);
    closeTimer = setTimeout(async () => {
      if (document.querySelectorAll(".damage-float").length === 0) {
        try { await OBR.modal.close(MODAL_ID); } catch {}
      }
    }, 2200);
  });
});
