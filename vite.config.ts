import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs, so a build can be dropped on any static host or
  // opened from a subdirectory without rewriting paths.
  base: "./",
  build: { target: "es2022" },
});
