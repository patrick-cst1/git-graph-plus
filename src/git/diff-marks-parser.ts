// Derive per-line change marks from a `git diff --unified=0` output, for the
// editor's "Changes" file annotation.
//
// With `-U0` every hunk is a pure change block, so classification is simple:
//   - a hunk with only additions            → those lines are "added"
//   - a hunk with removals and additions    → the new lines are "modified"
//   - a hunk with only removals             → a "deleted" marker on the line
//                                             before the removal point
//
// Pure Node (no VS Code imports) so it is unit-testable.

export interface FileChangeMarks {
  /** 1-based new-file line numbers that are pure additions. */
  added: number[];
  /** 1-based new-file line numbers that replaced removed content. */
  modified: number[];
  /** 1-based new-file line numbers where content was removed. */
  deleted: number[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedZeroMarks(diff: string): FileChangeMarks {
  const marks: FileChangeMarks = { added: [], modified: [], deleted: [] };
  if (!diff) return marks;

  let hunk: { newStart: number; newCount: number } | null = null;
  let removedInHunk = 0;

  const closeHunk = () => {
    if (!hunk) return;
    const { newStart, newCount } = hunk;
    if (removedInHunk === 0) {
      for (let i = 0; i < newCount; i++) marks.added.push(newStart + i);
    } else {
      for (let i = 0; i < newCount; i++) marks.modified.push(newStart + i);
      if (newCount === 0) marks.deleted.push(Math.max(1, newStart));
    }
    hunk = null;
    removedInHunk = 0;
  };

  for (const line of diff.split('\n')) {
    const header = HUNK_RE.exec(line);
    if (header) {
      closeHunk();
      hunk = {
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
      };
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('-') && !line.startsWith('---')) removedInHunk++;
  }
  closeHunk();

  // A hunk header with an empty count (e.g. `+5,0`) still needs the removed
  // marker, handled above by newCount === 0. Sanity: dedupe + sort.
  const uniqueSorted = (arr: number[]) => [...new Set(arr)].sort((a, b) => a - b);
  return {
    added: uniqueSorted(marks.added),
    modified: uniqueSorted(marks.modified),
    deleted: uniqueSorted(marks.deleted),
  };
}
