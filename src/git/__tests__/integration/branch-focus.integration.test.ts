import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitService } from '../../git-service';

// Self-contained repo helpers (execFileSync, no shell) so this integration
// test also runs on Windows. main: m1..m4 (m4 after branching), feature:
// f1..f3 branched at m3.
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

let dir: string | undefined;

function makeRepo(): string {
  dir = mkdtempSync(join(tmpdir(), 'ggp-focus-it-'));
  git(dir, ['init', '--initial-branch=main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'user.name', 'Test User']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  return dir;
}

function commitFile(repo: string, name: string, content: string, message: string): void {
  writeFileSync(join(repo, name), content);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', message]);
}

afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    dir = undefined;
  }
});

describe('GitService integration — branch focus', () => {
  it('scopes a focused branch to its own commits plus the fork-point boundary', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'm1\n', 'main1');
    commitFile(repo, 'a.txt', 'm2\n', 'main2');
    commitFile(repo, 'a.txt', 'm3\n', 'main3');
    git(repo, ['checkout', '-b', 'feature']);
    commitFile(repo, 'b.txt', 'f1\n', 'feat1');
    commitFile(repo, 'b.txt', 'f2\n', 'feat2');
    git(repo, ['checkout', 'main']);
    commitFile(repo, 'a.txt', 'm4\n', 'main4');
    const service = new GitService(repo);

    const base = await service.focusBase('feature');
    expect(base).toBe(git(repo, ['merge-base', 'main', 'feature']).trim());

    const scoped = await service.log({ branches: ['feature'], focusUnique: true, includeStashes: false });
    expect(scoped.map((c) => c.subject)).toEqual(['feat2', 'feat1', 'main3']);

    const full = await service.log({ branches: ['feature'], includeStashes: false });
    expect(full.map((c) => c.subject)).toEqual(['feat2', 'feat1', 'main3', 'main2', 'main1']);
  });

  it('keeps the full history for the default branch and fully merged branches', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'm1\n', 'main1');
    commitFile(repo, 'a.txt', 'm2\n', 'main2');
    const service = new GitService(repo);

    expect(await service.focusBase('main')).toBeNull();

    const scoped = await service.log({ branches: ['main'], focusUnique: true, includeStashes: false });
    expect(scoped.map((c) => c.subject)).toEqual(['main2', 'main1']);
  });

  it('still scopes a merged branch via its reflog creation point', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'm0\n', 'main0');
    commitFile(repo, 'a.txt', 'm1\n', 'main1');
    const forkPoint = git(repo, ['rev-parse', 'HEAD']).trim();
    git(repo, ['checkout', '-b', 'feature']);
    commitFile(repo, 'b.txt', 'f1\n', 'feat1');
    git(repo, ['checkout', 'main']);
    git(repo, ['merge', '--ff-only', 'feature']); // feature is now an ancestor of main
    commitFile(repo, 'a.txt', 'm2\n', 'main2');
    const service = new GitService(repo);

    // The merge base collapsed to the branch tip; the reflog still knows where
    // the branch was created, so focus keeps working after merging.
    expect(await service.focusBase('feature')).toBe(forkPoint);

    const scoped = await service.log({ branches: ['feature'], focusUnique: true, includeStashes: false });
    expect(scoped.map((c) => c.subject)).toEqual(['feat1', 'main1']);

    const full = await service.log({ branches: ['feature'], includeStashes: false });
    expect(full.map((c) => c.subject)).toEqual(['feat1', 'main1', 'main0']);
  });
});
