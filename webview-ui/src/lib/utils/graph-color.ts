/**
 * Built-in graph rail palette. Kept in sync with the `gitGraphPlus.graphColors`
 * default in package.json and the extension's DEFAULT_GRAPH_COLORS. Used as the
 * palette store's initial value and as the fallback for an empty palette.
 */
export const DEFAULT_GRAPH_COLORS: string[] = [
  '#0085d9', '#d9008f', '#00d90a', '#d98500',
  '#a300d9', '#ff0000', '#00d9cc', '#e138e8',
  '#85d900', '#dc5b23', '#6f24d6', '#ffcc00',
];

/**
 * Resolve a graph element's display color: a pattern-matched override wins,
 * otherwise fall back to the auto-assigned palette color (index wraps).
 */
export function resolveGraphColor(palette: string[], index: number, override?: string): string {
  if (override) return override;
  return palette[index % palette.length];
}
