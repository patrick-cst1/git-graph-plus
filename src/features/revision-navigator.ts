// Revision navigator: step through the revisions of the active file's history
// (newest commit → oldest → back to the working tree) and open any revision
// from a quick pick. Revisions are shown read-only through the built-in git
// content provider (`git:` scheme), like the graph's diffs.

import * as vscode from 'vscode';
import * as path from 'path';
import type { GitService } from '../git/git-service';
import type { Commit } from '../git/types';
import { getRepoRootForFile } from '../services/repo-resolver';
import { formatRelativeTime } from '../utils/blame-format';
import { toGitUri, gitUriRef } from '../utils/git-uri';

export interface RevisionNavigatorOptions {
  /** GitService for the repo that owns a file, or undefined when not in a repo. */
  getGitServiceForFile: (fsPath: string) => GitService | undefined;
}

const HISTORY_LIMIT = 200;

export function registerRevisionNavigator(
  context: vscode.ExtensionContext,
  options: RevisionNavigatorOptions,
): void {
  let filePath: string | undefined;
  let history: Commit[] = [];
  let cursor = -1; // -1 = the working tree
  let loading: Promise<void> | undefined;

  function activeFile(): { fsPath: string; ref?: string } | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return undefined;
    const uri = editor.document.uri;
    if (uri.scheme === 'file') return { fsPath: uri.fsPath };
    if (uri.scheme === 'git') return { fsPath: uri.fsPath, ref: gitUriRef(uri) };
    return undefined;
  }

  async function ensureHistory(fsPath: string): Promise<Commit[] | undefined> {
    if (filePath === fsPath && history.length > 0) return history;
    const root = getRepoRootForFile(fsPath);
    const service = root ? options.getGitServiceForFile(fsPath) : undefined;
    if (!root || !service) {
      vscode.window.showInformationMessage('Commit Timeline: the file is not inside a git repository.');
      return undefined;
    }
    const rel = path.relative(root, fsPath).split(path.sep).join('/');
    const fetched = await service.fileHistory(rel, { limit: HISTORY_LIMIT });
    filePath = fsPath;
    history = fetched;
    return history;
  }

  function positionOf(current: { fsPath: string; ref?: string }): number {
    if (!current.ref) return -1;
    const index = history.findIndex((c) => c.hash === current.ref);
    return index >= 0 ? index : -1;
  }

  async function openRevision(fsPath: string, index: number): Promise<void> {
    const commit = index >= 0 ? history[index] : undefined;
    if (index >= 0 && !commit) return;
    const uri = commit ? toGitUri(fsPath, commit.hash) : vscode.Uri.file(fsPath);
    await vscode.window.showTextDocument(uri, { preview: true, preserveFocus: false });
    cursor = commit ? index : -1;
    const label = commit
      ? `Revision ${index + 1}/${history.length}: ${commit.abbreviatedHash} — ${commit.subject}`
      : 'Working tree (latest)';
    vscode.window.setStatusBarMessage(`Commit Timeline: ${label}`, 5000);
  }

  async function step(delta: 1 | -1): Promise<void> {
    const current = activeFile();
    if (!current) return;
    const loaded = await ensureHistory(current.fsPath);
    if (!loaded) return;
    cursor = positionOf(current);
    const next = cursor + delta;
    if (next < -1) {
      vscode.window.setStatusBarMessage('Commit Timeline: already viewing the working tree.', 3000);
      return;
    }
    if (next >= history.length) {
      vscode.window.setStatusBarMessage('Commit Timeline: no older revision in the loaded history.', 3000);
      return;
    }
    await openRevision(current.fsPath, next);
  }

  async function pickRevision(): Promise<void> {
    const current = activeFile();
    if (!current) return;
    const loaded = await ensureHistory(current.fsPath);
    if (!loaded) return;
    if (loaded.length === 0) {
      vscode.window.showInformationMessage('Commit Timeline: no committed revisions for this file yet.');
      return;
    }
    cursor = positionOf(current);
    interface RevisionPick extends vscode.QuickPickItem {
      index: number;
    }
    const items: RevisionPick[] = [
      {
        label: '$(file) Working tree',
        description: 'latest',
        index: -1,
      },
      ...loaded.map((c, i) => ({
        label: `$(git-commit) ${c.subject}`,
        description: `${c.abbreviatedHash} · ${c.author.name}, ${formatRelativeTime(Date.parse(c.author.date) / 1000)}`,
        index: i,
      })),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: `Revisions of ${path.basename(current.fsPath)}`,
      placeHolder: 'Open a revision (read-only)',
      matchOnDescription: true,
    });
    if (!picked) return;
    await openRevision(current.fsPath, picked.index);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('gitGraphPlus.openFileRevision', () => pickRevision()),
    vscode.commands.registerCommand('gitGraphPlus.previousRevision', () => step(-1)),
    vscode.commands.registerCommand('gitGraphPlus.nextRevision', () => step(1)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      const fsPath = editor && (editor.document.uri.scheme === 'file' || editor.document.uri.scheme === 'git')
        ? editor.document.uri.fsPath
        : undefined;
      if (fsPath !== filePath) {
        history = [];
        cursor = -1;
      }
    }),
  );
}
