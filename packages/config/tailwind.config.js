// DEPRECATED — superseded by `tailwind.css` in this same package.
//
// This file held a Tailwind v3-style `module.exports` config (theme.extend
// with all of Postiz's imported color/animation/shadow tokens). Since
// PostGear's apps install `tailwindcss@^4.0.0`, and v4 moves theme
// configuration into CSS (`@theme`, `@custom-variant`, `@plugin`) instead of
// a JS file, that content has been ported to `./tailwind.css` — see that
// file for the actual token mapping, and
// docs/design-patterns/design-tokens.md for what each token means.
//
// Left in place (empty) rather than deleted only because
// docs/sprint-documents/ and this package's package.json `files` array may
// still reference this filename during Sprint 1 — remove both references
// and this file together once `tailwind.css` is confirmed wired up.
module.exports = {};
