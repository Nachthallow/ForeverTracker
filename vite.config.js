import { defineConfig } from "vite";

// GitHub Pages serves the site from /<repo>/, so assets need that prefix.
export default defineConfig({
  base: "/ForeverTracker/",
});
