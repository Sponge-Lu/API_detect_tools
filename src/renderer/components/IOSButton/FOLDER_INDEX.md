# 📁 src/renderer/components/IOSButton/ - AppButton 兼容目录

## 架构说明

**职责**: 保留 legacy `IOSButton` 导入路径，同时明确当前对外方向是 `AppButton`

**特点**:
- `index.ts` 将 `AppButton` 重新导出为 `IOSButton` 兼容别名
- 公共按钮契约以 `src/renderer/components/AppButton/AppButton.tsx` 为准
- 保持原有按钮交互和调用方式，避免重命名期间影响运行时
- 支持 `primary / secondary / tertiary / danger` 四种变体
- 支持加载、禁用、键盘焦点和 ref 转发

## 文件清单

| 文件 | 职责 | 关键导出 |
|------|------|--------|
| **index.ts** | 兼容导出入口 | `IOSButton`, `IOSButtonProps`（映射自 `AppButton`） |
| **IOSButton.tsx** | 历史实现文件 | 保留供兼容/参考，当前公共方向不再新增依赖 |
| **FOLDER_INDEX.md** | 本索引文件 | - |

## 当前使用建议

- 新代码优先直接使用 `AppButton`
- 旧代码仍可通过 `IOSButton` 路径工作
- 文档与测试应以 `AppButton` 作为公共原语名称

## 自指

本文件是 `src/renderer/components/IOSButton/FOLDER_INDEX.md`
