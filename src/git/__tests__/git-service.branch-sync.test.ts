import { describe, it, expect } from 'vitest';
import { GitService, GitError } from '../git-service';

// Right-click Push / Pull service methods (#graph branch sync). These exercise
// the remote resolution (upstream → same-named remote branch → default remote)
// and the fast-forward-only fetch outcome classification with a mocked exec.

function localBranch(name: string, opts: { current?: boolean; upstream?: string; track?: string } = {}): string {
  return `${opts.current ? '*' : ' '}${name}\x00abc1234\x00${opts.upstream ?? ''}\x00${opts.track ?? ''}\x00refs/heads/${name}`;
}

// `for-each-ref --format=%(refname:short) refs/remotes` prints one short name per line.
function remoteRef(remoteName: string, name: string): string {
  return `${remoteName}/${name}`;
}

function setup(opts: {
  branches?: string;
  remotes?: string;
  refs?: string;
  onCall?: (args: string[]) => void;
}) {
  const calls: string[][] = [];
  const service = new GitService('/tmp/repo');
  (service as any).exec = async (args: string[]) => {
    calls.push(args);
    if (args[0] === 'branch' && args[1] === '-a') return opts.branches ?? '';
    if (args[0] === 'remote') return opts.remotes ?? '';
    if (args[0] === 'for-each-ref') return opts.refs ?? '';
    opts.onCall?.(args);
    return '';
  };
  return { service, calls, fetchCalls: () => calls.filter(a => a[0] === 'fetch') };
}

describe('GitService.pushBranch', () => {
  it('pushes to the branch upstream with an explicit refspec', async () => {
    const { service, calls } = setup({
      branches: [localBranch('main', { current: true }), localBranch('feature', { upstream: 'origin/feature' })].join('\n'),
      remotes: 'origin',
    });
    await expect(service.pushBranch('feature')).resolves.toEqual({ pushed: true });
    expect(calls.filter(a => a[0] === 'push')).toEqual([['push', 'origin', 'refs/heads/feature']]);
  });

  it('re-publishes with -u when the upstream name differs (renamed branch, #97)', async () => {
    const { service, calls } = setup({
      branches: [localBranch('newname', { upstream: 'origin/oldname' })].join('\n'),
      remotes: 'origin',
    });
    await expect(service.pushBranch('newname')).resolves.toEqual({ pushed: true });
    expect(calls.filter(a => a[0] === 'push')).toEqual([['push', '-u', 'origin', 'refs/heads/newname']]);
  });

  it('re-publishes with -u when the upstream is gone', async () => {
    const { service, calls } = setup({
      branches: [localBranch('main', { current: true, upstream: 'origin/main', track: 'gone' })].join('\n'),
      remotes: 'origin',
    });
    await expect(service.pushBranch('main')).resolves.toEqual({ pushed: true });
    expect(calls.filter(a => a[0] === 'push')).toEqual([['push', '-u', 'origin', 'refs/heads/main']]);
  });

  it('publishes -u to the single remote that has a same-named branch', async () => {
    const { service, calls } = setup({
      branches: [localBranch('main', { current: true }), localBranch('feature')].join('\n'),
      remotes: 'fork',
      refs: remoteRef('fork', 'feature'),
    });
    await expect(service.pushBranch('feature')).resolves.toEqual({ pushed: true });
    expect(calls.filter(a => a[0] === 'push')).toEqual([['push', '-u', 'fork', 'refs/heads/feature']]);
  });

  it('falls back to the default remote for a never-published branch', async () => {
    const { service, calls } = setup({
      branches: [localBranch('feature')].join('\n'),
      remotes: 'origin\nfork',
    });
    await expect(service.pushBranch('feature')).resolves.toEqual({ pushed: true });
    expect(calls.filter(a => a[0] === 'push')).toEqual([['push', '-u', 'origin', 'refs/heads/feature']]);
  });

  it('prefers the default remote when several remotes have the branch', async () => {
    const { service, calls } = setup({
      branches: [localBranch('feature')].join('\n'),
      remotes: 'origin\nfork',
      refs: [remoteRef('origin', 'feature'), remoteRef('fork', 'feature')].join('\n'),
    });
    await expect(service.pushBranch('feature')).resolves.toEqual({ pushed: true });
    expect(calls.filter(a => a[0] === 'push')).toEqual([['push', '-u', 'origin', 'refs/heads/feature']]);
  });

  it('reports no-remote and does not push when no remotes exist', async () => {
    const { service, calls } = setup({ branches: [localBranch('feature')].join('\n') });
    await expect(service.pushBranch('feature')).resolves.toEqual({ pushed: false, reason: 'no-remote' });
    expect(calls.filter(a => a[0] === 'push')).toEqual([]);
  });

  it('throws for an unknown branch', async () => {
    const { service } = setup({ branches: [localBranch('main', { current: true })].join('\n'), remotes: 'origin' });
    await expect(service.pushBranch('nope')).rejects.toThrow('Branch not found');
  });
});

