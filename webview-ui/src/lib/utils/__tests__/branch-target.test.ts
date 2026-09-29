import { describe, it, expect } from 'vitest';
import { resolvePushRemote, resolvePullSource, type BranchTargetStore } from '../branch-target';
import type { BranchInfo, RemoteInfo } from '../../types';

function local(name: string, over: Partial<BranchInfo> = {}): BranchInfo {
  return { name, current: false, ahead: 0, behind: 0, hash: 'h', ...over };
}

function remote(name: string, remoteName: string): BranchInfo {
  return { name: `${remoteName}/${name}`, remote: remoteName, current: false, ahead: 0, behind: 0, hash: 'h' };
}

const remotes: RemoteInfo[] = [
  { name: 'origin', fetchUrl: 'x', pushUrl: 'x' },
  { name: 'fork', fetchUrl: 'x', pushUrl: 'x' },
];

function store(over: Partial<BranchTargetStore>): BranchTargetStore {
  return { localBranches: [], remoteBranches: [], remotes, ...over };
}

describe('resolvePushRemote', () => {
  it('uses the upstream remote when the branch tracks one', () => {
    const s = store({ localBranches: [local('feat', { upstream: 'fork/feat' })] });
    expect(resolvePushRemote('feat', s)).toBe('fork');
  });

  it('falls back to the single remote with a same-named branch', () => {
    const s = store({ localBranches: [local('feat')], remoteBranches: [remote('feat', 'fork')] });
    expect(resolvePushRemote('feat', s)).toBe('fork');
  });

  it('prefers the first remote when nothing matches', () => {
    const s = store({ localBranches: [local('feat')] });
    expect(resolvePushRemote('feat', s)).toBe('origin');
  });

  it('ignores a gone upstream and uses the same-named remote instead', () => {
    const s = store({
      localBranches: [local('feat', { upstream: 'origin/feat', upstreamGone: true })],
      remoteBranches: [remote('feat', 'fork')],
    });
    expect(resolvePushRemote('feat', s)).toBe('fork');
  });
});

describe('resolvePullSource', () => {
  it('uses the upstream as the source', () => {
    const s = store({ localBranches: [local('feat', { upstream: 'fork/feat' })] });
    expect(resolvePullSource('feat', s)).toEqual({ source: 'fork/feat', remote: 'fork', remoteBranch: 'feat' });
  });

  it('falls back to the same-named remote branch, preferring origin', () => {
    const s = store({
      localBranches: [local('feat')],
      remoteBranches: [remote('feat', 'fork'), remote('feat', 'origin')],
    });
    expect(resolvePullSource('feat', s)).toEqual({ source: 'origin/feat', remote: 'origin', remoteBranch: 'feat' });
  });

  it('returns null when there is nothing to pull from', () => {
    const s = store({ localBranches: [local('feat')] });
    expect(resolvePullSource('feat', s)).toBeNull();
  });
});
