// Pure formatting helpers for blame labels (no VS Code imports, unit-testable).

import type { BlameLine } from '../git/blame-parser';
import { isUncommitted } from '../git/blame-parser';

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Human "time ago" for a blame entry (epoch seconds). */
export function formatRelativeTime(epochSeconds: number, now: number = Date.now()): string {
  if (!epochSeconds) return '';
  const delta = Math.round(now / 1000) - epochSeconds;
  if (delta < 0) return 'just now';
  if (delta < 45) return 'just now';
  if (delta < 90) return 'a minute ago';
  if (delta < 45 * MINUTE) return `${Math.round(delta / MINUTE)} minutes ago`;
  if (delta < 90 * MINUTE) return 'an hour ago';
  if (delta < 22 * HOUR) return `${Math.round(delta / HOUR)} hours ago`;
  if (delta < 36 * HOUR) return 'yesterday';
  if (delta < 25 * DAY) return `${Math.round(delta / DAY)} days ago`;
  if (delta < 45 * DAY) return 'a month ago';
  if (delta < 320 * DAY) return `${Math.round(delta / (30 * DAY))} months ago`;
  if (delta < 548 * DAY) return 'a year ago';
  return `${Math.round(delta / (365 * DAY))} years ago`;
}

/** Absolute local date-time, e.g. "2024-01-31 18:05". */
export function formatAbsoluteTime(epochSeconds: number): string {
  if (!epochSeconds) return '';
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Expand a blame format template. Supported tokens: {author}, {ago}, {date},
 * {summary}, {sha}. Unknown tokens are left untouched.
 */
export function formatBlameLabel(
  blame: BlameLine,
  format: string,
  now: number = Date.now(),
): string {
  if (isUncommitted(blame)) {
    const who = blame.author || 'You';
    return format
      .replace(/\{author\}/g, who)
      .replace(/\{ago\}/g, 'uncommitted')
      .replace(/\{date\}/g, '')
      .replace(/\{summary\}/g, 'Not committed yet')
      .replace(/\{sha\}/g, '')
      .replace(/,\s*$/, '')
      .trim();
  }
  return format
    .replace(/\{author\}/g, blame.author)
    .replace(/\{ago\}/g, formatRelativeTime(blame.authorTime, now))
    .replace(/\{date\}/g, formatAbsoluteTime(blame.authorTime))
    .replace(/\{summary\}/g, blame.summary)
    .replace(/\{sha\}/g, blame.hash.slice(0, 7))
    .replace(/\s{2,}/g, ' ')
    .trim();
}
