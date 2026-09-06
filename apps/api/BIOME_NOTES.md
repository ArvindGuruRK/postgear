# Why `apps/api` overrides one Biome rule

[`biome.json`](./biome.json) extends the repo root config and turns **one**
rule off: `style/useImportType`.

That rule rewrites `import { ConfigService } from '@nestjs/config'` into
`import type { ConfigService } ...` whenever the identifier is only referenced
in type position — which, for a NestJS constructor, it always appears to be:

```ts
constructor(private readonly config: ConfigService) {}
```

The rewrite is correct for plain TypeScript and **wrong for NestJS**. Nest's
dependency injection reads constructor parameter types at runtime through the
`design:paramtypes` metadata that `emitDecoratorMetadata` writes. A `import
type` is erased entirely at compile time, so the emitted metadata records
`Object` instead of the class, and Nest fails at boot with:

```
Nest can't resolve dependencies of the AuthService (?, ...).
```

That failure is at startup rather than in a test, but it is triggered by a lint
autofix, which makes it exactly the kind of breakage that lands in a "tidy up
imports" commit and is hard to attribute.

The rule stays **on** everywhere else in the monorepo, where it is a genuine
improvement. `import type` is still used explicitly in this app for things that
really are type-only — `Request` from express, `Role` from `@postgear/db` — and
those are unaffected by the override.
