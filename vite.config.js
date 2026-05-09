import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        main: "index.html",
        dice: "dice.html",
        floater: "floater.html",
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@3d-dice/dice-box/dist/assets/*",
          dest: "dice-assets/assets",
        },
        {
          src: "node_modules/@3d-dice/dice-box/dist/Dice.js",
          dest: "dice-assets",
        },
        {
          src: "node_modules/@3d-dice/dice-box/dist/world.offscreen.js",
          dest: "dice-assets",
        },
        {
          src: "node_modules/@3d-dice/dice-box/dist/world.onscreen.js",
          dest: "dice-assets",
        },
      ],
    }),
  ],
});
