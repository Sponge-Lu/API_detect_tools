import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// {{ AURA-X: Add - Vite配置，集成React和Tauri. Source: context7-mcp on 'Tauri' }}
export default defineConfig({
  plugins: [react()],
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // 防止在生产环境中清除console.log
  clearScreen: false,
  
  // Tauri期望一个固定的端口，如果端口被占用则失败
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // 告诉vite忽略监视`src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
})

