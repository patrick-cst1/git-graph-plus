import type { GraphStyle } from '../types';

/** SourceGit-style waypoint in pixel coordinates. */
export interface GraphPathPoint {
  x: number;
  y: number;
}

/** mhutchie Git Graph control-offset factors (of a row). */
const FACTOR: Record<GraphStyle, number> = { rounded: 0.8, angular: 0.38 };

/** Rounds to 2 decimals so emitted path data stays compact. */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function samePoint(a: GraphPathPoint, b: GraphPathPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function dedupe(points: GraphPathPoint[]): GraphPathPoint[] {
  const out: GraphPathPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || !samePoint(last, p)) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * Normalise a routed polyline before drawing.
 *
 * SourceGit's router moves lane changes through half-row waypoints, so a
 * transition can span only half a row (and the endY guard can even leave a
 * purely horizontal leg). Drawn as-is with mhutchie's control offset, a
 * half-row transition is twice as tight as Git Graph's — the elbows look
 * right-angled. Merge a lane change with an adjacent vertical stub (up to one
 * full row) and collapse collinear runs, so every transition gets the full
 * row mhutchie's geometry assumes.
 */
export function normalizeGraphPoints(points: GraphPathPoint[], rowHeight: number): GraphPathPoint[] {
  let pts = dedupe(points);
  const eps = 0.01;
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const sameDirection = (c.y - b.y) * (b.y - a.y) >= 0;
      const span = Math.abs(c.y - a.y);
      const laneChangeThenStub = a.x !== b.x && b.x === c.x && sameDirection && span <= rowHeight + eps;
      const stubThenLaneChange = a.x === b.x && b.x !== c.x && sameDirection && span <= rowHeight + eps;
      if (laneChangeThenStub || stubThenLaneChange) {
        pts.splice(i, 1);
        changed = true;
        i--;
        continue;
      }
      const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
      if (collinear) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
    if (changed) pts = dedupe(pts);
  }
  return pts;
}

/**
 * Build the SVG path `d` for one branch polyline (points in pixel space).
 *
 * Same geometry as mhutchie Git Graph: vertical runs are straight `L`s and a
 * lane change is a cubic with control offset `row * 0.8` (rounded, default)
 * or a two-segment kink with `row * 0.38` (angular). `normalizeGraphPoints`
 * first widens half-row transitions to a full row.
 */
export function buildGraphPathD(points: GraphPathPoint[], style: GraphStyle, rowHeight: number): string {
  const pts = normalizeGraphPoints(points, rowHeight);
  if (pts.length < 2) return '';

  const factor = FACTOR[style];
  const parts: string[] = [`M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`];

  for (let i = 1; i < pts.length; i++) {
    const last = pts[i - 1];
    const cur = pts[i];

    if (cur.x === last.x || cur.y === last.y) {
      parts.push(`L ${fmt(cur.x)} ${fmt(cur.y)}`);
      continue;
    }

    const d = Math.abs(cur.y - last.y) * factor;
    if (style === 'angular') {
      // mhutchie angular: a diagonal to (cur.x, cur.y - d) then vertical when the
      // line locks to its destination, or vertical then a diagonal to the
      // destination. Lock to the destination lane when moving right, and to the
      // source lane when moving left.
      if (cur.x > last.x) parts.push(`L ${fmt(cur.x)} ${fmt(cur.y - d)}`);
      else parts.push(`L ${fmt(last.x)} ${fmt(last.y + d)}`);
      parts.push(`L ${fmt(cur.x)} ${fmt(cur.y)}`);
    } else {
      parts.push(`C ${fmt(last.x)} ${fmt(last.y + d)}, ${fmt(cur.x)} ${fmt(cur.y - d)}, ${fmt(cur.x)} ${fmt(cur.y)}`);
    }
  }

  return parts.join(' ');
}
