/**
 * `@postgear/media-contract`: the one place the shapes that cross between the
 * Node worker and the Python media service are written.
 *
 * Rules (also in the README):
 * - One JSON object in, one JSON object out; camelCase keys; JSON types only.
 * - Storage keys cross the boundary, never paths or addresses.
 * - Every input carries `version` (`MEDIA_CONTRACT_VERSION`).
 * - Python models are generated from `schema/contract.json`; never edited.
 *
 * Pure: imports nothing but `zod/v4`.
 */
export * from './names';
export * from './registry';
export * from './shapes/common';
export * from './shapes/faces';
export * from './shapes/health';
export * from './shapes/transcribe';
export * from './shapes/visual';
