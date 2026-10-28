# Fonts bundled with `@postgear/design-engine`

52 families in 61 files. They are served to browsers (the editor, the
gallery and the share page load them through the API's public font route) and
inlined into every export a customer downloads, so only fonts whose licence
allows embedding and redistribution may ship here: the **SIL Open Font License
1.1** (48 families) and the **Apache License 2.0** (4). "Free for commercial
use" is not enough, which is why the Logo Lab's personal-use fonts are not in
this folder.

Every line below was read from the files themselves (fontTools: the name table
for the copyright and designer, `fvar` and `OS/2` for the weights), not copied
from a catalogue. `src/fonts/index.ts` holds the same data and
`src/fonts/fonts.test.ts` reads the files to keep the two in step.

## Where the files come from

- **Google subset** (40 families): Google Fonts' latin subset, byte for byte as
  Google serves it.
- **Upstream, full** (12 families): the designer's own release, converted to
  WOFF2 with every glyph kept. These are the families whose licence reserves a
  font name. A subset is a Modified Version under the OFL, and a Modified
  Version may not use a Reserved Font Name (condition 3; OFL-FAQ 2.2.1), so
  the whole file is the way to ship them under their own name.
- **DM Serif Display** is a Google subset whose licence does name a Reserved
  Font Name, and it is lawful: the name is Adobe's "Source", inherited from
  Source Serif, which DM Serif Display was built on, and the family's own name
  does not use it.

## Known gaps

- The rupee sign (U+20B9) is missing from every file except Lobster and
  Playfair Display: Google keeps it in the latin-ext subset, and most of the
  upstream families never drew it.
- Leckerli One and Oleo Script have no ellipsis (U+2026), and Italiana has no
  euro sign (U+20AC).
- A missing character falls back to the family's fallback stack in
  `src/fonts/index.ts`, then to the system's own fonts.

## The families

| Family | Files | Licence | Copyright (name ID 0) | Designer (name ID 9) | Reserved font names | Source |
|---|---|---|---|---|---|---|
| Allura | `allura-400.woff2` | OFL 1.1 | Copyright 2010 The Allura Project Authors (https://github.com/googlefonts/allura) |  | none | Google subset |
| Anton | `anton-400.woff2` | OFL 1.1 | Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git) |  | none | Google subset |
| Archivo Black | `archivo-black-400.woff2` | OFL 1.1 | Copyright 2017 The Archivo Black Project Authors (https://github.com/Omnibus-Type/ArchivoBlack) |  | none | Google subset |
| Bangers | `bangers-400.woff2` | OFL 1.1 | Copyright 2010 The Bangers Project Authors (https://github.com/googlefonts/bangers) |  | none | Google subset |
| Bebas Neue | `bebas-neue-400.woff2` | OFL 1.1 | Copyright 2019 The Bebas Neue Project Authors (https://github.com/dharmatype/Bebas-Neue) |  | none | Google subset |
| Bodoni Moda | `bodoni-moda-var.woff2` (400 to 900) | OFL 1.1 | Copyright 2020 The Bodoni Moda Project Authors (https://github.com/indestructible-type/Bodoni) |  | none | Google subset |
| Boogaloo | `boogaloo-400.woff2` | OFL 1.1 | Copyright (c) 2011, John Vargas Beltran (www.johnvargasbeltran.com\|john.vargasbeltran@gmail.com), with Reserved Font Name "Boogaloo". | John Vargas Beltran | Boogaloo | Upstream, full |
| Bricolage Grotesque | `bricolage-grotesque-var.woff2` (200 to 800) | OFL 1.1 | Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage) |  | none | Google subset |
| Bubblegum Sans | `bubblegum-sans-400.woff2` | OFL 1.1 | Copyright (c) 2011 Angel Koziupa (sudtipos@sudtipos.com), Copyright (c) 2011 Alejandro Paul (sudtipos@sudtipos.com), with Reserved Font Name "Bubblegum Sans" | Angel Koziupa and Alejandro Paul | Bubblegum Sans | Upstream, full |
| Chewy | `chewy-400.woff2` | Apache 2.0 | Copyright (c) 2010 by Font Diner, Inc DBA Sideshow. All rights reserved. |  | none | Google subset |
| Cinzel | `cinzel-var.woff2` (400 to 900) | OFL 1.1 | Copyright 2020 The Cinzel Project Authors (https://github.com/NDISCOVER/Cinzel) |  | none | Google subset |
| Comic Neue | `comic-neue-300.woff2`, `comic-neue-400.woff2`, `comic-neue-700.woff2` | OFL 1.1 | Copyright 2014 The Comic Neue Project Authors (https://github.com/crozynski/comicneue) |  | none | Google subset |
| Comic Relief | `comic-relief-400.woff2`, `comic-relief-700.woff2` | OFL 1.1 | Copyright 2013 The Comic Relief Project Authors (https://github.com/loudifier/Comic-Relief) |  | none | Google subset |
| Cormorant Garamond | `cormorant-garamond-var.woff2` (300 to 700) | OFL 1.1 | Copyright 2015 The Cormorant Project Authors (github.com/CatharsisFonts/Cormorant) |  | none | Google subset |
| Damion | `damion-400.woff2` | OFL 1.1 | Copyright 2014 The Damion Project Authors (https://github.com/googlefonts/damionFont) |  | none | Google subset |
| DM Sans | `dm-sans-var.woff2` (100 to 1000) | OFL 1.1 | Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts) |  | none | Google subset |
| DM Serif Display | `dm-serif-display-400.woff2` | OFL 1.1 | Copyright 2014 - 2017 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'. Copyright 2019 Google LLC. |  | Source | Google subset |
| Fraunces | `fraunces-var.woff2` (100 to 900) | OFL 1.1 | Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) |  | none | Google subset |
| Gluten | `gluten-var.woff2` (100 to 900) | OFL 1.1 | Copyright 2020 The Gluten Project Authors (https://github.com/Etcetera-Type-Co/Gluten) |  | none | Google subset |
| Grandstander | `grandstander-var.woff2` (100 to 900) | OFL 1.1 | Copyright 2020 The Grandstander Project Authors (https://github.com/Etcetera-Type-Co/Grandstander) |  | none | Google subset |
| Great Vibes | `great-vibes-400.woff2` | OFL 1.1 | Copyright 2010 The Great Vibes Pro Project Authors (https://github.com/googlefonts/great-vibes) |  | none | Google subset |
| Instrument Serif | `instrument-serif-400.woff2` | OFL 1.1 | Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif) |  | none | Google subset |
| Inter | `inter-var.woff2` (100 to 900) | OFL 1.1 | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) |  | none | Google subset |
| Italiana | `italiana-400.woff2` | OFL 1.1 | Copyright (c) 2011 by Santiago Orozco (hi@typemade.mx) with reserved name Italiana | Santiago Orozco | Italiana | Upstream, full |
| JetBrains Mono | `jetbrains-mono-var.woff2` (100 to 800) | OFL 1.1 | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) |  | none | Google subset |
| Kalam | `kalam-300.woff2`, `kalam-400.woff2`, `kalam-700.woff2` | OFL 1.1 | Copyright (c) 2014 Indian Type Foundry (info@indiantypefoundry.com) |  | none | Google subset |
| Kavoon | `kavoon-400.woff2` | OFL 1.1 | Copyright (c) 2011-2012, Sorkin Type Co (www.sorkintype.com) with Reserved Font Name 'Kavoon' | Viktoriya Grabowska | Kavoon | Upstream, full |
| Leckerli One | `leckerli-one-400.woff2` | OFL 1.1 | Copyright (c) 2011 Gesine Todt (www.gesine-todt.de), with Reserved Font Names "Leckerli" | Gesine Todt | Leckerli, Leckerli One | Upstream, full |
| Lobster | `lobster-400.woff2` | OFL 1.1 | Copyright 2010 The Lobster Project Authors (https://github.com/impallari/The-Lobster-Font), with Reserved Font Name "Lobster". | Impallari Type | Lobster | Upstream, full |
| Lora | `lora-var.woff2` (400 to 700) | OFL 1.1 | Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic), with Reserved Font Name "Lora". | Olga Karpushina, Alexei Vanyashin (Cyrillic) | Lora | Upstream, full |
| Luckiest Guy | `luckiest-guy-400.woff2` | Apache 2.0 | Copyright (c) 2010 by Brian J. Bonislawsky DBA Astigmatic (AOETI). All rights reserved. Available under the Apache 2.0 licence. http://www.apache.org/licenses/LICENSE-2.0.html |  | none | Google subset |
| Manrope | `manrope-var.woff2` (200 to 800) | OFL 1.1 | Copyright 2019 The Manrope Project Authors (https://github.com/googlefonts/manrope) |  | none | Google subset |
| Marcellus | `marcellus-400.woff2` | OFL 1.1 | Copyright (c) 2012 by Brian J. Bonislawsky DBA Astigmatic (AOETI) (astigma@astigmatic.com), with Reserved Font Name "Marcellus" | Astigmatic (AOETI) | Marcellus | Upstream, full |
| Margarine | `margarine-400.woff2` | OFL 1.1 | Copyright (c) 2012 by Brian J. Bonislawsky DBA Astigmatic (AOETI) (astigma@astigmatic.com), with Reserved Font Name "Margarine" | Astigmatic (AOETI) | Margarine | Upstream, full |
| Montserrat | `montserrat-var.woff2` (100 to 900) | OFL 1.1 | Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat) |  | none | Google subset |
| Oleo Script | `oleo-script-400.woff2`, `oleo-script-700.woff2` | OFL 1.1 | Copyright (c) 2012, Soytutype (contact@soytutype.com.ar\|soytutype@gmail.com), with reserved fontname 'Oleo' | Soytutype | Oleo Script, Oleo | Upstream, full |
| Oswald | `oswald-var.woff2` (200 to 700) | OFL 1.1 | Copyright 2016 The Oswald Project Authors (https://github.com/googlefonts/OswaldFont) |  | none | Google subset |
| Outfit | `outfit-var.woff2` (100 to 900) | OFL 1.1 | Copyright 2021 The Outfit Project Authors (https://github.com/Outfitio/Outfit-Fonts) |  | none | Google subset |
| Pacifico | `pacifico-400.woff2` | OFL 1.1 | Copyright 2018 The Pacifico Project Authors (https://github.com/googlefonts/Pacifico) |  | none | Google subset |
| Playfair Display | `playfair-display-var.woff2` (400 to 900) | OFL 1.1 | Copyright 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display), with Reserved Font Name "Playfair Display". | Claus Eggers Sørensen | Playfair Display | Upstream, full |
| Plus Jakarta Sans | `plus-jakarta-sans-var.woff2` (200 to 800) | OFL 1.1 | Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans) |  | none | Google subset |
| Poppins | `poppins-400.woff2`, `poppins-600.woff2`, `poppins-700.woff2` | OFL 1.1 | Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins) |  | none | Google subset |
| Rancho | `rancho-400.woff2` | Apache 2.0 | Copyright (c) 2011 by Font Diner, Inc. All rights reserved. |  | none | Google subset |
| Satisfy | `satisfy-400.woff2` | Apache 2.0 | Copyright (c) 2011 by Font Diner, Inc. All rights reserved. |  | none | Google subset |
| Shrikhand | `shrikhand-400.woff2` | OFL 1.1 | Copyright (c) 2015 Jonny Pinhorn (jonpinhorn.typedesign@gmail.com) |  | none | Google subset |
| Sniglet | `sniglet-400.woff2`, `sniglet-800.woff2` | OFL 1.1 | Copyright (c) 2008, Haley Fiege (haley@kingdomofawesome.com), Copyright (c) 2012, Brenda Gallo (gbrenda1987@gmail.com) Copyright (c) 2013, Pablo Impallari (www.impallari.com\|impallari@gmail.com), with no Reserved Font Name. |  | none | Google subset |
| Sora | `sora-var.woff2` (100 to 800) | OFL 1.1 | Copyright 2019 The Sora Project Authors (https://github.com/sora-xor/sora-font) |  | none | Google subset |
| Space Grotesk | `space-grotesk-var.woff2` (300 to 700) | OFL 1.1 | Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk) |  | none | Google subset |
| Sriracha | `sriracha-400.woff2` | OFL 1.1 | Copyright (c) 2015, Cadson Demak (info@cadsondemak.com), Copyright (c) 2014, Pablo Impallari (www.impallari.com\|impallari@gmail.com) |  | none | Google subset |
| Syne | `syne-var.woff2` (400 to 800) | OFL 1.1 | Copyright 2019 The Syne Project Authors (https://gitlab.com/bonjour-monde/fonderie/syne-typeface) |  | none | Google subset |
| Titan One | `titan-one-400.woff2` | OFL 1.1 | Copyright (c) 2011 Rodrigo Fuenzalida (hello@rfuenzalida.com), with Reserved Font Name "Titan One" | Rodrigo Fuenzalida | Titan, Titan One | Upstream, full |
| Unbounded | `unbounded-var.woff2` (200 to 900) | OFL 1.1 | Copyright 2022 The Unbounded Project Authors (https://github.com/googlefonts/unbounded) |  | none | Google subset |

Each family's licence text is in [`licenses/`](licenses), one file per family
id (`licenses/<id>.txt`), word for word as the family distributes it (only the
line endings were normalised). The OFL ones open with the family's own
copyright header; the Apache ones are the Apache License 2.0. Upstream's own
`OFL.txt` for Boogaloo carries two U+FFFD replacement characters in the
author's name, kept as they are; the font's name table spells it "Beltran".
[`OFL.txt`](OFL.txt) is the bare OFL 1.1 text, for reference.

## Adding or replacing a font

1. The licence must be OFL 1.1 or Apache 2.0. Read the family's own licence
   file for a Reserved Font Name.
2. No reserved name: take Google's latin subset as served, as `woff2`. A
   reserved name: take the upstream release and convert it to WOFF2 with every
   glyph kept.
3. Add the file, its row above, its licence as `licenses/<id>.txt`, the id to
   `FontId` in `src/types.ts`, and its def in `src/fonts/index.ts`, with the
   copyright line from the file's name table (ID 0) and the weights its `fvar`
   or `OS/2` table really has. `fonts.test.ts` reads the files and fails on any
   mismatch, and the export reads that table, so a font missing from it never
   reaches a slide.
