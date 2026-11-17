# Sprint 12 Research: Libraries

> **Written**: 2026-11-14, **revised 2026-11-17** for the FFmpeg-only render decision (Remotion is dropped). Versions, licences, release dates and module formats were read from the npm registry (`registry.npmjs.org/<pkg>`) and from GitHub releases on 2026-11-14. A fact marked **verified** was fetched or run that day; a fact marked **reported** comes from memory or a secondary source and is confirmed by the Module 02 binaries doctor or the Module 05 thin slice before it ships. Facts about FFmpeg's build and filters marked "verified 2026-11-17" were produced by running FFmpeg 9.0.2 on the development machine (`09-ffmpeg-render-cookbook.md`).
> **What must load where**: the worker and the API compile with `module: commonjs` and `moduleResolution: node` (`apps/worker/tsconfig.json`, `apps/api/tsconfig.json`) on Node 20.9 or newer (`package.json` engines), so anything they import must load with `require()`. The web app is Next.js 16.3.2 on React 19 (`apps/web/package.json`) and can take ESM-only packages.

## 1. The Short List

### 1.1 Render And Preview (FFmpeg Only)

There is no render library to install. The export is one FFmpeg command whose filter graph is written by our own compiler (`packages/video-engine/src/render/`, see `05-editor-and-render.md`). The pieces that matter are inside the FFmpeg program:

| Piece | Where it lives | Licence | What it does for us | Verdict and why |
|---|---|---|---|---|
| **FFmpeg 9.0.2** | Outside program (section 2) | LGPL 2.1 or later as source; GPL for a build that includes x264 | Cut, crop, scale, overlay, rotate, perspective, fades, looks, audio mix, loudness and the encode, in one process | **Pick.** Verified 2026-11-17: the `-/filter_complex <file>` form reads a graph from a file (the old `-filter_complex_script` option is gone in 9.0.2). |
| **libass** with HarfBuzz and FriBidi | Compiled into the FFmpeg build; `ffmpeg -buildconf` on the gyan.dev "full" build lists `--enable-libass --enable-libharfbuzz --enable-libfribidi --enable-libfreetype --enable-fontconfig` (verified 2026-11-17) | ISC for libass (reported); HarfBuzz MIT, FreeType FTL or GPLv2, FriBidi LGPL (reported) | Draws every title, text item and, in Sprint 13, caption from an `.ass` file through the `ass` filter. Hindi conjuncts and Tamil signs came out joined correctly with the default shaping and broken with `shaping=simple` (verified 2026-11-17) | **Pick.** One text pipeline. The font files it loads must be TrueType or OpenType: a `.woff2` file fails with "Error opening memory font" (verified 2026-11-17), so the 52 Studio fonts are converted to TTF at image build time (section 2.3). |
| **libx264** | Compiled into the build (`--enable-libx264`) | GPL 2 or later | The H.264 High encoder for every export and the proxy | **Pick.** Forces the GPL build (section 3). |
| **FFmpeg's own APNG, GIF and WebP decoders** | Inside FFmpeg: `apng`, `gif` and `webp_anim` (native animated WebP) decoders are all present (verified 2026-11-17) | LGPL | Sticker ingest: any of the three becomes an APNG with full alpha at a fixed frame rate | **Pick.** No image library is needed on the server. |

### 1.2 Editor And Upload Libraries

