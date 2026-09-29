import type { BranchInfo, RemoteInfo } from '../types';

export interface BranchTargetStore {
  localBranches: BranchInfo[];
  remoteBranches: BranchInfo[];
  remotes: RemoteInfo[];
}

/**
 * Default remote for pushing a branch: its live upstream's remote, else the
 * single remote that already has a same-named branch, else the first remote.
 */
export function resolvePushRemote(branchName: string, store: BranchTargetStore): string {
  const info = store.localBranches.find(b => b.name === branchName);
  if (info?.upstream && !info.upstreamGone) {
    return info.upstream.split('/')[0];
  }
  const sameName = store.remoteBranches.find(b => !!b.remote && b.name === `${b.remote}/${branchName}`);
  return sameName?.remote ?? store.remotes[0]?.name ?? 'origin';
}

export interface PullSource {
  /** Display form, e.g. "fork/main". */
  source: string;
  remote: string;
  remoteBranch: string;
}

/**
 * Resolves where a local branch pulls from: its live upstream, else the
 * same-named remote branch (origin preferred when several remotes have one).
 * Returns null when neither exists.
 */
export function resolvePullSource(branchName: string, store: BranchTargetStore): PullSource | null {
  const info = store.localBranches.find(b => b.name === branchName);
  if (info?.upstream && !info.upstreamGone) {
    const slash = info.upstream.indexOf('/');
    if (slash > 0) {
      return {
        source: info.upstream,
        remote: info.upstream.slice(0, slash),
        remoteBranch: info.upstream.slice(slash + 1),
      };
    }
  }
  const matches = store.remoteBranches.filter(b => !!b.remote && b.name === `${b.remote}/${branchName}`);
  if (matches.length === 0) return null;
  const pick = matches.find(b => b.remote === 'origin') ?? matches[0];
  return { source: `${pick.remote}/${branchName}`, remote: pick.remote!, remoteBranch: branchName };
}
