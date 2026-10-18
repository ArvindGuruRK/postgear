# Preset avatars

The 16 SVGs in this folder are the preset avatars offered on the onboarding
"Profile" step (and any later profile settings page). They are static files,
committed to the repository and served by Next at `/avatars/<id>.svg`. Nothing
generates or fetches an avatar at runtime.

## Licence

- **Artwork:** "Notionists" by Zoish (<https://heyzoish.gumroad.com/l/notionists>),
  released under **CC0 1.0** (public domain dedication,
  <https://creativecommons.org/publicdomain/zero/1.0/>). No attribution is
  required; commercial use and modification are permitted. Credited here anyway.
- **Assembly code:** DiceBear (`@dicebear/core`, `@dicebear/collection` 9.4.2) by
  Florian Körner, MIT licence. Only used at generation time (a devDependency).

Both statements come from `node_modules/@dicebear/notionists/LICENSE`, and each
SVG also carries them in its `<metadata>` block.

## Regenerating

```
node apps/web/scripts/generate-avatars.mjs
```

Seeds and background colours are fixed in that script, so the output is
reproducible. The ids are duplicated in `apps/web/src/lib/avatars.ts` (picker
registry with alt text) and `apps/api/src/modules/users/avatar.presets.ts` (the
API allowlist), so add or remove an avatar in all three places.

**Never remove or rename an id that has shipped:** users store the id, and a
missing file would show a broken image (the UI falls back to initials only when
the id is unknown to the registry).