| Package | Version | Licence | Last release | Module format | Verdict and why |
|---|---|---|---|---|---|
| `@dnd-kit/core` | 6.3.1 | MIT | 2024-12-05 | CJS and ESM | **Pick** (already in `apps/web` at ^6.3.1, with `@dnd-kit/sortable` 10.0.0). Used for reordering tracks and dropping assets. Clip trim and move on the time axis is our own pointer code: dnd-kit has no notion of a time ruler or snapping to frames. |
| `react-moveable` | 0.56.0 | MIT | **2023-12-03** | CJS and ESM, 13 runtime deps, 4.6 MB unpacked | **Pick, optional.** Gives move, scale, rotate and snap guides in one component, which is what the preview's item handles need (the handles sit on a plain DOM layer over the `<video>`). But no npm release in almost three years and the repository was last pushed 2024-06-03 (api.github.com, verified 2026-11-14). See the open question in section 7. |
| `mediabunny` | 1.66.0 on npm (reported 2026-11-14) | MPL-2.0 | 2026-11-13 | ESM, with CJS bundles for Node and browser | **Pick, optional.** Reads duration, size, rotation, codec and frame rate from a `File` in the browser before upload (`Input`, `BlobSource`, `computeDuration()`, `getPrimaryVideoTrack()`, `canDecode()`: mediabunny.dev/guide/reading-media-files, verified 2026-11-14). Still useful for that one job, so a bad file is refused before 2 GB of upload. Not needed for playback or render: the preview uses the browser's own `<video>`. MPL-2.0 is file-level copyleft: fine as an unmodified dependency. |
| `wavesurfer.js` | 8.1.0 | BSD-3-Clause | 2026-11-12 | ESM with a CJS build, no deps | **Pick, optional.** Accepts pre-computed `peaks` and `duration` (wavesurfer.xyz/docs, verified 2026-11-14), good for the sound and music preview rows. **Not for the timeline**: there the waveform must follow segments, cuts and speed, so it is our own canvas drawing peaks made by FFmpeg (`05-editor-and-render.md`, section 9). |
| `@uppy/core` + `@uppy/aws-s3` | 6.3.1 + 6.3.1 | MIT | 2026-11-03 | ESM only | **Pick.** Headless (no Dashboard UI): our own drop box drives it. `@uppy/aws-s3` does S3 multipart for files over 100 MiB by default, resumes by listing parts, and works with MinIO and R2; the bucket CORS must expose `ETag` (uppy.io/docs/aws-s3, verified 2026-11-14). The API signs each request; bytes go straight to storage. |
| `@aws-sdk/client-s3` | 3.1169.0 | Apache-2.0 | 2026-11-13 | CJS and ESM, Node 20 or newer | **Pick** (already in `apps/api` at ^3.1131.0). Moves into the shared storage package so the worker can read and write. |
| `@aws-sdk/lib-storage` | 3.1169.0 | Apache-2.0 | 2026-11-13 | CJS and ESM; peer `@aws-sdk/client-s3` ^3.1169.0 | **Pick.** `Upload` streams a large file from the worker's disk to storage as multipart, without holding it in memory (reported; not re-read today). |
| `@aws-sdk/s3-request-presigner` | 3.1169.0 | Apache-2.0 | 2026-11-13 | CJS and ESM | **Pick.** Short-lived signed GET URLs for private clip files, and the signed part URLs the browser upload needs. Keep the three AWS packages on one version. |
| `@temporalio/worker` | as installed (^1.24.0) | MIT | not re-read today | CJS | **Pick** (already in the app). New queues only; the render runs inside an activity as a child process, never in workflow code. |
| `opentype.js` or `fontkit` | not read | MIT (both, reported) | not read | CJS and ESM | **Pick one at build time, for the compiler only.** Reads each font's `unitsPerEm`, `usWinAscent` and `usWinDescent` so the compiler can convert a CSS pixel size to an ASS font size (`09-ffmpeg-render-cookbook.md`, section 6). The numbers can also be generated into a table by a build script, which keeps the library out of the runtime. |

### 1.3 Stickers And GIFs

| Source | Licence | Verdict |
|---|---|---|
| Noto animated emoji (Google) | CC BY 4.0, attribution required (remotion.dev/docs/animated-emoji, verified 2026-11-14; the licence text itself is also on the Noto project page) | **Pick** for the own pack, stored as APNG in our storage (converted at ingest, `09-ffmpeg-render-cookbook.md`, section 5). Credit line goes in the app's licences page. The count and formats on offer were not read today (reported: Lottie, GIF and WebP per emoji). |
| Klipy API | Klipy terms (reported; `07-legal-limits-cost-and-risks.md` owns them) | **Rejected 2026-11-17** (its terms do not allow storing copies or commercial use, so a render could not rely on it). Replaced by the open-source catalogue in research 10. |

## 2. Outside Programs

These are not npm packages. The worker runs them as separate processes through the safe process runner (argument arrays, timeouts, output caps).

