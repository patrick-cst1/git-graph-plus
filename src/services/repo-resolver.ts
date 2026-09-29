// Locate the git repository that owns a file, for editor-level features
// (blame, file history, annotations). Walks up from the file's directory
// looking for a `.git` entry — a directory in a normal clone, a file in a
// linked worktree or submodule — and caches the result per directory.
//
// Pure Node (no VS Code imports) so it is unit-testable.

import * as path from 'path';
import { existsSync } from 'fs';

const rootByDir = new Map<string, string | null>();

function hasGitEntry(dir: string): boolean {
  return existsSync(path.join(dir, '.git'));
}

/** Nearest ancestor directory (inclusive) that contains a `.git` entry. */
export function findRepoRoot(startDir: string): string | undefined {
  const visited: string[] = [];
  let dir = startDir;
  for (;;) {
    const cached = rootByDir.get(dir);
    if (cached !== undefined) {
      for (const v of visited) rootByDir.set(v, cached);
      return cached ?? undefined;
    }
    if (hasGitEntry(dir)) {
      for (const v of visited) rootByDir.set(v, dir);
      rootByDir.set(dir, dir);
      return dir;
    }
    visited.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) {
      for (const v of visited) rootByDir.set(v, null);
      return undefined;
    }
    dir = parent;
  }
}

/** Repository root for a file path, or undefined when the file is not in a repo. */
export function getRepoRootForFile(filePath: string): string | undefined {
  return findRepoRoot(path.dirname(filePath));
}

/** Test/utility hook: drop the directory cache (e.g. after creating repos). */
export function clearRepoRootCache(): void {
  rootByDir.clear();
}
