"""
annotate-screenshots.py — Add red boxes, arrows, and labels to Worktree doc screenshots.
Reads from _backup/, writes annotated versions to parent dir.

Coordinates verified via numpy pixel analysis on Retina 2x screenshots.
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math

DIR = Path(__file__).parent.parent / 'docs' / 'screenshots' / 'worktree'
BACKUP = DIR / '_backup'

RED = (220, 45, 45)
BLUE = (50, 100, 220)
GREEN_DARK = (40, 140, 40)
ORANGE = (210, 130, 30)
LINE_W = 6
FONT_SIZE = 38

def get_font(size=FONT_SIZE):
    for name in [
        '/System/Library/Fonts/PingFang.ttc',
        '/System/Library/Fonts/STHeiti Medium.ttc',
        '/System/Library/Fonts/Helvetica.ttc',
    ]:
        try:
            return ImageFont.truetype(name, size)
        except:
            pass
    return ImageFont.load_default()

def draw_rect(draw, box, color=RED, width=LINE_W, radius=0):
    x1, y1, x2, y2 = box
    if radius > 0:
        draw.rounded_rectangle([x1, y1, x2, y2], radius=radius, outline=color, width=width)
    else:
        for i in range(width):
            draw.rectangle([x1 - i, y1 - i, x2 + i, y2 + i], outline=color)

def draw_arrow(draw, start, end, color=RED, width=5, head_size=24):
    draw.line([start, end], fill=color, width=width)
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.sqrt(dx * dx + dy * dy)
    if length == 0:
        return
    udx, udy = dx / length, dy / length
    px, py = -udy, udx
    p1 = (end[0] - head_size * udx + head_size * 0.5 * px,
          end[1] - head_size * udy + head_size * 0.5 * py)
    p2 = (end[0] - head_size * udx - head_size * 0.5 * px,
          end[1] - head_size * udy - head_size * 0.5 * py)
    draw.polygon([end, p1, p2], fill=color)

def draw_label(draw, pos, text, font, color=RED, bg=(255, 255, 255, 230)):
    bbox = font.getbbox(text)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x, y = pos
    pad = 10
    draw.rectangle([x - pad, y - pad, x + tw + pad, y + th + pad], fill=bg, outline=color, width=3)
    draw.text((x, y), text, fill=color, font=font)


# ─── shot-01: Full window — highlight branch icon button ───
def annotate_shot_01():
    img = Image.open(BACKUP / 'shot-01-full-window.png').convert('RGBA')
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = get_font(42)

    # Right tile branch icon: y=176-203, x=2360-2387 (from pixel analysis)
    # Add generous padding for visibility
    icon_box = (2340, 160, 2410, 220)
    draw_rect(draw, icon_box, RED, 6, radius=8)

    # Arrow from label to icon
    draw_label(draw, (2060, 120), "分支图标按钮", font, RED)
    draw_arrow(draw, (2300, 155), (2340, 180), RED, 5, 22)

    result = Image.alpha_composite(img, overlay).convert('RGB')
    result.save(DIR / 'shot-01-full-window.png')
    print('  done shot-01')


# ─── shot-02: Popover initial — highlight popover ───
def annotate_shot_02():
    img = Image.open(BACKUP / 'shot-02-popover-initial.png').convert('RGBA')
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = get_font(36)

    # Popover card: border at x:1073-1632, y:222-441 (rgb 209,209,214)
    # Add slight padding outside border
    popover_box = (1065, 214, 1642, 450)
    draw_rect(draw, popover_box, RED, 6, radius=12)

    # Label to the left of popover
    draw_label(draw, (780, 310), "Worktree 面板", font, RED)
    draw_arrow(draw, (1030, 335), (1065, 335), RED, 5, 20)

    result = Image.alpha_composite(img, overlay).convert('RGB')
    result.save(DIR / 'shot-02-popover-initial.png')
    print('  done shot-02')


# ─── shot-03: After create — highlight badge and path ───
def annotate_shot_03():
    img = Image.open(BACKUP / 'shot-03-after-create.png').convert('RGBA')
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = get_font(36)

    # Badge "520-program": y=171-208, x=1396-1618
    badge_box = (1385, 162, 1630, 218)
    draw_rect(draw, badge_box, RED, 6, radius=8)
    draw_label(draw, (1390, 225), "Worktree 标记", font, RED)
    draw_arrow(draw, (1505, 225), (1505, 218), RED, 4, 18)

    # Path "~/…/wt-1" — it's after the badge, around x:1640-1800
    path_box = (1640, 166, 1810, 214)
    draw_rect(draw, path_box, BLUE, 5, radius=6)
    draw_label(draw, (1650, 225), "Worktree 目录", font, BLUE)
    draw_arrow(draw, (1720, 225), (1720, 214), BLUE, 4, 18)

    result = Image.alpha_composite(img, overlay).convert('RGB')
    result.save(DIR / 'shot-03-after-create.png')
    print('  done shot-03')


# ─── shot-04-closeup: Popover detail ───
def annotate_shot_04_closeup():
    img = Image.open(BACKUP / 'shot-04-popover-closeup.png').convert('RGBA')
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = get_font(26)

    # Dimensions: 1120x548 (verified via numpy pixel analysis)
    # "WORKTREES" header: y≈63-93, x≈54-346
    # "+ New Worktree (from master)" button: y≈180-225, x≈55-749
    # Divider: y=278-281
    # Green dot (master): x:52-75, y:340-363; "master" text: x:110-278
    # "current" badge: x:884-1043, y:340-370
    # Orange dot (wt-1): x:52-75, y:448-471; "wt-1" text: x:110-229

    # Highlight create button
    draw_rect(draw, (40, 168, 760, 235), RED, 4, radius=6)
    draw_label(draw, (780, 185), "创建新 Worktree", font, RED)

    # Highlight green dot + master label
    draw_rect(draw, (38, 328, 290, 378), GREEN_DARK, 4, radius=6)
    draw_label(draw, (780, 338), "主分支 (绿色)", font, GREEN_DARK)

    # Highlight "current" badge
    draw_rect(draw, (870, 328, 1060, 378), RED, 4, radius=6)
    draw_label(draw, (870, 388), "当前所在", font, RED)

    # Highlight orange dot + wt-1
    draw_rect(draw, (38, 435, 240, 488), ORANGE, 4, radius=6)
    draw_label(draw, (780, 445), "Worktree 分支 (橙色)", font, ORANGE)

    result = Image.alpha_composite(img, overlay).convert('RGB')
    result.save(DIR / 'shot-04-popover-closeup.png')
    print('  done shot-04-closeup')


# ─── shot-04-list: Full window with popover list ───
def annotate_shot_04_list():
    img = Image.open(BACKUP / 'shot-04-popover-list.png').convert('RGBA')
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = get_font(36)

    # Popover card: border at x:1073-1632, y:150-496 (rgb 209,209,214)
    popover_box = (1065, 142, 1642, 504)
    draw_rect(draw, popover_box, RED, 6, radius=12)

    # Highlight wt-1 row (orange dot at ~1104,446; row spans y:425-475)
    wt1_box = (1075, 425, 1630, 478)
    draw_rect(draw, wt1_box, BLUE, 5, radius=8)
    draw_label(draw, (780, 440), "新建的 wt-1", font, BLUE)
    draw_arrow(draw, (1020, 465), (1075, 455), BLUE, 5, 20)

    result = Image.alpha_composite(img, overlay).convert('RGB')
    result.save(DIR / 'shot-04-popover-list.png')
    print('  done shot-04-list')


# ─── shot-05: Badge header close-up ───
def annotate_shot_05():
    img = Image.open(BACKUP / 'shot-05-worktree-badge.png').convert('RGBA')
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = get_font(30)

    # Dimensions: 2504x156 (2x Retina capture of tile header)
    # Button clusters from pixel analysis:
    #   Branch icon: x:1943-1996, y:49-102
    #   Folder icon: x:2089-2146, y:53-101
    #   Maximize: x:2250-2289, y:56-95
    #   Close: x:2400-2427, y:62-89

    icon_box = (1930, 38, 2010, 114)
    draw_rect(draw, icon_box, RED, 5, radius=8)
    draw_label(draw, (1670, 48), "分支图标", font, RED)
    draw_arrow(draw, (1850, 73), (1930, 73), RED, 4, 18)

    result = Image.alpha_composite(img, overlay).convert('RGB')
    result.save(DIR / 'shot-05-worktree-badge.png')
    print('  done shot-05')


def main():
    if not BACKUP.exists():
        print("ERROR: No _backup/ directory. Run this after first annotation pass.")
        return

    print('Annotating from backups...')
    annotate_shot_01()
    annotate_shot_02()
    annotate_shot_03()
    annotate_shot_04_closeup()
    annotate_shot_04_list()
    annotate_shot_05()
    print('\nDone! Check docs/screenshots/worktree/')


if __name__ == '__main__':
    main()
