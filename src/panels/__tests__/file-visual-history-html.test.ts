// @vitest-environment happy-dom
/// <reference lib="dom" />
import { describe, it, expect, beforeEach } from 'vitest';
import { renderFileVisualHistoryHtml, CHART_SCRIPT, AUTHOR_COLORS } from '../file-visual-history-html';
import { buildVisualHistory } from '../../git/visual-history';

const commits = [
  { hash: 'a', author: 'Alice', date: '2024-01-01T00:00:00Z' },
  { hash: 'b', author: 'Bob', date: '2024-01-02T00:00:00Z' },
  { hash: 'c', author: 'Alice', date: '2024-01-02T10:00:00Z' },
];

function payloadFromHtml(html: string): unknown {
  const match = /<script type="application\/json" id="payload"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]);
}

describe('renderFileVisualHistoryHtml', () => {
  it('renders the heading, payload and CSP nonce', () => {
    const data = buildVisualHistory(commits);
    const html = renderFileVisualHistoryHtml({ relativePath: 'src/a.ts', rootPath: '/repo', data, loaded: 3, cap: 500 });
    expect(html).toContain('<h1>src/a.ts</h1>');
    expect(html).toContain('/repo');
    expect(html).toMatch(/script-src 'nonce-[A-Za-z0-9]{32}'/);

    const payload = payloadFromHtml(html) as { data: { total: number }; colors: string[] };
    expect(payload.data.total).toBe(3);
    expect(payload.colors).toEqual(AUTHOR_COLORS);
  });

  it('escapes the heading and escapes < inside the payload', () => {
    const data = buildVisualHistory([{ hash: 'a', author: '<script>alert(1)</script>', date: '2024-01-01T00:00:00Z' }]);
    const html = renderFileVisualHistoryHtml({ relativePath: '<img src=x>', rootPath: '/repo', data });
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    const payload = payloadFromHtml(html) as { data: { authors: Array<{ name: string }> } };
    expect(payload.data.authors[0].name).toBe('<script>alert(1)</script>');
  });

  it('shows the empty state without a chart for no commits', () => {
    const html = renderFileVisualHistoryHtml({ relativePath: 'a.ts', rootPath: '/repo', data: buildVisualHistory([]) });
    expect(html).toContain('No committed history for this file yet.');
    expect(html).not.toContain('id="chart"');
  });

  it('shows a loading error escaped', () => {
    const html = renderFileVisualHistoryHtml({ relativePath: 'a.ts', rootPath: '/repo', error: '<boom>' });
    expect(html).toContain('&lt;boom&gt;');
  });
});

describe('CHART_SCRIPT', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('draws one rect per author segment and a legend entry per author', () => {
    const data = buildVisualHistory(commits);
    const payload = JSON.stringify({ data, colors: AUTHOR_COLORS, otherColor: '#888', capped: false, loaded: 3 });
    document.body.innerHTML = `
      <div id="summary"></div>
      <svg id="chart"></svg>
      <div id="legend"></div>
      <script type="application/json" id="payload">${payload}</script>`;
    new Function(CHART_SCRIPT)();

    // 3 buckets: 1 + 2 + 0 commits; Alice appears in buckets 0 and 1, Bob in 1.
    const rects = document.querySelectorAll('#chart rect');
    expect(rects.length).toBe(3);
    const legend = document.querySelectorAll('#legend .item');
    expect(legend.length).toBe(2);
    expect(document.getElementById('summary')!.textContent).toContain('3 commits');
    // Bucket tooltip carries the per-author breakdown.
    const titles = Array.from(document.querySelectorAll('#chart title')).map((t) => t.textContent);
    expect(titles[1]).toContain('Alice (1)');
    expect(titles[1]).toContain('Bob (1)');
  });

  it('does nothing when the payload is missing', () => {
    document.body.innerHTML = '<svg id="chart"></svg>';
    expect(() => new Function(CHART_SCRIPT)()).not.toThrow();
  });
});
