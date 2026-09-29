import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findRepoRoot, getRepoRootForFile, clearRepoRootCache } from '../repo-resolver';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ggp-resolver-'));
  clearRepoRootCache();
});

afterEach(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  clearRepoRootCache();
});

describe('repo-resolver', () => {
  it('finds the nearest ancestor with a .git directory', () => {
    const repo = join(root, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
    writeFileSync(join(repo, 'src', 'deep', 'file.ts'), '');

    expect(findRepoRoot(join(repo, 'src', 'deep'))).toBe(repo);
    expect(getRepoRootForFile(join(repo, 'src', 'deep', 'file.ts'))).toBe(repo);
  });

  it('accepts a .git file (linked worktrees, submodules)', () => {
    const repo = join(root, 'wt');
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, '.git'), 'gitdir: /somewhere/else\n');

    expect(findRepoRoot(repo)).toBe(repo);
  });

  it('returns undefined when no ancestor is a repo', () => {
    const plain = join(root, 'plain', 'nested');
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, 'file.txt'), '');

    expect(getRepoRootForFile(join(plain, 'file.txt'))).toBeUndefined();
  });

  it('stops at the nearest repo (nested repos do not leak upward)', () => {
    const outer = join(root, 'outer');
    const inner = join(outer, 'vendor', 'inner');
    mkdirSync(join(outer, '.git'), { recursive: true });
    mkdirSync(join(inner, '.git'), { recursive: true });
    writeFileSync(join(inner, 'f.ts'), '');

    expect(getRepoRootForFile(join(inner, 'f.ts'))).toBe(inner);
  });
});
