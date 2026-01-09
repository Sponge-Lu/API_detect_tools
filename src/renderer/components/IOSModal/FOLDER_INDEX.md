# IOSModal 组件

## 概述

iOS 风格弹窗组件，提供统一的弹窗样式和交互体验。

## 文件结构

| 文件 | 描述 |
|------|------|
| `IOSModal.tsx` | iOS 风格弹窗组件实现 |
| `index.ts` | 组件导出 |
| `FOLDER_INDEX.md` | 本文件 |

## 组件特性

- iOS 风格样式（圆角、毛玻璃背景、居中）
- 遮罩层（半透明黑色背景 + 模糊）
- 打开/关闭动画（缩放 + 淡入淡出）
- 按钮布局（底部横向排列，主要操作在右侧）
- 支持 ESC 键关闭
- 支持点击遮罩关闭

## 使用示例

```tsx
import { IOSModal } from './IOSModal';
import { IOSButton } from '../IOSButton';

function MyDialog() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <IOSModal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title="确认操作"
      footer={
        <>
          <IOSButton variant="tertiary" onClick={() => setIsOpen(false)}>
            取消
          </IOSButton>
          <IOSButton variant="primary" onClick={handleConfirm}>
            确认
          </IOSButton>
        </>
      }
    >
      <p>确定要执行此操作吗？</p>
    </IOSModal>
  );
}
```

## Props

| 属性 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `isOpen` | `boolean` | - | 是否打开 |
| `onClose` | `() => void` | - | 关闭回调 |
| `title` | `ReactNode` | - | 标题 |
| `titleIcon` | `ReactNode` | - | 标题图标 |
| `children` | `ReactNode` | - | 内容 |
| `footer` | `ReactNode` | - | 底部操作按钮 |
| `size` | `'sm' \| 'md' \| 'lg' \| 'xl'` | `'md'` | 弹窗尺寸 |
| `showCloseButton` | `boolean` | `true` | 是否显示关闭按钮 |
| `closeOnOverlayClick` | `boolean` | `true` | 是否点击遮罩关闭 |
| `closeOnEsc` | `boolean` | `true` | 是否按 ESC 键关闭 |

## 更新日志

- 2025-01-08: 创建 IOSModal 组件
