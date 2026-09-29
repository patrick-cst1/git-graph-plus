import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitService } from '../../git-service';

// Same self-contained helpers as the other new integration tests (no shell
// quoting) so this runs on Windows too. The folder is intentionally NOT a git
// repository: initRepo has to create it.
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@example.com',
  GIT_COMMITTER_NAME: 'Test Committer',
  GIT_COMMITTER_EMAIL: 'committer@example.com',
  LC_ALL: 'C',
};

let dir: string | undefined;

function makeEmptyFolder(): string {
  dir = mkdtempSync(join(tmpdir(), 'ggp-init-it-'));
  return dir;
}

afterEach(() => {
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    dir = undefined;
  }
});

describe('GitService integration — initRepo', () => {
  it('initialises a plain folder and creates the empty initial commit', async () => {
    const folder = makeEmptyFolder();
    const service = new GitService(folder);

    const result = await service.initRepo();

    expect(result).toEqual({ committed: true });
    expect(await service.isUnbornHead()).toBe(false);
    const commits = await service.log();
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe('Initial commit');
    expect(commits[0].parents).toEqual([]);
    // The folder is now a real repository.
    expect(execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: folder, encoding: 'utf8' }).trim()).toBe('true');
  });

  it('keeps the repository but reports a failed commit without an identity', async () => {
    const folder = makeEmptyFolder();
    const emptyConfig = join(folder, 'empty-gitconfig');
    writeFileSync(emptyConfig, '');
    const service = new GitService(folder);
    service.setExtraEnv({
      ...GIT_ENV,
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: '',
      GIT_AUTHOR_EMAIL: '',
      GIT_COMMITTER_NAME: '',
      GIT_COMMITTER_EMAIL: '',
    });

    const result = await service.initRepo();

    expect(result.committed).toBe(false);
    // git refuses the commit with a missing/empty identity ("empty ident name"
    // when the vars are empty, "who you are" when they are absent entirely).
    expect(result.error).toMatch(/empty ident name|who you are/i);
    // The repository exists (unborn HEAD), so the retry button can finish it.
    expect(await service.isUnbornHead()).toBe(true);
  });
});
