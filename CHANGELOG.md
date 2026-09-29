# Changelog

## 0.7.35

- Branch focus now covers only the branch's **own commits**, from its fork point
  to its tip — in **filter** mode the log is scoped to that range (the fork
  point itself is kept as the boundary), and in **dim** mode everything outside
  it is faded. The base branch's earlier history is no longer shown or
  highlighted. The fork point is the merge base with the repository's default
  branch; focusing several branches, or a branch with no commits of its own,
  keeps the full history.
- **Load more** now carries the branch / remote / focus scope, so paging no
  longer drops an active filter.

## 0.7.34

- Returning from a commit peek in the compare panel now lands you back where
  you left off: the row you opened stays highlighted and the list scrolls back
  to it, instead of jumping to the top.

## 0.7.33

- Clicking a commit in the compare panel's **Ahead / Behind / All** lists now
  peeks it in the panel (details + changes) instead of leaving compare mode,
  with a **Back to comparison** button (and Esc) returning to the list. The
  graph keeps the compare pair selected, and a peeked commit that is not part of
  the loaded graph is fetched on demand.

## 0.7.32

- Opening a folder that is not a git repository now offers an **Initialise
  Repository** button in the graph: it runs `git init` and creates an empty
  initial commit in one step. (An initialised but empty repository already had
  its own **Create initial commit** button.)

## 0.7.31

- Compare mode now has **Ahead / Behind / All** tabs next to the file view:
  they list the commits each side has that the other does not (with live
  counts), and clicking a commit opens it. The lists are fetched together with
  the compare diff, one `git log <base>..<head>` per direction.

## 0.7.30

- Fixes: the remote-branch **Delete Remote Branch** context-menu item now
  opens the delete dialog (it was never wired up), the File History and
  Search & Compare views no longer show two refresh buttons, and **Show Line
  History** no longer includes the line after a selection that ends at column 0.

## 0.7.29

- **Search & Compare** view in the Source Control sidebar: search commit
  messages (a hex query jumps to the commit) and compare two branches or tags
  to list the changed files — click a file to open its diff between the refs.
- **Git Command Palette** (`gitGraphPlus.gitCommandPalette`): one quick pick
  that guides fetch / pull / push, branch / tag / stash, checkout, merge,
  rebase, reset (with a hard-reset confirmation), cherry-pick, revert, amend,
  undo last commit, continue / abort the running operation, and clean.

## 0.7.28

- **File History** view in the Source Control sidebar: the commits that touched
  the active editor's file (rename-aware, paged with **Load more**). Right-click
  a commit to open the file at that revision, compare it with the previous
  revision, or copy its SHA; click it to open it in Commit Timeline.
- **Show Line History**: select lines in the editor and run it from the editor
  context menu to see only the commits that changed them (clear the filter from
  the view title).
- **Revision navigator**: `Open File Revision…` picks any revision of the
  current file; `Go to Older/Newer Revision` steps through them read-only.
- **Show File History Chart**: a chart of the file's commits over time, stacked
  by author.

## 0.7.27

- File annotations for the active editor, toggled from the editor title bar:
  **Blame** shows the author and age after every line, **Changes** highlights
  lines added / modified / removed versus HEAD, and **Heatmap** tints lines by
  how recently they were changed.
- Optional **CodeLens** above each blame block (author + age); click it to open
  the commit in Commit Timeline. Off by default — enable
  `gitGraphPlus.codeLens.enabled`.
- The editor title bar now also carries the current-line blame toggle with a
  checked state, and every toggle only appears for real files.

## 0.7.26

- Editor blame: the current line shows the commit that last changed it, the
  status bar shows the same commit (click to open it in Commit Timeline), and
  hovering a line shows full commit details with a link into the panel. All
  three share one cached blame engine and can be toggled in Settings
  (`gitGraphPlus.currentLineBlame.*`, `gitGraphPlus.statusBarBlame.enabled`,
  `gitGraphPlus.hovers.enabled`).

## 0.7.25

- Reflog entries can now be recovered directly from the context menu:
  **New Branch** / **New Tag** pin a commit that no branch points at any more
  (e.g. after a bad reset or rebase), and **Cherry-Pick Commit** moves it onto
  the current branch.

## 0.7.24

- Merge connectors (the lines leaving a merge commit to join the merged
  branch) now use the same one-sweep quadratic as the branch-line transitions,
  so every bend matches the head/tail style instead of the private two-bend S.
- **Simplify** toggle in the filter bar: show only the structural commits of
  the loaded log — branch/tag/remote tips, merges, forks and the load
  boundary. Recomputed from the already-loaded commits, no extra git call, and
  remembered for the session.
- The adjustable commit columns are now opt-in: enable
  `gitGraphPlus.resizableColumns` to drag column borders and right-click the
  header to show or hide columns. Off by default, the Author / SHA / Date
  columns keep their fixed widths.

## 0.7.23

- Commit list columns: drag the border between the Author / SHA / Date headers
  to resize any column, and right-click the header to show or hide columns. The
  layout is remembered between webview reloads.

## 0.7.22

- Branch focus in the graph header: one-click **Solo** on any branch in the
  branch dropdown, a **Dim others** mode that keeps the full graph and fades
  everything outside the focused branches, and **Hide** to drop a branch (and
  its exclusive commits) from the graph. Hidden branches are listed in the
  dropdown for unhiding, and the filter button shows the focused branch.

## 0.7.21

- Draw the default (`rounded`) lines with Git Graph Plus's upstream transition
  geometry: a corner-hugging quadratic for right moves, a gentle cubic
  mid-path, and a flat entry on the final left move. Each bend is a single
  sweeping curve into the next commit, with no extra hook at its ends.

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
