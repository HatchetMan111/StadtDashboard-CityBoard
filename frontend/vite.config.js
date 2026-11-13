import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Baut die SPA (Admin) und den Display-Client als zwei Einträge.
// Ausgabe direkt nach app/spa/ – wird committed, damit der LXC
// kein Node braucht (Backend serviert die Dateien statisch).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../app/spa",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        display: resolve(__dirname, "display.html"),
      },
    },
  },
});
