import * as vscode from 'vscode';
import { normalizeInteractiveRebaseMode, type InteractiveRebaseMode } from '../git/classic-rebase';

/**
 * Reads the `gitGraphPlus.timeout` setting (in seconds) and returns the
 * equivalent in milliseconds for `GitService.setDefaultTimeout`. Falls back to
 * the 60s default when the value is missing or non-positive.
 */
export function readTimeoutMs(): number {
  const seconds = vscode.workspace.getConfiguration('gitGraphPlus').get<number>('timeout', 60);
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60000;
}

/** Default number of commits loaded on the first graph render / refresh. */
export const DEFAULT_INITIAL_COMMIT_COUNT = 200;
/** Default number of extra commits fetched each time "Load more" is clicked. */
export const DEFAULT_LOAD_MORE_COMMIT_COUNT = 50;
/** Default for `gitGraphPlus.autoLoadHistory`: off, so "Load more" stays manual. */
export const DEFAULT_AUTO_LOAD_HISTORY = false;

function readPositiveIntSetting(key: string, fallback: number): number {
  const raw = vscode.workspace.getConfiguration('gitGraphPlus').get<number>(key, fallback);
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : fallback;
}

/**
 * Reads `gitGraphPlus.initialCommitCount` — how many commits to load when the
 * graph first renders (and on refresh). Falls back to 200 when unset/invalid.
 */
export function readInitialCommitCount(): number {
  return readPositiveIntSetting('initialCommitCount', DEFAULT_INITIAL_COMMIT_COUNT);
}

/**
 * Reads `gitGraphPlus.loadMoreCommitCount` — how many additional commits each
 * "Load more" click fetches. Falls back to 50 when unset/invalid.
 */
export function readLoadMoreCommitCount(): number {
  return readPositiveIntSetting('loadMoreCommitCount', DEFAULT_LOAD_MORE_COMMIT_COUNT);
}

/**
 * Reads `gitGraphPlus.autoLoadHistory` — whether scrolling near the bottom of
 * the graph automatically fetches the next chunk (issue #61). Falls back to
 * false when unset, so the default behaviour keeps the "Load more" button
 * manual.
 */
export function readAutoLoadHistory(): boolean {
  return vscode.workspace
    .getConfiguration('gitGraphPlus')
    .get<boolean>('autoLoadHistory', DEFAULT_AUTO_LOAD_HISTORY) === true;
}

/**
 * Reads `gitGraphPlus.lfsLocks` — whether to poll the origin server for Git LFS
 * lock status. Falls back to `true` (the previous behaviour) when unset or
 * non-boolean.
 */
export function readLfsLocksEnabled(): boolean {
  const enabled = vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('lfsLocks', true);
  return typeof enabled === 'boolean' ? enabled : true;
}

/**
 * Reads `gitGraphPlus.interactiveRebase.mode` — whether interactive rebase
 * opens the GUI editor (`ui`, default) or runs classic `git rebase -i` in the
 * integrated terminal (`classic`).
 */
export function readInteractiveRebaseMode(): InteractiveRebaseMode {
  return normalizeInteractiveRebaseMode(
    vscode.workspace.getConfiguration('gitGraphPlus').get<string>('interactiveRebase.mode', 'ui'),
  );
}

/** Which tab the commit details panel opens on when a commit is selected. */
export type DefaultCommitTab = 'details' | 'changes';
/** Default commit-details tab, preserving the pre-setting behavior. */
export const DEFAULT_COMMIT_TAB: DefaultCommitTab = 'details';

/**
 * Reads `gitGraphPlus.defaultCommitTab` — whether the commit details panel
 * opens on the Details (`details`, default) or Changes/diff (`changes`) tab
 * when a commit is clicked. Falls back to `details` when unset/invalid.
 */
export function readDefaultCommitTab(): DefaultCommitTab {
  const raw = vscode.workspace.getConfiguration('gitGraphPlus').get<string>('defaultCommitTab', DEFAULT_COMMIT_TAB);
  return raw === 'changes' ? 'changes' : DEFAULT_COMMIT_TAB;
}

/**
 * Reads `gitGraphPlus.showStashes` — whether stashes are rendered in the
 * commit graph and included in commit search results. Defaults to true
 * (stashes visible) so existing behaviour is unchanged.
 */
export function readShowStashes(): boolean {
  const raw = vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('showStashes', true);
  return typeof raw === 'boolean' ? raw : true;
}

/** Line style used when drawing the commit graph. */
export type GraphStyle = 'rounded' | 'angular';

/** Default value of `gitGraphPlus.graphStyle`. */
export const DEFAULT_GRAPH_STYLE: GraphStyle = 'rounded';

/** Maps any raw setting value to a supported graph style (`rounded` fallback). */
export function normalizeGraphStyle(value: unknown): GraphStyle {
  return value === 'angular' ? 'angular' : 'rounded';
}

/**
 * Reads `gitGraphPlus.graphStyle` — `rounded` (default) draws smooth curves,
 * `angular` draws straight lines with right-angled elbows. Falls back to
 * `rounded` when unset or invalid.
 */
export function readGraphStyle(): GraphStyle {
  return normalizeGraphStyle(
    vscode.workspace.getConfiguration('gitGraphPlus').get<string>('graphStyle', DEFAULT_GRAPH_STYLE),
  );
}

/**
 * Reads `gitGraphPlus.showAvatars` — whether author/committer avatars are
 * shown in the graph, hover cards, commit details, and stats view. Defaults to
 * true; only an explicit `false` disables them.
 */
export function readShowAvatars(): boolean {
  return vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('showAvatars', true) !== false;
}

/**
 * Reads `gitGraphPlus.showStats` — whether the Stats view is offered in the
 * toolbar. Defaults to false; only an explicit `true` enables it.
 */
export function readShowStats(): boolean {
  return vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('showStats', false) === true;
}
