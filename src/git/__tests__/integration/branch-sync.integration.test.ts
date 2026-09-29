import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitService } from '../../git-service';

// Self-contained repo helpers (execFileSync, no shell) so this integration
// test also runs on Windows. Local bare repositories stand in for remotes.

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@example.com',
  GIT_COMMITTER_NAME: 'Test Committer',
  GIT_COMMITTER_EMAIL: 'committer@example.com',
  LC_ALL: 'C',
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
}

const dirs: string[] = [];

function makeTemp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function initRepo(): string {
  const repo = makeTemp('ggp-bsync-');
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  git(repo, ['config', 'user.name', 'Test User']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  return repo;
}

function makeBareRemote(): string {
  const remote = makeTemp('ggp-bsync-remote-');
  git(remote, ['init', '--bare', '--initial-branch=main']);
  return remote;
}

function cloneRepo(remote: string): string {
  const other = makeTemp('ggp-bsync-clone-');
  execFileSync('git', ['clone', remote, other], { cwd: tmpdir(), encoding: 'utf8', env: GIT_ENV });
  git(other, ['config', 'user.name', 'Other User']);
  git(other, ['config', 'user.email', 'other@example.com']);
  return other;
}

function commitFile(repo: string, name: string, content: string, message: string): string {
  writeFileSync(join(repo, name), content);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']).trim();
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop()!;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

describe('GitService integration — branch sync (right-click push/pull)', () => {
  it('pushes a non-current branch to the only remote with a same-named branch and sets tracking', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one\n', 'c1');
    git(repo, ['checkout', '-b', 'feature']);
    const tip = commitFile(repo, 'b.txt', 'two\n', 'c2');
    git(repo, ['checkout', 'main']);
    const remote = makeBareRemote();
    git(repo, ['remote', 'add', 'fork', remote]);
    git(repo, ['push', 'fork', 'feature']);

    const service = new GitService(repo);
    await expect(service.pushBranch('feature')).resolves.toEqual({ pushed: true });

    expect(git(repo, ['rev-parse', 'refs/remotes/fork/feature']).trim()).toBe(tip);
    expect(git(repo, ['for-each-ref', '--format=%(upstream:short)', 'refs/heads/feature']).trim()).toBe('fork/feature');
  });

  it('publishes a never-pushed branch to the default remote with -u', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one\n', 'c1');
    git(repo, ['checkout', '-b', 'feature']);
    const tip = commitFile(repo, 'b.txt', 'two\n', 'c2');
    git(repo, ['checkout', 'main']);
    const remote = makeBareRemote();
    git(repo, ['remote', 'add', 'origin', remote]);

    const service = new GitService(repo);
    await expect(service.pushBranch('feature')).resolves.toEqual({ pushed: true });

    expect(git(repo, ['rev-parse', 'refs/remotes/origin/feature']).trim()).toBe(tip);
    expect(git(repo, ['for-each-ref', '--format=%(upstream:short)', 'refs/heads/feature']).trim()).toBe('origin/feature');
  });

  it('fast-forwards a non-current branch from its upstream without checking it out', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one\n', 'c1');
    git(repo, ['checkout', '-b', 'feature']);
    commitFile(repo, 'b.txt', 'f1\n', 'f1');
    const remote = makeBareRemote();
    git(repo, ['remote', 'add', 'origin', remote]);
    git(repo, ['push', '-u', 'origin', 'feature']);
    git(repo, ['checkout', 'main']);

    const other = cloneRepo(remote);
    git(other, ['checkout', 'feature']);
    const remoteTip = commitFile(other, 'b.txt', 'f2\n', 'f2');
    git(other, ['push', 'origin', 'feature']);

    const service = new GitService(repo);
    await expect(service.pullBranchFastForward('feature')).resolves.toEqual({ status: 'fetched' });

    expect(git(repo, ['rev-parse', 'refs/heads/feature']).trim()).toBe(remoteTip);
    expect(git(repo, ['rev-parse', 'refs/remotes/origin/feature']).trim()).toBe(remoteTip);
    expect(git(repo, ['symbolic-ref', '--short', 'HEAD']).trim()).toBe('main');
  });

  it('reports a diverged branch instead of clobbering it, after refreshing the remote-tracking ref', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one\n', 'c1');
    git(repo, ['checkout', '-b', 'feature']);
    commitFile(repo, 'b.txt', 'base\n', 'base');
    const remote = makeBareRemote();
    git(repo, ['remote', 'add', 'origin', remote]);
    git(repo, ['push', '-u', 'origin', 'feature']);
    const localTip = commitFile(repo, 'b.txt', 'local\n', 'local');
    git(repo, ['checkout', 'main']);

    const other = cloneRepo(remote);
    git(other, ['checkout', 'feature']);
    const remoteTip = commitFile(other, 'b.txt', 'remote\n', 'remote');
    git(other, ['push', 'origin', 'feature']);

    const service = new GitService(repo);
    const res = await service.pullBranchFastForward('feature');

    expect(res.status).toBe('non-fast-forward');
    expect(git(repo, ['rev-parse', 'refs/heads/feature']).trim()).toBe(localTip);
    expect(git(repo, ['rev-parse', 'refs/remotes/origin/feature']).trim()).toBe(remoteTip);
  });

  it('reports a branch checked out in another worktree', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one\n', 'c1');
    git(repo, ['checkout', '-b', 'feature']);
    commitFile(repo, 'b.txt', 'f1\n', 'f1');
    const remote = makeBareRemote();
    git(repo, ['remote', 'add', 'origin', remote]);
    git(repo, ['push', '-u', 'origin', 'feature']);
    git(repo, ['checkout', 'main']);

    const wtParent = makeTemp('ggp-bsync-wt-');
    git(repo, ['worktree', 'add', join(wtParent, 'wt'), 'feature']);

    const service = new GitService(repo);
    await expect(service.pullBranchFastForward('feature')).resolves.toEqual({ status: 'checked-out' });
  });

  it('fetches an explicit remote branch into the same-named local branch (remote-branch menu)', async () => {
    const repo = initRepo();
    commitFile(repo, 'a.txt', 'one\n', 'c1');
    git(repo, ['checkout', '-b', 'feature']);
    commitFile(repo, 'b.txt', 'f1\n', 'f1');
    const remote = makeBareRemote();
    git(repo, ['remote', 'add', 'origin', remote]);
    git(repo, ['push', '-u', 'origin', 'feature']);
    git(repo, ['checkout', 'main']);

    const other = cloneRepo(remote);
    git(other, ['checkout', 'feature']);
    const remoteTip = commitFile(other, 'b.txt', 'f2\n', 'f2');
    git(other, ['push', 'origin', 'feature']);

    const service = new GitService(repo);
    await expect(service.fetchBranchInto('origin', 'feature', 'feature')).resolves.toEqual({ ok: true });

    expect(git(repo, ['rev-parse', 'refs/heads/feature']).trim()).toBe(remoteTip);
  });
});
