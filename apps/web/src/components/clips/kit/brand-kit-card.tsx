'use client';

/**
 * One Studio brand kit with its clip fields (Module 10 section 3), on the
 * kit page's Brand Kit tab:
 *
 * - **Logo On Video**: Off or one of the four corners (`Segmented`), beside a
 *   small drawing of a tall frame with the logo at that corner. A kit with no
 *   logo says so and the bar is off.
 * - **Caption Style**: the style clips take from the kit (the built-in
 *   styles and the workspace's own), or None to keep each clip's own.
 * - **Intro**: one short uploaded video (`BrandVideoField`).
 * - **Outro**: a **Card** (the kit's colours and logo with one closing line,
 *   saved when the field is left or with Save) or a **Video**.
 *
 * Each change is saved at once through `PATCH /clips/brand-kits/:id`; the
 * answer replaces the card's kit, and a refusal is a red toast with the
 * API's own sentence.
 */
import {
  Button,
  Card,
  ChoiceTiles,
  FormField,
  FormLabel,
  Input,
  Segmented,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  toast,
} from '@postgear/ui';
import { useEffect, useId, useState } from 'react';
import { GroupLabel, NOTE } from '@/components/studio/panel-ui';
import { ApiError } from '@/lib/api';
import { updateClipBrandKit } from '@/lib/clips-recipes-api';
import type { CaptionStyleView } from '@/types/clips';
import type { ClipBrandKitPatch, ClipBrandKitView } from '@/types/clips-recipes';
import { BrandVideoField } from './brand-video-field';
import {
  cleanOutroLine,
  INTRO_NOTE,
  LOGO_CHOICES,
  type LogoChoice,
  NO_LOGO_NOTE,
  OUTRO_CARD_NOTE,
  OUTRO_LINE_MAX,
  OUTRO_VIDEO_NOTE,
  RECIPE_ACTION_FAILED,
} from './kit-model';
import { LogoCornerDrawing } from './logo-corner';
import type { BrandUploadDeps } from './use-brand-video-upload';

const STYLE_NONE = '__none';
const STYLE_GONE = '__gone';

type OutroKind = 'card' | 'video';

function sentenceOf(cause: unknown): string {
  return cause instanceof ApiError && cause.message ? cause.message : RECIPE_ACTION_FAILED;
}

