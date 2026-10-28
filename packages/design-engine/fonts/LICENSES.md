# Fonts bundled with `@postgear/design-engine`

Every file here is the **latin** `woff2` subset served by Google Fonts, saved
once and vendored so an export never touches the network (see
`src/render/export-html.ts`: the renderer inlines these bytes as `data:` URIs).

All eight families are licensed under the **SIL Open Font License, Version 1.1**
(<https://openfontlicense.org/>). The OFL allows bundling, embedding and
redistribution with the software; it forbids selling the fonts on their own and
requires that the copyright notices and the licence travel with the files:
the notices are in the table below, and the licence's full text is
[`OFL.txt`](OFL.txt) beside them. Nothing here may be renamed and
redistributed under a "Reserved Font Name".

| File | Family | Weights it serves | Copyright |
|---|---|---|---|
| `sora-var.woff2` | Sora | 100-800 (variable) | Copyright 2020 The Sora Project Authors |
| `inter-var.woff2` | Inter | 100-900 (variable) | Copyright 2020 The Inter Project Authors |
| `space-grotesk-var.woff2` | Space Grotesk | 300-700 (variable) | Copyright 2020 The Space Grotesk Project Authors |
| `playfair-display-var.woff2` | Playfair Display | 400-900 (variable) | Copyright 2017 The Playfair Display Project Authors |
| `jetbrains-mono-var.woff2` | JetBrains Mono | 100-800 (variable) | Copyright 2020 The JetBrains Mono Project Authors |
| `poppins-400.woff2` | Poppins | 400 | Copyright 2020 The Poppins Project Authors |
| `poppins-600.woff2` | Poppins | 600 | Copyright 2020 The Poppins Project Authors |
| `poppins-700.woff2` | Poppins | 700 | Copyright 2020 The Poppins Project Authors |
| `archivo-black-400.woff2` | Archivo Black | 400 | Copyright 2019 The Archivo Black Project Authors |
| `dm-serif-display-400.woff2` | DM Serif Display | 400 | Copyright 2019 The DM Serif Display Project Authors |

A variable family ships one file for every weight: Google serves the same
binary for each `wght` the CSS asks for, so storing three copies of it would
only make the exports slower. `src/fonts/index.ts` declares the weight range
each file covers.

## Replacing or adding a font

1. It must be OFL (or another licence that allows embedding and redistribution).
   Nothing else goes in this folder.
2. Take the latin subset only, as `woff2`.
3. Add the file, a row above with its copyright line (and the same line at the
   top of `OFL.txt`), and an entry in `src/fonts/index.ts`. The export reads
   that table, so a font missing from it simply never reaches a slide.
