import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Standalone build for the Showdown-native Matchup Center plugin.
//
// Emits an ES-module bundle (stable entry name `matchup.js`) into
// frontend/dist-plugin/. The bundle is served from the PS client origin under
// /cannoli-matchup/ and injected into the legacy client via a deferred
// <script type="module"> (mirroring the Showdex injection in
// showdown/Dockerfile.client). ES modules + code splitting are deliberate:
// a later phase lazy-loads the ~1.5MB learnsets module as a separate chunk.
//
// Build: `bun run build:plugin` (optionally VITE_MATCHUP_API_BASE=<origin>).
export default defineConfig(({ mode }) => {
  // envDir is the repo root, same as the main site config.
  const envDir = path.resolve(__dirname, '..')
  const env = loadEnv(mode, envDir, 'VITE_')
  // Bake-time default: the live site. Dev builds pass
  // VITE_MATCHUP_API_BASE=http://localhost:3001.
  const apiBase = env.VITE_MATCHUP_API_BASE || 'https://cannoli.live'

  return {
    plugins: [react()],
    // Chunks/assets resolve against the prod mount prefix on the sim origin.
    base: '/cannoli-matchup/',
    // Don't copy the site's public/ dir (favicons, fonts) into the plugin dist.
    publicDir: false,
    envDir,
    define: {
      // Absolute Cannoli API origin (e.g. https://cannoli.live or
      // http://localhost:3001). The sim origin has no /api proxy, so the
      // plugin must call absolute URLs. Defaults to the live site.
      __MATCHUP_API_BASE__: JSON.stringify(apiBase),
      // The site's shared API client (src/lib/api.ts) reads
      // `import.meta.env.VITE_API_URL` once at module scope. Replace that
      // read with a runtime expression so a page-level override
      // (`window.CANNOLI_MATCHUP_API_BASE`, set BEFORE the plugin module
      // executes) wins over the baked default — the plugin reuses the site's
      // api object verbatim, zero drift, but stays repointable at runtime.
      'import.meta.env.VITE_API_URL':
        `(typeof window !== "undefined" && window.CANNOLI_MATCHUP_API_BASE || ${JSON.stringify(apiBase)})`,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      outDir: 'dist-plugin',
      emptyOutDir: true,
      rollupOptions: {
        input: path.resolve(__dirname, 'src/plugins/matchup/main.tsx'),
        output: {
          format: 'es',
          entryFileNames: 'matchup.js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  }
})
