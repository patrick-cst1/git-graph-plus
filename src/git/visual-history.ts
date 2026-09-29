// Aggregates a file's commit history into time buckets for the Visual File
// History chart. Pure (no VS Code imports) so it is unit-testable.
//
// The bucket unit is picked from the span of the history: days for a few
// weeks, weeks for a year, then months / quarters / years — and the bucket
// count is capped by merging units further so the chart never explodes.

export type VisualHistoryUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface VisualHistoryCommit {
  hash: string;
  author: string;
  /** ISO-8601 author date. */
  date: string;
}

export interface VisualHistoryBucket {
  label: string;
  /** Bucket start, epoch ms (UTC-aligned). */
  start: number;
  /** Exclusive bucket end, epoch ms. */
  end: number;
  total: number;
  byAuthor: Record<string, number>;
}

export interface VisualHistoryAuthor {
  name: string;
  commits: number;
}

export interface VisualHistoryData {
  unit: VisualHistoryUnit;
  buckets: VisualHistoryBucket[];
  authors: VisualHistoryAuthor[];
  total: number;
  firstDate?: string;
  lastDate?: string;
}

const MS_DAY = 86_400_000;
const MAX_AUTHORS = 8;

function startOfDay(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function startOfWeek(t: number): number {
  const day = startOfDay(t);
  const dow = new Date(day).getUTCDay(); // 0 = Sunday
  const shift = (dow + 6) % 7; // Monday = 0
  return day - shift * MS_DAY;
}

function startOfMonth(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function startOfQuarter(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1);
}

function startOfYear(t: number): number {
  return Date.UTC(new Date(t).getUTCFullYear(), 0, 1);
}

function bucketStart(t: number, unit: VisualHistoryUnit): number {
  switch (unit) {
    case 'day': return startOfDay(t);
    case 'week': return startOfWeek(t);
    case 'month': return startOfMonth(t);
    case 'quarter': return startOfQuarter(t);
    case 'year': return startOfYear(t);
  }
}

function nextBucket(start: number, unit: VisualHistoryUnit): number {
  const d = new Date(start);
  switch (unit) {
    case 'day': return start + MS_DAY;
    case 'week': return start + 7 * MS_DAY;
    case 'month': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    case 'quarter': return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1);
    case 'year': return Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  }
}

function label(start: number, unit: VisualHistoryUnit): string {
  const d = new Date(start);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  switch (unit) {
    case 'day': return `${y}-${m}-${day}`;
    case 'week': return `${y}-${m}-${day}`;
    case 'month': return `${y}-${m}`;
    case 'quarter': return `${y} Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
    case 'year': return `${y}`;
  }
}

const UNIT_ORDER: VisualHistoryUnit[] = ['day', 'week', 'month', 'quarter', 'year'];

export function buildVisualHistory(
  commits: VisualHistoryCommit[],
  options?: { maxBuckets?: number },
): VisualHistoryData {
  const maxBuckets = Math.max(4, options?.maxBuckets ?? 60);
  const parsed = commits
    .map((c) => ({ ...c, t: Date.parse(c.date) }))
    .filter((c) => Number.isFinite(c.t) && c.author)
    .sort((a, b) => a.t - b.t);

  if (parsed.length === 0) {
    return { unit: 'day', buckets: [], authors: [], total: 0 };
  }

  const first = parsed[0].t;
  const last = parsed[parsed.length - 1].t;
  const spanDays = (last - first) / MS_DAY;

  let unit: VisualHistoryUnit = spanDays <= 31 ? 'day' : spanDays <= 370 ? 'week' : 'month';
  for (;;) {
    let count = 0;
    for (let t = bucketStart(first, unit); t <= last; t = nextBucket(t, unit)) count++;
    if (count <= maxBuckets || unit === 'year') break;
    unit = UNIT_ORDER[UNIT_ORDER.indexOf(unit) + 1];
  }

  // For very long histories even years can exceed the cap: chunk them.
  let chunk = 1;
  if (unit === 'year') {
    let years = 0;
    for (let t = bucketStart(first, unit); t <= last; t = nextBucket(t, unit)) years++;
    if (years > maxBuckets) chunk = Math.ceil(years / maxBuckets);
  }

  const buckets: VisualHistoryBucket[] = [];
  const advance = (t: number): number => {
    let next = t;
    for (let i = 0; i < chunk; i++) next = nextBucket(next, unit);
    return next;
  };
  for (let t = bucketStart(first, unit); t <= last; t = advance(t)) {
    const end = advance(t);
    buckets.push({
      label: label(t, unit),
      start: t,
      end,
      total: 0,
      byAuthor: {},
    });
  }

  // Buckets are contiguous and sorted; binary search finds a commit's bucket
  // even when years are chunked (a plain start-key map would miss those).
  const findBucket = (t: number): VisualHistoryBucket | undefined => {
    let lo = 0;
    let hi = buckets.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t < buckets[mid].start) hi = mid - 1;
      else if (t >= buckets[mid].end) lo = mid + 1;
      else return buckets[mid];
    }
    return undefined;
  };

  const authorCounts = new Map<string, number>();
  for (const c of parsed) {
    const bucket = findBucket(c.t);
    if (!bucket) continue;
    bucket.total++;
    bucket.byAuthor[c.author] = (bucket.byAuthor[c.author] ?? 0) + 1;
    authorCounts.set(c.author, (authorCounts.get(c.author) ?? 0) + 1);
  }

  const authors = [...authorCounts.entries()]
    .map(([name, count]) => ({ name, commits: count }))
    .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
    .slice(0, MAX_AUTHORS);

  return {
    unit,
    buckets,
    authors,
    total: parsed.length,
    firstDate: parsed[0].date,
    lastDate: parsed[parsed.length - 1].date,
  };
}
