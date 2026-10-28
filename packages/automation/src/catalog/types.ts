/**
 * What every step type declares about itself. The catalog is data: the web
 * app reads it to draw the library, cards and panels, the API to validate
 * and describe, the worker to pick timeouts and retries. One declaration
 * per type, so the three never drift.
 */
import type { ZodType, ZodTypeDef } from 'zod';
import type { PortId } from '../graph/schema';

/** Every step type id. The UI says "step"; the code says "node". */
export const NODE_TYPES = [
  'trigger.postPublished',
  'trigger.postFailed',
  'trigger.schedule',
  'trigger.manual',
  'trigger.webhook',
  'postgear.createDraft',
  'postgear.addToQueue',
  'postgear.publish',
  'postgear.getPost',
  'ai.generateText',
  'ai.generateImage',
  'ai.generateHashtags',
  'ai.rewriteInBrandVoice',
  'ai.generateVideo',
  'studio.renderDesign',
  'logic.ifElse',
  'logic.switch',
  'logic.filter',
  'logic.delay',
  'logic.manualReview',
  'logic.setFields',
  'logic.merge',
  'notify.inApp',
  'notify.slack',
  'notify.teams',
  'notify.discord',
  'notify.email',
  'notify.whatsapp',
  'data.googleSheetsAppendRow',
  'data.excelAppendRow',
  'data.httpRequest',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/** Library groups. `social` holds the Publish To {Platform} cards. */
export type NodeCategory = 'trigger' | 'postgear' | 'social' | 'ai' | 'logic' | 'notify' | 'data';

/**
 * The card's stripe colour, as a role the web app maps to a design token:
 * triggers yellow (primary), PostGear ink, social the platform's colour,
 * AI violet, logic blue, notify green, data orange.
 */
export type ColourFamily = 'yellow' | 'ink' | 'platform' | 'violet' | 'blue' | 'green' | 'orange';

/**
 * Icon names the web app maps to components: brand logos for apps and
 * platforms, lucide icons for built-ins. A string key, so this package
 * stays free of React.
 */
export const ICON_KEYS = [
  'post-published',
  'post-failed',
  'schedule',
  'manual',
  'webhook',
  'draft',
  'queue',
  'publish',
  'post',
  'sparkles',
  'image',
  'hashtag',
  'wand',
  'video',
  'design',
  'if-else',
  'paths',
  'filter',
  'delay',
  'review',
  'set-fields',
  'merge',
  'bell',
  'slack',
  'teams',
  'discord',
  'email',
  'whatsapp',
  'google-sheets',
  'excel',
  'http',
  'instagram',
  'facebook',
  'x',
  'linkedin',
  'youtube',
  'tiktok',
  'pinterest',
] as const;

export type IconKey = (typeof ICON_KEYS)[number];

/** Outside apps a step can need a saved connection for (Connections page). */
export type ConnectionKind = 'slack' | 'teams' | 'discord' | 'google' | 'http';

export interface PortSpec {
  id: PortId;
  /** Title Case label shown next to a labelled port ("True", "Otherwise"). */
  label: string;
}

/** Field types of step data, the same words the condition builder uses. */
export type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'object' | 'media';

/**
 * One piece of data a step gives the steps after it. Drives Insert Data
 * and token validation. `path` is relative to the step's output
 * (`post.url`); nested fields list their parent as an `object` field too.
 */
export interface OutputField {
  path: string;
  /** Plain words: "Post Link", not `url`. */
  label: string;
  type: FieldType;
  /** For lists: the type of each item. */
  of?: FieldType;
  /** A realistic value for previews before any real run. */
  sample?: unknown;
}

/** A config field that must be filled before the step can run. */
export interface RequiredField<C> {
  /** Dotted config path, the same one a `node.required_missing` issue focuses. */
  path: string;
  /** Sentence case, plain words: "Write the message to send." */
  message: string;
  /** When given, the field is required only if this returns true. */
  when?(config: C): boolean;
}

/** Where a step keeps its connection id, and whether it can run without one. */
export interface ConnectionUse {
  kind: ConnectionKind;
  /** Config field that holds the connection id. */
  field: string;
  /** HTTP Request runs without its secret headers connection. */
  optional?: boolean;
}

/** What a step summary can look up: names for ids, never secrets. */
export interface SummaryContext {
  channels?: readonly { id: string; name: string; provider: string }[];
  connections?: readonly { id: string; name: string; kind: ConnectionKind }[];
}

export interface NodeDefinition<C extends object = Record<string, unknown>> {
  type: NodeType;
  /** Starts at 1; bumped when the config schema changes in a breaking way. */
  typeVersion: number;
  category: NodeCategory;
  /** Title Case: "Post Published". */
  title: string;
  /** Sentence case, one line. */
  description: string;
  /** Extra search words: "excel" finds Google Sheets too. */
  keywords: readonly string[];
  icon: IconKey;
  family: ColourFamily;
  /**
   * `ready` means the definition is complete. Whether the worker can run it
   * yet is `EXECUTABLE_TYPES`; Coming Soon steps are shown but never added.
   */
  status: 'ready' | 'comingSoon';
  /** Shown on Coming Soon cards: "WhatsApp is coming soon." */
  comingSoonReason?: string;
  priority: 'P0' | 'P1' | 'P2';
  /** Triggers take no input; every other step has one. */
  inputs: readonly [] | readonly ['in'];
  /**
   * Output ports. A function for steps whose ports come from their config
   * (Paths: one per case). It gets the raw config, so an unfinished config
   * still draws its ports. The `error` port of On Error is added by
   * `outputPortsOf`, not declared here.
   */
  outputs: readonly PortSpec[] | ((config: Record<string, unknown>) => PortSpec[]);
  /** Strict. Accepts `defaultConfig`; completeness is `required`. */
  configSchema: ZodType<C, ZodTypeDef, unknown>;
  /** A value for every field a template or the user does not set. */
  defaultConfig: C;
  /** Fields that must be filled before a test or activation. */
  required?: readonly RequiredField<C>[];
  /** The data the step outputs; a function when it depends on the config (Set Fields). */
  outputShape: readonly OutputField[] | ((config: Record<string, unknown>) => OutputField[]);
  /**
   * `internal` writes PostGear data (a draft, a notification, credits);
   * `external` leaves PostGear (Slack, Sheets, HTTP). External steps run
   * dry in tests.
   */
  sideEffect: 'none' | 'internal' | 'external';
  /** True when the step makes posts go out without a person: drives the activation tick. */
  publishes?: boolean;
  connection?: ConnectionUse;
  /**
   * Channel ids in `config.channels`: `act` steps post to them (each must be
   * connected), `filter` steps only match on them (a removed one is a warning).
   */
  channels?: 'act' | 'filter';
  /**
   * `none`: one attempt. `transient`: network, 429 and 5xx errors retry with
   * backoff. `safe`: transient retries, and the step is idempotent, so Retry
   * From Here may run it again.
   */
  retry: 'none' | 'transient' | 'safe';
  /** `fast`: 30 s. `slow`: 5 minutes with heartbeats (AI, Render Design). */
  timeoutClass: 'fast' | 'slow';
  /** AI steps: estimated credits per run. */
  credits?(config: C): number;
  /** The run workflow waits here instead of calling an activity. */
  blocking?: 'delay' | 'review';
  /** False for triggers, If / Else, Paths, Manual Review and Merge. */
  canDisable: boolean;
  /** False for triggers and Manual Review: they have no On Error setting. */
  canHandleErrors: boolean;
  /** A one-line summary of the config for the card: "Every Monday at 08:00". */
  summary(config: C, ctx: SummaryContext): string;
  /** The card title when it depends on the config: "Publish To Instagram". */
  titleFor?(config: C): string;
}

/** Declares a step type with its config type checked against its schema. */
export function defineNode<C extends object>(definition: NodeDefinition<C>): NodeDefinition<C> {
  return definition;
}
