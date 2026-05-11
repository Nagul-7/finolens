import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Use BACKEND_URL env var when running inside Docker; fall back to localhost for local dev
const backendUrl = process.env.BACKEND_URL || 'http://localhost:5000'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api': backendUrl,
      '/socket.io': { target: backendUrl, ws: true }
    }
  }
})
