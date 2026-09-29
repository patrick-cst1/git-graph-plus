// HTML for the Visual File History panel. Pure (no VS Code imports) so the
// chart markup and script are unit-testable; the panel class only supplies
// data and hosts the webview.

import type { VisualHistoryData } from '../git/visual-history';

export const AUTHOR_COLORS = [
  '#4f9cf9', '#f97316', '#22c55e', '#a855f7',
  '#ef4444', '#14b8a6', '#eab308', '#ec4899',
];
export const OTHER_COLOR = '#8b8b8b';

export interface VisualHistoryHtmlOptions {
  /** Repo-relative path shown in the heading. */
  relativePath: string;
  /** Repository root shown under the heading. */
  rootPath: string;
  data?: VisualHistoryData;
  /** Number of commits fetched (may be capped). */
  loaded?: number;
  /** Hard cap the panel requested, used for the "latest N" note. */
  cap?: number;
  error?: string;
}

export function createNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderFileVisualHistoryHtml(options: VisualHistoryHtmlOptions): string {
  const nonce = createNonce();
  const { data, loaded, error } = options;
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');

  let body: string;
  if (error) {
    body = `<p class="error">${escapeHtml(error)}</p>`;
  } else if (!data || data.total === 0) {
    body = '<p class="muted">No committed history for this file yet.</p>';
  } else {
    const payload = JSON.stringify({
      data,
      colors: AUTHOR_COLORS,
      otherColor: OTHER_COLOR,
      capped: options.cap !== undefined && loaded === options.cap,
      loaded: loaded ?? data.total,
    }).replace(/</g, '\\u003c');
    body = `
        <div class="summary" id="summary"></div>
        <div class="chart-wrap"><svg id="chart" viewBox="0 0 900 280" preserveAspectRatio="none"></svg></div>
        <div class="legend" id="legend"></div>
        <script type="application/json" id="payload" nonce="${nonce}">${payload}</script>
        <script nonce="${nonce}">${CHART_SCRIPT}</script>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px 16px; }
  h1 { font-size: 1.1em; margin: 0 0 4px; }
  .path { color: var(--vscode-descriptionForeground); margin-bottom: 12px; }
  .muted { color: var(--vscode-descriptionForeground); }
  .error { color: var(--vscode-errorForeground); }
  .chart-wrap { width: 100%; }
  svg { width: 100%; height: 280px; display: block; }
  .legend { display: flex; flex-wrap: wrap; gap: 10px 18px; margin-top: 10px; }
  .legend .item { display: inline-flex; align-items: center; gap: 6px; font-size: 0.92em; }
  .legend .swatch { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
  .toolbar { margin-top: 14px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
<h1>${escapeHtml(options.relativePath)}</h1>
<div class="path">${escapeHtml(options.rootPath)}</div>
${body}
<div class="toolbar"><button id="refresh">Refresh</button></div>
<script nonce="${nonce}">
  const api = acquireVsCodeApi();
  const refresh = document.getElementById('refresh');
  if (refresh) refresh.addEventListener('click', () => api.postMessage({ type: 'refresh' }));
</script>
</body>
</html>`;
}

// Runs inside the webview: reads the injected payload and draws a stacked bar
// chart with plain SVG (no external libraries).
export const CHART_SCRIPT = `
(function () {
  const el = document.getElementById('payload');
  if (!el) return;
  const payload = JSON.parse(el.textContent || '{}');
  const data = payload.data;
  const colors = payload.colors;
  const otherColor = payload.otherColor;
  const buckets = data.buckets || [];
  const authors = data.authors || [];
  const colorOf = (name) => {
    const i = authors.findIndex((a) => a.name === name);
    return i >= 0 ? colors[i % colors.length] : otherColor;
  };

  const summary = document.getElementById('summary');
  if (summary) {
    const first = data.firstDate ? new Date(data.firstDate).toLocaleDateString() : '';
    const last = data.lastDate ? new Date(data.lastDate).toLocaleDateString() : '';
    const capped = payload.capped ? ' (latest ' + payload.loaded + ' commits)' : '';
    summary.textContent = data.total + ' commits · ' + first + ' → ' + last + capped;
  }

  const svg = document.getElementById('chart');
  if (!svg || buckets.length === 0) return;
  const W = 900, H = 280, LEFT = 44, RIGHT = 10, TOP = 10, BOTTOM = 34;
  const innerW = W - LEFT - RIGHT, innerH = H - TOP - BOTTOM;
  const max = Math.max.apply(null, buckets.map((b) => b.total).concat([1]));
  const step = innerW / buckets.length;
  const barW = Math.max(2, Math.min(28, step * 0.7));
  const ns = 'http://www.w3.org/2000/svg';
  const add = (tag, attrs, text) => {
    const node = document.createElementNS(ns, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (text !== undefined) node.textContent = text;
    svg.appendChild(node);
    return node;
  };

  // Y axis: baseline + max label.
  add('line', { x1: LEFT, y1: TOP + innerH, x2: W - RIGHT, y2: TOP + innerH, stroke: 'currentColor', 'stroke-opacity': 0.35, 'stroke-width': 1 });
  add('text', { x: LEFT - 6, y: TOP + 10, 'text-anchor': 'end', 'font-size': 11, fill: 'currentColor', 'fill-opacity': 0.8 }, String(max));
  add('text', { x: LEFT - 6, y: TOP + innerH + 4, 'text-anchor': 'end', 'font-size': 11, fill: 'currentColor', 'fill-opacity': 0.8 }, '0');

  // X labels: first, middle, last (or every bucket when there are few). The
  // first/last labels are anchored inward so they are not clipped at the edges.
  const labelIdx = buckets.length <= 8
    ? buckets.map((_, i) => i)
    : [0, Math.floor(buckets.length / 2), buckets.length - 1];
  for (const i of labelIdx) {
    const anchor = labelIdx.length > 1 && i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle';
    add('text', {
      x: LEFT + i * step + step / 2,
      y: H - 12,
      'text-anchor': anchor,
      'font-size': 11,
      fill: 'currentColor',
      'fill-opacity': 0.8,
    }, buckets[i].label);
  }

  buckets.forEach((bucket, i) => {
    const x = LEFT + i * step + (step - barW) / 2;
    let y = TOP + innerH;
    const stack = Object.keys(bucket.byAuthor)
      .map((name) => ({ name, count: bucket.byAuthor[name] }))
      .sort((a, b) => b.count - a.count);
    const group = add('g', {});
    const title = document.createElementNS(ns, 'title');
    title.textContent = bucket.label + ': ' + bucket.total + ' commit' + (bucket.total === 1 ? '' : 's') +
      (stack.length ? ' — ' + stack.map((s) => s.name + ' (' + s.count + ')').join(', ') : '');
    group.appendChild(title);
    for (const s of stack) {
      const h = (s.count / max) * innerH;
      y -= h;
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', barW);
      rect.setAttribute('height', Math.max(1, h));
      rect.setAttribute('fill', colorOf(s.name));
      rect.setAttribute('rx', '1');
      group.appendChild(rect);
    }
  });

  const legend = document.getElementById('legend');
  if (legend) {
    authors.forEach((a, i) => {
      const item = document.createElement('span');
      item.className = 'item';
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = colors[i % colors.length];
      item.appendChild(sw);
      item.appendChild(document.createTextNode(a.name + ' (' + a.commits + ')'));
      legend.appendChild(item);
    });
  }
})();
`;
