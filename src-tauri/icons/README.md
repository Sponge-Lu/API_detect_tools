# 应用图标

Tauri需要以下格式的图标文件：

## 必需的图标文件

- `32x32.png` - Windows任务栏图标
- `128x128.png` - Windows应用列表图标
- `128x128@2x.png` - macOS高分辨率图标
- `icon.icns` - macOS应用图标包
- `icon.ico` - Windows应用图标

## 自动生成图标

您可以使用在线工具或命令行工具从一张高分辨率PNG图片生成所有格式：

### 方法1：使用Tauri CLI（推荐）

```bash
npm install --save-dev @tauri-apps/cli
npx tauri icon /path/to/your/icon.png
```

这会自动生成所有需要的图标格式到 `src-tauri/icons/` 目录。

### 方法2：在线工具

访问以下网站上传图片并生成图标：
- https://www.favicon-generator.org/
- https://icon.kitchen/

### 方法3：手动创建

使用图像编辑软件（如Photoshop、GIMP）：
1. 准备一张1024x1024的PNG图片
2. 导出为不同尺寸的PNG文件
3. 使用工具转换为ICO和ICNS格式

## 图标设计建议

- ✅ 使用简洁的图标设计
- ✅ 确保在小尺寸下依然清晰
- ✅ 使用高对比度颜色
- ✅ 避免过多细节
- ⚠️ 图标应为正方形（1:1比例）
- ⚠️ 背景应为透明或纯色

## 临时解决方案

如果暂时没有图标，Tauri会使用默认图标。您可以先进行开发和测试，稍后再添加自定义图标。

