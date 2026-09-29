import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { BlameService, MAX_FULL_BLAME_LINES, WINDOW_LINES } from '../blame-service';
import { clearRepoRootCache } from '../repo-resolver';
import type { GitService } from '../../git/git-service';
import type { BlameLine } from '../../git/blame-parser';

function line(n: number, over: Partial<BlameLine> = {}): BlameLine {
  return {
    hash: 'a'.repeat(40),
    author: 'Ada',
    authorEmail: 'ada@example.com',
    authorTime: 1700000000,
    summary: 'commit',
    line: n,
    originalLine: n,
    filename: 'src/app.ts',
    ...over,
  };
}

let root: string;
let repo: string;
let file: string;
let outside: string;
let blame: ReturnType<typeof vi.fn>;
let service: BlameService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ggp-blame-'));
  repo = join(root, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'src'), { recursive: true });
  file = join(repo, 'src', 'app.ts');
  writeFileSync(file, 'x\n'.repeat(10));
  outside = join(root, 'loose.ts');
  writeFileSync(outside, 'x\n');
  clearRepoRootCache();

  blame = vi.fn(async (_path: string, range?: { start: number; end: number }) => {
    if (range) {
      const lines: BlameLine[] = [];
      for (let i = range.start; i <= range.end; i++) lines.push(line(i));
      return lines;
    }
    return [line(1), line(2), line(3)];
  });
  service = new BlameService(() => ({ blame } as unknown as GitService));
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  clearRepoRootCache();
});

describe('BlameService', () => {
  it('blames a whole file and returns the requested line', async () => {
    const result = await service.getLineBlame(file, 2, 10);
    expect(result?.line).toBe(2);
    expect(blame).toHaveBeenCalledTimes(1);
    expect(blame).toHaveBeenCalledWith(join('src', 'app.ts'), undefined);
  });

  it('serves repeat lookups from the cache', async () => {
    await service.getLineBlame(file, 1, 10);
    await service.getLineBlame(file, 2, 10);
    await service.getLineBlame(file, 3, 10);
    expect(blame).toHaveBeenCalledTimes(1);
  });

  it('blames a window around the line for very large files', async () => {
    const big = MAX_FULL_BLAME_LINES + 5000;
    const result = await service.getLineBlame(file, 24_000, big);
    expect(result?.line).toBe(24_000);
    expect(blame).toHaveBeenCalledWith(join('src', 'app.ts'), {
      start: 24_000 - WINDOW_LINES,
      end: 24_000 + WINDOW_LINES,
    });
  });

  it('re-fetches a window when the requested line is outside the cached one', async () => {
    const big = MAX_FULL_BLAME_LINES + 5000;
    await service.getLineBlame(file, 1000, big);
    await service.getLineBlame(file, 24_000, big);
    expect(blame).toHaveBeenCalledTimes(2);
  });

  it('returns undefined (and retries only after a delay) when blame fails', async () => {
    blame.mockRejectedValueOnce(new Error('fatal: no such path'));
    expect(await service.getLineBlame(file, 1, 10)).toBeUndefined();
    expect(await service.getLineBlame(file, 1, 10)).toBeUndefined();
    expect(blame).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for files outside a repository without calling git', async () => {
    expect(await service.getLineBlame(outside, 1, 1)).toBeUndefined();
    expect(blame).not.toHaveBeenCalled();
  });

  it('invalidate() forces the next lookup to re-blame', async () => {
    await service.getLineBlame(file, 1, 10);
    service.invalidate(file);
    await service.getLineBlame(file, 1, 10);
    expect(blame).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent lookups into one git call', async () => {
    const [a, b] = await Promise.all([
      service.getLineBlame(file, 1, 10),
      service.getLineBlame(file, 2, 10),
    ]);
    expect(a?.line).toBe(1);
    expect(b?.line).toBe(2);
    expect(blame).toHaveBeenCalledTimes(1);
  });
});