| Program | Version | Licence | What ships | Verdict |
|---|---|---|---|---|
| **yt-dlp** | 2026.10.26 (released 2026-10-26) | Unlicense | Standalone files per OS on the GitHub release: `yt-dlp.exe` (22 MB, Windows x64), `yt-dlp_linux` (39 MB, glibc), `yt-dlp_linux_aarch64`, `yt-dlp_musllinux`, `yt-dlp_macos`, plus `SHA2-256SUMS` and its signature. The 3 MB file named `yt-dlp` is the zip build and needs Python (api.github.com/repos/yt-dlp/yt-dlp/releases/latest, verified 2026-11-14). | **Pick.** Downloaded by a setup script, checksum verified, never committed. A minimum version plus `yt-dlp -U`, not a hard pin, because sites change weekly. |
| **yt-dlp-ejs** | 0.8.0 (2026-03-17) | Unlicense | The scripts that solve YouTube's JavaScript challenges. Already inside the official standalone binaries, so no extra step (github.com/yt-dlp/yt-dlp/wiki/EJS, verified 2026-11-14). | **Pick** (comes with the binary). |
| **Deno** | 2.9.8 (released 2026-10-21) | MIT | One zip per OS with a `.sha256sum` file: `deno-x86_64-pc-windows-msvc.zip` (41 MB), `deno-x86_64-unknown-linux-gnu.zip` (40 MB), `deno-aarch64-unknown-linux-gnu.zip` (api.github.com/repos/denoland/deno/releases/latest, verified 2026-11-14). | **Pick.** The JavaScript runtime yt-dlp needs for YouTube. |
| **FFmpeg and ffprobe** | 9.0.2 "Lei" (2026-09-18); 8.1.3 is the older maintained branch (ffmpeg.org/download.html, verified 2026-11-14) | LGPL 2.1 or later as source; GPL once built with GPL parts (ffmpeg.org/legal.html, verified 2026-11-14) | Source only: "FFmpeg only provides source code". Binaries come from third parties, section 2.2. | **Pick.** The renderer, the cutter, the prober and the analyser. |

### 2.1 The JavaScript Runtime yt-dlp Needs

"yt-dlp needs to solve JavaScript challenges presented by YouTube" and does so in an outside runtime (github.com/yt-dlp/yt-dlp/wiki/EJS, verified 2026-11-14):

| Runtime | Minimum | Status | Sandbox |
|---|---|---|---|
| Deno | 2.3.0 | Recommended, **enabled by default** | Runs with restricted permissions (no file or network access) |
| Node | 22.0.0 | `--js-runtimes node` | Some permissions restricted |
| QuickJS, QuickJS-NG | 2023-12-9; all NG versions | `--js-runtimes quickjs`; slow before QuickJS 2025-4-26 or NG 0.12.0 | Needs a temp file per run |
| Bun | 1.2.11 | Deprecated | No restrictions at all |

Deno is the pick: it is the default, it is the only one that sandboxes the downloaded script fully, and our Node floor is 20.9, below what yt-dlp accepts for Node. The path is passed explicitly: `--js-runtimes deno:<absolute path>`. Twitch and Kick do not need a runtime (reported); the doctor still requires Deno because YouTube is in scope. The wiki warns that yt-dlp may raise its minimum versions without notice, which is why the doctor checks a floor and prints the update command.

### 2.2 FFmpeg Builds And Their Licences

| Source | Platforms | Licence of the binary | Notes |
|---|---|---|---|
| **BtbN/FFmpeg-Builds** (linked from ffmpeg.org) | Windows x64 and arm64, Linux x64 and arm64 | `gpl`, `lgpl` and `nonfree` variants; static or shared | Built daily; release-branch builds for 9.0 and 8.1 next to master; Linux builds need glibc 2.28 or newer; the last 14 daily builds are kept, the last build of each month for two years (github.com/BtbN/FFmpeg-Builds README, verified 2026-11-14). A `checksums.sha256` file is on each release. The `gpl` variant is expected to carry libass, HarfBuzz, FriBidi, FreeType, fontconfig and x264 (reported: the gyan.dev build was verified, this one is re-checked with `ffmpeg -buildconf` in the Module 02 doctor). |
| **gyan.dev "full"** (linked from ffmpeg.org) | Windows x64 | GPLv3 | 9.0.2, dated 2026-09-19 (gyan.dev/ffmpeg/builds, verified 2026-11-14). **This is the build the cookbook was verified on** (2026-11-17): `--enable-gpl --enable-version3`, libx264, libass, libharfbuzz, libfribidi, libfreetype, fontconfig, libwebp, libzimg. The simplest choice for Windows development. The "essentials" build was not tested: check it has libass and libharfbuzz before using it. |
| **Debian `apt install ffmpeg`** | Debian in the worker image | GPL build (reported) | Trusted and patched by the distribution, but older: Debian 12 ships the 5.1 series (reported). Several filters used here (`-/filter_complex` file form, native animated WebP decoding, the `perspective` option set) were verified on 9.0.2 only. |

