/**
 * Test helpers for the canvas (Module 08): jsdom shims React Flow needs to
 * draw nodes, and small builders for graphs and run models. Only tests
 * import this file.
 */
import {
  type AutomationGraph,
  edgeId,
  GRAPH_SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  getDefinition,
  type PortId,
} from '@postgear/automation';
import type {
  AutomationRunStatus,
  AutomationStepStatus,
  RunDetail,
  RunStep,
} from '@/types/workflows';
import { buildRunModel, type RunModel } from '../runs/run-model';

/**
 * What React Flow reads from the DOM that jsdom does not have (after React
 * Flow's own testing guide): ResizeObserver, DOMMatrixReadOnly and element
 * sizes. Call once per test file, before rendering a canvas.
 */
export function installFlowDom(): void {
  class ResizeObserverShim {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      const box = target as HTMLElement;
      const width = box.offsetWidth ?? 1;
      const height = box.offsetHeight ?? 1;
      const size = [{ inlineSize: width, blockSize: height }];
      const entry = {
        target,
        contentRect: { x: 0, y: 0, top: 0, left: 0, width, height, right: width, bottom: height },
        borderBoxSize: size,
        contentBoxSize: size,
        devicePixelContentBoxSize: size,
      };
      this.callback([entry as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  class DOMMatrixShim {
    m22: number;
    constructor(transform?: string) {
      const scale = transform?.match(/scale\(([0-9.]+)\)/)?.[1];
      this.m22 = scale !== undefined ? Number(scale) : 1;
    }
  }
  const scope = globalThis as unknown as Record<string, unknown>;
  scope.ResizeObserver = ResizeObserverShim;
  scope.DOMMatrixReadOnly = DOMMatrixShim;
  // The flow's own box is a wide screen, so fitting the view keeps the zoom at
  // 100% and the cards show their full detail; anything else is its own size.
  const size = (box: HTMLElement, style: string, screen: number) =>
    box.classList.contains('react-flow__renderer') || box.classList.contains('react-flow')
      ? screen
      : Number.parseFloat(style) || 1;
  Object.defineProperties(HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return size(this, this.style.height, 1000);
      },
    },
    offsetWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return size(this, this.style.width, 2000);
      },
    },
  });
  (SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect;
  installMatchMedia();
}

/** jsdom has no matchMedia; the animated buttons ask it about reduced motion. */
export function installMatchMedia(): void {
  if (typeof window.matchMedia === 'function') return;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/** A step with its type's default config, named after its key unless told otherwise. */
export function step(
  key: string,
  type: string,
  overrides: Partial<Omit<GraphNode, 'key' | 'type'>> = {},
): GraphNode {
  const def = getDefinition(type);
  return {
    key,
    type,
    typeVersion: def?.typeVersion ?? 1,
    name: key,
    position: { x: 0, y: 0 },
    config: JSON.parse(JSON.stringify(def?.defaultConfig ?? {})) as Record<string, unknown>,
    ...overrides,
  };
}

export function line(source: string, target: string, sourcePort: PortId = 'out'): GraphEdge {
  return { id: edgeId(source, sourcePort, target), source, sourcePort, target, targetPort: 'in' };
}

export function graphOf(nodes: GraphNode[], edges: GraphEdge[] = []): AutomationGraph {
  return { schemaVersion: GRAPH_SCHEMA_VERSION, nodes, edges, notes: [] };
}

/** One step row as the API sends it. */
export function stepRow(
  nodeKey: string,
  status: AutomationStepStatus,
  overrides: Partial<RunStep> = {},
): RunStep {
  return {
    id: `step_${nodeKey}`,
    nodeKey,
    nodeType: 'logic.setFields',
    nodeName: nodeKey,
    status,
    attempt: 1,
    attempts: 1,
    input: null,
    output: null,
    truncated: false,
    error: null,
    ports: status === 'SUCCEEDED' || status === 'DRY_RUN' ? ['out'] : [],
    startedAt: '2026-10-29T14:02:00.000Z',
    finishedAt: null,
    durationMs: null,
    updatedAt: '2026-10-29T14:02:01.000Z',
    ...overrides,
  };
}

/** A run model from a run detail, the way the builder makes one. */
export function runOf(
  graph: AutomationGraph,
  steps: RunStep[],
  overrides: Partial<RunDetail> = {},
): RunModel {
  const status: AutomationRunStatus = overrides.status ?? 'RUNNING';
  return buildRunModel({
    id: 'run_1',
    automationId: 'auto_1',
    mode: 'TEST',
    status,
    triggerType: 'trigger.manual',
    options: null,
    startedById: null,
    stepCount: steps.length,
    creditsUsed: 0,
    error: null,
    startedAt: '2026-10-29T14:02:00.000Z',
    finishedAt: null,
    createdAt: '2026-10-29T14:02:00.000Z',
    version: null,
    triggerSummary: null,
    triggerPayload: null,
    graph,
    steps,
    ...overrides,
  });
}
