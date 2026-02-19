#!/usr/bin/env python3
"""
Muxvo App Icon 批量生成脚本
使用 Google Gemini Imagen 4.0 生成 8 个方案 × 3 张 = 24 张图标
"""

import os
import sys
import time
import configparser
from pathlib import Path

from google import genai

# 读取 API Key
config = configparser.ConfigParser()
config.read(os.path.expanduser("~/.config/bxz-xhs/config.ini"))
api_key = config.get("gemini_nano", "api_key")

client = genai.Client(api_key=api_key)

OUTPUT_DIR = Path(__file__).parent

# 通用前缀
PREFIX = "App icon design, macOS dock icon style, 1024x1024, single centered composition on solid background, no text unless specified, sharp vector-quality rendering, dark theme, professional app icon, Dribbble quality, clean edges, suitable for small sizes, no busy details. "

# 8 个设计方案
CONCEPTS = [
    {
        "name": "01-amber-grid",
        "prompt": PREFIX + "A rounded-square app icon with a deep navy background (#0a0e14). The foreground shows a 2x2 grid of four slightly rounded rectangles, separated by thin dark gaps (#06080c), representing terminal tiles. The top-left tile glows brighter in warm amber (#e8a748) with a subtle radial glow emanating from its center, while the other three tiles are rendered in progressively dimmer shades of amber -- muted gold, dark amber, and near-charcoal with just a faint amber edge-highlight. Each tile has a tiny 2px status dot in the upper-left corner (the bright tile's dot is green #4ade80, the others are dim gray). The entire icon has a subtle frosted-glass sheen with a faint diagonal highlight across the upper-left quadrant. A very soft ambient glow of amber bleeds outward from behind the grid arrangement. No text. Clean, geometric, minimal."
    },
    {
        "name": "02-signal-fork",
        "prompt": PREFIX + "A rounded-square app icon on a deep navy (#0a0e14) background. A single bold amber (#e8a748) line enters from the left-center of the icon and splits into three diverging paths that fan outward to the right, like a trident or branching circuit trace. The branching point has a bright amber node (a small filled circle) with a radial glow. Each of the three output paths terminates in a small rounded rectangle (representing a terminal window) in diminishing amber tones. The paths themselves have a subtle glow effect, with the glow strongest at the fork node and fading along the branches. The lines are clean and geometric, with rounded caps. Between the paths, very faint grid lines suggest the underlying workspace. A subtle frosted glass overlay gives the whole composition depth. No text."
    },
    {
        "name": "03-warm-pulse",
        "prompt": PREFIX + "A rounded-square app icon on deep navy (#0a0e14). Centered in the icon is a horizontal audio waveform made of 7 vertical rounded bars of varying heights, arranged symmetrically (short-medium-tall-tallest-tall-medium-short). The bars are rendered in warm amber (#e8a748) with a soft vertical gradient that transitions from bright amber at the top to a deeper burnt amber at the base. The tallest center bar doubles as a blinking terminal cursor -- it is slightly brighter and has a subtle glow halo. Below the waveform, a single thin horizontal line in muted amber serves as the baseline, like a terminal prompt line. The entire waveform has a breathing-glow feel with a soft outer glow around the bars. No text. Clean and iconic."
    },
    {
        "name": "04-command-nexus",
        "prompt": PREFIX + "A rounded-square app icon on deep navy (#0a0e14). At the center, a hexagonal shape with slightly rounded corners in frosted amber glass -- semi-transparent amber (#e8a748) fill at about 20 percent opacity, with a solid amber border. From each of the six vertices of the hexagon, thin lines extend outward toward the icon edges, each terminating in a small circle node. Three of these outer nodes glow bright amber, two glow in muted blue (#60a5fa), and one glows in soft purple (#a78bfa) -- referencing three AI tool ecosystems. The center of the hexagon contains a tiny greater-than prompt symbol in bright amber. A subtle ambient glow radiates from the hexagonal center. The overall feel is that of a network topology or command map. No text."
    },
    {
        "name": "05-stacked-planes",
        "prompt": PREFIX + "A rounded-square app icon on deep navy (#06080c). Three rounded rectangles (aspect ratio 4:3) are stacked in a subtle 3D perspective arrangement, offset diagonally from bottom-left to upper-right, creating a layered card-stack effect. The backmost card is dark charcoal (#161b22) with a faint amber border. The middle card is slightly lighter with a thin amber border at 40 percent opacity. The front card is rendered with a frosted-glass effect and a full-brightness amber (#e8a748) border. The front card has a tiny mock terminal header: three dots in the upper-left corner (one amber, two dim gray), and two lines of text represented by thin horizontal bars in muted gray and one highlighted bar in amber. A soft shadow cascade falls from each card. No text."
    },
    {
        "name": "06-m-glyph-circuit",
        "prompt": PREFIX + "A rounded-square app icon on deep navy (#0a0e14). A stylized letter M constructed from continuous circuit-trace-style lines (3px weight, rounded joints) in warm amber (#e8a748). The M is built as follows: the left vertical stroke rises straight up, the first diagonal descends to a center valley point, the second diagonal rises to the right peak, and the right vertical descends -- but instead of sharp corners, each vertex is a small filled circle node that glows. The center valley node glows brightest, with a radial amber glow suggesting an active signal junction. The two outer top nodes of the M have tiny branching lines extending outward like antennae or circuit branches, suggesting multiplexing. The entire letterform sits on a subtle grid of very faint lines. The M is perfectly centered and occupies about 60 percent of the icon space."
    },
    {
        "name": "07-amber-ember",
        "prompt": PREFIX + "A rounded-square app icon on deep navy (#0a0e14). At the center, an abstract ember or flame shape formed by two overlapping, slightly rotated rounded parallelogram forms. The outer form is a warm amber (#e8a748) outline with a transparent interior. The inner form is a smaller, brighter filled shape in gradient from bright amber (#f0c060) at the top to deep amber (#b07830) at the base. Where the two shapes overlap, the intersection area glows brighter. From the top of the ember, three thin curved wisps rise upward in decreasing opacity, suggesting heat or energy rising. Below the ember, a subtle horizontal elliptical glow suggests the ember is floating above a dark surface. The entire composition is surrounded by a barely-visible circular ring that frames the ember. No text. Organic yet precise."
    },
    {
        "name": "08-grid-aperture",
        "prompt": PREFIX + "A rounded-square app icon on deep navy (#0a0e14). Six trapezoidal blades arranged in a circular aperture or iris pattern, like a camera shutter partially open. Each blade is rendered as a frosted-glass panel with a subtle border, and an amber (#e8a748) edge highlight on the inner edge of each blade facing the center opening. The aperture opening at the center is a small hexagonal space through which a bright amber glow emanates, as if light is shining through from behind. Each blade has one or two tiny horizontal lines etched into it in very faint gray, suggesting miniature terminal text. The amber glow from the center creates a subtle radial gradient that illuminates the inner faces of the blades. A very faint ring of amber glow encircles the outer edges of the aperture assembly. No text."
    },
]


