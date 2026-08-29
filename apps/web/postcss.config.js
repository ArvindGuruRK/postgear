/**
 * Tailwind v4 PostCSS setup. v3 used the `tailwindcss` package directly as
 * a PostCSS plugin (plus `autoprefixer` for vendor prefixing); v4 replaces
 * both with the single `@tailwindcss/postcss` package, which handles
 * prefixing internally — that's why autoprefixer was removed from
 * package.json rather than kept alongside this.
 */
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
