/**
 * Every Python activity with its input and output shape, in one table.
 *
 * `buildContractSchema()` turns the table into one JSON Schema document
 * (`schema/contract.json`): each shape and each shared piece under `$defs`,
 * so the Python generator makes one class per shape with a stable name.
 * `npm run contract:export` writes it; a Jest test fails when the file on
 * disk is not what the shapes produce today.
 */
import { z } from 'zod/v4';
import { MEDIA_CONTRACT_VERSION, MEDIA_PY_ACTIVITY_NAMES } from './names';
import { faceTracksFile, mediaPyDetectFacesInput, mediaPyDetectFacesOutput } from './shapes/faces';
import { mediaPyHealthInput, mediaPyHealthOutput } from './shapes/health';
import { heardFile, mediaPyTranscribeInput, mediaPyTranscribeOutput } from './shapes/transcribe';
import {
  mediaPyMotionInput,
  mediaPyMotionOutput,
  mediaPyStillsInput,
  mediaPyStillsOutput,
  motionFile,
} from './shapes/visual';

export interface ActivityShapes {
  input: z.ZodType;
  output: z.ZodType;
}

/**
 * The activities, keyed by their Temporal type. A module adds its row here
 * along with its shapes, fixtures and the generated Python.
 */
export const MEDIA_PY_CONTRACT = {
  [MEDIA_PY_ACTIVITY_NAMES.health]: { input: mediaPyHealthInput, output: mediaPyHealthOutput },
  [MEDIA_PY_ACTIVITY_NAMES.transcribe]: {
    input: mediaPyTranscribeInput,
    output: mediaPyTranscribeOutput,
  },
  [MEDIA_PY_ACTIVITY_NAMES.detectFaces]: {
    input: mediaPyDetectFacesInput,
    output: mediaPyDetectFacesOutput,
  },
  [MEDIA_PY_ACTIVITY_NAMES.motion]: { input: mediaPyMotionInput, output: mediaPyMotionOutput },
  [MEDIA_PY_ACTIVITY_NAMES.stills]: { input: mediaPyStillsInput, output: mediaPyStillsOutput },
} as const satisfies Record<string, ActivityShapes>;

/**
 * Stored files both sides read and write (never an activity payload: they are
 * too big for one, and speech text must stay out of Temporal's history).
 * Keyed by the shape's name; fixtures live in `fixtures/files/<name>/`.
 */
export const MEDIA_FILE_SHAPES = {
  HeardFile: heardFile,
  MotionFile: motionFile,
  FaceTracksFile: faceTracksFile,
} as const satisfies Record<string, z.ZodType>;

export type MediaFileName = keyof typeof MEDIA_FILE_SHAPES;

export type MediaPyContract = typeof MEDIA_PY_CONTRACT;
export type ContractActivityName = keyof MediaPyContract;

/**
 * The activities as one TypeScript interface, for `proxyActivities` in a
 * workflow. A type only: no Node worker registers these names.
 */
export type MediaPyActivities = {
  [K in ContractActivityName]: (
    input: z.input<MediaPyContract[K]['input']>,
  ) => Promise<z.output<MediaPyContract[K]['output']>>;
};

type JsonObject = { [key: string]: JsonValue };
type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Zod's own `id` key is noise in the file; the name is the `$defs` key. */
function withoutId(schema: JsonObject): JsonObject {
  const { id: _id, $schema: _schema, ...rest } = schema;
  return rest;
}

/** Sorts object keys so the file is the same on every machine. */
function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  const out: JsonObject = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key] as JsonValue);
  return out;
}

/** The shape's name: its `meta({ id })`, which every top-level shape has. */
function shapeName(schema: z.ZodType): string {
  const meta = z.globalRegistry.get(schema) as { id?: string } | undefined;
  if (!meta?.id) throw new Error('Every contract shape needs a meta id');
  return meta.id;
}

/** One JSON Schema document holding every shape under `$defs`. */
export function buildContractSchema(): JsonObject {
  const defs: JsonObject = {};
  const properties: JsonObject = {};

  const add = (name: string, schema: JsonObject) => {
    const existing = defs[name];
    const clean = withoutId(schema);
    if (existing && JSON.stringify(sortKeys(existing)) !== JSON.stringify(sortKeys(clean))) {
      throw new Error(`Two different shapes are both called ${name}`);
    }
    defs[name] = clean;
  };

  for (const [activity, shapes] of Object.entries(MEDIA_PY_CONTRACT) as Array<
    [string, ActivityShapes]
  >) {
    for (const [side, schema] of [
      ['input', shapes.input],
      ['output', shapes.output],
    ] as const) {
      const name = shapeName(schema);
      const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: side }) as JsonObject;
      const nested = isObject(json.$defs) ? json.$defs : {};
      const { $defs: _defs, ...root } = json;
      for (const [key, value] of Object.entries(nested)) {
        if (isObject(value)) add(key, value);
      }
      add(name, root);
      properties[`${activity}_${side}`] = { $ref: `#/$defs/${name}` };
    }
  }

  for (const [fileName, schema] of Object.entries(MEDIA_FILE_SHAPES) as Array<
    [string, z.ZodType]
  >) {
    const name = shapeName(schema);
    if (name !== fileName)
      throw new Error(`The file shape ${fileName} must carry its name as its id`);
    const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' }) as JsonObject;
    const nested = isObject(json.$defs) ? json.$defs : {};
    const { $defs: _defs, ...root } = json;
    for (const [key, value] of Object.entries(nested)) {
      if (isObject(value)) add(key, value);
    }
    add(name, root);
    properties[`file_${name}`] = { $ref: `#/$defs/${name}` };
  }

  return sortKeys({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://postgear.local/media-contract.json',
    title: 'MediaContract',
    description: `Generated from packages/media-contract. Contract version ${MEDIA_CONTRACT_VERSION}. Do not edit.`,
    type: 'object',
    properties,
    $defs: defs,
  }) as JsonObject;
}

/** The file's text, exactly as `contract:export` writes it. */
export function contractSchemaText(): string {
  return `${JSON.stringify(buildContractSchema(), null, 2)}\n`;
}
