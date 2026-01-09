# 📁 src/renderer/components/IOSButton/ - iOS 风格按钮组件

## 架构说明

**职责**: 提供 iOS 风格的按钮组件

**特点**:
- 支持 Primary/Secondary/Tertiary 三种变体
- iOS 风格样式（圆角、填充、阴影）
- 悬停状态（背景色变化）
- 按下状态（缩放动画）
- 保持原有的 onClick 处理逻辑
- 支持加载状态
- 支持禁用状态
- 支持 ref 转发（forwardRef）
- 无障碍性支持（焦点指示器、键盘导航、ARIA 属性）
- 性能优化（GPU 加速、will-change、仅使用 transform/opacity 动画）

**依赖关系**:
- 被 `App.tsx` 和其他组件使用
- 使用 iOS 设计系统 CSS 变量

---

## 📂 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **IOSButton.tsx** | iOS 按钮组件 | `IOSButton` 组件, `IOSButtonProps` 类型 |
| **index.ts** | 组件导出 | 重新导出 `IOSButton` |
| **FOLDER_INDEX.md** | 本索引文件 | - |

---

## 🧩 组件详解

### IOSButton 组件

**Props:**
- `variant`: 按钮变体 ('primary' | 'secondary' | 'tertiary')
- `size`: 按钮尺寸 ('sm' | 'md' | 'lg')
- `loading`: 是否显示加载状态
- `disabled`: 是否禁用
- `children`: 按钮内容
- `className`: 额外的 CSS 类名
- `aria-label`: 无障碍标签（当按钮只有图标时必需）
- 继承所有标准 button HTML 属性
- 支持 ref 转发

**样式特点:**
- Primary: 蓝色填充背景，白色文字，带阴影
- Secondary: 浅蓝色背景，蓝色文字，无阴影
- Tertiary: 透明背景，蓝色文字，悬停时显示背景

**交互效果:**
- 悬停: 背景色变化
- 按下: 缩放到 0.97
- 禁用: 透明度 50%
- 加载: 显示旋转图标

---

## 使用示例

```tsx
import { IOSButton } from './components/IOSButton';

// Primary 按钮
<IOSButton variant="primary" onClick={handleClick}>
  添加站点
</IOSButton>

// Secondary 按钮
<IOSButton variant="secondary" size="sm">
  取消
</IOSButton>

// Tertiary 按钮
<IOSButton variant="tertiary" loading={isLoading}>
  刷新
</IOSButton>

// 使用 ref
const buttonRef = useRef<HTMLButtonElement>(null);
<IOSButton ref={buttonRef} variant="primary">
  聚焦按钮
</IOSButton>
```

---

## 🔄 自指

本文件是 `src/renderer/components/IOSButton/FOLDER_INDEX.md`