def generate_concept(concept, num_images=3):
    """为一个方案生成多张图片"""
    name = concept["name"]
    prompt = concept["prompt"]

    print(f"\n{'='*50}")
    print(f"方案: {name}")
    print(f"{'='*50}")

    success_count = 0

    for i in range(num_images):
        output_path = OUTPUT_DIR / f"{name}-v{i+1}.png"

        if output_path.exists():
            print(f"  跳过 v{i+1}: 已存在")
            success_count += 1
            continue

        print(f"  生成 v{i+1}...", end=" ", flush=True)

        try:
            response = client.models.generate_images(
                model="imagen-4.0-fast-generate-001",
                prompt=prompt,
                config={
                    "number_of_images": 1,
                    "aspect_ratio": "1:1",
                },
            )

            if response.generated_images:
                image = response.generated_images[0]
                with open(output_path, "wb") as f:
                    f.write(image.image.image_bytes)
                print(f"OK -> {output_path.name}")
                success_count += 1
            else:
                print("FAIL (no image returned)")

        except Exception as e:
            print(f"FAIL ({e})")

        # 避免 API 限流
        time.sleep(2)

    return success_count


def main():
    print("=" * 50)
    print("Muxvo App Icon 批量生成")
    print(f"模型: imagen-4.0-fast-generate-001")
    print(f"总计: {len(CONCEPTS)} 方案 x 3 张 = {len(CONCEPTS) * 3} 张")
    print(f"输出: {OUTPUT_DIR}")
    print("=" * 50)

    total_success = 0
    total_expected = len(CONCEPTS) * 3

    for concept in CONCEPTS:
        count = generate_concept(concept, num_images=3)
        total_success += count

    print(f"\n{'='*50}")
    print(f"完成! {total_success}/{total_expected} 张生成成功")
    print(f"输出目录: {OUTPUT_DIR}")
    print("=" * 50)


if __name__ == "__main__":
    main()
