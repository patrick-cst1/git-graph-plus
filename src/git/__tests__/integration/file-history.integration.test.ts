import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitService } from '../../git-service';

// Self-contained repo helpers (execFileSync, no shell) so this integration
// test also runs on Windows, unlike the shell-quoted helpers in helpers.ts.
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
  dir = mkdtempSync(join(tmpdir(), 'ggp-filehist-it-'));
  git(dir, ['init', '--initial-branch=main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'tag.gpgsign', 'false']);
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

describe('GitService integration — fileHistory', () => {
  it('returns the commits that touched a file, newest first', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\n', 'create a');
    commitFile(repo, 'b.txt', 'other\n', 'create b');
    commitFile(repo, 'a.txt', 'one\ntwo\n', 'extend a');
    const service = new GitService(repo);

    const history = await service.fileHistory('a.txt');

    expect(history.map((c) => c.subject)).toEqual(['extend a', 'create a']);
    expect(history[0].hash).toHaveLength(40);
  });

  it('follows renames', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\n', 'create a');
    git(repo, ['mv', 'a.txt', 'b.txt']);
    git(repo, ['commit', '-m', 'rename to b']);
    commitFile(repo, 'b.txt', 'one\ntwo\n', 'extend b');
    const service = new GitService(repo);

    const history = await service.fileHistory('b.txt');

    expect(history.map((c) => c.subject)).toEqual(['extend b', 'rename to b', 'create a']);
  });

  it('pages with skip', async () => {
    const repo = makeRepo();
    for (let i = 0; i < 5; i++) commitFile(repo, 'a.txt', `${i}\n`, `c${i}`);
    const service = new GitService(repo);

    const page1 = await service.fileHistory('a.txt', { limit: 2 });
    const page2 = await service.fileHistory('a.txt', { limit: 2, skip: 2 });

    expect(page1.map((c) => c.subject)).toEqual(['c4', 'c3']);
    expect(page2.map((c) => c.subject)).toEqual(['c2', 'c1']);
  });

  it('rejects paths escaping the repo', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\n', 'first');
    const service = new GitService(repo);

    await expect(service.fileHistory('../outside.txt')).rejects.toThrow();
    await expect(service.fileHistory('-flag')).rejects.toThrow();
  });
});

describe('GitService integration — lineHistory', () => {
  it('returns only the commits that changed the requested lines', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'l1\nl2\nl3\n', 'c1');
    commitFile(repo, 'a.txt', 'l1\nL2\nl3\n', 'c2 line2');
    commitFile(repo, 'a.txt', 'l1\nL2\nl3\nNEW\n', 'c3 append');
    const service = new GitService(repo);

    const history = await service.lineHistory('a.txt', 2, 2);

    expect(history.map((c) => c.subject)).toEqual(['c2 line2', 'c1']);
  });

  it('returns an empty list when the range cannot be traced', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\n', 'first');
    const service = new GitService(repo);

    expect(await service.lineHistory('missing.txt', 1, 1)).toEqual([]);
  });

  it('rejects invalid ranges', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\n', 'first');
    const service = new GitService(repo);

    await expect(service.lineHistory('a.txt', 0, 2)).rejects.toThrow();
    await expect(service.lineHistory('a.txt', 5, 2)).rejects.toThrow();
  });
});
