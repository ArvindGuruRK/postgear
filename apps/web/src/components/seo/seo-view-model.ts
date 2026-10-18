/**
 * The SEO analyzer's presentation logic, as pure functions over the API's
 * shapes (Sprint 7).
 *
 * ## Why this is not in the components
 *
 * The screen has several places that read the same facts differently: the
 * history card groups audits by site and draws each site's trend, the hero
 * compares a run with the one before, the breakdown colours a grade, the
 * clipboard wants the whole report as text. Each is a small decision that
 * would be invisible in JSX and silent when wrong. Here they are named,
 * tested without rendering, and shared, so a grade is never one colour in
 * the history and another on the gauge.
 *
 * ## Grades are the Sprint 5 tone vocabulary
 *
 * A and B are the unambiguously good outcomes (`success`), C is the ordinary
 * middle (`secondary`), D is "needs attention" (`accent`), F is `danger`: the
 * same mapping `ScoreGauge` uses for its arc, read off the letter instead of
 * the number so a stored grade and a live score can never disagree.
 */
import type { BadgeProps } from '@postgear/ui';
import type { SeoAuditDetail, SeoAuditSummary, SeoGrade, SeoSeverity } from '@/types/seo';
import { SEO_CATEGORIES, SEO_CATEGORY_LABELS, SEO_SEVERITIES } from '@/types/seo';

export type BadgeVariant = NonNullable<BadgeProps['variant']>;

/** The badge tone for a grade; the outline sticker when there is none yet. */
export function gradeVariant(grade: SeoGrade | null | undefined): BadgeVariant {
  switch (grade) {
    case 'A':
    case 'B':
      return 'success';
    case 'C':
      return 'secondary';
    case 'D':
      return 'accent';
    case 'F':
      return 'danger';
    default:
      return 'outline';
  }
}

/** Critical is red, warning is orange, info is the ordinary blue. */
export function severityVariant(severity: SeoSeverity): BadgeVariant {
  switch (severity) {
    case 'critical':
      return 'danger';
    case 'warning':
      return 'accent';
    default:
      return 'primary';
  }
}

export const SEVERITY_LABELS: Record<SeoSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
};

export interface ScoreDelta {
  /** Current minus previous; zero is "unchanged". */
  delta: number;
  direction: 'up' | 'down' | 'same';
  previousScore: number;
  previousAt: string;
}

/**
 * How this run compares with the one before, or null when there is nothing
 * to compare with: a first run, or a previous run that never scored.
 */
export function scoreDelta(
  current: number | null,
  previous: { overallScore: number | null; createdAt: string } | null,
): ScoreDelta | null {
  if (current === null || previous === null || previous.overallScore === null) {
    return null;
  }

  const delta = Math.round(current) - Math.round(previous.overallScore);

  return {
    delta,
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same',
    previousScore: Math.round(previous.overallScore),
    previousAt: previous.createdAt,
  };
}

/**
 * Client-side validation of the URL field: what the API will certainly
 * refuse with a 400 is caught here, so the message sits next to the field
 * before anything is sent. What it may refuse with a 422 (a private or
 * internal address) is deliberately *not* caught here: the API owns that
 * rule (and logs the attempt), so `http://localhost:3000` passes this check
 * and is refused by the server with the message shown on the same field.
 */
export function isValidUrlInput(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length === 0 || /\s/.test(trimmed)) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** The host of a URL, without a leading `www.`; the input itself when it is not a URL. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The path and query of a URL, or an empty string for the root. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    return path === '/' ? '' : path;
  } catch {
    return '';
  }
}

export interface TrendPointData {
  /** The run's `createdAt`, so two runs on one day stay two points. */
  x: string;
  y: number;
}

/** One site in the history card: every run of a URL, latest first. */
export interface SiteHistory {
  targetUrl: string;
  host: string;
  path: string;
  latest: SeoAuditSummary;
  audits: SeoAuditSummary[];
  /** Finished runs' overall scores, oldest first: the sparkline and the trend chart. */
  trend: TrendPointData[];
}

