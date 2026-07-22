import { defineConfig } from "vite";

// Builds the content-frame runtime (engine + runtime) into a single ES module
// that the pager:// handler injects into every served document. Output lands in
// src-tauri/resources/ and is bundled as a Tauri resource (see tauri.conf.json
// `bundle.resources`), so the Rust handler can read it from the resource dir.
//
// NOTE: unverified — confirm the output is a self-contained module with no bare
// imports when you build on a real machine (src-tauri/NOTES.md).
export default defineConfig({
  build: {
    outDir: "src-tauri/resources",
    emptyOutDir: false,
    lib: {
      entry: "src/content/runtime.ts",
      formats: ["es"],
      fileName: () => "content-runtime.js",
    },
  },
});
