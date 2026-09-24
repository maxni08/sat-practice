import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ["index.html"] },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [
        "**/work/**",
        "**/src-tauri/**",
        "**/source-pdfs/**",
        "**/public/bank/assets/**",
        "**/outputs/**",
        "**/dist/**",
      ],
    },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022" },
});
