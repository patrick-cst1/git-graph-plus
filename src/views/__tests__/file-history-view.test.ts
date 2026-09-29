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
    window: { activeTextEditor: undefined },
  };
});

import * as vscode from 'vscode';
import { FileHistoryViewProvider, FILE_HISTORY_PAGE_SIZE } from '../file-history-view';
import type { GitService } from '../../git/git-service';
import type { Commit } from '../../git/types';

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

function mockService(): GitService & { fileHistory: ReturnType<typeof vi.fn>; lineHistory: ReturnType<typeof vi.fn> } {
  return {
    rootPath: '/repo',
    fileHistory: vi.fn(async () => []),
    lineHistory: vi.fn(async () => []),
  } as unknown as GitService & { fileHistory: ReturnType<typeof vi.fn>; lineHistory: ReturnType<typeof vi.fn> };
}

const editor = (fsPath: string) => ({
  document: { uri: { scheme: 'file', fsPath } },
} as unknown as vscode.TextEditor);

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

describe('FileHistoryViewProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the active file history and maps commits to items', async () => {
    const service = mockService();
    service.fileHistory.mockResolvedValue([commit('a'.repeat(40), 'first'), commit('b'.repeat(40), 'second')]);
    const provider = new FileHistoryViewProvider({ getGitServiceForFile: () => service });
    const states: Array<{ relativePath?: string; count: number }> = [];
    provider.onDidChangeState((s) => states.push({ relativePath: s.relativePath, count: s.count }));

    provider.setActiveEditor(editor('/repo/src/a.ts'));
    await flush();

    expect(service.fileHistory).toHaveBeenCalledWith('src/a.ts', { limit: FILE_HISTORY_PAGE_SIZE, skip: 0 });
    const items = provider.getChildren();
    expect(items.map((i) => i.label)).toEqual(['first', 'second']);
    expect(items[0].contextValue).toBe('fileHistoryCommit');
    expect((items[0].command as { command: string }).command).toBe('gitGraphPlus.showCommit');
    expect(states.at(-1)).toEqual({ relativePath: 'src/a.ts', count: 2 });
  });

  it('pages older commits with Load more', async () => {
    const service = mockService();
    const firstPage = Array.from({ length: FILE_HISTORY_PAGE_SIZE }, (_, i) => commit(String(i).padStart(40, '0'), `c${i}`));
    service.fileHistory
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([commit('f'.repeat(40), 'older')]);
    const provider = new FileHistoryViewProvider({ getGitServiceForFile: () => service });

    provider.setActiveEditor(editor('/repo/a.ts'));
    await flush();
    expect(provider.getChildren().length).toBe(FILE_HISTORY_PAGE_SIZE + 1); // + Load more

    provider.loadMore();
    await flush();

    expect(service.fileHistory).toHaveBeenLastCalledWith('a.ts', { limit: FILE_HISTORY_PAGE_SIZE, skip: FILE_HISTORY_PAGE_SIZE });
    const items = provider.getChildren();
    expect(items.length).toBe(FILE_HISTORY_PAGE_SIZE + 1);
    expect(items.at(-1)!.label).toBe('older');
  });

  it('switches to line history and clears the filter again', async () => {
    const service = mockService();
    service.lineHistory.mockResolvedValue([commit('c'.repeat(40), 'line change')]);
    const provider = new FileHistoryViewProvider({ getGitServiceForFile: () => service });

    provider.showLineRange(editor('/repo/src/a.ts'), 3, 7);
    await flush();

    expect(service.lineHistory).toHaveBeenCalledWith('src/a.ts', 3, 7, FILE_HISTORY_PAGE_SIZE);
    expect(provider.getChildren().map((i) => i.label)).toEqual(['line change']);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'gitGraphPlus.fileHistory.lineMode', true);

    provider.clearLineRange();
    await flush();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('setContext', 'gitGraphPlus.fileHistory.lineMode', false);
  });

  it('reports files outside a repository', async () => {
    const provider = new FileHistoryViewProvider({ getGitServiceForFile: () => undefined });
    const states: Array<{ error?: string }> = [];
    provider.onDidChangeState((s) => states.push({ error: s.error }));

    provider.setActiveEditor(editor('/outside/a.ts'));
    await flush();

    expect(provider.getChildren()).toEqual([]);
    expect(states.at(-1)?.error).toMatch(/not inside a git repository/i);
  });

  it('keeps the previous page and surfaces an error when a load fails', async () => {
    const service = mockService();
    service.fileHistory
      .mockResolvedValueOnce([commit('a'.repeat(40), 'first')])
      .mockRejectedValueOnce(new Error('boom'));
    const provider = new FileHistoryViewProvider({ getGitServiceForFile: () => service });
    const states: Array<{ error?: string }> = [];
    provider.onDidChangeState((s) => states.push({ error: s.error }));

    provider.setActiveEditor(editor('/repo/a.ts'));
    await flush();
    provider.refresh();
    await flush();

    expect(provider.getChildren().map((i) => i.label)).toEqual(['first']);
    expect(states.at(-1)?.error).toBe('boom');
  });

  it('does not refetch when the active editor stays on the same file', async () => {
    const service = mockService();
    const provider = new FileHistoryViewProvider({ getGitServiceForFile: () => service });
    provider.setActiveEditor(editor('/repo/a.ts'));
    await flush();
    provider.setActiveEditor(editor('/repo/a.ts'));
    await flush();
    expect(service.fileHistory).toHaveBeenCalledTimes(1);
  });
});
