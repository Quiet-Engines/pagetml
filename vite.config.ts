import { defineConfig } from "vite";

// The engine, harness, and fixtures are all served as-is by Vite's dev server.
// Fixtures live in `public/fixtures` so they are served verbatim at
// `/fixtures/<name>.html` (the engine paginates their raw DOM, exactly as the
// real app will paginate an untrusted user document inside the content frame).
export default defineConfig({
  root: ".",
  server: {
    port: 5179,
    strictPort: true,
  },
});