**The LGPL catch.** An LGPL build leaves out "libraries that are GPL-only. Most prominently libx264 and libx265" (BtbN README). An LGPL FFmpeg can still write H.264 through `libopenh264`, which is slower and has no `-crf` mode (reported). With the render now fully inside FFmpeg, x264's `-crf` and `-preset` are what the export leans on. Two facts keep the GPL build safe: (1) the GPL binds whoever **distributes** the binary, and PostGear only runs FFmpeg on its own servers as a separate program that exchanges files and arguments with our code; (2) the worker image stays in a **private** registry. If a worker image with a GPL FFmpeg inside is ever pushed to a **public** registry, that is distribution and the GPL source offer applies.

### 2.3 Fonts The Worker Needs

libass reads fonts from a folder passed as `fontsdir` (verified 2026-11-17). It reads TrueType and OpenType files (`.ttf`, `.otf`, `.ttc`) and **cannot read WOFF2**: both Studio files tried (`anton-400.woff2`, `bodoni-moda-var.woff2`) were refused with "Error opening memory font". So:

- The 52 Studio fonts (WOFF2 today in `packages/design-engine/fonts/`) need TTF or OTF twins in the worker image. Build step: decompress each WOFF2 with a font tool such as `fonttools` (`woff2` decompress, reported) or keep the source TTFs next to them. The licence file of every family goes with it (see the Studio fonts decision).
- Variable fonts (`-var.woff2`): libass picks one instance by name and weight; whether `Bold` works on a variable file is **not verified**. Prefer static instances for the weights we offer.
- Tamil and Devanagari need a real font with those scripts. Windows' Nirmala UI covered both on the test machine; the Linux image needs Noto Sans Tamil and Noto Sans Devanagari (reported: the Debian packages are `fonts-noto-core`, which covers both; confirm in the image).
- Colour emoji do not render in libass (section 7 of the cookbook): Segoe UI Emoji came out as plain outlines. An emoji font is useful only as a fallback for outline emoji; coloured emoji are placed as images.

## 3. The FFmpeg Licence In Practice

| Question | Answer |
|---|---|
| What licence does our binary have? | GPL (version 3 for gyan.dev, `--enable-gpl --enable-version3`), because it contains x264 (verified 2026-11-17). |
| What do we owe? | Nothing while the binary stays on our own servers: running a GPL program as a separate process is not distribution (reported; not legal advice). Keep the worker image private. If a binary is ever given to anyone, the source offer applies. |
| Is there a per-render fee? | No. The render licence cost that the Remotion design carried (a minimum of $100 a month once the team passed three people) is gone. |
| Codec patents | Not covered by any open-source licence: H.264 and AAC patent questions stay with us, as before. |
| Third-party notices | The in-app Credits page lists FFmpeg, x264, libass, HarfBuzz and FreeType with their licences. |

## 4. Editor Starter: Build Or Buy

The paid Remotion Editor Starter is no longer an option: it is a Remotion template and the Remotion player is not in the design. The decision stands as **build**, using the free references in `03-open-source-reference-repos.md`.

## 5. Rejected