/**
 * Groups audits by their target URL, sites ordered by their latest run and
 * runs within a site latest first. Accepts the list in any order so a run
 * prepended after a stream and a list the server sent both group the same.
 */
export function groupHistory(audits: readonly SeoAuditSummary[]): SiteHistory[] {
  const bySite = new Map<string, SeoAuditSummary[]>();

  for (const audit of audits) {
    const runs = bySite.get(audit.targetUrl);
    if (runs) {
      runs.push(audit);
    } else {
      bySite.set(audit.targetUrl, [audit]);
    }
  }

  const sites: SiteHistory[] = [];

  for (const [targetUrl, runs] of bySite) {
    const sorted = [...runs].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const trend = [...sorted]
      .reverse()
      .filter((audit) => audit.status === 'done' && audit.overallScore !== null)
      .map((audit) => ({ x: audit.createdAt, y: Math.round(audit.overallScore as number) }));

    sites.push({
      targetUrl,
      host: hostOf(targetUrl),
      path: pathOf(targetUrl),
      latest: sorted[0],
      audits: sorted,
      trend,
    });
  }

  return sites.sort((a, b) => Date.parse(b.latest.createdAt) - Date.parse(a.latest.createdAt));
}

/** "just now", "5 min ago", "3 h ago", "2 d ago"; a date beyond a week. */
export function formatRelative(iso: string, now = new Date()): string {
  const then = new Date(iso);

  if (Number.isNaN(then.getTime())) {
    return '';
  }

  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));

  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;

  return then.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(then.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/** "840 ms" under a second, "4.2 s" over it. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) {
    return '–';
  }

  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The whole report as plain text for the clipboard: the score line, the four
 * categories, and every recommendation grouped by severity. Dates are the
 * ISO day so the text is the same wherever it is pasted.
 */
export function reportAsText(detail: SeoAuditDetail): string {
  const lines: string[] = [];
  const day = detail.createdAt.slice(0, 10);

  lines.push(`SEO audit: ${detail.finalUrl ?? detail.targetUrl}`);
  lines.push(
    detail.overallScore === null
      ? `Not scored · ${day}`
      : `Score ${Math.round(detail.overallScore)}/100 · Grade ${detail.grade ?? '–'} · ${day}`,
  );

  if (detail.previous?.overallScore !== null && detail.previous?.overallScore !== undefined) {
    const change = scoreDelta(detail.overallScore, detail.previous);
    if (change) {
      const sign = change.delta > 0 ? '+' : '';
      lines.push(
        `vs last run (${detail.previous.createdAt.slice(0, 10)}): ${sign}${change.delta} from ${change.previousScore}`,
      );
    }
  }

  const byCategory = new Map(detail.categories.map((category) => [category.category, category]));
  lines.push(
    SEO_CATEGORIES.map((id) => {
      const category = byCategory.get(id);
      const score = category ? Math.round(category.score) : '–';
      const estimated = category?.estimated ? ' (estimated)' : '';
      return `${SEO_CATEGORY_LABELS[id]} ${score}${estimated}`;
    }).join(' · '),
  );

  if (detail.advice) {
    lines.push('');
    lines.push(
      detail.advice.source === 'ai'
        ? `What to fix (AI advice${detail.advice.model ? ` · ${detail.advice.model}` : ''})`
        : 'What to fix (rule-based)',
    );
    if (detail.advice.summary.trim().length > 0) {
      lines.push(detail.advice.summary.trim());
    }

    for (const severity of SEO_SEVERITIES) {
      const items = detail.advice.recommendations.filter((item) => item.severity === severity);
      if (items.length === 0) continue;
      lines.push('');
      lines.push(`${SEVERITY_LABELS[severity]} (${items.length})`);
      for (const item of items) {
        lines.push(`- ${item.title}: ${item.issue}`);
        lines.push(`  Fix: ${item.fix}`);
        if (item.docsUrl) {
          lines.push(`  More: ${item.docsUrl}`);
        }
      }
    }
  }

  return lines.join('\n');
}
