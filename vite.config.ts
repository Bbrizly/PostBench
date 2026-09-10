import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/ui',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4316,
    proxy: { '/api': 'http://127.0.0.1:4317', '/media': 'http://127.0.0.1:4317' },
  },
  build: { outDir: '../../dist/ui', emptyOutDir: true },
})
