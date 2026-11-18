"""The TTF twins of the Studio fonts, for the render's libass (Module 11).

Run by `npm run clips:fonts:build` (scripts/fonts-build.ts), never by hand.
It reads one JSON job file and writes one JSON result file:

  job:    [{"src": ".../montserrat-var.woff2", "out": ".../montserrat-800.ttf",
            "weight": 800, "instance": true, "assName": "PGF 3a9c1e 800",
            "psName": "PGF-3a9c1e-800"}, ...]
  result: [{"out": ..., "unitsPerEm": 1000, "winAscent": 1109,
            "winDescent": 453, "coverage": [[32, 126], ...]}, ...]

What it does to each file (fontTools, MIT):
- reads WOFF2, WOFF, TTF or OTF and writes plain TTF (OTF stays OTF);
- a variable font is instanced at the weight with every other axis at its
  default (libass draws only a variable font's default instance);
- the family, style, full and PostScript names become the twin's own
  (`assName`, `psName`), so libass can match it exactly and it never
  carries a Reserved Font Name; the copyright and licence records stay;
- the weight class is the twin's weight, and no bold or italic flag is set,
  so libass never fakes bold on top of a face that is already heavy.

Needs fontTools with WOFF2 support: `pip install "fonttools[woff]"`.
"""

import json
import sys

from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

NAME_IDS_DROPPED = (16, 17, 21, 22, 25)


def ranges(codepoints):
    out = []
    for cp in sorted(codepoints):
        if out and cp == out[-1][1] + 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


def twin(job):
    font = TTFont(job["src"])
    font.flavor = None
    if job.get("instance") and "fvar" in font:
        axes = {axis.axisTag: axis.defaultValue for axis in font["fvar"].axes}
        axes["wght"] = job["weight"]
        font = instancer.instantiateVariableFont(font, axes, updateFontNames=False)

    names = font["name"]
    for nid in NAME_IDS_DROPPED:
        names.removeNames(nameID=nid)
    for nid, value in (
        (1, job["assName"]),
        (2, "Regular"),
        (3, job["psName"]),
        (4, job["assName"]),
        (6, job["psName"]),
    ):
        names.setName(value, nid, 3, 1, 0x409)
        names.setName(value, nid, 1, 0, 0)

    os2 = font["OS/2"]
    os2.usWeightClass = job["weight"]
    # Regular only: clear ITALIC (bit 0) and BOLD (bit 5), set REGULAR (bit 6).
    os2.fsSelection = (os2.fsSelection & ~0b0100001) | 0b1000000
    font["head"].macStyle = 0

    cmap = font.getBestCmap() or {}
    font.save(job["out"])
    return {
        "out": job["out"],
        "unitsPerEm": font["head"].unitsPerEm,
        "winAscent": os2.usWinAscent,
        "winDescent": os2.usWinDescent,
        "coverage": ranges(cmap.keys()),
    }


def main():
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        jobs = json.load(handle)
    results = [twin(job) for job in jobs]
    with open(sys.argv[2], "w", encoding="utf-8") as handle:
        json.dump(results, handle)
    return 0


if __name__ == "__main__":
    sys.exit(main())
