/**
 * The type set a design can use, and the one place that knows which file
 * serves which weight and under which licence.
 *
 * CLAUDE.md's "one font, Sora" rule is about the **app's chrome**. A design is
 * the user's own content and would look like a template library of one if
 * every slide were set in the product's UI face, so themes, a design's own
 * font choice, a single element and a brand kit all pick from these 52
 * families. The Studio around the canvas still uses the app's role utilities
 * only.
 *
 * ## What may ship
 *
 * Only SIL Open Font License and Apache 2.0 families. The files are served to
 * browsers and inlined into customers' exports, so a family needs embedding
 * and redistribution rights, not just "free for commercial use". Each def
 * carries what the Font Licences dialog and `fonts/LICENSES.md` show, read
 * from the file itself rather than from a catalogue (Sprint 9's hand-copied
 * lines had wrong years and one wrong holder): the copyright notice as the
 * file's name table states it, the names its licence reserves, and the
 * designer when the file names one.
 *
 * A family whose licence reserves a font name ships as the designer's own
 * release converted to WOFF2 with every glyph kept (`upstream-full`). A subset
 * is a Modified Version under the OFL, and a Modified Version may not carry a
 * Reserved Font Name (OFL-FAQ 2.2.1), so subsetting "Lobster" and still
 * calling it "Lobster" is exactly what the licence forbids. Everything else is
 * Google Fonts' latin subset as Google serves it.
 *
 * DM Serif Display is the one subset with a reserved name, and it is a lawful
 * one: the name is Adobe's "Source" (the family is built on Source Serif),
 * and the family's own name does not use it.
 *
 * ## Weights
 *
 * A variable file covers a range, so it is stored once and its `@font-face`
 * declares the range its `fvar` table really has; static cuts are separate
 * files at their own `usWeightClass`. `fonts.test.ts` reads both tables out
 * of the files, because a declaration that promises more than the file holds
 * fails silently: Sprint 9 declared 100 to 800 for Sora and JetBrains Mono
 * trims whose lightest weight was 400, and the browser drew 100 as 400
 * without a word.
 *
 * Nothing in this file reads a file: the package stays browser-safe. The API's
 * exporter resolves `file` against `packages/design-engine/fonts/` and inlines
 * the bytes; the web app serves the same folder through the API's public font
 * route. One copy of each file, two readers.
 */
import type { FontCategory, FontId } from '../types';

export interface FontFace {
  /** The file in `packages/design-engine/fonts/`. */
  file: string;
  /** A single weight, or the range a variable file covers. */
  weight: number | [number, number];
}

/** The only two licences a bundled family may carry (see `fonts/LICENSES.md`). */
export type FontLicence = 'OFL-1.1' | 'Apache-2.0';

/**
 * Where a file came from. `google-subset` is Google Fonts' latin subset,
 * unchanged; `upstream-full` is the designer's release with every glyph kept,
 * for a family whose licence reserves its name.
 */
export type FontSource = 'google-subset' | 'upstream-full';

export interface FontDef {
  id: FontId;
  /** What the font picker shows: the family's own name, in Title Case. */
  label: string;
  /** The CSS family name. Matches Google's, so a missing file falls back sanely. */
  family: string;
  category: FontCategory;
  licence: FontLicence;
  /**
   * The file's own copyright notice (name ID 0), word for word, with the line
   * breaks some files carry folded into spaces so it fits one table row.
   */
  copyright: string;
  /** Names the licence reserves (the OFL's "Reserved Font Name"), empty when none. */
  reservedNames: string[];
  source: FontSource;
  /** The designer the file names (name ID 9). Google's subsets drop the record. */
  designer?: string;
  /** What a web-safe stack should do if the file never arrives. */
  fallback: string;
  faces: FontFace[];
}

/*
 * A fallback only shows while a file loads, if it never arrives, or for a
 * character the file lacks (Google's latin subsets have no rupee sign), so it
 * aims for the same feel rather than the same face. The script and
 * handwritten stacks name the faces Windows (Segoe) and macOS (Snell
 * Roundhand, Bradley Hand) ship before the generic `cursive`, which is Comic
 * Sans on Windows.
 */
