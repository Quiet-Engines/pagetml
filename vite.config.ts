import { defineConfig, type Plugin } from "vite";

// Content-Security-Policy for the content frame (spec §4.4, QE-1431).
//
// The real app serves the user's document over `pagetml://` and sets this header
// on that response; here a dev middleware sets the same header on
// `/app/content.html` so the default-deny behavior and the per-file "allow
// remote resources" relaxation are exercised the same way.
//
// `'self'` is the content frame's own origin — `pagetml://<doc>` in production,
// the dev server here — so same-origin document assets load while arbitrary
// remote hosts are blocked. The toggle adds `https:` to the fetching
// directives. (Dev also needs 'unsafe-eval' / ws: for Vite's module runtime and
// HMR; production's policy is tighter, keyed only to pagetml:.)
function contentCsp(allowRemote: boolean): string {
  const remote = allowRemote ? " https:" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'${remote}`,
    `style-src 'self' 'unsafe-inline'${remote}`,
    `img-src 'self' data: blob:${remote}`,
    `font-src 'self' data:${remote}`,
    `media-src 'self' data: blob:${remote}`,
    `connect-src 'self' ws: wss:${remote}`,
  ].join("; ");
}

function contentCspPlugin(): Plugin {
  return {
    name: "pagetml-content-csp",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (url.startsWith("/app/content.html")) {
          const allowRemote = /[?&]remote=1(?:&|$)/.test(url);
          res.setHeader("Content-Security-Policy", contentCsp(allowRemote));
        }
        next();
      });
    },
  };
}

// Fixtures live in `public/fixtures` so they are served verbatim at
// `/fixtures/<name>.html` (the engine paginates their raw DOM, exactly as the
// real app will paginate an untrusted user document inside the content frame).
export default defineConfig({
  root: ".",
  plugins: [contentCspPlugin()],
  server: {
    port: 5179,
    strictPort: true,
  },
  // `npm run build:app` produces the Tauri frontendDist (../dist). Both the
  // chrome (app/index.html) and the dev content host (app/content.html) are
  // emitted; the window loads `app/index.html`. NOTE: verify the dist layout on
  // a real build (see src-tauri/NOTES.md).
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: "app/index.html",
        content: "app/content.html",
      },
    },
  },
});
