/**
 * The two slots the engine drives but does not fill yet: text and stickers
 * above the picture (Modules 11 and 12) and sounds through Web Audio
 * (Module 14). Both are given the same frame state the areas were drawn
 * from, so whatever fills them later is in step with the picture by
 * construction.
 *
 * The empty versions here keep their host element and do nothing else, so
 * the engine's code path is the final one from the start.
 */
import type { AudioLayer, OverlayLayer } from './types';

/** An overlay layer with nothing on it yet. */
export class EmptyOverlayLayer implements OverlayLayer {
  private host: HTMLElement | null = null;

  mount(host: HTMLElement): void {
    this.host = host;
  }

  update(): void {
    // Modules 11 and 12 draw text and stickers here.
  }

  destroy(): void {
    this.host = null;
  }

  /** The element it was mounted into, for tests. */
  get mountedHost(): HTMLElement | null {
    return this.host;
  }
}

/** An audio layer with no sounds yet. */
export class SilentAudioLayer implements AudioLayer {
  update(): void {
    // Module 14 starts and re-aligns sounds here.
  }

  silence(): void {
    // Nothing is playing.
  }

  destroy(): void {
    // Nothing to release.
  }
}
