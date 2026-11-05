import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' 让构建产物可以放在任意子路径（如 GitHub Pages）下运行
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
