/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// One self-contained index.html (scripts, styles and the two fonts inside): the Flutter app loads it from its assets,
// where a module script could not fetch a second file, and the same file is the demo page.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  base: "./",
  build: {
    target: "es2020",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
  // The demo's pretend TV reads the family room TV's own switch-off list from devices/.
  server: { fs: { allow: [".", "../../devices"] } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
