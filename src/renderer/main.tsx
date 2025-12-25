/**
 * 输入: React, ReactDOM, App 组件, CSS 样式
 * 输出: React 应用挂载到 DOM
 * 定位: 入口点 - 初始化 React 应用并挂载到根元素
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/renderer/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
