/**
 * How far a running export is, as a ring the size of an icon (Module 15): in
 * the editor's Export button and on a clip card's poster. Decorative: the
 * control or badge it sits in says the number.
 */
export function ExportRing({ progress, className }: { progress: number; className?: string }) {
  const r = 6;
  const around = 2 * Math.PI * r;
  const done = Math.min(100, Math.max(0, progress)) / 100;
  return (
    <svg
      viewBox="0 0 16 16"
      className={className ?? 'h-4 w-4 -rotate-90'}
      aria-hidden="true"
      data-testid="clip-export-ring"
    >
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.25}
        strokeWidth={2.5}
      />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeDasharray={around}
        strokeDashoffset={around * (1 - done)}
        strokeLinecap="round"
      />
    </svg>
  );
}
