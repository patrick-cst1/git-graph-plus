import type { GraphStyle } from '../types';

/** SourceGit-style waypoint in pixel coordinates. */
export interface GraphPathPoint {
  x: number;
  y: number;
}

/** Knobs for the transition geometry / dot anchoring. */
export interface GraphPathOptions {
  /**
   * Optional cap on how many rows a lane change may sweep over. By default
   * (omitted) the change spreads across the whole straight run, so the line
   * keeps curving like a parabola; a finite value tightens the bend to at
   * most that many rows.
   */
  maxTransitionRows?: number;
  /**
   * Commit dots (pixel coordinates). The line must keep passing exactly
   * through its own commits, so a dot is never smoothed away: it always stays
   * an endpoint of a drawn segment.
   */
  dots?: readonly GraphPathPoint[];
}

/** mhutchie Git Graph control-offset factors (of the transition span). */
const FACTOR: Record<GraphStyle, number> = { rounded: 0.8, angular: 0.38 };

/**
 * By default a lane change spreads across the whole straight run between its
 * two surrounding points (usually commits), so the line keeps curving the
 * whole way like a parabola instead of bending early and then running
 * straight. A finite `maxTransitionRows` tightens that into at most N rows.
 */
const DEFAULT_MAX_TRANSITION_ROWS = Infinity;

/** Rounds to 2 decimals so emitted path data stays compact. */
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function samePoint(a: GraphPathPoint, b: GraphPathPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function pointKey(p: GraphPathPoint): string {
  return `${Math.round(p.x * 100)}|${Math.round(p.y * 100)}`;
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
 * SourceGit's router snaps lane changes to half-row waypoints, so a transition
 * spans half a row at most (and the endY guard can even leave a purely
 * horizontal leg). Drawn as-is, the bend is a tight hook that reads as a
 * right-angled elbow. Fold each lane change into the adjacent vertical run and
 * collapse collinear runs, so the line sweeps across like a parabola instead
 * of turning a corner. By default the sweep covers the whole run between the
 * two surrounding points; `maxTransitionRows` can tighten it.
 *
 * A lane change grows into the neighbouring straight run; the straight run is
 * trimmed, never a commit dot. Dots are anchors: the middle point of a merged
 * or collapsed chain is kept whenever it is a dot, so the drawn line always
 * passes through its own commits.
 */
export function normalizeGraphPoints(
  points: GraphPathPoint[],
  rowHeight: number,
  options: GraphPathOptions = {},
): GraphPathPoint[] {
  const cap = rowHeight * (options.maxTransitionRows ?? DEFAULT_MAX_TRANSITION_ROWS);
  const eps = 0.01;
  const dotKeys = options.dots && options.dots.length > 0 ? new Set(options.dots.map(pointKey)) : null;
  const isDot = (p: GraphPathPoint) => dotKeys !== null && dotKeys.has(pointKey(p));
  let pts = dedupe(points);
  let changed = true;
  while (changed && pts.length > 2) {
    changed = false;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1], b = pts[i], c = pts[i + 1];
      const dy1 = b.y - a.y, dy2 = c.y - b.y;
      const sameDirection = dy1 * dy2 >= 0;
      const laneChangeThenStub = a.x !== b.x && b.x === c.x && sameDirection;
      const stubThenLaneChange = a.x === b.x && b.x !== c.x && sameDirection;
      if (!isDot(b) && (laneChangeThenStub || stubThenLaneChange)) {
        const total = Math.abs(c.y - a.y);
        if (total <= cap + eps) {
          // Fits inside the budget: one transition covers the whole chain.
          pts.splice(i, 1);
          changed = true;
          i--;
          continue;
        }
        // Grow the transition to the full budget by trimming the stub it
        // borrows from (only possible while the lane change itself fits).
        const laneChangeSpan = laneChangeThenStub ? Math.abs(dy1) : Math.abs(dy2);
        if (laneChangeSpan < cap - eps) {
          const sign = c.y > a.y ? 1 : -1;
          pts[i] = laneChangeThenStub
            ? { x: b.x, y: a.y + sign * cap }
            : { x: b.x, y: c.y - sign * cap };
          changed = true;
          i--;
          continue;
        }
      }
      if (!isDot(b)) {
        const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
        if (collinear) {
          pts.splice(i, 1);
          changed = true;
          i--;
        }
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
 * lane change is a cubic with control offset `span * 0.8` (rounded, default)
 * or a two-segment kink with `span * 0.38` (angular). `normalizeGraphPoints`
 * first folds each lane change into the neighbouring straight run so the bend
 * sweeps over several rows.
 */
export function buildGraphPathD(
  points: GraphPathPoint[],
  style: GraphStyle,
  rowHeight: number,
  options: GraphPathOptions = {},
): string {
  const pts = normalizeGraphPoints(points, rowHeight, options);
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
