'use client';

/**
 * Chat Preview (Sprint 13, Module 14): the emote in four lines of a stream
 * chat, so a streamer sees it at the size people will (28 px; the 56 px
 * picture on a 2x screen).
 *
 * Pure React with no outside picture: no site's logo or wordmark, only the
 * word "chat". The sun and moon switch sets a light or a dark ground. The
 * typed line lives in this component's state only: it is never saved or
 * sent anywhere.
 *
 * The grounds and name colours imitate a stream chat, not the app's theme,
 * so they are this component's own constants rather than theme tokens (the
 * same reason a platform's brand colour is written where it is drawn).
 */
import { MoonIcon } from '@animateicons/react/lucide/moon-icon';
import { SunIcon } from '@animateicons/react/lucide/sun-icon';
import { Input, Segmented } from '@postgear/ui';
import { Smile } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

export type ChatGround = 'light' | 'dark';

/** The chat's own colours: a near-black and a white ground, and names that read on each. */
export const CHAT_COLOURS: Readonly<
  Record<ChatGround, { ground: string; text: string; names: readonly string[] }>
> = {
  dark: {
    ground: '#18181b',
    text: '#efeff1',
    names: ['#ff7f50', '#1e90ff', '#9acd32', '#da70d6'],
  },
  light: {
    ground: '#ffffff',
    text: '#0e0e10',
    names: ['#c2410c', '#1d4ed8', '#4d7c0f', '#a21caf'],
  },
};

const GROUND_OPTIONS = [
  { value: 'light' as const, label: 'Light Chat', icon: SunIcon },
  { value: 'dark' as const, label: 'Dark Chat', icon: MoonIcon },
];

/** A stand-in emote for the playground: the page passes the real moving one. */
function PlaceholderEmote() {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center align-middle">
      <Smile className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
    </span>
  );
}

export interface ChatPreviewProps {
  /** Draws one emote, 28 px tall; `index` tells the copies apart. */
  renderEmote?: (index: number) => ReactNode;
  /** Where the switch starts. */
  initialGround?: ChatGround;
  className?: string;
}

export function ChatPreview({ renderEmote, initialGround = 'dark', className }: ChatPreviewProps) {
  const [ground, setGround] = useState<ChatGround>(initialGround);
  const [ownLine, setOwnLine] = useState('');
  const fieldId = useId();
  const colours = CHAT_COLOURS[ground];
  let next = 0;
  const emote = () => {
    const index = next;
    next += 1;
    return (
      <span key={`emote-${index}`} className="mx-0.5 inline-block align-middle" aria-hidden="true">
        {renderEmote ? renderEmote(index) : <PlaceholderEmote />}
      </span>
    );
  };
  const name = (who: string, colour: number) => (
    <span className="font-bold" style={{ color: colours.names[colour] }}>
      {who}:
    </span>
  );

  return (
    <section className={className} aria-label="Chat Preview" data-testid="emote-chat-preview">
      <div className="flex items-center justify-between gap-3">
        <h3 className="m-0 font-sans text-lg text-ink type-heading">Chat Preview</h3>
        <Segmented
          label="Chat Ground"
          value={ground}
          onValueChange={setGround}
          options={GROUND_OPTIONS}
          tight
        />
      </div>
      <div
        className="mt-3 flex flex-col gap-1.5 rounded-md border-2 border-outline p-3 font-sans text-sm leading-7"
        style={{ backgroundColor: colours.ground, color: colours.text }}
        data-ground={ground}
      >
        <p className="m-0">{name('maya', 0)} that was wild</p>
        <p className="m-0">
          {name('kai', 1)} {emote()}
        </p>
        <p className="m-0">
          {name('noor', 2)} no way {emote()}
          {emote()}
          {emote()}
          {emote()}
          {emote()}
        </p>
        <p className="m-0 break-words">
          {name('you', 3)} {ownLine.trim() === '' ? 'gg' : ownLine} {emote()}
        </p>
      </div>
      <label htmlFor={fieldId} className="mt-3 block font-sans text-sm font-bold text-ink">
        Your chat line
      </label>
      <Input
        id={fieldId}
        className="mt-1"
        value={ownLine}
        maxLength={120}
        autoComplete="off"
        spellCheck={false}
        placeholder="Enter your own chat line"
        onChange={(event) => setOwnLine(event.target.value)}
      />
    </section>
  );
}
