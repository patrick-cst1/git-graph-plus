import type { GraphStyle } from '../types';

/** SourceGit-style waypoint in pixel coordinates. */
export interface GraphPathPoint {
  x: number;
  y: number;
}

/** Knobs for the transition geometry / dot anchoring. */
export interface GraphPathOptions {
  /**
   * Optional cap on how many rows a lane change may sweep over. Defaults to a
   * single row (mhutchie Git Graph's geometry); larger values widen the sweep.
   */
  maxTransitionRows?: number;
  /**
   * Commit dots (pixel coordinates). The line must keep passing exactly
   * through its own commits, so a dot is never smoothed away: it always stays
   * an endpoint of a drawn segment.
   */
  dots?: readonly GraphPathPoint[];
}

/** mhutchie angular control-offset factor (of the transition span). */
const FACTOR_ANGULAR = 0.38;

/**
 * mhutchie Git Graph draws one segment per commit row, so a lane change is
 * always a single-row transition with its fixed 80% (0.8 * row) control
 * offset. Keep that as the default: the line stays on its lane, connects every
 * commit dot and never sweeps across the graph. `maxTransitionRows` can widen
 * the sweep when experimenting.
 */
const DEFAULT_MAX_TRANSITION_ROWS = 1;

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
 * collapse collinear runs, so the bend is a full mhutchie-style row instead of
 * a half-row hook (or, with a larger `maxTransitionRows`, a wider sweep).
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
 * Vertical runs are straight `L`s. `rounded` (default) uses Git Graph Plus's
 * upstream transition geometry — a corner-hugging quadratic for right moves,
 * a gentle cubic mid-path and a flat quadratic entry on the final left move —
 * so each bend is a single sweeping curve with no extra hook at its ends.
 * `angular` uses mhutchie's two-segment kink (`span * 0.38`).
 * `normalizeGraphPoints` first folds lane changes into the neighbouring
 * straight runs.
 */
export function buildGraphPathD(
  points: GraphPathPoint[],
  style: GraphStyle,
  rowHeight: number,
  options: GraphPathOptions = {},
): string {
  const pts = normalizeGraphPoints(points, rowHeight, options);
  if (pts.length < 2) return '';

  const parts: string[] = [`M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`];

  for (let i = 1; i < pts.length; i++) {
    const last = pts[i - 1];
    const cur = pts[i];

    if (cur.x === last.x || cur.y === last.y) {
      parts.push(`L ${fmt(cur.x)} ${fmt(cur.y)}`);
      continue;
    }

    if (style === 'angular') {
      const d = Math.abs(cur.y - last.y) * FACTOR_ANGULAR;
      // mhutchie angular: a diagonal to (cur.x, cur.y - d) then vertical when the
      // line locks to its destination, or vertical then a diagonal to the
      // destination. Lock to the destination lane when moving right, and to the
      // source lane when moving left.
      if (cur.x > last.x) parts.push(`L ${fmt(cur.x)} ${fmt(cur.y - d)}`);
      else parts.push(`L ${fmt(last.x)} ${fmt(last.y + d)}`);
      parts.push(`L ${fmt(cur.x)} ${fmt(cur.y)}`);
    } else if (cur.x > last.x) {
      // Git Graph Plus: corner-hugging quadratic — leaves horizontally, sweeps
      // around the corner and arrives vertically on the new lane.
      parts.push(`Q ${fmt(cur.x)} ${fmt(last.y)}, ${fmt(cur.x)} ${fmt(cur.y)}`);
    } else if (i < pts.length - 1) {
      // Git Graph Plus: a gentle S across the transition.
      const midY = (last.y + cur.y) / 2;
      parts.push(`C ${fmt(last.x)} ${fmt(midY + 4)}, ${fmt(cur.x)} ${fmt(midY - 4)}, ${fmt(cur.x)} ${fmt(cur.y)}`);
    } else {
      // Git Graph Plus: flat entry — leaves vertically and sweeps horizontally
      // into the last point.
      parts.push(`Q ${fmt(last.x)} ${fmt(cur.y)}, ${fmt(cur.x)} ${fmt(cur.y)}`);
    }
  }

  return parts.join(' ');
}