const SANS = 'ui-sans-serif, system-ui, sans-serif';
const SERIF = 'ui-serif, Georgia, serif';
const MONO = 'ui-monospace, SFMono-Regular, monospace';
const SCRIPT = '"Segoe Script", "Snell Roundhand", cursive';
const HANDWRITTEN = '"Segoe Print", "Bradley Hand", cursive';

export const FONTS: Record<FontId, FontDef> = {
  // Sprint 9
  sora: {
    id: 'sora',
    label: 'Sora',
    family: 'Sora',
    category: 'sans',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright 2019 The Sora Project Authors (https://github.com/sora-xor/sora-font)',
    fallback: SANS,
    faces: [{ file: 'sora-var.woff2', weight: [100, 800] }],
  },
  inter: {
    id: 'inter',
    label: 'Inter',
    family: 'Inter',
    category: 'sans',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)',
    fallback: SANS,
    faces: [{ file: 'inter-var.woff2', weight: [100, 900] }],
  },
  poppins: {
    id: 'poppins',
    label: 'Poppins',
    family: 'Poppins',
    category: 'sans',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright 2020 The Poppins Project Authors (https://github.com/itfoundry/Poppins)',
    fallback: SANS,
    faces: [
      { file: 'poppins-400.woff2', weight: 400 },
      { file: 'poppins-600.woff2', weight: 600 },
      { file: 'poppins-700.woff2', weight: 700 },
    ],
  },
  'space-grotesk': {
    id: 'space-grotesk',
    label: 'Space Grotesk',
    family: 'Space Grotesk',
    category: 'sans',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2020 The Space Grotesk Project Authors (https://github.com/floriankarsten/space-grotesk)',
    fallback: SANS,
    faces: [{ file: 'space-grotesk-var.woff2', weight: [300, 700] }],
  },
  'archivo-black': {
    id: 'archivo-black',
    label: 'Archivo Black',
    family: 'Archivo Black',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2017 The Archivo Black Project Authors (https://github.com/Omnibus-Type/ArchivoBlack)',
    fallback: SANS,
    faces: [{ file: 'archivo-black-400.woff2', weight: 400 }],
  },
  'dm-serif-display': {
    id: 'dm-serif-display',
    label: 'DM Serif Display',
    family: 'DM Serif Display',
    category: 'serif',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: ['Source'],
    copyright:
      "Copyright 2014 - 2017 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'. Copyright 2019 Google LLC.",
    fallback: SERIF,
    faces: [{ file: 'dm-serif-display-400.woff2', weight: 400 }],
  },
  'playfair-display': {
    id: 'playfair-display',
    label: 'Playfair Display',
    family: 'Playfair Display',
    category: 'serif',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Playfair Display'],
    copyright:
      'Copyright 2017 The Playfair Display Project Authors (https://github.com/clauseggers/Playfair-Display), with Reserved Font Name "Playfair Display".',
    designer: 'Claus Eggers Sørensen',
    fallback: SERIF,
    faces: [{ file: 'playfair-display-var.woff2', weight: [400, 900] }],
  },
  'jetbrains-mono': {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono',
    family: 'JetBrains Mono',
    category: 'mono',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)',
    fallback: MONO,
    faces: [{ file: 'jetbrains-mono-var.woff2', weight: [100, 800] }],
  },
  // The Logo Lab's Google families
  manrope: {
    id: 'manrope',
    label: 'Manrope',
    family: 'Manrope',
    category: 'sans',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2019 The Manrope Project Authors (https://github.com/googlefonts/manrope)',
    fallback: SANS,
    faces: [{ file: 'manrope-var.woff2', weight: [200, 800] }],
  },
  'dm-sans': {
    id: 'dm-sans',
    label: 'DM Sans',
    family: 'DM Sans',
    category: 'sans',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2014 The DM Sans Project Authors (https://github.com/googlefonts/dm-fonts)',
    fallback: SANS,
    faces: [{ file: 'dm-sans-var.woff2', weight: [100, 1000] }],
  },
  montserrat: {
    id: 'montserrat',
    label: 'Montserrat',
    family: 'Montserrat',
    category: 'sans',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat)',
    fallback: SANS,
    faces: [{ file: 'montserrat-var.woff2', weight: [100, 900] }],
  },
  outfit: {
    id: 'outfit',
    label: 'Outfit',
    family: 'Outfit',
    category: 'sans',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2021 The Outfit Project Authors (https://github.com/Outfitio/Outfit-Fonts)',
    fallback: SANS,
    faces: [{ file: 'outfit-var.woff2', weight: [100, 900] }],
  },
  'plus-jakarta-sans': {
    id: 'plus-jakarta-sans',
    label: 'Plus Jakarta Sans',
    family: 'Plus Jakarta Sans',
    category: 'sans',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2020 The Plus Jakarta Sans Project Authors (https://github.com/tokotype/PlusJakartaSans)',
    fallback: SANS,
    faces: [{ file: 'plus-jakarta-sans-var.woff2', weight: [200, 800] }],
  },
  grandstander: {
    id: 'grandstander',
    label: 'Grandstander',
    family: 'Grandstander',
    category: 'comic',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2020 The Grandstander Project Authors (https://github.com/Etcetera-Type-Co/Grandstander)',
    fallback: SANS,
    faces: [{ file: 'grandstander-var.woff2', weight: [100, 900] }],
  },
  'comic-relief': {
    id: 'comic-relief',
    label: 'Comic Relief',
    family: 'Comic Relief',
    category: 'comic',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2013 The Comic Relief Project Authors (https://github.com/loudifier/Comic-Relief)',
    fallback: SANS,
    faces: [
      { file: 'comic-relief-400.woff2', weight: 400 },
      { file: 'comic-relief-700.woff2', weight: 700 },
    ],
  },
  'comic-neue': {
    id: 'comic-neue',
    label: 'Comic Neue',
    family: 'Comic Neue',
    category: 'comic',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2014 The Comic Neue Project Authors (https://github.com/crozynski/comicneue)',
    fallback: SANS,
    faces: [
      { file: 'comic-neue-300.woff2', weight: 300 },
      { file: 'comic-neue-400.woff2', weight: 400 },
      { file: 'comic-neue-700.woff2', weight: 700 },
    ],
  },
  bangers: {
    id: 'bangers',
    label: 'Bangers',
    family: 'Bangers',
    category: 'comic',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2010 The Bangers Project Authors (https://github.com/googlefonts/bangers)',
    fallback: SANS,
    faces: [{ file: 'bangers-400.woff2', weight: 400 }],
  },
  gluten: {
    id: 'gluten',
    label: 'Gluten',
    family: 'Gluten',
    category: 'comic',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2020 The Gluten Project Authors (https://github.com/Etcetera-Type-Co/Gluten)',
    fallback: SANS,
    faces: [{ file: 'gluten-var.woff2', weight: [100, 900] }],
  },
  sniglet: {
    id: 'sniglet',
    label: 'Sniglet',
    family: 'Sniglet',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright (c) 2008, Haley Fiege (haley@kingdomofawesome.com), Copyright (c) 2012, Brenda Gallo (gbrenda1987@gmail.com) Copyright (c) 2013, Pablo Impallari (www.impallari.com|impallari@gmail.com), with no Reserved Font Name.',
    fallback: SANS,
    faces: [
      { file: 'sniglet-400.woff2', weight: 400 },
      { file: 'sniglet-800.woff2', weight: 800 },
    ],
  },
  'luckiest-guy': {
    id: 'luckiest-guy',
    label: 'Luckiest Guy',
    family: 'Luckiest Guy',
    category: 'comic',
    licence: 'Apache-2.0',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright (c) 2010 by Brian J. Bonislawsky DBA Astigmatic (AOETI). All rights reserved. Available under the Apache 2.0 licence. http://www.apache.org/licenses/LICENSE-2.0.html',
    fallback: SANS,
    faces: [{ file: 'luckiest-guy-400.woff2', weight: 400 }],
  },
  chewy: {
    id: 'chewy',
    label: 'Chewy',
    family: 'Chewy',
    category: 'comic',
    licence: 'Apache-2.0',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright (c) 2010 by Font Diner, Inc DBA Sideshow. All rights reserved.',
    fallback: SANS,
    faces: [{ file: 'chewy-400.woff2', weight: 400 }],
  },
  pacifico: {
    id: 'pacifico',
    label: 'Pacifico',
    family: 'Pacifico',
    category: 'script',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2018 The Pacifico Project Authors (https://github.com/googlefonts/Pacifico)',
    fallback: SCRIPT,
    faces: [{ file: 'pacifico-400.woff2', weight: 400 }],
  },
  shrikhand: {
    id: 'shrikhand',
    label: 'Shrikhand',
    family: 'Shrikhand',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright (c) 2015 Jonny Pinhorn (jonpinhorn.typedesign@gmail.com)',
    fallback: SANS,
    faces: [{ file: 'shrikhand-400.woff2', weight: 400 }],
  },
  sriracha: {
    id: 'sriracha',
    label: 'Sriracha',
    family: 'Sriracha',
    category: 'handwritten',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright (c) 2015, Cadson Demak (info@cadsondemak.com), Copyright (c) 2014, Pablo Impallari (www.impallari.com|impallari@gmail.com)',
    fallback: HANDWRITTEN,
    faces: [{ file: 'sriracha-400.woff2', weight: 400 }],
  },
  kalam: {
    id: 'kalam',
    label: 'Kalam',
    family: 'Kalam',
    category: 'handwritten',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright (c) 2014 Indian Type Foundry (info@indiantypefoundry.com)',
    fallback: HANDWRITTEN,
    faces: [
      { file: 'kalam-300.woff2', weight: 300 },
      { file: 'kalam-400.woff2', weight: 400 },
      { file: 'kalam-700.woff2', weight: 700 },
    ],
  },
  damion: {
    id: 'damion',
    label: 'Damion',
    family: 'Damion',
    category: 'script',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2014 The Damion Project Authors (https://github.com/googlefonts/damionFont)',
    fallback: SCRIPT,
    faces: [{ file: 'damion-400.woff2', weight: 400 }],
  },
  satisfy: {
    id: 'satisfy',
    label: 'Satisfy',
    family: 'Satisfy',
    category: 'script',
    licence: 'Apache-2.0',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright (c) 2011 by Font Diner, Inc. All rights reserved.',
    fallback: SCRIPT,
    faces: [{ file: 'satisfy-400.woff2', weight: 400 }],
  },
  rancho: {
    id: 'rancho',
    label: 'Rancho',
    family: 'Rancho',
    category: 'handwritten',
    licence: 'Apache-2.0',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright (c) 2011 by Font Diner, Inc. All rights reserved.',
    fallback: HANDWRITTEN,
    faces: [{ file: 'rancho-400.woff2', weight: 400 }],
  },
  'titan-one': {
    id: 'titan-one',
    label: 'Titan One',
    family: 'Titan One',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Titan', 'Titan One'],
    copyright:
      'Copyright (c) 2011 Rodrigo Fuenzalida (hello@rfuenzalida.com), with Reserved Font Name "Titan One"',
    designer: 'Rodrigo Fuenzalida',
    fallback: SANS,
    faces: [{ file: 'titan-one-400.woff2', weight: 400 }],
  },
  'bubblegum-sans': {
    id: 'bubblegum-sans',
    label: 'Bubblegum Sans',
    family: 'Bubblegum Sans',
    category: 'comic',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Bubblegum Sans'],
    copyright:
      'Copyright (c) 2011 Angel Koziupa (sudtipos@sudtipos.com), Copyright (c) 2011 Alejandro Paul (sudtipos@sudtipos.com), with Reserved Font Name "Bubblegum Sans"',
    designer: 'Angel Koziupa and Alejandro Paul',
    fallback: SANS,
    faces: [{ file: 'bubblegum-sans-400.woff2', weight: 400 }],
  },
  boogaloo: {
    id: 'boogaloo',
    label: 'Boogaloo',
    family: 'Boogaloo',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Boogaloo'],
    copyright:
      'Copyright (c) 2011, John Vargas Beltran (www.johnvargasbeltran.com|john.vargasbeltran@gmail.com), with Reserved Font Name "Boogaloo".',
    designer: 'John Vargas Beltran',
    fallback: SANS,
    faces: [{ file: 'boogaloo-400.woff2', weight: 400 }],
  },
  'leckerli-one': {
    id: 'leckerli-one',
    label: 'Leckerli One',
    family: 'Leckerli One',
    category: 'script',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Leckerli', 'Leckerli One'],
    copyright:
      'Copyright (c) 2011 Gesine Todt (www.gesine-todt.de), with Reserved Font Names "Leckerli"',
    designer: 'Gesine Todt',
    fallback: SCRIPT,
    faces: [{ file: 'leckerli-one-400.woff2', weight: 400 }],
  },
  kavoon: {
    id: 'kavoon',
    label: 'Kavoon',
    family: 'Kavoon',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Kavoon'],
    copyright:
      "Copyright (c) 2011-2012, Sorkin Type Co (www.sorkintype.com) with Reserved Font Name 'Kavoon'",
    designer: 'Viktoriya Grabowska',
    fallback: SANS,
    faces: [{ file: 'kavoon-400.woff2', weight: 400 }],
  },
  lobster: {
    id: 'lobster',
    label: 'Lobster',
    family: 'Lobster',
    category: 'script',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Lobster'],
    copyright:
      'Copyright 2010 The Lobster Project Authors (https://github.com/impallari/The-Lobster-Font), with Reserved Font Name "Lobster".',
    designer: 'Impallari Type',
    fallback: SCRIPT,
    faces: [{ file: 'lobster-400.woff2', weight: 400 }],
  },
  'oleo-script': {
    id: 'oleo-script',
    label: 'Oleo Script',
    family: 'Oleo Script',
    category: 'script',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Oleo Script', 'Oleo'],
    copyright:
      "Copyright (c) 2012, Soytutype (contact@soytutype.com.ar|soytutype@gmail.com), with reserved fontname 'Oleo'",
    designer: 'Soytutype',
    fallback: SCRIPT,
    faces: [
      { file: 'oleo-script-400.woff2', weight: 400 },
      { file: 'oleo-script-700.woff2', weight: 700 },
    ],
  },
  margarine: {
    id: 'margarine',
    label: 'Margarine',
    family: 'Margarine',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Margarine'],
    copyright:
      'Copyright (c) 2012 by Brian J. Bonislawsky DBA Astigmatic (AOETI) (astigma@astigmatic.com), with Reserved Font Name "Margarine"',
    designer: 'Astigmatic (AOETI)',
    fallback: SANS,
    faces: [{ file: 'margarine-400.woff2', weight: 400 }],
  },
  lora: {
    id: 'lora',
    label: 'Lora',
    family: 'Lora',
    category: 'serif',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Lora'],
    copyright:
      'Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic), with Reserved Font Name "Lora".',
    designer: 'Olga Karpushina, Alexei Vanyashin (Cyrillic)',
    fallback: SERIF,
    faces: [{ file: 'lora-var.woff2', weight: [400, 700] }],
  },
  // The luxury set
  'cormorant-garamond': {
    id: 'cormorant-garamond',
    label: 'Cormorant Garamond',
    family: 'Cormorant Garamond',
    category: 'serif',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright 2015 The Cormorant Project Authors (github.com/CatharsisFonts/Cormorant)',
    fallback: SERIF,
    faces: [{ file: 'cormorant-garamond-var.woff2', weight: [300, 700] }],
  },
  'bodoni-moda': {
    id: 'bodoni-moda',
    label: 'Bodoni Moda',
    family: 'Bodoni Moda',
    category: 'serif',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2020 The Bodoni Moda Project Authors (https://github.com/indestructible-type/Bodoni)',
    fallback: SERIF,
    faces: [{ file: 'bodoni-moda-var.woff2', weight: [400, 900] }],
  },
  cinzel: {
    id: 'cinzel',
    label: 'Cinzel',
    family: 'Cinzel',
    category: 'serif',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright 2020 The Cinzel Project Authors (https://github.com/NDISCOVER/Cinzel)',
    fallback: SERIF,
    faces: [{ file: 'cinzel-var.woff2', weight: [400, 900] }],
  },
  italiana: {
    id: 'italiana',
    label: 'Italiana',
    family: 'Italiana',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Italiana'],
    copyright: 'Copyright (c) 2011 by Santiago Orozco (hi@typemade.mx) with reserved name Italiana',
    designer: 'Santiago Orozco',
    fallback: SANS,
    faces: [{ file: 'italiana-400.woff2', weight: 400 }],
  },
  marcellus: {
    id: 'marcellus',
    label: 'Marcellus',
    family: 'Marcellus',
    category: 'serif',
    licence: 'OFL-1.1',
    source: 'upstream-full',
    reservedNames: ['Marcellus'],
    copyright:
      'Copyright (c) 2012 by Brian J. Bonislawsky DBA Astigmatic (AOETI) (astigma@astigmatic.com), with Reserved Font Name "Marcellus"',
    designer: 'Astigmatic (AOETI)',
    fallback: SERIF,
    faces: [{ file: 'marcellus-400.woff2', weight: 400 }],
  },
  fraunces: {
    id: 'fraunces',
    label: 'Fraunces',
    family: 'Fraunces',
    category: 'serif',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces)',
    fallback: SERIF,
    faces: [{ file: 'fraunces-var.woff2', weight: [100, 900] }],
  },
  'instrument-serif': {
    id: 'instrument-serif',
    label: 'Instrument Serif',
    family: 'Instrument Serif',
    category: 'serif',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif)',
    fallback: SERIF,
    faces: [{ file: 'instrument-serif-400.woff2', weight: 400 }],
  },
  syne: {
    id: 'syne',
    label: 'Syne',
    family: 'Syne',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2019 The Syne Project Authors (https://gitlab.com/bonjour-monde/fonderie/syne-typeface)',
    fallback: SANS,
    faces: [{ file: 'syne-var.woff2', weight: [400, 800] }],
  },
  unbounded: {
    id: 'unbounded',
    label: 'Unbounded',
    family: 'Unbounded',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2022 The Unbounded Project Authors (https://github.com/googlefonts/unbounded)',
    fallback: SANS,
    faces: [{ file: 'unbounded-var.woff2', weight: [200, 900] }],
  },
  'bricolage-grotesque': {
    id: 'bricolage-grotesque',
    label: 'Bricolage Grotesque',
    family: 'Bricolage Grotesque',
    category: 'sans',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2022 The Bricolage Grotesque Project Authors (https://github.com/ateliertriay/bricolage)',
    fallback: SANS,
    faces: [{ file: 'bricolage-grotesque-var.woff2', weight: [200, 800] }],
  },
  'bebas-neue': {
    id: 'bebas-neue',
    label: 'Bebas Neue',
    family: 'Bebas Neue',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2019 The Bebas Neue Project Authors (https://github.com/dharmatype/Bebas-Neue)',
    fallback: SANS,
    faces: [{ file: 'bebas-neue-400.woff2', weight: 400 }],
  },
  anton: {
    id: 'anton',
    label: 'Anton',
    family: 'Anton',
    category: 'display',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git)',
    fallback: SANS,
    faces: [{ file: 'anton-400.woff2', weight: 400 }],
  },
  oswald: {
    id: 'oswald',
    label: 'Oswald',
    family: 'Oswald',
    category: 'sans',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2016 The Oswald Project Authors (https://github.com/googlefonts/OswaldFont)',
    fallback: SANS,
    faces: [{ file: 'oswald-var.woff2', weight: [200, 700] }],
  },
  'great-vibes': {
    id: 'great-vibes',
    label: 'Great Vibes',
    family: 'Great Vibes',
    category: 'script',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright:
      'Copyright 2010 The Great Vibes Pro Project Authors (https://github.com/googlefonts/great-vibes)',
    fallback: SCRIPT,
    faces: [{ file: 'great-vibes-400.woff2', weight: 400 }],
  },
  allura: {
    id: 'allura',
    label: 'Allura',
    family: 'Allura',
    category: 'script',
    licence: 'OFL-1.1',
    source: 'google-subset',
    reservedNames: [],
    copyright: 'Copyright 2010 The Allura Project Authors (https://github.com/googlefonts/allura)',
    fallback: SCRIPT,
    faces: [{ file: 'allura-400.woff2', weight: 400 }],
  },
};

export const FONT_IDS = Object.keys(FONTS) as FontId[];

/** The font picker's groups, in the order it shows them. */
export const FONT_CATEGORIES: readonly FontCategory[] = [
  'sans',
  'serif',
  'display',
  'script',
  'handwritten',
  'comic',
  'mono',
];

export const FONT_CATEGORY_LABELS: Record<FontCategory, string> = {
  sans: 'Sans Serif',
  serif: 'Serif',
  display: 'Display',
  script: 'Script',
  handwritten: 'Handwritten',
  comic: 'Comic',
  mono: 'Monospace',
};

/** The licence names the Font Licences dialog shows. */
export const FONT_LICENCE_LABELS: Record<FontLicence, string> = {
  'OFL-1.1': 'SIL Open Font License 1.1',
  'Apache-2.0': 'Apache License 2.0',
};

/**
 * One category's families, alphabetical by label. A picker of 52 is scanned
 * by name, and the registry's own order (by the batch each family arrived in)
 * means nothing to the person choosing.
 */
export function fontsInCategory(category: FontCategory): FontDef[] {
  return FONT_IDS.map((id) => FONTS[id])
    .filter((font) => font.category === category)
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

/** The name a person sees for a family. */
export function fontLabel(id: FontId): string {
  return FONTS[id].label;
}

/** The CSS `font-family` value for a slot: the family, then its fallback. */
export function fontStack(id: FontId): string {
  const font = FONTS[id];
  return `"${font.family}", ${font.fallback}`;
}

/**
 * The weight a face declares. A variable file says `100 800`, which is what
 * lets one file answer every weight a theme asks for.
 */
export function faceWeight(face: FontFace): string {
  return Array.isArray(face.weight) ? `${face.weight[0]} ${face.weight[1]}` : String(face.weight);
}

/**
 * The weight a family can really draw. Most of the set has one or a few
 * static weights (Archivo Black, Bangers and Pacifico only one), and a theme
 * or a font swap that asks for 800 from them would otherwise get a browser's
 * synthetic bold, which is heavier in Chromium than in the editor's own
 * rendering on some platforms; snapping to what the files have keeps the two
 * identical. A variable family clamps into its range instead, since every
 * weight inside it is real.
 */
export function resolveWeight(id: FontId, requested: number): number {
  const faces = FONTS[id].faces;
  const variable = faces.find((face) => Array.isArray(face.weight));

  if (variable && Array.isArray(variable.weight)) {
    return Math.max(variable.weight[0], Math.min(variable.weight[1], requested));
  }

  const weights = faces.map((face) => face.weight as number);
  return weights.reduce((best, weight) =>
    Math.abs(weight - requested) < Math.abs(best - requested) ? weight : best,
  );
}

/** Every file a set of fonts needs, deduplicated. What the exporter inlines. */
export function filesFor(ids: Iterable<FontId>): string[] {
  const files = new Set<string>();

  for (const id of ids) {
    for (const face of FONTS[id].faces) files.add(face.file);
  }

  return [...files];
}
