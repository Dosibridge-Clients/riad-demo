import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Override with `npm run build -- --base=/riad-demo/` when hosting under a sub-path
  // (GitHub Pages project sites); React Router reads the same value via import.meta.env.BASE_URL.
  base: '/',
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
})
