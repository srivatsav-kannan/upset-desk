import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The app reads every models/*/predictions.csv from the repo at build time, so the dev
// server must be allowed to serve files from the repo root (one level up).
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const modelsDir = fileURLToPath(new URL("../models", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      // Dev only: models/ is outside this app's folder, so watch it too. A new or edited
      // predictions.csv then shows up without restarting the dev server.
      name: "watch-models",
      configureServer(server) {
        server.watcher.add(modelsDir);
      },
    },
  ],
  server: { fs: { allow: [repoRoot] } },
});
