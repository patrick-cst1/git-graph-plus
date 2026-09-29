// Builds `git:`-scheme URIs in the exact format VS Code's built-in Git
// extension understands (mirrors its internal `toGitUri`), so the built-in
// content provider serves the blob: ref '' → index (stage 0), 'HEAD'/<sha> →
// that revision. The query `path` is the absolute fsPath; the URI path keeps
// the file extension so the editor still infers the language.

import * as vscode from 'vscode';

export function toGitUri(fsPath: string, ref: string): vscode.Uri {
  const fileUri = vscode.Uri.file(fsPath);
  return fileUri.with({
    scheme: 'git',
    query: JSON.stringify({ path: fileUri.fsPath, ref }),
  });
}

/** The ref embedded in a `git:`-scheme URI, or undefined for other URIs. */
export function gitUriRef(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== 'git') return undefined;
  try {
    const parsed = JSON.parse(uri.query) as { ref?: unknown };
    return typeof parsed.ref === 'string' ? parsed.ref : undefined;
  } catch {
    return undefined;
  }
}
