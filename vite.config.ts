import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cpSync, existsSync, readFileSync } from 'node:fs'
import { join, normalize } from 'node:path'

/**
 * pdf.js 解析中文 PDF 需要字符映射表（cmaps）。随应用一起部署到 dist/pdfjs/cmaps/，
 * 不依赖外部 CDN；开发模式下直接从 node_modules 提供。
 */
function pdfjsCmaps(): Plugin {
  const src = join(process.cwd(), 'node_modules/pdfjs-dist/cmaps')
  let outDir = 'dist'
  return {
    name: 'pdfjs-cmaps',
    configResolved(c) {
      outDir = c.build.outDir
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/pdfjs\/cmaps\/([^?#]+)/)
        if (!m) return next()
        const file = normalize(join(src, decodeURIComponent(m[1])))
        if (!file.startsWith(src) || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/octet-stream')
        res.end(readFileSync(file))
      })
    },
    closeBundle() {
      if (existsSync(src)) cpSync(src, join(outDir, 'pdfjs/cmaps'), { recursive: true })
    },
  }
}

// base './' 让构建产物可以放在任意子路径（如 GitHub Pages）下运行
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), pdfjsCmaps()],
  build: {
    // pdf.js 使用较新的语法；iOS 16.4+ 的 Safari 均支持 ES2022
    target: 'es2022',
  },
})
