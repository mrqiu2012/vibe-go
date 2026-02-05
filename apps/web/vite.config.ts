import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 3989,
    strictPort: true,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
    proxy: {
      "/api": {
        target: "http://localhost:3990",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3990",
        ws: true,
      },
    },
    watch: {
      // Ignore files that might cause unnecessary reloads
      ignored: [
        "**/node_modules/**",
        "**/dist/**",
        "**/.git/**",
        "**/data/**",
        "**/*.log",
      ],
    },
    hmr: {
      // Reduce HMR reconnection attempts to avoid constant reloads
      overlay: true,
    },
  },
  build: {
    // Optimize build for stability
    sourcemap: false,
    minify: "esbuild",
  },
});

