import { resolve } from "node:path";
import { defineConfig } from "vite";

// GitHub Pages serves the site from /<repo>/, so assets need that prefix.
// Two pages: the group view and the character page.
export default defineConfig({
  base: "/ForeverTracker/",
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        character: resolve(import.meta.dirname, "character.html"),
      },
    },
  },
});
