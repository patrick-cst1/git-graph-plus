import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  class TreeItem {
    contextValue?: string;
    iconPath?: unknown;
    description?: string;
    tooltip?: unknown;
    command?: { command: string; title: string; arguments?: unknown[] };
    constructor(public label: string, public collapsibleState: number) {}
  }
  class ThemeIcon { constructor(public id: string) {} }
  class MarkdownString { appendMarkdown() { return this; } }
  class EventEmitter {
    private listeners: Array<(arg: unknown) => void> = [];
    event = (cb: (arg: unknown) => void) => { this.listeners.push(cb); return { dispose: () => {} }; };
    fire = (arg?: unknown) => { this.listeners.forEach((l) => l(arg)); };
    dispose = () => { this.listeners = []; };
  }
  return {
    TreeItem,
    ThemeIcon,
    MarkdownString,
    EventEmitter,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    commands: { executeCommand: vi.fn() },
  };
});

import { SearchCompareViewProvider } from '../search-compare-view';
import type { GitService } from '../../git/git-service';
import type { Commit, DiffData } from '../../git/types';

function commit(hash: string, subject: string): Commit {
  return {
    hash,
    abbreviatedHash: hash.slice(0, 7),
    subject,
    body: '',
    parents: [],
    refs: [],
    author: { name: 'Alice', email: 'a@example.com', date: '2024-01-01T00:00:00Z' },
    committer: { name: 'Alice', email: 'a@example.com', date: '2024-01-01T00:00:00Z' },
  };
}

const file = (path: string, hunks = 1): DiffData => ({
  file: path,
  hunks: Array.from({ length: hunks }, () => ({ header: '@@', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [] })),
  isBinary: false,
  isImage: false,
});

function mockService(): GitService {
  return {
    searchCommits: vi.fn(async () => []),
    searchByHash: vi.fn(async () => null),
    diffCommits: vi.fn(async () => []),
  } as unknown as GitService;
}

describe('SearchCompareViewProvider', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searches commit messages and lists the results with a header', async () => {
    const service = mockService();
    (service.searchCommits as ReturnType<typeof vi.fn>).mockResolvedValue([commit('a'.repeat(40), 'fix thing')]);
    const provider = new SearchCompareViewProvider({ getService: () => service });

    await provider.search('fix');

    expect(service.searchCommits).toHaveBeenCalledWith('fix', { limit: 50 });
    const items = provider.getChildren();
    expect(items.map((i) => i.label)).toEqual(['Search: "fix"', 'fix thing']);
    expect(items[1].contextValue).toBe('searchCompareCommit');
    expect(provider.getState()).toMatchObject({ mode: 'search', count: 1, loading: false });
  });

  it('treats a hex query as a commit hash', async () => {
    const service = mockService();
    (service.searchByHash as ReturnType<typeof vi.fn>).mockResolvedValue(commit('c'.repeat(40), 'hash hit'));
    const provider = new SearchCompareViewProvider({ getService: () => service });

    await provider.search('ccccccc');

    expect(service.searchByHash).toHaveBeenCalledWith('ccccccc');
    expect(service.searchCommits).not.toHaveBeenCalled();
    expect(provider.getChildren().map((i) => i.label)).toContain('hash hit');
  });

  it('compares two refs and lists the changed files', async () => {
    const service = mockService();
    (service.diffCommits as ReturnType<typeof vi.fn>).mockResolvedValue([file('a.ts'), file('b.ts', 3)]);
    const provider = new SearchCompareViewProvider({ getService: () => service });

    await provider.compare('main', 'feature');

    expect(service.diffCommits).toHaveBeenCalledWith('main', 'feature');
    const items = provider.getChildren();
    expect(items[0].label).toBe('main → feature');
    expect(items[0].description).toBe('2 files');
    expect(items[1].command?.command).toBe('gitGraphPlus.searchCompare.openFileDiff');
    expect(provider.getBase()).toBe('main');
    expect(provider.getHead()).toBe('feature');
  });

  it('clears the results and re-runs the last query on refresh', async () => {
    const service = mockService();
    (service.searchCommits as ReturnType<typeof vi.fn>).mockResolvedValue([commit('a'.repeat(40), 'x')]);
    const provider = new SearchCompareViewProvider({ getService: () => service });

    await provider.search('x');
    provider.clear();
    expect(provider.getChildren()).toEqual([]);
    expect(provider.getState().query).toBe('');

    await provider.search('x');
    provider.refresh();
    // search, search again after clear, and refresh re-runs the last query.
    expect(service.searchCommits).toHaveBeenCalledTimes(3);
  });

  it('surfaces errors and an empty repository', async () => {
    const provider = new SearchCompareViewProvider({ getService: () => undefined });
    await provider.search('x');
    expect(provider.getState().error).toBe('No git repository.');

    const service = mockService();
    (service.searchCommits as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    const failing = new SearchCompareViewProvider({ getService: () => service });
    await failing.search('x');
    expect(failing.getState().error).toBe('boom');
  });
});
