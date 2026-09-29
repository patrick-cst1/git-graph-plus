import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: unknown[]) => unknown>,
  showTextDocument: vi.fn(async () => undefined),
  setStatusBarMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  activeEditor: undefined as unknown,
}));

vi.mock('vscode', () => {
  class Uri {
    scheme = 'file';
    fsPath: string;
    query = '';
    path: string;
    constructor(fsPath: string) {
      this.fsPath = fsPath;
      this.path = fsPath.replace(/\\/g, '/');
    }
    with(change: Record<string, unknown>): Uri {
      const next = new Uri(this.fsPath);
      Object.assign(next, change);
      return next;
    }
    static file(p: string): Uri {
      return new Uri(p);
    }
  }
  return {
    Uri,
    commands: {
      registerCommand: (id: string, cb: (...args: unknown[]) => unknown) => {
        H.handlers[id] = cb;
        return { dispose() {} };
      },
      executeCommand: vi.fn(),
    },
    window: {
      get activeTextEditor() { return H.activeEditor; },
      showTextDocument: H.showTextDocument,
      setStatusBarMessage: H.setStatusBarMessage,
      showInformationMessage: H.showInformationMessage,
      showQuickPick: vi.fn(async () => undefined),
      onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    },
  };
});

vi.mock('../../services/repo-resolver', () => ({
  getRepoRootForFile: () => '/repo',
}));

import { registerRevisionNavigator } from '../revision-navigator';
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

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function setup() {
  const service = {
    rootPath: '/repo',
    fileHistory: vi.fn(async () => [commit(A, 'newest'), commit(B, 'older')]),
  } as unknown as GitService;
  registerRevisionNavigator({ subscriptions: [] } as never, {
    getGitServiceForFile: () => service,
  });
  return service;
}

const editor = (fsPath: string) => ({
  document: { uri: { scheme: 'file', fsPath } },
} as unknown);

describe('revision navigator', () => {
  beforeEach(() => {
    H.handlers = {};
    H.showTextDocument.mockClear();
    H.setStatusBarMessage.mockClear();
    H.showInformationMessage.mockClear();
    H.activeEditor = undefined;
  });

  it('steps from the working tree to the newest revision and back', async () => {
    setup();
    H.activeEditor = editor('/repo/a.ts');

    await H.handlers['gitGraphPlus.nextRevision']();
    expect(H.showTextDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ scheme: 'git', query: expect.stringContaining(A) }),
      expect.anything(),
    );

    // Opening a revision makes its (read-only) editor the active one; mirror
    // that so the next step starts from revision A.
    H.activeEditor = { document: { uri: (H.showTextDocument.mock.calls.at(-1) as unknown[])[0] } };

    await H.handlers['gitGraphPlus.nextRevision']();
    expect(H.showTextDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({ scheme: 'git', query: expect.stringContaining(B) }),
      expect.anything(),
    );
    H.activeEditor = { document: { uri: (H.showTextDocument.mock.calls.at(-1) as unknown[])[0] } };

    // Older than the loaded history → stays put with a status message.
    H.showTextDocument.mockClear();
    await H.handlers['gitGraphPlus.nextRevision']();
    expect(H.showTextDocument).not.toHaveBeenCalled();
    expect(H.setStatusBarMessage).toHaveBeenLastCalledWith(expect.stringContaining('no older revision'), 3000);
  });

  it('does not step past the working tree', async () => {
    setup();
    H.activeEditor = editor('/repo/a.ts');

    await H.handlers['gitGraphPlus.previousRevision']();
    expect(H.showTextDocument).not.toHaveBeenCalled();
    expect(H.setStatusBarMessage).toHaveBeenLastCalledWith(expect.stringContaining('working tree'), 3000);
  });

  it('does nothing without a file editor', async () => {
    setup();
    H.activeEditor = undefined;
    await H.handlers['gitGraphPlus.nextRevision']();
    expect(H.showTextDocument).not.toHaveBeenCalled();
  });
});
