/**
 * The mascot on the auth screens' illustration panel: a phone character
 * holding up a scheduled post.
 *
 * Hand-authored SVG rather than lucide-react, which design-system-rules.md
 * §13 mandates "exclusively, no custom SVG set". That rule governs *icons*
 * (the interchangeable 16/20px glyphs that sit beside text), and this is a
 * single named illustration, the one thing lucide cannot supply. It is kept
 * to the same constraints that make the icon rule work, so it stays part of
 * the system rather than an exception to it:
 *
 * - No raw hex (§7). Every stroke is a token and every fill is a surface or
 *   action token, so the drawing re-colors with the theme for free. The five
 *   flat action fills stay put (§12).
 * - Chunky linework matching `strokeWidth={2.5}`-and-up icon weight (§13)
 *   and the border scale (§4): 6px on the body, 3-4px on details.
 * - `aria-hidden`, because the panel beside it already says in words what
 *   this says in pictures: announcing it twice is noise, not access.
 *
 * The four coloured cards on the phone's screen each carry a small real logo
 * of a launch platform (Instagram, Facebook, X, LinkedIn): the product's own
 * artwork in `public/icon/`, the same files `PlatformIcon` draws. The card
 * colour stays the loud part and the logo sits small on top of it. X swaps to
 * its white tile in dark mode, as it does everywhere else.
 *
 * Dark mode keeps the near-white linework on purpose. The owner tried soft
 * gray and dark outline alternatives, a mascot pinned to the light palette,
 * and #2a2a2a outlines on 2026-10-22, and went back to this.
 */
export function AuthIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 360"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Ground shadow: ink at low opacity, not a gray token, so it reads as
          a shadow of the figure in both themes. */}
      <ellipse cx="160" cy="338" rx="92" ry="12" className="fill-ink opacity-20" />

      {/* Sparkles and floaters, drawn first so the figure overlaps them. */}
      <g className="stroke-ink" strokeWidth="3">
        <path
          d="M44 66c0 14-6 20-20 20 14 0 20 6 20 20 0-14 6-20 20-20-14 0-20-6-20-20Z"
          className="fill-actionSecondary"
        />
        <path
          d="M292 214c0 11-5 16-16 16 11 0 16 5 16 16 0-11 5-16 16-16-11 0-16-5-16-16Z"
          className="fill-actionAccent"
        />
        <path
          d="M60 236c0 9-4 13-13 13 9 0 13 4 13 13 0-9 4-13 13-13-9 0-13-4-13-13Z"
          className="fill-actionSecondary"
        />
        <circle cx="272" cy="248" r="7" />
        <circle cx="36" cy="160" r="5" />
        <circle cx="246" cy="112" r="5" />
      </g>

      {/* Legs and shoes. Behind the body so the joints tuck under it. */}
      <g className="stroke-ink" strokeWidth="10">
        <path d="M138 250v58" />
        <path d="M186 250l12 56" />
      </g>
      <g className="stroke-ink" strokeWidth="4">
        <rect x="104" y="304" width="46" height="24" rx="12" className="fill-actionAccent" />
        <rect x="180" y="300" width="46" height="24" rx="12" className="fill-actionAccent" />
      </g>

      {/* Arms. The left one waves; the right one holds the post up. */}
      <g className="stroke-ink" strokeWidth="10">
        <path d="M98 150c-22 8-34 24-36 44" />
        <path d="M222 146c22-2 38-10 46-24" />
      </g>

      {/* Body: the phone. bg-secondary's token as a fill, so the chassis is
          the same white/near-black the form surfaces use. */}
      <g className="stroke-ink" strokeWidth="6">
        <rect x="96" y="56" width="128" height="200" rx="22" className="fill-secondary" />
        <rect x="221" y="98" width="9" height="30" rx="4" className="fill-actionSecondary" />
        <rect x="221" y="140" width="9" height="20" rx="4" className="fill-actionSecondary" />
      </g>

      {/* Screen and face. */}
      <rect x="110" y="70" width="100" height="172" rx="14" className="fill-actionPrimary" />
      <g className="stroke-ink" strokeWidth="4">
        <ellipse cx="140" cy="108" rx="15" ry="17" className="fill-secondary" />
        <ellipse cx="180" cy="108" rx="15" ry="17" className="fill-secondary" />
      </g>
      <g className="fill-ink">
        <circle cx="144" cy="112" r="6" />
        <circle cx="184" cy="112" r="6" />
      </g>
      <path d="M140 142c6 10 34 10 40 0" className="stroke-ink" strokeWidth="5" />

      {/* Channel tiles: the five action fills, one per square; the same
          palette the app uses for its own action surfaces. */}
      {/* Only these four outlines are #2a2a2a in dark mode (owner's pick,
          2026-10-22). The one raw hex in this file; it is the default dark
          theme's surface gray, written out so it stays this exact colour in
          every dark theme. */}
      <g className="stroke-ink dark:stroke-[#2a2a2a]" strokeWidth="3">
        <rect x="124" y="168" width="34" height="32" rx="8" className="fill-actionSecondary" />
        <rect x="164" y="168" width="34" height="32" rx="8" className="fill-actionAccent" />
        <rect x="124" y="206" width="34" height="32" rx="8" className="fill-actionSuccess" />
        <rect x="164" y="206" width="34" height="32" rx="8" className="fill-actionAi" />
      </g>

      {/* The real logos, small, centred on their tile: Instagram, Facebook /
          X, LinkedIn. Plain <image> elements: small static SVGs from /public.
          twitter.svg draws its tile 4 units in from each edge of a 64-unit
          canvas, so it is drawn 64/56 larger (and shifted back) to match the
          others; twitterlight.svg fills its canvas. */}
      <image href="/icon/instagram.svg" x="130" y="173" width="22" height="22" />
      <image href="/icon/facebookplatform.svg" x="170" y="173" width="22" height="22" />
      <image
        href="/icon/twitter.svg"
        x="128.43"
        y="209.43"
        width="25.14"
        height="25.14"
        className="dark:hidden"
      />
      <image
        href="/icon/twitterlight.svg"
        x="130"
        y="211"
        width="22"
        height="22"
        className="hidden dark:inline"
      />
      <image href="/icon/linkedin.svg" x="170" y="211" width="22" height="22" />

      {/* The scheduled post itself: a paper plane just let go of, clear of the
          hand below it so the two read as launch and launcher, not one shape. */}
      <g className="stroke-ink" strokeWidth="4">
        <path d="M270 74l42-20-16 42-9-14-17-8Z" className="fill-secondary" />
        <path d="M312 54l-25 26" />
        <path d="M266 96c2-6 4-10 8-13" strokeDasharray="3 7" />
      </g>

      {/* Waving hand and holding hand, drawn last so they cap the arms. */}
      <g className="stroke-ink" strokeWidth="4">
        <circle cx="60" cy="200" r="15" className="fill-secondary" />
        <circle cx="272" cy="114" r="15" className="fill-secondary" />
      </g>
    </svg>
  );
}
