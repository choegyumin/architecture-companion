import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": new URL("src", import.meta.url).pathname },
  },
  server: {
    host: "127.0.0.1",
    port: 4317,
    strictPort: false,
    watch: {
      ignored: ["**/.architecture-companion/**", "**/src/cli/**", "**/src/server/**", "**/*.test.{ts,tsx}"],
    },
  },
  build: {
    outDir: "skills/architecture-companion/runtime/client",
    sourcemap: true,
  },
});
