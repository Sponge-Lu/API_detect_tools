import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.join(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.join(__dirname, 'dist-renderer'),
    emptyOutDir: true,
    // 优化构建配置
    minify: 'terser', // 使用 terser 进行更好的压缩
    terserOptions: {
      compress: {
        drop_console: true, // 移除 console.log
        drop_debugger: true // 移除 debugger
      }
    },
    // 代码分割优化
    rollupOptions: {
      output: {
        manualChunks: {
          // 将大型依赖分离出来
          'react-vendor': ['react', 'react-dom'],
          'lucide': ['lucide-react']
        }
      }
    },
    // 关闭 source map 以减小体积
    sourcemap: false,
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 设置 chunk 大小警告限制
    chunkSizeWarningLimit: 1000
  },
  server: {
    port: 5173
  }
});