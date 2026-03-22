import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Read ~/.config/solana/id.json so VITE_LOCAL_KEYPAIR_JSON can default at build time (dev only). */
function readDefaultLocalKeypair(): string {
  try {
    const p = path.join(os.homedir(), ".config", "solana", "id.json");
    if (!fs.existsSync(p)) return "";
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? JSON.stringify(parsed) : "";
  } catch {
    return "";
  }
}

export default defineConfig(() => {
  const fallbackLocalKeypair = readDefaultLocalKeypair();

  return {
    plugins: [react()],
    define: {
      // Compile-time inject; process.env wins over id.json fallback.
      "import.meta.env.VITE_LOCAL_KEYPAIR_JSON": JSON.stringify(
        process.env.VITE_LOCAL_KEYPAIR_JSON || fallbackLocalKeypair
      )
    },
    resolve: {
      alias: {
        buffer: "buffer/"
      }
    },
    optimizeDeps: {
      include: ["buffer"]
    },
    server: {
      port: 5173,
      strictPort: true
    }
  };
});

