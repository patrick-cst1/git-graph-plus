// Cached blame lookups for editor features (current-line blame, hovers,
// annotations, CodeLens). One blame per file is cached and shared by every
// consumer; large files are blamed in a window around the requested line.
//
// Pure Node (no VS Code imports) so it is unit-testable.

import * as path from 'path';
import type { GitService } from '../git/git-service';
import type { BlameLine } from '../git/blame-parser';
import { getRepoRootForFile } from './repo-resolver';

/** How long a file's blame stays fresh before it is fetched again. */
export const FILE_TTL_MS = 60_000;
/** Failed lookups (untracked files, …) retry after this long. */
export const ERROR_TTL_MS = 5_000;
/** Files up to this many lines are blamed whole; larger files get a window. */
export const MAX_FULL_BLAME_LINES = 20_000;
/** Lines blamed on either side of the requested line for very large files. */
export const WINDOW_LINES = 250;

interface FileBlame {
  lines: Map<number, BlameLine>;
  /** True when the whole file was blamed (no window). */
  complete: boolean;
  at: number;
}

export class BlameService {
  private files = new Map<string, FileBlame>();
  private errors = new Map<string, number>();
  private pending = new Map<string, Promise<FileBlame | undefined>>();

  constructor(private readonly getGitService: (repoRoot: string) => GitService) {}

  /** Blame of a single line (1-based), or undefined when unavailable. */
  async getLineBlame(absPath: string, line: number, lineCount: number): Promise<BlameLine | undefined> {
    const file = await this.getFileBlame(absPath, lineCount, line);
    return file?.lines.get(line);
  }

  /**
   * Blame for the whole file (or the cached window that covers `line`).
   * Returns undefined when the file is outside a repo or blame fails.
   */
  async getFileBlame(absPath: string, lineCount: number, line?: number): Promise<FileBlame | undefined> {
    const root = getRepoRootForFile(absPath);
    if (!root) return undefined;
    const rel = path.relative(root, absPath);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;

    const now = Date.now();
    const errAt = this.errors.get(absPath);
    if (errAt !== undefined && now - errAt < ERROR_TTL_MS) return undefined;

    const cached = this.files.get(absPath);
    if (cached && now - cached.at < FILE_TTL_MS && (cached.complete || line === undefined || cached.lines.has(line))) {
      return cached;
    }

    const wantWindow = cached?.complete !== true && lineCount > MAX_FULL_BLAME_LINES && line !== undefined;
    const range = wantWindow
      ? { start: Math.max(1, line - WINDOW_LINES), end: Math.min(lineCount, line + WINDOW_LINES) }
      : undefined;

    const inflight = this.pending.get(absPath);
    if (inflight) return inflight;

    const request = this.getGitService(root)
      .blame(rel, range)
      .then((lines) => {
        const entry: FileBlame = {
          lines: new Map(lines.map((l) => [l.line, l])),
          complete: range === undefined,
          at: Date.now(),
        };
        this.files.set(absPath, entry);
        this.errors.delete(absPath);
        return entry;
      })
      .catch(() => {
        this.errors.set(absPath, Date.now());
        return undefined;
      })
      .finally(() => {
        if (this.pending.get(absPath) === request) this.pending.delete(absPath);
      });
    this.pending.set(absPath, request);
    return request;
  }

  /** Drop the cached blame of one file (e.g. after it is saved). */
  invalidate(absPath: string): void {
    this.files.delete(absPath);
    this.errors.delete(absPath);
  }

  /** Drop every cached blame (e.g. after HEAD moved). */
  invalidateAll(): void {
    this.files.clear();
    this.errors.clear();
  }
}

export type { FileBlame };
