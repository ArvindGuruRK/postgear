# `@postgear/media-contract`

The shapes that cross between the Node worker (`apps/worker`) and the Python media service (`apps/media`), written **once**, in Zod (`zod/v4`). JSON Schema is exported from them, the Python models are generated from that, and one set of fixture files is parsed on both sides, so the two languages cannot drift apart unnoticed.

## Rules

1. **One JSON object in, one JSON object out.** An activity takes one argument and answers one value, so a field can be added later without changing a signature.
2. **camelCase keys, JSON types only.** Strings, numbers, booleans, null, arrays and objects. No dates, no big integers, no bytes. Times are whole milliseconds of the video.
3. **Storage keys cross the boundary, never paths or addresses.** Each side resolves a key with its own storage code. The key pattern is `CLIP_KEY_PATTERN_SOURCE`, checked against `@postgear/storage` and the Python copy with the same example list.
4. **Every input carries `version`** (`MEDIA_CONTRACT_VERSION`), so a newer Node side can be told from an older Python side.
5. **No optional keys.** A value that may be absent is nullable and required. Python sends `null` for an absent value, and Zod's `.optional()` refuses `null`, so an optional key would fail on the wire. A test enforces it.
6. **Every object is strict.** An unknown key is a refusal on both sides.
7. **Speech text never rides in a payload.** Words live in stored files (`MEDIA_FILE_SHAPES`, such as the heard file) named by key, so they are never in Temporal's history or a log line.
8. **Errors have a type.** Python raises `ApplicationError(type=...)` with a type from `MEDIA_ERROR_TYPES`; the table says which ones a retry cannot fix.

## Adding Or Changing A Shape

```bash
# 1. Edit or add the Zod shape in src/shapes/, and its row in src/registry.ts.
# 2. Add fixtures: fixtures/<activity>/valid/*.json and invalid/*.json
#    (file names start with `input` or `output`); stored files go in fixtures/files/<Name>/.
npm run contract:export     # writes schema/contract.json
npm run contract:python     # regenerates apps/media/src/postgear_media/contract/generated.py
npm test --workspace=@postgear/media-contract
npm run test --workspace=@postgear/media
```

Both generated files are committed. A Jest test fails when `schema/contract.json` is stale and a pytest test fails when `generated.py` is.

## What Is Here

| Path | What |
|---|---|
| `src/names.ts` | Activity names, the contract version, error types. No dependency at all, so workflow code imports it (`@postgear/media-contract/names`) |
| `src/shapes/` | The Zod shapes, one file per activity, plus `common.ts` |
| `src/registry.ts` | The table of activities and stored files, the `MediaPyActivities` type, the JSON Schema builder |
| `schema/contract.json` | Generated. Do not edit |
| `fixtures/` | Example payloads and files parsed by Jest and by pytest; `keys/examples.json` for the storage key rules |
