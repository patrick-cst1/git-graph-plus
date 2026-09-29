import { describe, it, expect } from 'vitest';
import { parseBlamePorcelain, isUncommitted } from '../blame-parser';

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);

function record(over: {
  sha?: string;
  orig?: number;
  final?: number;
  author?: string;
  mail?: string;
  time?: number;
  summary?: string;
  filename?: string;
  previous?: string;
  content?: string;
} = {}): string {
  const {
    sha = SHA, orig = 1, final = 1, author = 'Ada Lovelace', mail = 'ada@example.com',
    time = 1700000000, summary = 'first commit', filename = 'src/app.ts',
    previous, content = 'const x = 1;',
  } = over;
  const lines = [
    `${sha} ${orig} ${final} 1`,
    `author ${author}`,
    `author-mail <${mail}>`,
    `author-time ${time}`,
    `author-tz +0000`,
    `committer ${author}`,
    `committer-mail <${mail}>`,
    `committer-time ${time}`,
    `committer-tz +0000`,
    `summary ${summary}`,
  ];
  if (previous) lines.push(`previous ${previous} src/old.ts`);
  lines.push(`filename ${filename}`, `\t${content}`);
  return lines.join('\n');
}

describe('parseBlamePorcelain', () => {
  it('parses a single record', () => {
    const [line] = parseBlamePorcelain(record());
    expect(line).toMatchObject({
      hash: SHA,
      author: 'Ada Lovelace',
      authorEmail: 'ada@example.com',
      authorTime: 1700000000,
      summary: 'first commit',
      line: 1,
      originalLine: 1,
      filename: 'src/app.ts',
    });
    expect(line.previous).toBeUndefined();
  });

  it('parses consecutive records (line-porcelain repeats the header)', () => {
    const raw = [
      record({ orig: 1, final: 1, content: 'line one' }),
      record({ sha: SHA2, orig: 5, final: 2, author: 'Grace Hopper', summary: 'second commit', content: 'line two' }),
    ].join('\n');
    const lines = parseBlamePorcelain(raw);
    expect(lines).toHaveLength(2);
    expect(lines[0].line).toBe(1);
    expect(lines[1].line).toBe(2);
    expect(lines[1].originalLine).toBe(5);
    expect(lines[1].author).toBe('Grace Hopper');
    expect(lines[1].summary).toBe('second commit');
  });

  it('captures rename metadata from `previous`', () => {
    const [line] = parseBlamePorcelain(record({ previous: SHA2 }));
    expect(line.previous).toEqual({ hash: SHA2, filename: 'src/old.ts' });
  });

  it('treats an all-zeroes hash as uncommitted', () => {
    const [line] = parseBlamePorcelain(record({ sha: '0'.repeat(40), author: 'You', summary: 'Not Committed Yet' }));
    expect(isUncommitted(line)).toBe(true);
  });

  it('parses 64-character (sha256) hashes', () => {
    const sha256 = 'c'.repeat(64);
    const [line] = parseBlamePorcelain(record({ sha: sha256 }));
    expect(line.hash).toBe(sha256);
    expect(isUncommitted(line)).toBe(false);
  });

  it('returns an empty list for empty output', () => {
    expect(parseBlamePorcelain('')).toEqual([]);
  });

  it('keeps a truncated trailing record (metadata without the source line)', () => {
    const raw = `${SHA} 1 1 1\nauthor Ada\nauthor-time 1700000000\nsummary s`;
    const lines = parseBlamePorcelain(raw);
    expect(lines).toHaveLength(1);
    expect(lines[0].author).toBe('Ada');
  });
});
