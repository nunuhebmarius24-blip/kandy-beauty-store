import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages uses a repository subpath; Netlify serves from the domain root.
const base = process.env.GITHUB_ACTIONS === 'true' ? '/kandy-beauty-store/' : '/'

export default defineConfig({ plugins: [react()], base })
