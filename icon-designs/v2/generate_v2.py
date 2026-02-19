#!/usr/bin/env python3
"""Muxvo App Icon V2 - 10 方案 × 3 张 = 30 张"""

import os, time, configparser
from pathlib import Path
from google import genai

config = configparser.ConfigParser()
config.read(os.path.expanduser("~/.config/bxz-xhs/config.ini"))
client = genai.Client(api_key=config.get("gemini_nano", "api_key"))

OUT = Path(__file__).parent

PREFIX = "App icon design, macOS Big Sur style, 1024x1024, rounded square icon with smooth continuous curvature corners, single centered composition, sharp vector-quality rendering, dark theme, professional app icon, Dribbble quality, clean edges, suitable for small sizes. "

CONCEPTS = [
    ("01-the-router", PREFIX + "Deep navy background color #0a0e14. A single bold geometric mark centered on the icon: one thick luminous amber line (#e8a748) enters from the left side and cleanly splits into three evenly-spaced parallel horizontal lines that extend to the right, like a highway interchange viewed from above or a signal multiplexer diagram. The split point is a smooth rounded fork, not sharp angles. The three output lines have subtle graduated thickness — the middle line slightly thicker than the outer two. Very faint ambient glow around the amber lines creating a soft warm halo against the dark background. No text, no extra decorations. Extreme minimalism — just the forking line shape and negative space. The overall composition is horizontally centered and vertically centered, occupying about 55% of the icon area. Flat vector style with only the subtle glow as depth cue. Inspired by the clean confidence of Linear and Stripe brand marks."),

    ("02-convergence-point", PREFIX + "Deep navy background color #0a0e14. Three thin parallel diagonal lines in warm amber (#e8a748) entering from the upper-left area of the icon, angled at roughly 30 degrees, converging and merging into a single luminous point slightly below and right of center. The convergence point is a small solid amber circle (like a node or terminus) that glows with a soft radial warmth. The three input lines are evenly spaced, clean, and precise — like fiber optic strands merging into one output. From the convergence point, a single slightly thicker line continues briefly toward the lower-right, suggesting the unified output. The composition is intentionally asymmetric, placed slightly off-center for dynamic tension. Very subtle frosted glass effect on the background — barely visible, just enough to add depth. No text, no grid, no extra shapes. Pure geometric minimalism with maximum clarity."),

    ("03-amber-prism", PREFIX + "A polished 3D triangular prism made of translucent amber crystal (#e8a748) sitting upright on a deep navy (#0a0e14) surface, the prism refracts and splits a single beam of warm amber light entering from the left into three distinct parallel beams exiting the right side, each beam a slightly different warm tone representing multiple AI conversations being routed. The prism has realistic glass caustics, internal light scattering, and subtle volumetric glow. The surface of the prism shows fine beveled edges with bright specular highlights. Beneath the prism a soft amber reflection pools on the glossy navy floor. Cinematic rim lighting from behind creates a dramatic silhouette edge. Hyper-realistic 3D render, studio lighting, premium tactile material feel."),

    ("04-routing-cube", PREFIX + "A 3D metallic cube with rounded edges floating at a slight angle above a deep navy (#0a0e14) base, the cube is made of brushed dark gunmetal with a warm amber (#e8a748) glowing core visible through three precisely cut rectangular slots on the front face arranged vertically like terminal panes. The amber light spills outward from each slot casting volumetric god-rays and warm caustic patterns onto the surrounding surface. The top face of the cube has a subtle frosted glass inset panel with a faint grid texture suggesting a tiled terminal layout. Realistic anodized aluminum material with brushed metal texture, sharp specular highlights along the beveled edges. A soft ambient occlusion shadow grounds the floating cube. Dramatic three-point studio lighting. Hyper-realistic 3D render, cinematic depth of field, premium macOS icon aesthetic."),

    ("05-mv-ligature", PREFIX + "A bold custom ligature combining the letters M and V into one unified letterform, where the right leg of the M seamlessly flows into the left stroke of the V, creating a single continuous glyph. The ligature is rendered in warm amber #e8a748 with a subtle gradient from slightly lighter amber at the top to deeper gold at the bottom. The letterform uses geometric sans-serif proportions with confident stroke weight — thick, modern, and ownable. The strokes have clean flat terminations with no serifs or decorative elements. The background is a rich deep navy #0a0e14 with a very subtle radial gradient slightly lighter at the center. No outlines, no shadows, no embellishments — just the bold MV mark sitting perfectly centered. Think Airbnb logo level of simplicity and confidence."),

    ("06-bold-m-monogram", PREFIX + "A single bold uppercase letter M centered on the icon, constructed from three vertical bars connected by diagonal strokes at the top, in a clean geometric sans-serif style. The M is rendered in warm amber #e8a748 with a smooth vertical gradient transitioning from bright amber at the top to a slightly deeper warm gold at the base. The letter has generous proportions — wide and confident, filling about 55% of the icon width. The stroke weight is heavy and uniform throughout. The middle valley of the M dips only to about 60% depth, creating a distinctive shallow notch that makes it feel unique and custom-designed. The background is solid deep navy #0a0e14. A very faint warm amber glow emanates from directly behind the letter. No borders, no decorations, no additional elements — purely the bold M letterform. Inspired by the confidence of the Figma F and the simplicity of the Bear app icon."),

    ("07-prismatic-split", PREFIX + "A luminous triangular prism viewed at a three-quarter angle, centered on a deep navy #0a0e14 background. A single bright beam of warm amber #e8a748 light enters the prism from the upper left. The prism itself is rendered in translucent frosted glass with subtle navy-blue tints and soft inner reflections. On the right side of the prism, the single beam refracts and splits into exactly three distinct parallel rays fanning outward — each ray a slightly different warm tone graduating from bright amber to soft gold to pale honey, representing three multiplexed AI channels. The rays extend cleanly toward the lower right with crisp edges and gentle volumetric glow. The prism has minimal geometric facets with smooth beveled edges. A faint warm radial glow surrounds the point where light enters. No text, no extra decorations. Scientific elegance meets terminal precision."),

    ("08-orbital-nexus", PREFIX + "Against a deep navy #0a0e14 background, a central luminous nexus point rendered as a small intensely bright amber #e8a748 sphere with a soft volumetric glow halo. From this central nexus, exactly three elegant orbital paths arc outward in different directions — one curving up-left, one curving right, one curving down-left — each rendered as smooth thin amber-gold lines with subtle gradient trails that fade from bright amber near the center to transparent at their outer extent. At the end of each orbital path sits a small glowing node, each slightly different in size. The orbital paths have a gentle three-dimensional perspective tilt. Between the central nexus and each node, faint pulsing dash patterns suggest active data flow. The entire orbital system is contained within a very thin barely-visible frosted glass ring. The central sphere emits a warm radial gradient. The overall impression is of a command center routing hub. No text."),

    ("09-quantum-core", PREFIX + "A deep navy #0a0e14 background with an ultra-subtle radial gradient brightening slightly at center. At the exact center floats a brilliant glowing amber #e8a748 energy sphere, luminous and plasma-like with a hot white core fading to warm amber at its edges, casting a soft volumetric amber glow. Encircling the sphere are three concentric tilted orbital rings rendered in thin brushed metallic gunmetal with amber edge-lighting, each ring on a different axis like a gyroscope or atomic model. The rings have subtle translucency where they overlap. From the central sphere, five ultra-thin luminous amber energy filaments extend outward in different directions, terminating at tiny glowing nodes near the icon edges. A faint holographic grid of tiny dots in the deep background. The overall feel is a quantum computing reactor core — powerful, precise, and alive with energy. No text."),

    ("10-rift-gateway", PREFIX + "A deep navy #0a0e14 background. At the center, a vertical elongated hexagonal portal frame rendered in sleek dark chrome metal with beveled edges catching amber highlights. The portal frame has fine geometric etching that glow faintly amber #e8a748. Inside the portal opening, a mesmerizing depth effect: four translucent parallel planes recede into the portal at slight angles, each plane a different shade from warm amber to deep gold, creating a layered dimensional tunnel effect. The planes have faint grid-line patterns like holographic data interfaces. The portal edges emit controlled elegant plasma tendrils that curl slightly outward. At the deepest point, a single bright amber point of light serves as the vanishing focal point. Two thin parallel lines of amber light extend from top and bottom of the portal frame. Sleek, cinematic, futuristic. No text."),
]


def gen(concept_name, prompt, num=3):
    print(f"\n{'='*50}\n{concept_name}\n{'='*50}")
    ok = 0
    for i in range(1, num + 1):
        out = OUT / f"{concept_name}-v{i}.png"
        if out.exists():
            print(f"  v{i}: skip (exists)")
            ok += 1
            continue
        print(f"  v{i}...", end=" ", flush=True)
        try:
            r = client.models.generate_images(
                model="imagen-4.0-fast-generate-001",
                prompt=prompt,
                config={"number_of_images": 1, "aspect_ratio": "1:1"},
            )
            if r.generated_images:
                with open(out, "wb") as f:
                    f.write(r.generated_images[0].image.image_bytes)
                print(f"OK")
                ok += 1
            else:
                print("FAIL (no image)")
        except Exception as e:
            print(f"FAIL ({e})")
        time.sleep(2)
    return ok


total = 0
for name, prompt in CONCEPTS:
    total += gen(name, prompt)

print(f"\n{'='*50}")
print(f"完成: {total}/{len(CONCEPTS)*3} 张")
print(f"输出: {OUT}")
