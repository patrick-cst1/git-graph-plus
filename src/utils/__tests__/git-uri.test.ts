import { describe, it, expect, vi } from 'vitest';

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
  return { Uri };
});

import { toGitUri, gitUriRef } from '../git-uri';

describe('git-uri', () => {
  it('builds a git-scheme URI with the built-in provider query shape', () => {
    const uri = toGitUri('/repo/src/a.ts', 'abc123');
    expect(uri.scheme).toBe('git');
    expect(JSON.parse(uri.query)).toEqual({ path: '/repo/src/a.ts', ref: 'abc123' });
  });

  it('reads the ref back from a git-scheme URI', () => {
    const uri = toGitUri('/repo/a.ts', 'HEAD');
    expect(gitUriRef(uri)).toBe('HEAD');
  });

  it('returns undefined for other schemes and malformed queries', () => {
    expect(gitUriRef({ scheme: 'file', query: '' } as never)).toBeUndefined();
    expect(gitUriRef({ scheme: 'git', query: 'not-json' } as never)).toBeUndefined();
    expect(gitUriRef({ scheme: 'git', query: '{"ref":42}' } as never)).toBeUndefined();
  });
});
