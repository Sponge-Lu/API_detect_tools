# IOSModal 兼容目录

## 概述

该目录保留 legacy `IOSModal` 路径；当前对外推荐原语为 `AppModal`。

## 文件结构

| 文件 | 描述 |
|------|------|
| `index.ts` | 将 `AppModal` 重新导出为 `IOSModal` 兼容别名 |
| `IOSModal.tsx` | 历史实现文件，保留供兼容/参考 |
| `FOLDER_INDEX.md` | 本文件 |

## 当前弹窗契约

- 统一使用主题 token 驱动的弹窗表面、边框和阴影
- 遮罩、标题栏、正文区、底部操作区与 overlay family 保持同一结构语言
- 支持 ESC 键关闭、点击遮罩关闭和关闭按钮
- 通过 `overlay-title` / `overlay-body` / `overlay-footer` 测试标记与抽屉类 overlay 对齐

## 使用示例

```tsx
import { AppModal } from '../AppModal/AppModal';
import { AppButton } from '../AppButton/AppButton';

function MyDialog() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <AppModal
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      title="确认操作"
      footer={
        <>
          <AppButton variant="tertiary" onClick={() => setIsOpen(false)}>
            取消
          </AppButton>
          <AppButton variant="primary" onClick={handleConfirm}>
            确认
          </AppButton>
        </>
      }
    >
      <p>确定要执行此操作吗？</p>
    </AppModal>
  );
}
```

## 使用建议

- 新代码优先直接使用 `AppModal`
- 旧代码仍可通过 `IOSModal` 路径工作

## 更新日志

- 2025-01-08: 创建弹窗兼容目录
- 2026-03-31: 与统一 overlay family 对齐共享 chrome 标记
