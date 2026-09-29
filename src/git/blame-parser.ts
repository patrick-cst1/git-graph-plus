// Parser for `git blame --line-porcelain` output.
//
// `--line-porcelain` repeats the full commit metadata for every line, so the
// output is a flat sequence of records:
//
//   <sha> <origLine> <finalLine> [<groupSize>]
//   author <name>
//   author-mail <<email>>
//   author-time <epoch seconds>
//   author-tz <tz>
//   ...
//   summary <subject>
//   previous <sha> <path>      (only when the line changed across a rename)
//   filename <path>
//   \t<the source line itself>
//
// The source line (a TAB-prefixed line) terminates each record.

/** One blamed line of a file. */
export interface BlameLine {
  /** Commit that last touched the line; all-zeroes when not committed yet. */
  hash: string;
  author: string;
  authorEmail: string;
  /** Commit time as epoch seconds (0 when unknown). */
  authorTime: number;
  summary: string;
  /** 1-based line number in the blamed (current) file. */
  line: number;
  /** 1-based line number in the revision the line came from. */
  originalLine: number;
  /** Path of the file in the revision the line came from (follows renames). */
  filename: string;
  /** Set when git tracked the line across a rename. */
  previous?: { hash: string; filename: string };
}

const HEADER_RE = /^([0-9a-f]{40,64}) (\d+) (\d+)(?: (\d+))?$/;

/** True when the blame entry is a line that is not committed yet. */
export function isUncommitted(blame: BlameLine): boolean {
  return /^0+$/.test(blame.hash);
}

export function parseBlamePorcelain(raw: string): BlameLine[] {
  const out: BlameLine[] = [];
  let cur: BlameLine | null = null;

  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;

    const header = HEADER_RE.exec(line);
    if (header) {
      cur = {
        hash: header[1],
        originalLine: Number(header[2]),
        line: Number(header[3]),
        author: '',
        authorEmail: '',
        authorTime: 0,
        summary: '',
        filename: '',
      };
      continue;
    }

    // The source line itself ends the current record.
    if (line.startsWith('\t')) {
      if (cur) {
        out.push(cur);
        cur = null;
      }
      continue;
    }

    if (!cur) continue;

    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);
    switch (key) {
      case 'author':
        cur.author = value;
        break;
      case 'author-mail':
        cur.authorEmail = value.replace(/^</, '').replace(/>$/, '');
        break;
      case 'author-time':
        cur.authorTime = Number(value) || 0;
        break;
      case 'summary':
        cur.summary = value;
        break;
      case 'filename':
        cur.filename = value;
        break;
      case 'previous': {
        const m = /^([0-9a-f]{40,64}) (.+)$/.exec(value);
        if (m) cur.previous = { hash: m[1], filename: m[2] };
        break;
      }
      default:
        break;
    }
  }

  // A record without a trailing source line (truncated output) is still kept:
  // its metadata is valid, only the content is missing.
  if (cur) out.push(cur);
  return out;
}
