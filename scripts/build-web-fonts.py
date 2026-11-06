"""
Regenerates the studio's web fonts (assets/fonts/web/*.woff2) from the renderer's TTFs.

The video renderer uses the full TTFs in assets/fonts; browsers get small woff2 subsets with
matching unicode-range declarations in src/app/globals.css. Run this only when a font changes:

    python3 -m venv /tmp/fontvenv && /tmp/fontvenv/bin/pip install fonttools brotli
    /tmp/fontvenv/bin/python -I scripts/build-web-fonts.py

fonttools is a one-off build tool, not a project dependency.
"""

from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets" / "fonts"
OUT = FONTS / "web"


def r(a: int, b: int) -> list[int]:
    return list(range(a, b + 1))


def subset_to(src: Path, out: Path, unicodes: list[int]) -> None:
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.flavor = "woff2"
    font = subset.load_font(str(src), opts)
    s = subset.Subsetter(opts)
    s.populate(unicodes=unicodes)
    s.subset(font)
    subset.save_font(font, str(out), opts)
    print(f"{out.name}: {out.stat().st_size // 1024} KB")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # UI face: pin the width axis, keep weights 400-700.
    ui = instancer.instantiateVariableFont(TTFont(FONTS / "ui" / "InstrumentSans.ttf"), {"wdth": 100, "wght": (400, 700)})
    ui.flavor = "woff2"
    ui.save(OUT / "InstrumentSans.woff2")
    print(f"InstrumentSans.woff2: {(OUT / 'InstrumentSans.woff2').stat().st_size // 1024} KB")

    ascii_ = r(0x20, 0x7E)
    latin = ascii_ + r(0xA0, 0x24F) + [0x259] + r(0x1E00, 0x1EFF) + r(0x2000, 0x206F) + r(0x20A0, 0x20CF) + r(0x2100, 0x214F) + r(0x2190, 0x21FF) + [0x2212, 0x25CC]
    subset_to(FONTS / "NotoSans.ttf", OUT / "NotoSans-Latin.woff2", latin)
    subset_to(FONTS / "NotoSans.ttf", OUT / "NotoSans-Rupee.woff2", [0x20, 0x20B9])
    subset_to(FONTS / "NotoSans.ttf", OUT / "NotoSans-Separators.woff2", [0x20, 0xB7, 0x2022])
    subset_to(FONTS / "NotoSansMalayalam.ttf", OUT / "NotoSansMalayalam.woff2", ascii_ + r(0x0D00, 0x0D7F) + [0x200C, 0x200D, 0x25CC, 0x0964, 0x0965])
    subset_to(FONTS / "NotoSansDevanagari.ttf", OUT / "NotoSansDevanagari.woff2", ascii_ + r(0x0900, 0x097F) + r(0x1CD0, 0x1CFF) + r(0xA8E0, 0xA8FF) + [0x200C, 0x200D, 0x20B9, 0x25CC])


if __name__ == "__main__":
    main()
