// Search & Compare view (SCM sidebar): a home for the commit search and the
// ref-to-ref comparison. Results are rendered as a small tree; commands live
// in extension.ts (quick picks, diff URIs, opening the panel).

import * as vscode from 'vscode';
import type { GitService } from '../git/git-service';
import type { Commit, DiffData } from '../git/types';
import { formatRelativeTime } from '../utils/blame-format';

export const SEARCH_RESULT_LIMIT = 50;

export type SearchCompareMode = 'search' | 'compare';

export interface SearchCompareState {
  mode: SearchCompareMode;
  query: string;
  base: string;
  head: string;
  loading: boolean;
  error?: string;
  count: number;
}

export interface SearchCompareViewOptions {
  /** GitService of the active repository, or undefined when none. */
  getService: () => GitService | undefined;
}

export type SearchCompareItem =
  | SearchCompareHeaderItem
  | SearchCompareCommitItem
  | SearchCompareFileItem;

export class SearchCompareViewProvider implements vscode.TreeDataProvider<SearchCompareItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly _onDidChangeState = new vscode.EventEmitter<SearchCompareState>();
  readonly onDidChangeState = this._onDidChangeState.event;

  private mode: SearchCompareMode = 'search';
  private query = '';
  private base = '';
  private head = '';
  private commits: Commit[] = [];
  private files: DiffData[] = [];
  private loading = false;
  private error: string | undefined;
  private fetchId = 0;

  constructor(private readonly options: SearchCompareViewOptions) {}

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this._onDidChangeState.dispose();
  }

  getState(): SearchCompareState {
    return {
      mode: this.mode,
      query: this.query,
      base: this.base,
      head: this.head,
      loading: this.loading,
      error: this.error,
      count: this.mode === 'search' ? this.commits.length : this.files.length,
    };
  }

  /** Run a commit-message/author search and show the results. */
  async search(query: string): Promise<void> {
    const service = this.options.getService();
    const id = ++this.fetchId;
    this.mode = 'search';
    this.query = query;
    this.commits = [];
    this.files = [];
    this.error = undefined;
    this.loading = true;
    this.fire();
    if (!service) {
      this.loading = false;
      this.error = 'No git repository.';
      this.fire();
      return;
    }
    try {
      // A hex-looking query is treated as a commit hash first (same as the
      // graph's search box); anything else greps the commit messages.
      const isHash = /^[0-9a-f]{7,40}$/i.test(query.trim());
      const results = isHash
        ? await service.searchByHash(query.trim()).then((c) => (c ? [c] : []))
        : await service.searchCommits(query.trim(), { limit: SEARCH_RESULT_LIMIT });
      if (id !== this.fetchId) return;
      this.commits = results;
    } catch (err) {
      if (id !== this.fetchId) return;
      this.error = err instanceof Error ? err.message : 'Search failed.';
    } finally {
      if (id === this.fetchId) {
        this.loading = false;
        this.fire();
      }
    }
  }

  /** Show the files changed between two refs. */
  async compare(base: string, head: string): Promise<void> {
    const service = this.options.getService();
    const id = ++this.fetchId;
    this.mode = 'compare';
    this.base = base;
    this.head = head;
    this.commits = [];
    this.files = [];
    this.error = undefined;
    this.loading = true;
    this.fire();
    if (!service) {
      this.loading = false;
      this.error = 'No git repository.';
      this.fire();
      return;
    }
    try {
      const files = await service.diffCommits(base, head);
      if (id !== this.fetchId) return;
      this.files = files;
    } catch (err) {
      if (id !== this.fetchId) return;
      this.error = err instanceof Error ? err.message : 'Compare failed.';
    } finally {
      if (id === this.fetchId) {
        this.loading = false;
        this.fire();
      }
    }
  }

  /** Clear the results and return to the empty state. */
  clear(): void {
    this.fetchId++;
    this.query = '';
    this.base = '';
    this.head = '';
    this.commits = [];
    this.files = [];
    this.error = undefined;
    this.loading = false;
    this.fire();
  }

  /** Re-run the last search/compare (used by the refresh button). */
  refresh(): void {
    if (this.mode === 'search' && this.query) void this.search(this.query);
    else if (this.mode === 'compare' && this.base && this.head) void this.compare(this.base, this.head);
    else this.fire();
  }

  getBase(): string {
    return this.base;
  }

  getHead(): string {
    return this.head;
  }

  private fire(): void {
    this._onDidChangeTreeData.fire();
    this._onDidChangeState.fire(this.getState());
  }

  getTreeItem(element: SearchCompareItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SearchCompareItem): SearchCompareItem[] {
    if (element) return [];
    const items: SearchCompareItem[] = [];
    if (this.mode === 'search') {
      if (this.query) items.push(new SearchCompareHeaderItem(`Search: "${this.query}"`, `${this.commits.length} result${this.commits.length === 1 ? '' : 's'}`));
      items.push(...this.commits.map((c) => new SearchCompareCommitItem(c)));
    } else if (this.base && this.head) {
      items.push(new SearchCompareHeaderItem(`${this.base} → ${this.head}`, `${this.files.length} file${this.files.length === 1 ? '' : 's'}`));
      items.push(...this.files.map((f) => new SearchCompareFileItem(f)));
    }
    return items;
  }
}

export class SearchCompareHeaderItem extends vscode.TreeItem {
  readonly kind = 'header';
  constructor(label: string, description: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.contextValue = 'searchCompareHeader';
  }
}

export class SearchCompareCommitItem extends vscode.TreeItem {
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
    this.contextValue = 'searchCompareCommit';
    this.command = {
      command: 'gitGraphPlus.showCommit',
      title: 'Open in Commit Timeline',
      arguments: [commit.hash],
    };
  }
}

export class SearchCompareFileItem extends vscode.TreeItem {
  readonly kind = 'file';
  constructor(readonly diff: DiffData) {
    super(diff.file, vscode.TreeItemCollapsibleState.None);
    this.description = diff.isBinary ? 'binary' : `${diff.hunks.length} hunk${diff.hunks.length === 1 ? '' : 's'}`;
    this.iconPath = new vscode.ThemeIcon('diff');
    this.contextValue = 'searchCompareFile';
    this.command = {
      command: 'gitGraphPlus.searchCompare.openFileDiff',
      title: 'Open Diff',
      arguments: [this],
    };
  }
}
