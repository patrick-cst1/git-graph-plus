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
  GIT_AUTHOR_DATE: '2024-01-01T00:00:00+00:00',
  GIT_COMMITTER_DATE: '2024-01-01T00:00:00+00:00',
  LC_ALL: 'C',
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
}

let dir: string | undefined;

function makeRepo(): string {
  dir = mkdtempSync(join(tmpdir(), 'ggp-blame-it-'));
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

describe('GitService integration — blame', () => {
  it('blames committed lines with author and summary', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\ntwo\n', 'first');
    commitFile(repo, 'a.txt', 'one\nTWO\nthree\n', 'second');
    const service = new GitService(repo);

    const lines = await service.blame('a.txt');

    expect(lines.map((l) => l.line)).toEqual([1, 2, 3]);
    expect(lines[0].summary).toBe('first');
    expect(lines[1].summary).toBe('second');
    expect(lines[2].summary).toBe('second');
    expect(lines[0].author).toBe('Test Author');
    expect(lines[0].authorEmail).toBe('author@example.com');
  });

  it('reports uncommitted edits as the all-zeroes commit', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\ntwo\n', 'first');
    writeFileSync(join(repo, 'a.txt'), 'one\nTWO-CHANGED\n');
    const service = new GitService(repo);

    const lines = await service.blame('a.txt');

    expect(lines[1].hash).toMatch(/^0+$/);
    expect(lines[0].hash).not.toMatch(/^0+$/);
  });

  it('blames only the requested line range', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\ntwo\nthree\n', 'first');
    const service = new GitService(repo);

    const lines = await service.blame('a.txt', { start: 2, end: 2 });

    expect(lines).toHaveLength(1);
    expect(lines[0].line).toBe(2);
  });

  it('rejects invalid ranges and paths escaping the repo', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\n', 'first');
    const service = new GitService(repo);

    await expect(service.blame('a.txt', { start: 0, end: 2 })).rejects.toThrow();
    await expect(service.blame('a.txt', { start: 3, end: 1 })).rejects.toThrow();
    await expect(service.blame('../outside.txt')).rejects.toThrow();
    await expect(service.blame('-flag')).rejects.toThrow();
  });
});

describe('GitService integration — workingFileLineMarks', () => {
  it('reports modified and added lines versus HEAD', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\ntwo\nthree\nfour\n', 'first');
    writeFileSync(join(repo, 'a.txt'), 'one\nTWO\nthree\nFOUR-EXTRA\nfive\n');
    const service = new GitService(repo);

    const marks = await service.workingFileLineMarks('a.txt');

    expect(marks.modified).toEqual([2, 4, 5]);
    expect(marks.added).toEqual([]);
    expect(marks.deleted).toEqual([]);
  });

  it('reports a pure deletion on the line above the removal point', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\ntwo\nthree\n', 'first');
    writeFileSync(join(repo, 'a.txt'), 'one\nthree\n');
    const service = new GitService(repo);

    const marks = await service.workingFileLineMarks('a.txt');

    expect(marks.deleted).toEqual([1]);
  });

  it('returns empty marks for a clean file', async () => {
    const repo = makeRepo();
    commitFile(repo, 'a.txt', 'one\n', 'first');
    const service = new GitService(repo);

    expect(await service.workingFileLineMarks('a.txt')).toEqual({ added: [], modified: [], deleted: [] });
  });
});
