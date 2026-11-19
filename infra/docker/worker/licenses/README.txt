PostGear worker image: third-party notices
==========================================

This image is for PostGear's own servers. Keep it in a private registry and
never publish it: it contains GPL programs (FFmpeg built with x264 and other
GPL libraries). They run as separate programs; PostGear's code only starts
them with argument arrays and exchanges files with them, and never links to
them. Pushing this image to a public registry would be distributing those
programs, and the GPL's source offer would then apply.

What is in here, and where each notice is:

ffmpeg/
  FFmpeg 9.0.2 and ffprobe, the static "gpl" Linux x64 build from
  FFmpeg-Builds (formerly BtbN/FFmpeg-Builds, linked from ffmpeg.org), release
  autobuild-2026-10-31-12-59, file
  ffmpeg-n9.0.2-39-g7adfbe40dc-linux64-gpl-9.0.tar.xz. GPL version 3 (see
  LICENSE.txt from that archive). BUILD.txt is `ffmpeg -version` and
  `ffmpeg -buildconf` of the copy in this image, which names every library
  compiled in. Source: FFmpeg git commit 7adfbe40dc on the release/9.0
  branch (https://git.ffmpeg.org/ffmpeg.git) and the build scripts at
  https://github.com/FFmpeg-Builds/FFmpeg-Builds (tag autobuild-2026-10-31-12-59).

yt-dlp/
  yt-dlp 2026.10.26, the official standalone Linux executable (yt-dlp_linux).
  yt-dlp itself is under the Unlicense (LICENSE). The executable bundles
  Python and other components; their licences are in
  THIRD_PARTY_LICENSES.txt, from the same release tag.

deno/
  Deno 2.9.8 (x86_64-unknown-linux-gnu), MIT (LICENSE.md). yt-dlp uses it to
  solve YouTube's JavaScript challenges.

fonts/
  The fonts in /usr/share/postgear-fonts: the TTF twins of the Studio fonts
  (SIL Open Font License 1.1 or Apache License 2.0, listed font by font in
  LICENSES.md; renamed twins, so no Reserved Font Name is used), Noto Sans
  Tamil and Noto Sans Devanagari (OFL-Noto.txt), and the last-resort
  fallbacks Noto Sans and Noto Emoji (OFL-NotoSans.txt, OFL-NotoEmoji.txt,
  from github.com/google/fonts). No font with a personal-use-only licence is
  in this image.

Node.js and the npm packages under /app/node_modules keep their own licence
files inside each package folder.
