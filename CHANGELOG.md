# Changelog

## 0.7.20

- Align the graph lines with mhutchie Git Graph's geometry again: a lane change
  is a single one-row transition (0.8-row control offset), so lines stay on
  their lanes, every commit dot stays connected and nothing sweeps across the
  graph. Reverts the experimental wide/spread transitions.

## 0.7.19

- Spread each lane change across the whole run between the two surrounding
  commits: the line now drifts gradually (parabola-like) the whole way into the
  next commit instead of bending early and then running straight.

## 0.7.18

- Tune the transition sweep to two rows (48px): three rows felt too swoopy and
  one row too tight.

## 0.7.17

- Sweep lane changes over up to three rows (borrowing from the straight run)
  instead of one, so graph lines flow through the bend like a parabola rather
  than turning a tight corner.
- Keep commit dots as curve anchors: a dot is never smoothed away, so the line
  always passes exactly through its own commits.

## 0.7.16

- Draw branch transitions over a full row so graph lines bend with wider,
  rounder curves (mhutchie Git Graph geometry) instead of tightening into
  right-angled elbows; SourceGit half-row waypoints and straight horizontal
  stubs are folded into a single transition.
- Emit path coordinates rounded to 2 decimals (smaller DOM, no visual change).

## 0.7.15

- Merge the remote fork line into this fork: the two-commit compare feature
  (2-dot/3-dot scope, merge-tree conflict checks, conflict preview) now ships
  alongside everything below.
- Stats stays a single opt-in view (`gitGraphPlus.showStats`, off by default);
  the duplicate toolbar wiring was removed so there is no overlapping feature.
- Search/reflog navigation uses a single nonce guard; the graph scrolls exactly
  once per navigation request and never re-scrolls to a stale target.

## 0.7.14

- Fix the graph scrolling back to a previous search / reflog target when the
  bottom panel opens (a single commit click could jump the view unexpectedly).

## 0.7.13

- Add a "create initial commit" action when the repository has no commits yet.
- Add a Skip action for conflicting rebases and cherry-picks.
- Add an opt-in Stats view (`gitGraphPlus.showStats`, off by default).
- Fix the author column so names align with the header when no avatar is shown.
- Fix merge lines drawing with sharp corners instead of smooth rounded curves.

## 0.7.12

- First public release of this fork.
