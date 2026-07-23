import { defineConfig } from "vite";

// Builds the content-frame runtime (engine + runtime) into a single ES module
// that the pagetml:// handler injects into every served document. Output lands in
// src-tauri/resources/ and is bundled as a Tauri resource (see tauri.conf.json
// `bundle.resources`), so the Rust handler can read it from the resource dir.
//
// Verified self-contained (no bare imports) — 2026-07-23 native bring-up.
export default defineConfig({
  build: {
    outDir: "src-tauri/resources",
    emptyOutDir: false,
    // Only the runtime bundle belongs in the resource dir — don't copy the
    // dev fixtures from public/.
    copyPublicDir: false,
    lib: {
      entry: "src/content/runtime.ts",
      formats: ["es"],
      fileName: () => "content-runtime.js",
    },
  },
});
