// File History view: the commits that touched the active editor's file
// (`git log --follow`), paged. When the user runs "Show Line History" the
// same view switches to `git log -L <start>,<end>:<file>` until the line
// filter is cleared.

import * as vscode from 'vscode';
import * as path from 'path';
import type { GitService } from '../git/git-service';
import type { Commit } from '../git/types';
import { formatRelativeTime } from '../utils/blame-format';

export const FILE_HISTORY_PAGE_SIZE = 50;
export const LINE_MODE_CONTEXT = 'gitGraphPlus.fileHistory.lineMode';

export interface FileHistoryViewState {
  /** Repo-relative path of the tracked file (POSIX separators). */
  relativePath?: string;
  lineRange?: { start: number; end: number };
  loading: boolean;
  error?: string;
  count: number;
  hasMore: boolean;
}

export interface FileHistoryViewOptions {
  /** GitService for the repo that owns a file, or undefined when not in a repo. */
  getGitServiceForFile: (fsPath: string) => GitService | undefined;
}

export type FileHistoryItem = FileHistoryCommitItem | FileHistoryLoadMoreItem;

export class FileHistoryViewProvider implements vscode.TreeDataProvider<FileHistoryItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly _onDidChangeState = new vscode.EventEmitter<FileHistoryViewState>();
  readonly onDidChangeState = this._onDidChangeState.event;

  private fsPath: string | undefined;
  private relativePath: string | undefined;
  private lineRange: { start: number; end: number } | undefined;
  private commits: Commit[] = [];
  private hasMore = false;
  private loading = false;
  private error: string | undefined;
  private fetchId = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: FileHistoryViewOptions) {}

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this._onDidChangeTreeData.dispose();
    this._onDidChangeState.dispose();
  }

  /** Absolute path of the tracked file, or undefined. */
  getFilePath(): string | undefined {
    return this.fsPath;
  }

  /** The commit currently shown at the given tree index, if loaded. */
  getCommitAt(index: number): Commit | undefined {
    return this.commits[index];
  }

  /** Track the active editor's file; resets any line filter when it changes. */
  setActiveEditor(editor: vscode.TextEditor | undefined): void {
    const fsPath = editor && editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
    if (fsPath === this.fsPath) return;
    this.fsPath = fsPath;
    this.lineRange = undefined;
    this.commits = [];
    this.hasMore = false;
    this.schedule(0);
  }

  /** Switch the view to the history of a line range of the given editor. */
  showLineRange(editor: vscode.TextEditor, start: number, end: number): void {
    if (editor.document.uri.scheme !== 'file') return;
    const first = Math.max(1, Math.floor(start));
    const last = Math.max(first, Math.floor(end));
    this.fsPath = editor.document.uri.fsPath;
    this.lineRange = { start: first, end: last };
    this.commits = [];
    this.hasMore = false;
    this.schedule(0);
  }

  /** Drop the line filter and show the whole file's history again. */
  clearLineRange(): void {
    if (!this.lineRange) return;
    this.lineRange = undefined;
    this.schedule(0);
  }

  /** Debounced refresh (used for watcher/save-driven updates). */
  schedule(delay = 250): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.fetchPage(false);
    }, delay);
  }

  /** Refresh now (user-invoked). */
  refresh(): void {
    this.schedule(0);
  }

  /** Fetch the next page of older commits. */
  loadMore(): void {
    if (!this.hasMore || this.loading) return;
    void this.fetchPage(true);
  }

  private emitState(): void {
    void vscode.commands.executeCommand('setContext', LINE_MODE_CONTEXT, this.lineRange !== undefined);
    this._onDidChangeState.fire({
      relativePath: this.relativePath,
      lineRange: this.lineRange,
      loading: this.loading,
      error: this.error,
      count: this.commits.length,
      hasMore: this.hasMore,
    });
  }

  private async fetchPage(append: boolean): Promise<void> {
    const id = ++this.fetchId;
    const fsPath = this.fsPath;

    if (!fsPath) {
      this.commits = [];
      this.hasMore = false;
      this.error = undefined;
      this.loading = false;
      this.relativePath = undefined;
      this._onDidChangeTreeData.fire();
      this.emitState();
      return;
    }

    const service = this.options.getGitServiceForFile(fsPath);
    const rel = service ? path.relative(service.rootPath, fsPath).split(path.sep).join('/') : '';
    if (!service || !rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      this.commits = [];
      this.hasMore = false;
      this.error = 'Not inside a git repository.';
      this.loading = false;
      this.relativePath = undefined;
      this._onDidChangeTreeData.fire();
      this.emitState();
      return;
    }

    this.relativePath = rel;
    this.loading = true;
    this.emitState();

    try {
      let page: Commit[];
      if (this.lineRange) {
        page = await service.lineHistory(rel, this.lineRange.start, this.lineRange.end, FILE_HISTORY_PAGE_SIZE);
        this.hasMore = false;
      } else {
        page = await service.fileHistory(rel, {
          limit: FILE_HISTORY_PAGE_SIZE,
          skip: append ? this.commits.length : 0,
        });
        this.hasMore = page.length === FILE_HISTORY_PAGE_SIZE;
      }
      if (id !== this.fetchId || fsPath !== this.fsPath) return;
      this.commits = append ? [...this.commits, ...page] : page;
      this.error = undefined;
    } catch (err) {
      if (id !== this.fetchId || fsPath !== this.fsPath) return;
      // Keep the previously loaded page (same file): the error is surfaced in
      // the view message and Load more can be retried.
      this.error = err instanceof Error ? err.message : 'Failed to load file history.';
    } finally {
      if (id === this.fetchId && fsPath === this.fsPath) {
        this.loading = false;
        this._onDidChangeTreeData.fire();
        this.emitState();
      }
    }
  }

  getTreeItem(element: FileHistoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FileHistoryItem): FileHistoryItem[] {
    if (element) return [];
    const items: FileHistoryItem[] = this.commits.map((c) => new FileHistoryCommitItem(c));
    if (this.hasMore) items.push(new FileHistoryLoadMoreItem());
    return items;
  }
}

export class FileHistoryCommitItem extends vscode.TreeItem {
  readonly kind = 'commit';
  constructor(readonly commit: Commit) {
    super(commit.subject || commit.abbreviatedHash, vscode.TreeItemCollapsibleState.None);
    const when = Number.isFinite(Date.parse(commit.author.date))
      ? formatRelativeTime(Date.parse(commit.author.date) / 1000)
      : '';
    this.description = [commit.author.name, when].filter(Boolean).join(', ');
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${commit.subject}**\n\n`);
    md.appendMarkdown(`${commit.author.name} · ${commit.author.date}\n\n`);
    md.appendMarkdown(`\`${commit.abbreviatedHash}\``);
    this.tooltip = md;
    this.iconPath = new vscode.ThemeIcon('git-commit');
    this.contextValue = 'fileHistoryCommit';
    this.command = {
      command: 'gitGraphPlus.showCommit',
      title: 'Open in Commit Timeline',
      arguments: [commit.hash],
    };
  }
}

export class FileHistoryLoadMoreItem extends vscode.TreeItem {
  readonly kind = 'loadMore';
  constructor() {
    super('Load more…', vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('ellipsis');
    this.contextValue = 'fileHistoryLoadMore';
    this.command = { command: 'gitGraphPlus.fileHistory.loadMore', title: 'Load More' };
  }
}
