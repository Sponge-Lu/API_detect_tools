import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react()],
  root: join(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: join(__dirname, 'dist-renderer'),
    emptyOutDir: true,
    // 当前 bundle 在 terser 压缩阶段会稳定触发 OOM，改用 esbuild 保持可构建性。
    minify: 'esbuild',
    // 代码分割优化
    rollupOptions: {
      output: {
        manualChunks: {
          // 将大型依赖分离出来
          'react-vendor': ['react', 'react-dom'],
          lucide: ['lucide-react'],
          state: ['zustand'],
        },
      },
    },
    // 关闭 source map 以减小体积
    sourcemap: false,
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // 设置 chunk 大小警告限制
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
  },
});