export function BrandKitCard({
  kit,
  styles,
  onChange,
  uploadDeps,
}: {
  kit: ClipBrandKitView;
  /** Every caption style the workspace can pick (built in first), or null while they load. */
  styles: readonly CaptionStyleView[] | null;
  onChange: (kit: ClipBrandKitView) => void;
  uploadDeps?: BrandUploadDeps;
}) {
  const ids = {
    name: useId(),
    logo: useId(),
    style: useId(),
    intro: useId(),
    outro: useId(),
    line: useId(),
  };
  const [outroKind, setOutroKind] = useState<OutroKind>(kit.outro?.kind ?? 'card');
  const savedLine = kit.outro?.kind === 'card' ? kit.outro.text : '';
  const [line, setLine] = useState(savedLine);
  const [lineBusy, setLineBusy] = useState(false);

  // A saved kit (from here or another tab) brings its own line back.
  useEffect(() => {
    setLine(savedLine);
  }, [savedLine]);
  useEffect(() => {
    if (kit.outro) setOutroKind(kit.outro.kind);
  }, [kit.outro]);

  /** Saves a patch; answers the API's sentence on a refusal, else null. */
  const save = async (patch: ClipBrandKitPatch): Promise<string | null> => {
    try {
      onChange(await updateClipBrandKit(kit.id, patch));
      return null;
    } catch (cause) {
      return sentenceOf(cause);
    }
  };
  const saveOrToast = async (patch: ClipBrandKitPatch) => {
    const problem = await save(patch);
    if (problem) toast({ title: problem, variant: 'danger' });
    return problem;
  };

  const logoValue: LogoChoice = kit.clipLogoPosition ?? 'off';
  const hasLogo = kit.logoUrl !== null;

  const styleKnown =
    kit.clipCaptionStyleId === null ||
    styles === null ||
    styles.some((style) => style.id === kit.clipCaptionStyleId);
  const styleValue =
    kit.clipCaptionStyleId === null ? STYLE_NONE : styleKnown ? kit.clipCaptionStyleId : STYLE_GONE;
  const builtIn = (styles ?? []).filter((style) => style.builtIn);
  const own = (styles ?? []).filter((style) => !style.builtIn);

  const saveLine = async () => {
    const next = cleanOutroLine(line);
    if ((next ?? '') === savedLine || lineBusy) return;
    setLineBusy(true);
    const problem = await saveOrToast({ clipOutroText: next });
    setLineBusy(false);
    if (!problem) toast({ title: next ? 'Closing line saved.' : 'Closing line removed.' });
  };

  const chooseOutro = (next: OutroKind) => {
    setOutroKind(next);
    // Back to the card: the uploaded outro video goes, and the line is the outro again.
    if (next === 'card' && kit.outro?.kind === 'video') {
      void saveOrToast({ clipOutroVideoId: null });
    }
  };

  return (
    <Card className="flex flex-col gap-5 p-5" data-testid="clip-kit-brand-card" data-kit={kit.id}>
      <div className="flex items-center gap-3">
        {kit.logoUrl ? (
          // biome-ignore lint/performance/noImgElement: a signed storage address, not a Next image source.
          <img
            src={kit.logoUrl}
            alt=""
            className="h-10 w-10 shrink-0 rounded-md border-2 border-outline bg-inset object-contain"
          />
        ) : null}
        <h3 id={ids.name} className="m-0 min-w-0 flex-1 truncate type-heading text-lg text-ink">
          {kit.name}
        </h3>
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel id={ids.logo}>Logo On Video</GroupLabel>
        <div className="flex items-center gap-4">
          <Segmented<LogoChoice>
            labelledBy={ids.logo}
            value={logoValue}
            disabled={!hasLogo}
            onValueChange={(next) =>
              void saveOrToast({ clipLogoPosition: next === 'off' ? null : next })
            }
            options={LOGO_CHOICES}
          />
          <LogoCornerDrawing position={hasLogo ? kit.clipLogoPosition : null} />
        </div>
        {hasLogo ? null : <p className={NOTE}>{NO_LOGO_NOTE}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel id={ids.style}>Caption Style</GroupLabel>
        <Select
          value={styleValue}
          disabled={styles === null}
          onValueChange={(next) => {
            if (next === STYLE_GONE) return;
            void saveOrToast({ clipCaptionStyleId: next === STYLE_NONE ? null : next });
          }}
        >
          <SelectTrigger
            aria-labelledby={ids.style}
            className="max-w-xs"
            data-testid="clip-kit-caption-style"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STYLE_NONE}>None</SelectItem>
            {styleKnown ? null : <SelectItem value={STYLE_GONE}>Deleted Style</SelectItem>}
            {builtIn.length > 0 ? (
              <SelectGroup>
                <SelectLabel>Built In</SelectLabel>
                {builtIn.map((style) => (
                  <SelectItem key={style.id} value={style.id}>
                    {style.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
            {own.length > 0 ? (
              <SelectGroup>
                <SelectLabel>My Styles</SelectLabel>
                {own.map((style) => (
                  <SelectItem key={style.id} value={style.id}>
                    {style.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ) : null}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel id={ids.intro}>Intro</GroupLabel>
        <p className={NOTE}>{INTRO_NOTE}</p>
        <BrandVideoField
          label="Intro"
          video={kit.intro}
          onUploaded={(videoId) => save({ clipIntroVideoId: videoId })}
          onRemove={async () => {
            await saveOrToast({ clipIntroVideoId: null });
          }}
          uploadDeps={uploadDeps}
          testId="clip-kit-intro"
        />
      </div>

      <div className="flex flex-col gap-2">
        <GroupLabel id={ids.outro}>Outro</GroupLabel>
        <ChoiceTiles<OutroKind>
          labelledBy={ids.outro}
          className="max-w-sm"
          value={outroKind}
          onValueChange={chooseOutro}
          options={[
            { value: 'card', label: 'Card' },
            { value: 'video', label: 'Video' },
          ]}
        />
        {outroKind === 'card' ? (
          <div className="flex flex-col gap-2" data-testid="clip-kit-outro-card">
            <p className={NOTE}>{OUTRO_CARD_NOTE}</p>
            <FormField className="max-w-md">
              <FormLabel htmlFor={ids.line}>Closing line</FormLabel>
              <div className="flex items-center gap-2">
                <Input
                  id={ids.line}
                  value={line}
                  maxLength={OUTRO_LINE_MAX}
                  placeholder="Enter your closing line"
                  disabled={lineBusy}
                  onChange={(event) => setLine(event.target.value)}
                  onBlur={() => void saveLine()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void saveLine();
                    }
                  }}
                  data-testid="clip-kit-outro-line"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={lineBusy || (cleanOutroLine(line) ?? '') === savedLine}
                  onClick={() => void saveLine()}
                  data-testid="clip-kit-outro-save"
                >
                  Save
                </Button>
              </div>
            </FormField>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className={NOTE}>{OUTRO_VIDEO_NOTE}</p>
            <BrandVideoField
              label="Outro"
              video={kit.outro?.kind === 'video' ? kit.outro.video : null}
              onUploaded={(videoId) => save({ clipOutroVideoId: videoId })}
              onRemove={async () => {
                await saveOrToast({ clipOutroVideoId: null });
              }}
              uploadDeps={uploadDeps}
              testId="clip-kit-outro-video"
            />
          </div>
        )}
      </div>
    </Card>
  );
}