| Package | Read today | Why not |
|---|---|---|
| `@uppy/tus` 6.0.1 + `@tus/server` 2.4.7 | MIT; `@tus/server` is ESM only and needs Node 20.19 or newer | The API is CommonJS on a 20.9 floor, so it cannot `require()` it. tus also puts a stateful upload endpoint on our API, where S3 multipart sends bytes straight to storage. **Later**, only if we ever need uploads through a proxy. |
| `execa` 10.2.1 | MIT, ESM only, Node 22 or newer | Cannot load in the worker. The safe process runner is `node:child_process` `spawn` with no shell, which is all we need. |
| `youtube-dl-exec` 3.1.19 | MIT | Downloads a binary in a postinstall script and hides the argument list. We want our own allowlisted arguments and the doctor. |
| `fluent-ffmpeg` 2.1.3 | Marked deprecated on npm: "Package no longer supported" | Unmaintained; builds command strings we would rather control. The compiler writes the graph file and the argument array itself. |
| `ffmpeg-static` 5.3.0, `@ffmpeg-installer/ffmpeg` 1.1.0 | GPL-3.0-or-later; LGPL-2.1, last release 2021-07-15 | Binary-in-npm wrappers with old or opaque builds and no ffprobe. We fetch a named build and verify its checksum. |
| `@ffmpeg/ffmpeg` 0.12.15 (WASM) | MIT wrapper, last release 2025-01-07 | Far too slow and memory-bound for hour-long sources; all heavy work is on the worker. |
| `peaks.js` 4.0.0 | LGPL-3.0 | Copyleft in the browser bundle, and it brings Konva. Our own canvas is smaller. |
| `@xzdarcy/react-timeline-editor` 1.0.0, `react-rnd` 10.5.3 | MIT | The first has its own engine and styling that fight ours (study it, do not ship it); the second has no rotation. |
| `@dnd-kit/react` 0.5.3 | MIT, released 2026-10-31 | The next generation of dnd-kit, still before 1.0. **Later**; the app is on `@dnd-kit/core` 6. |
| A Node wrapper around the ASS format (`ass-compiler`, `assjs`) | not read | We write ASS ourselves in `buildAss()`: it is a plain text format and the compiler needs full control of every tag. `assjs` (a browser ASS renderer) is a possible preview aid, but it is a second text engine and would not match libass exactly; the preview draws text with the DOM instead (`05-editor-and-render.md`, section 3). |

## 6. Rules That Follow From The Reads

1. **One FFmpeg build, checked at boot.** The doctor runs `ffmpeg -buildconf` and requires `--enable-libass`, `--enable-libharfbuzz`, `--enable-libx264` and `--enable-fontconfig`, and runs one tiny render (a still with text) to prove `-/filter_complex` and the `ass` filter work.
2. **Graph in a file, argument array, no shell.** `-/filter_complex <file>` (FFmpeg 9.0.2; the older `-filter_complex_script` is rejected as an unknown option).
3. **Fonts as TTF or OTF.** No WOFF2 in any `fontsdir`.
4. **The cookbook is the contract.** `09-ffmpeg-render-cookbook.md` records what was verified on 9.0.2. If the image installs a different build or version, the compiler tests (which render real frames) must pass again before shipping.
5. **Jest and the render.** The compiler is pure TypeScript under `packages/video-engine` and runs under ts-jest like every other engine package; the parity tests that call a real FFmpeg live next to it and skip with a clear message when `ffmpeg` is not on the PATH.
6. **Node versions.** The worker image follows `node:22-bookworm-slim`; the repo floor of 20.9 stays for the API.

## 7. Open Questions

1. **Settled 2026-11-17 (decision brief D2)**: FFmpeg only, GPL build, private registry. No question left.
2. **Open question for Arvind**: `react-moveable`, or our own handles? Recommendation: start Module 11 with a half-day spike of `react-moveable` on React 19 over the preview's DOM layer. If it holds, keep it for rotation and snap guides; if it misbehaves, write our own handles and add rotation ourselves. The library's age is the reason for the spike.
3. **Open question for Arvind**: Uppy, or a small uploader of our own? Recommendation: Uppy core with `@uppy/aws-s3`, headless. Resume, retries and part bookkeeping are the parts that go wrong when hand-written.
4. **Open question for Arvind**: BtbN `gpl` static build or the Debian package in the worker image? Recommendation: the BtbN 9.0 `gpl` build, checksum-verified, because every recipe in the cookbook was verified on 9.0.2. Module 02 runs the cookbook's smoke render against whichever is chosen.
