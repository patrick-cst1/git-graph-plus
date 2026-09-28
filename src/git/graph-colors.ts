const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Built-in graph rail palette. Kept in sync with the `gitGraphPlus.graphColors`
 * default in package.json and the webview's DEFAULT_GRAPH_COLORS.
 */
export const DEFAULT_GRAPH_COLORS: string[] = [
  '#0085d9', '#d9008f', '#00d90a', '#d98500',
  '#a300d9', '#ff0000', '#00d9cc', '#e138e8',
  '#85d900', '#dc5b23', '#6f24d6', '#ffcc00',
];

/**
 * Validate a user-configured graph color palette. Keeps only valid `#rgb` /
 * `#rrggbb` strings (invalid entries are skipped silently, mirroring
 * compileBranchColorRules). Falls back to DEFAULT_GRAPH_COLORS when the result
 * would be empty (empty config, all-invalid entries, or non-array input).
 */
export function resolveGraphColors(raw: unknown): string[] {
  if (!Array.isArray(raw)) return DEFAULT_GRAPH_COLORS;
  const colors = raw.filter(
    (c): c is string => typeof c === 'string' && HEX_COLOR.test(c),
  );
  return colors.length > 0 ? colors : DEFAULT_GRAPH_COLORS;
}
