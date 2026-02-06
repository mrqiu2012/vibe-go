import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const monacoVsPath = path.join(path.dirname(require.resolve("monaco-editor/package.json")), "min", "vs");

export default defineConfig({
  plugins: [
    react(),
    {
      name: "monaco-from-node_modules",
      configureServer(server) {
        server.middlewares.use("/vs", (req, res, next) => {
          const url = (req.url ?? "").replace(/^\//, "").replace(/\?.*$/, "");
          const file = path.resolve(monacoVsPath, url);
          const root = path.resolve(monacoVsPath);
          if (!file.startsWith(root + path.sep) && file !== root) {
            return next();
          }
          if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
            return next();
          }
          const ext = path.extname(file);
          const types: Record<string, string> = {
            ".js": "application/javascript",
            ".css": "text/css",
            ".json": "application/json",
          };
          res.setHeader("Content-Type", types[ext] ?? "application/octet-stream");
          fs.createReadStream(file).pipe(res);
        });
      },
      closeBundle() {
        // Copy monaco vs from node_modules to dist so production serves from same source
        const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "dist");
        const destVs = path.join(outDir, "vs");
        if (fs.existsSync(outDir) && fs.existsSync(monacoVsPath)) {
          fs.cpSync(monacoVsPath, destVs, { recursive: true });
        }
      },
    },
  ],
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

