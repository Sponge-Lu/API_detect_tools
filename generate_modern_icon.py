#!/usr/bin/env python3
"""
Bebas Neue风格图标生成器 - 蓝粉配色，视觉居中的L字母
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

def create_bebas_style_l(size):
    """创建Bebas Neue风格的L字母图标"""
    # 创建透明背景
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # === 蓝粉渐变背景 ===
    corner_radius = size // 4
    
    # 从浅蓝到粉红的渐变
    for y in range(size):
        ratio = y / size
        r = int(96 + (244 - 96) * ratio)
        g = int(165 - (165 - 114) * ratio)
        b = int(250 - (250 - 182) * ratio)
        
        draw.rectangle(
            [(0, y), (size, y + 1)],
            fill=(r, g, b, 255)
        )
    
    # 应用圆角遮罩
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        [(0, 0), (size, size)],
        radius=corner_radius,
        fill=255
    )
    img.putalpha(mask)
    
    # === Bebas Neue风格的L字母 ===
    # Bebas Neue特点：高、窄、粗、无衬线
    center_x = size // 2
    center_y = size // 2
    
    # L字母参数 - Bebas Neue风格（加宽版本）
    l_height = int(size * 0.58)  # 很高
    l_width = int(size * 0.42)   # 加宽（从32%增加到42%）
    stroke_width = int(size * 0.11)  # 粗线条，统一宽度
    
    # 视觉居中调整（往右移动）
    visual_offset_x = -int(size * 0.03)  # 向右偏移（负数）
    visual_offset_y = int(size * 0.01)   # 稍微向上
    
    l_left = center_x - int(l_width * 0.5) - visual_offset_x
    l_top = center_y - l_height // 2 - visual_offset_y
    
    # === 绘制Bebas Neue风格的L（统一粗细） ===
    
    # 1. 竖线部分（从上到下）
    vertical_rect = [
        l_left,
        l_top,
        l_left + stroke_width,
        l_top + l_height
    ]
    draw.rectangle(vertical_rect, fill=(255, 255, 255, 255))
    
    # 2. 横线部分（底部，与竖线同宽）
    horizontal_rect = [
        l_left,
        l_top + l_height - stroke_width,
        l_left + l_width,
        l_top + l_height
    ]
    draw.rectangle(horizontal_rect, fill=(255, 255, 255, 255))
    
    # === Bebas Neue风格处理：极简，无圆角 ===
    # 保持锐利的边缘，这是Bebas Neue的特点
    
    # === 添加微妙的阴影（增强立体感但不破坏简洁感） ===
    shadow_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_img)
    
    shadow_offset = max(2, size // 120)
    
    # 竖线底部右侧阴影
    shadow_draw.rectangle(
        [l_left + stroke_width, l_top + l_height - stroke_width * 2,
         l_left + stroke_width + shadow_offset, l_top + l_height],
        fill=(0, 0, 0, 40)
    )
    
    # 横线右侧阴影
    shadow_draw.rectangle(
        [l_left + l_width, l_top + l_height - stroke_width,
         l_left + l_width + shadow_offset, l_top + l_height],
        fill=(0, 0, 0, 40)
    )
    
    img = Image.alpha_composite(img, shadow_img)
    
    # === 添加高光（Bebas Neue风格的细节） ===
    highlight_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    highlight_draw = ImageDraw.Draw(highlight_img)
    
    highlight_width = max(1, stroke_width // 8)
    
    # 竖线左边缘高光
    highlight_draw.rectangle(
        [l_left + highlight_width, l_top + stroke_width // 4,
         l_left + highlight_width * 2, l_top + l_height - stroke_width],
        fill=(255, 255, 255, 80)
    )
    
    # 横线顶边高光
    highlight_draw.rectangle(
        [l_left + stroke_width * 1.2, l_top + l_height - stroke_width + highlight_width,
         l_left + l_width - highlight_width * 2, l_top + l_height - stroke_width + highlight_width * 2],
        fill=(255, 255, 255, 80)
    )
    
    img = Image.alpha_composite(img, highlight_img)
    
    return img


def generate_ico(png_path, output_path):
    """生成Windows ICO文件"""
    img = Image.open(png_path)
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    
    icons = []
    for size in sizes:
        resized = img.resize(size, Image.Resampling.LANCZOS)
        icons.append(resized)
    
    icons[0].save(
        output_path,
        format='ICO',
        sizes=sizes,
        append_images=icons[1:]
    )


def main():
    print("🎨 生成Bebas Neue风格L字母图标...")
    print("=" * 60)
    
    icons_dir = Path("src-tauri/icons")
    icons_dir.mkdir(parents=True, exist_ok=True)
    
    # 生成各种尺寸
    sizes = {
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "icon.png": 512,
    }
    
    for filename, size in sizes.items():
        print(f"✨ 生成 {size}x{size} 像素...")
        img = create_bebas_style_l(size)
        output_path = icons_dir / filename
        img.save(str(output_path), 'PNG')
        print(f"   ✅ {output_path}")
    
    print("=" * 60)
    print("🪟 生成 Windows ICO...")
    ico_path = icons_dir / "icon.ico"
    generate_ico(str(icons_dir / "icon.png"), str(ico_path))
    print(f"   ✅ {ico_path}")
    
    # macOS ICNS
    icns_path = icons_dir / "icon.icns"
    img_512 = Image.open(icons_dir / "icon.png")
    img_512.save(str(icns_path), 'PNG')
    print(f"   ✅ {icns_path}")
    
    print("=" * 60)
    print("✅ Bebas Neue风格图标生成完成！")
    print(f"\n📁 位置: {icons_dir.absolute()}")
    print("\n🎨 设计特点:")
    print("   • Bebas Neue字体风格")
    print("   • 加宽比例（58%高 × 42%宽）")
    print("   • 统一粗线条（11%宽度）")
    print("   • 锐利边缘，无圆角")
    print("   • 向右偏移，视觉平衡")
    print("   • 简洁高光和阴影")
    print("\n🚀 重新编译查看效果")


if __name__ == "__main__":
    main()
