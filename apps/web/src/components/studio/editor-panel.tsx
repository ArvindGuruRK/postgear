'use client';

/**
 * The editor's properties panel (Sprint 9, Screen 4): three tabs beside the
 * canvas, and the same panel inside a drawer below the lg breakpoint
 * (`bare`, where the drawer brings its own surface and title).
 *
 * - Element: the element selected on the canvas (`ElementPanel`).
 * - Slide: the slide's layout, background and optional elements (`SlidePanel`).
 * - Design: theme, brand kit, brand name and handle, format (`DesignPanel`).
 *
 * The panel keeps no copy of the design. It draws the document it is given
 * and hands every edit to the editor as a function of the latest document
 * (`ApplyChange`), so the canvas, the rail and the panel never disagree and
 * every edit can be undone. Only the open tab is drawn, and each scrolls on
 * its own, with room at its edges for focus rings and the chosen ring.
 */
import type { DesignDocument, SlotId } from '@postgear/design-engine';
import { cn, Tabs, TabsContent, TabsList, TabsTrigger } from '@postgear/ui';
import type { BrandKitView, StudioMediaRef } from '@/types/studio';
import type { ApplyChange } from './editor-state';
import { DesignPanel } from './panel-design';
import { ElementPanel } from './panel-element';
import { SlidePanel } from './panel-slide';
import { PanelSurface } from './panel-ui';
import { StudioPanel } from './studio-ui';

export type PanelTab = 'element' | 'slide' | 'design';

export type MediaPurpose =
  | { kind: 'image'; slideId: string; slot: SlotId }
  | { kind: 'logo'; slideId: string }
  | { kind: 'background'; slideId: string };

export interface EditorPanelProps {
  document: DesignDocument;
  /** The slide on the canvas. */
  slideId: string;
  selected: SlotId | null;
  /** Elements on this slide still too long at their smallest size (the canvas reports them). */
  overflow: readonly SlotId[];
  /** Every picture the design draws, by media id; an id missing here is a picture that was deleted. */
  media: Readonly<Record<string, StudioMediaRef>>;
  /** Null while loading or after a failed load. */
  kits: BrandKitView[] | null;
  kitsError: string | null;
  onReloadKits: () => void;
  tab: PanelTab;
  /** The island switches to 'element' itself when the canvas selects something. */
  onTabChange: (tab: PanelTab) => void;
  onSelect: (slot: SlotId | null) => void;
  onChange: ApplyChange;
  /** Opens the media library; the island applies the choice. */
  onPickMedia: (purpose: MediaPurpose) => void;
  /** Opens the layout picker for this slide. */
  onChangeLayout: () => void;
  /** The island adds the kit's logo to the media map. */
  onKitApplied: (kit: BrandKitView) => void;
  /** Inside a drawer, which brings its own surface and title: no panel around the tabs. */
  bare?: boolean;
  className?: string;
}

const PANEL_TABS: readonly PanelTab[] = ['element', 'slide', 'design'];

function isPanelTab(value: string): value is PanelTab {
  return (PANEL_TABS as readonly string[]).includes(value);
}

/**
 * A tab's content: it scrolls on its own inside the panel. The negative
 * margin and its padding leave room for rings, which the scroll would clip.
 */
const SCROLL =
  'mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain -mx-1.5 px-1.5 py-1.5 pg-scrollbar';

/** The properties panel: Element, Slide and Design tabs. */
export function EditorPanel({
  document,
  slideId,
  selected,
  overflow,
  media,
  kits,
  kitsError,
  onReloadKits,
  tab,
  onTabChange,
  onSelect,
  onChange,
  onPickMedia,
  onChangeLayout,
  onKitApplied,
  bare = false,
  className,
}: EditorPanelProps) {
  const Frame = bare ? 'div' : StudioPanel;
  const scroll = cn(SCROLL, bare ? 'pg-scrollbar-secondary' : 'pg-scrollbar-chrome');

  return (
    <PanelSurface surface={bare ? 'secondary' : 'chrome'}>
      <Frame className={cn('flex min-h-0 flex-col', !bare && 'p-3', className)}>
        {/* The drawer names itself; beside the canvas, the tabs need a name above them. */}
        {bare ? null : <h2 className="sr-only">Properties</h2>}
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (isPanelTab(value)) onTabChange(value);
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="grid w-full shrink-0 grid-cols-3">
            <TabsTrigger value="element">Element</TabsTrigger>
            <TabsTrigger value="slide">Slide</TabsTrigger>
            <TabsTrigger value="design">Design</TabsTrigger>
          </TabsList>

          <TabsContent value="element" className={scroll}>
            <ElementPanel
              document={document}
              slideId={slideId}
              selected={selected}
              overflow={overflow}
              media={media}
              onSelect={onSelect}
              onChange={onChange}
              onPickMedia={onPickMedia}
            />
          </TabsContent>

          <TabsContent value="slide" className={scroll}>
            <SlidePanel
              document={document}
              slideId={slideId}
              media={media}
              onChange={onChange}
              onPickMedia={onPickMedia}
              onChangeLayout={onChangeLayout}
            />
          </TabsContent>

          <TabsContent value="design" className={scroll}>
            <DesignPanel
              document={document}
              slideId={slideId}
              media={media}
              kits={kits}
              kitsError={kitsError}
              onReloadKits={onReloadKits}
              onChange={onChange}
              onKitApplied={onKitApplied}
            />
          </TabsContent>
        </Tabs>
      </Frame>
    </PanelSurface>
  );
}
