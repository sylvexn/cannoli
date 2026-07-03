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
      // plugin must call absolute URLs. Empty default until P2 consumes it.
      __MATCHUP_API_BASE__: JSON.stringify(env.VITE_MATCHUP_API_BASE ?? ''),
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
