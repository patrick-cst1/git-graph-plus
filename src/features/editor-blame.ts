// Editor-level blame features: current-line blame (trailing decoration),
// status-bar blame, and hover cards. Registered once from activate(); all
// state is derived from the shared BlameService cache.

import * as vscode from 'vscode';
import type { BlameService } from '../services/blame-service';
import { isUncommitted, type BlameLine } from '../git/blame-parser';
import { formatAbsoluteTime, formatBlameLabel, formatRelativeTime } from '../utils/blame-format';

export interface EditorBlameOptions {
  blameService: BlameService;
  /** Open a commit in the Commit Timeline panel. */
  showCommit: (hash: string) => void;
}

const SHOW_COMMIT_COMMAND = 'gitGraphPlus.showCommit';
const DEBOUNCE_MS = 90;

export function registerEditorBlame(context: vscode.ExtensionContext, options: EditorBlameOptions): void {
  const { blameService } = options;

  const lineDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      margin: '0 0 0 2em',
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      fontStyle: 'italic',
    },
  });
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  context.subscriptions.push(lineDecoration, statusItem);

  const config = () => vscode.workspace.getConfiguration('gitGraphPlus');
  const currentLineEnabled = () => config().get<boolean>('currentLineBlame.enabled', true) !== false;
  const statusBarEnabled = () => config().get<boolean>('statusBarBlame.enabled', true) !== false;
  const hoversEnabled = () => config().get<boolean>('hovers.enabled', true) !== false;
  const blameFormat = () => config().get<string>('currentLineBlame.format', '{author}, {ago}');

  let decoratedEditor: vscode.TextEditor | undefined;
  let lastKey = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearDecorations(): void {
    if (decoratedEditor) {
      decoratedEditor.setDecorations(lineDecoration, []);
      decoratedEditor = undefined;
    }
  }

  function clearAll(): void {
    clearDecorations();
    statusItem.hide();
    lastKey = '';
  }

  function tooltipFor(blame: BlameLine, fsPath: string): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.isTrusted = { enabledCommands: [SHOW_COMMIT_COMMAND] };
    if (isUncommitted(blame)) {
      md.appendMarkdown(`**Uncommitted changes**\n\nNot committed yet.`);
      return md;
    }
    md.appendMarkdown(`**${blame.author}** · ${formatAbsoluteTime(blame.authorTime)} (${formatRelativeTime(blame.authorTime)})\n\n`);
    md.appendMarkdown(`${blame.summary}\n\n`);
    const file = blame.filename || fsPath;
    md.appendMarkdown(`\`${blame.hash.slice(0, 7)}\` · ${file}:${blame.line}`);
    return md;
  }

  async function update(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      clearAll();
      return;
    }
    const doc = editor.document;
    const line = editor.selection.active.line + 1;

    // The selection can span lines; the blame shown is for the active end.
    const key = `${doc.uri.fsPath}:${line}:${doc.version}`;
    if (key === lastKey) return;
    lastKey = key;

    const blame = await blameService.getLineBlame(doc.uri.fsPath, line, doc.lineCount);

    // The editor may have moved on while blame was loading — only apply when
    // the same line is still active.
    if (vscode.window.activeTextEditor !== editor || editor.selection.active.line + 1 !== line) return;

    if (!blame) {
      clearAll();
      return;
    }

    if (currentLineEnabled()) {
      if (decoratedEditor && decoratedEditor !== editor) clearDecorations();
      const end = doc.lineAt(line - 1).text.length;
      const range = new vscode.Range(line - 1, end, line - 1, end);
      editor.setDecorations(lineDecoration, [
        { range, renderOptions: { after: { contentText: ` ${formatBlameLabel(blame, blameFormat())}` } } },
      ]);
      decoratedEditor = editor;
    } else {
      clearDecorations();
    }

    if (statusBarEnabled()) {
      if (isUncommitted(blame)) {
        statusItem.text = '$(git-commit) Uncommitted changes';
        statusItem.tooltip = tooltipFor(blame, doc.uri.fsPath);
        statusItem.command = undefined;
      } else {
        statusItem.text = `$(git-commit) ${blame.author}, ${formatRelativeTime(blame.authorTime)}`;
        statusItem.tooltip = tooltipFor(blame, doc.uri.fsPath);
        statusItem.command = { command: SHOW_COMMIT_COMMAND, title: 'Open in Commit Timeline', arguments: [blame.hash] };
      }
      statusItem.show();
    } else {
      statusItem.hide();
    }
  }

  function schedule(delay = DEBOUNCE_MS): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void update();
    }, delay);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => { lastKey = ''; schedule(0); }),
    vscode.window.onDidChangeTextEditorSelection(() => schedule()),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== 'file') return;
      blameService.invalidate(e.document.uri.fsPath);
      lastKey = '';
      schedule(150);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme !== 'file') return;
      blameService.invalidate(doc.uri.fsPath);
      lastKey = '';
      schedule(0);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('gitGraphPlus')) return;
      lastKey = '';
      schedule(0);
    }),
  );

  // Hover cards: commit details for the hovered line, with a link that opens
  // the commit in the panel.
  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: 'file' }, {
      async provideHover(document, position) {
        if (!hoversEnabled()) return undefined;
        const line = position.line + 1;
        const blame = await blameService.getLineBlame(document.uri.fsPath, line, document.lineCount);
        if (!blame) return undefined;
        const md = new vscode.MarkdownString();
        md.isTrusted = { enabledCommands: [SHOW_COMMIT_COMMAND] };
        if (isUncommitted(blame)) {
          md.appendMarkdown(`**Uncommitted changes**\n\nNot committed yet.`);
        } else {
          md.appendMarkdown(`**${blame.author}** · ${formatAbsoluteTime(blame.authorTime)} (${formatRelativeTime(blame.authorTime)})\n\n`);
          md.appendMarkdown(`${blame.summary}\n\n`);
          md.appendMarkdown(`\`${blame.hash.slice(0, 7)}\` · ${blame.filename}:${line}`);
          md.appendMarkdown(`\n\n[Open in Commit Timeline](command:${SHOW_COMMIT_COMMAND}?${encodeURIComponent(JSON.stringify([blame.hash]))})`);
        }
        return new vscode.Hover(md, new vscode.Range(position.line, 0, position.line, 0));
      },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('gitGraphPlus.toggleCurrentLineBlame', async () => {
      const next = !currentLineEnabled();
      await config().update('currentLineBlame.enabled', next, vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(next ? 'Commit Timeline: line blame on' : 'Commit Timeline: line blame off', 3000);
    }),
    vscode.commands.registerCommand(SHOW_COMMIT_COMMAND, (hash: unknown) => {
      if (typeof hash === 'string' && hash.length > 0) options.showCommit(hash);
    }),
  );

  schedule(0);
}
