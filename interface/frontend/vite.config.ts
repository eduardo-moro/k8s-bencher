// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const isElectronBuild = process.env.BUILD_TARGET === "electron";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Electron packaging only: disable SSR entirely and produce a plain
    // static SPA (interface/API's server.ts serves it as static files) -
    // a local desktop app gets no SEO/first-paint benefit from SSR, and
    // this avoids needing a second Node server process just for the
    // frontend. Local dev (npm run dev / make interface) never sets
    // BUILD_TARGET, so this stays false there - SSR dev flow unaffected.
    // TanStack Start's SPA mode writes its prerendered HTML shell to
    // `_shell.html` by default (meant for an edge worker that masks every
    // route to that file). interface/API/src/server.ts (Task 5) is a plain
    // static-file server that does a literal SPA fallback to `index.html`,
    // so redirect the shell's output filename to match.
    spa: isElectronBuild ? { enabled: true, prerender: { outputPath: "/index" } } : undefined,
  },
  // The wrapper's nitro plugin (Cloudflare-targeted) redirects the server
  // build to `.output/server/...` instead of TanStack Start's own default
  // `dist/server/server.js`. SPA mode's built-in prerender step (which
  // renders the static HTML shell) hardcodes that default `dist/server`
  // path, so nitro must be disabled for the electron build or prerender
  // fails with ERR_MODULE_NOT_FOUND. Not needed anyway: electron packaging
  // doesn't deploy to Cloudflare.
  nitro: isElectronBuild ? false : undefined,
});
