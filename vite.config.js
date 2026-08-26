import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves this repo at https://<user>.github.io/habura/ —
// base must match the repo name exactly or every asset 404s.
export default defineConfig({
  base: '/habura/',
  plugins: [react()],
})