describe('GitService.pullBranchFastForward', () => {
  it('fast-forwards from the upstream without a checkout', async () => {
    const { service, fetchCalls } = setup({
      branches: [localBranch('main', { current: true }), localBranch('feature', { upstream: 'origin/feature' })].join('\n'),
      remotes: 'origin',
    });
    await expect(service.pullBranchFastForward('feature')).resolves.toEqual({ status: 'fetched' });
    expect(fetchCalls()).toEqual([
      ['fetch', 'origin', 'refs/heads/feature'],
      ['fetch', '.', 'refs/remotes/origin/feature:refs/heads/feature'],
    ]);
  });

  it('falls back to the single same-named remote branch when there is no upstream', async () => {
    const { service, fetchCalls } = setup({
      branches: [localBranch('feature')].join('\n'),
      remotes: 'fork',
      refs: remoteRef('fork', 'feature'),
    });
    await expect(service.pullBranchFastForward('feature')).resolves.toEqual({ status: 'fetched' });
    expect(fetchCalls()[0]).toEqual(['fetch', 'fork', 'refs/heads/feature']);
  });

  it('honours an explicit source over the upstream (remote-branch menu)', async () => {
    const { service, fetchCalls } = setup({
      branches: [localBranch('feature', { upstream: 'origin/feature' })].join('\n'),
      remotes: 'origin\nfork',
    });
    await expect(service.pullBranchFastForward('feature', { remote: 'fork', remoteBranch: 'feature' })).resolves.toEqual({ status: 'fetched' });
    expect(fetchCalls()[0]).toEqual(['fetch', 'fork', 'refs/heads/feature']);
  });

  it('reports no-upstream when nothing matches', async () => {
    const { service, fetchCalls } = setup({
      branches: [localBranch('feature')].join('\n'),
      remotes: 'origin',
      refs: remoteRef('origin', 'other'),
    });
    await expect(service.pullBranchFastForward('feature')).resolves.toEqual({ status: 'no-upstream' });
    expect(fetchCalls()).toEqual([]);
  });

  it('reports current-branch without touching git', async () => {
    const { service, fetchCalls } = setup({ branches: [localBranch('main', { current: true })].join('\n'), remotes: 'origin' });
    await expect(service.pullBranchFastForward('main')).resolves.toEqual({ status: 'current-branch' });
    expect(fetchCalls()).toEqual([]);
  });

  it('reports non-fast-forward divergences', async () => {
    const { service } = setup({
      branches: [localBranch('feature', { upstream: 'origin/feature' })].join('\n'),
      remotes: 'origin',
      onCall: (args) => {
        if (args[0] === 'fetch' && args[2]?.startsWith('refs/remotes/')) {
          throw new GitError(' ! [rejected]        feature -> feature  (non-fast-forward)', 1, args);
        }
      },
    });
    await expect(service.pullBranchFastForward('feature')).resolves.toEqual({
      status: 'non-fast-forward',
      remote: 'origin',
      remoteBranch: 'feature',
    });
  });

  it('reports branches checked out in another worktree', async () => {
    const { service } = setup({
      branches: [localBranch('feature', { upstream: 'origin/feature' })].join('\n'),
      remotes: 'origin',
      onCall: (args) => {
        if (args[0] === 'fetch' && args[2]?.startsWith('refs/remotes/')) {
          throw new GitError("fatal: refusing to fetch into branch 'refs/heads/feature' checked out at 'C:/wt'", 128, args);
        }
      },
    });
    await expect(service.pullBranchFastForward('feature')).resolves.toEqual({ status: 'checked-out' });
  });

  it('surfaces other fetch failures as errors', async () => {
    const { service } = setup({
      branches: [localBranch('feature', { upstream: 'origin/feature' })].join('\n'),
      remotes: 'origin',
      onCall: (args) => {
        if (args[0] === 'fetch' && args[2]?.startsWith('refs/remotes/')) {
          throw new GitError('fatal: couldn\'t find remote ref', 128, args);
        }
      },
    });
    await expect(service.pullBranchFastForward('feature')).rejects.toThrow('fatal: couldn\'t find remote ref');
  });
});

describe('GitService.fetchBranchInto', () => {
  it('fetches the remote branch, then updates the local ref with a local FF-only fetch', async () => {
    const { service, calls } = setup({ remotes: 'origin' });
    await expect(service.fetchBranchInto('origin', 'feature/x', 'feature/x')).resolves.toEqual({ ok: true });
    expect(calls).toEqual([
      ['fetch', 'origin', 'refs/heads/feature/x'],
      ['fetch', '.', 'refs/remotes/origin/feature/x:refs/heads/feature/x'],
    ]);
  });

  it('classifies non-fast-forward rejections', async () => {
    const { service } = setup({
      remotes: 'origin',
      onCall: (args) => {
        if (args[0] === 'fetch' && args[2]?.startsWith('refs/remotes/')) {
          throw new GitError(' ! [rejected]        feature -> feature  (non-fast-forward)', 1, args);
        }
      },
    });
    const res = await service.fetchBranchInto('origin', 'feature', 'feature');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('non-fast-forward');
  });

  it('classifies checked-out rejections', async () => {
    const { service } = setup({
      remotes: 'origin',
      onCall: (args) => {
        if (args[0] === 'fetch' && args[2]?.startsWith('refs/remotes/')) {
          throw new GitError("fatal: refusing to fetch into branch 'refs/heads/feature' checked out at 'C:/wt'", 128, args);
        }
      },
    });
    const res = await service.fetchBranchInto('origin', 'feature', 'feature');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('checked-out');
  });

  it('classifies unknown failures as other', async () => {
    const { service } = setup({
      remotes: 'origin',
      onCall: (args) => {
        if (args[0] === 'fetch' && args[2]?.startsWith('refs/remotes/')) {
          throw new GitError('some other failure', 1, args);
        }
      },
    });
    const res = await service.fetchBranchInto('origin', 'feature', 'feature');
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.reason).toBe('other');
  });
});
