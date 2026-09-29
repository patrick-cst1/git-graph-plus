// Editor file annotations (opt-in): blame text on every line, working-tree
// change marks, and a recency heatmap — plus an optional per-block CodeLens.
// Toggled from the editor title bar / command palette; state is session-only
// (like GitLens's per-editor toggles) and applied to the active editor.

import * as vscode from 'vscode';
import * as path from 'path';
import type { BlameService } from '../services/blame-service';
import type { GitService } from '../git/git-service';
import { isUncommitted, type BlameLine } from '../git/blame-parser';
import { formatRelativeTime } from '../utils/blame-format';
import { getRepoRootForFile } from '../services/repo-resolver';

export interface EditorAnnotationsOptions {
  blameService: BlameService;
  /** GitService for the repo that owns a file, or undefined when not in a repo. */
  getGitServiceForFile: (fsPath: string) => GitService | undefined;
  showCommit: (hash: string) => void;
}

const MAX_ANNOTATION_LINES = 20_000;
const MAX_CODELENS_BLOCKS = 400;
const SHOW_COMMIT_COMMAND = 'gitGraphPlus.showCommit';
const CONTEXT_KEY = {
  blame: 'gitGraphPlus.annotations.blame',
  changes: 'gitGraphPlus.annotations.changes',
  heatmap: 'gitGraphPlus.annotations.heatmap',
};

/** Heat buckets (days) → decoration index, hot (recent) → cold (old). */
const HEAT_DAYS = [1, 7, 30, 90, 180, 365];
const HEAT_COLORS = [
  'rgba(255, 80, 60, 0.22)',
  'rgba(255, 140, 60, 0.20)',
  'rgba(255, 200, 70, 0.18)',
  'rgba(150, 210, 90, 0.16)',
  'rgba(90, 190, 160, 0.15)',
  'rgba(80, 150, 220, 0.14)',
  'rgba(110, 120, 200, 0.12)',
];

export function registerEditorAnnotations(
  context: vscode.ExtensionContext,
  options: EditorAnnotationsOptions,
): void {
  const { blameService } = options;

  const blameDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      margin: '0 0 0 1.5em',
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      fontStyle: 'italic',
    },
  });
  const addedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(80, 200, 120, 0.16)',
    overviewRulerColor: 'rgba(80, 200, 120, 0.8)',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  const modifiedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(80, 150, 230, 0.16)',
    overviewRulerColor: 'rgba(80, 150, 230, 0.8)',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  const deletedDecoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: 'rgba(230, 90, 90, 0.14)',
    overviewRulerColor: 'rgba(230, 90, 90, 0.8)',
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
  const heatDecorations = HEAT_COLORS.map((color) =>
    vscode.window.createTextEditorDecorationType({ isWholeLine: true, backgroundColor: color }),
  );
  context.subscriptions.push(
    blameDecoration, addedDecoration, modifiedDecoration, deletedDecoration, ...heatDecorations,
  );

  const config = () => vscode.workspace.getConfiguration('gitGraphPlus');
  const codeLensEnabled = () => config().get<boolean>('codeLens.enabled', false) === true;

  let blameOn = false;
  let changesOn = false;
  let heatmapOn = false;
  const setContext = (key: string, value: boolean) =>
    void vscode.commands.executeCommand('setContext', key, value);

  let appliedEditor: vscode.TextEditor | undefined;
  let applyToken = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearAll(editor: vscode.TextEditor | undefined = appliedEditor): void {
    if (!editor) return;
    editor.setDecorations(blameDecoration, []);
    editor.setDecorations(addedDecoration, []);
    editor.setDecorations(modifiedDecoration, []);
    editor.setDecorations(deletedDecoration, []);
    for (const d of heatDecorations) editor.setDecorations(d, []);
    if (appliedEditor === editor) appliedEditor = undefined;
  }

  function heatIndex(blame: BlameLine): number {
    const days = blame.authorTime ? (Date.now() / 1000 - blame.authorTime) / 86400 : 9999;
    for (let i = 0; i < HEAT_DAYS.length; i++) {
      if (days <= HEAT_DAYS[i]) return i;
    }
    return HEAT_COLORS.length - 1;
  }

  async function apply(): Promise<void> {
    const token = ++applyToken;
    const editor = vscode.window.activeTextEditor;
    if (appliedEditor && appliedEditor !== editor) clearAll(appliedEditor);

    if (!editor || editor.document.uri.scheme !== 'file') return;
    if (!blameOn && !changesOn && !heatmapOn) {
      clearAll(editor);
      return;
    }
    const doc = editor.document;
    const lineCount = doc.lineCount;
    if (lineCount > MAX_ANNOTATION_LINES) {
      vscode.window.setStatusBarMessage(
        'Commit Timeline: file too large for annotations', 4000,
      );
      return;
    }

    const fsPath = doc.uri.fsPath;
    const needBlame = blameOn || heatmapOn;
    const file = needBlame ? await blameService.getFileBlame(fsPath, lineCount) : undefined;
    if (token !== applyToken || vscode.window.activeTextEditor !== editor) return;

    // ── Blame text ──
    if (blameOn) {
      const decorations: vscode.DecorationOptions[] = [];
      if (file) {
        for (let line = 1; line <= lineCount; line++) {
          const blame = file.lines.get(line);
          if (!blame) continue;
          const text = isUncommitted(blame)
            ? 'You, uncommitted'
            : `${blame.author}, ${formatRelativeTime(blame.authorTime)}`;
          const end = doc.lineAt(line - 1).text.length;
          decorations.push({
            range: new vscode.Range(line - 1, end, line - 1, end),
            renderOptions: { after: { contentText: ` ${text}` } },
          });
        }
      }
      editor.setDecorations(blameDecoration, decorations);
    } else {
      editor.setDecorations(blameDecoration, []);
    }

    // ── Heatmap ──
    if (heatmapOn) {
      const buckets: vscode.DecorationOptions[][] = heatDecorations.map(() => []);
      if (file) {
        for (let line = 1; line <= lineCount; line++) {
          const blame = file.lines.get(line);
          if (!blame) continue;
          buckets[heatIndex(blame)].push({ range: doc.lineAt(line - 1).range });
        }
      }
      heatDecorations.forEach((d, i) => editor.setDecorations(d, buckets[i]));
    } else {
      for (const d of heatDecorations) editor.setDecorations(d, []);
    }

    // ── Working-tree changes ──
    if (changesOn) {
      const root = getRepoRootForFile(fsPath);
      const service = root ? options.getGitServiceForFile(fsPath) : undefined;
      let added: vscode.DecorationOptions[] = [];
      let modified: vscode.DecorationOptions[] = [];
      let deleted: vscode.DecorationOptions[] = [];
      if (service && root) {
        const rel = path.relative(root, fsPath);
        const marks = await service.workingFileLineMarks(rel);
        if (token !== applyToken || vscode.window.activeTextEditor !== editor) return;
        const toOptions = (lines: number[]): vscode.DecorationOptions[] =>
          lines
            .filter((line) => line >= 1 && line <= lineCount)
            .map((line) => ({ range: doc.lineAt(line - 1).range }));
        added = toOptions(marks.added);
        modified = toOptions(marks.modified);
        deleted = toOptions(marks.deleted);
      }
      editor.setDecorations(addedDecoration, added);
      editor.setDecorations(modifiedDecoration, modified);
      editor.setDecorations(deletedDecoration, deleted);
    } else {
      editor.setDecorations(addedDecoration, []);
      editor.setDecorations(modifiedDecoration, []);
      editor.setDecorations(deletedDecoration, []);
    }

    appliedEditor = editor;
  }

  function schedule(delay = 120): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void apply();
    }, delay);
  }

  // ── CodeLens: one lens per blame block (author + age), click opens the commit ──
  const lensEmitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(lensEmitter);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file' }, {
      onDidChangeCodeLenses: lensEmitter.event,
      async provideCodeLenses(document) {
        if (!codeLensEnabled() || document.uri.scheme !== 'file') return [];
        const lineCount = document.lineCount;
        if (lineCount > MAX_ANNOTATION_LINES) return [];
        const file = await blameService.getFileBlame(document.uri.fsPath, lineCount);
        if (!file) return [];
        const lenses: vscode.CodeLens[] = [];
        let lastHash = '';
        let blocks = 0;
        for (let line = 1; line <= lineCount; line++) {
          const blame = file.lines.get(line);
          if (!blame || blame.hash === lastHash) continue;
          lastHash = blame.hash;
          if (blocks++ >= MAX_CODELENS_BLOCKS) break;
          const range = new vscode.Range(line - 1, 0, line - 1, 0);
          if (isUncommitted(blame)) continue;
          lenses.push(new vscode.CodeLens(range, {
            title: `${blame.author}, ${formatRelativeTime(blame.authorTime)}`,
            command: SHOW_COMMIT_COMMAND,
            arguments: [blame.hash],
          }));
        }
        return lenses;
      },
    }),
  );

  const toggle = async (which: 'blame' | 'changes' | 'heatmap') => {
    const next = which === 'blame' ? !blameOn : which === 'changes' ? !changesOn : !heatmapOn;
    if (which === 'blame') blameOn = next;
    else if (which === 'changes') changesOn = next;
    else heatmapOn = next;
    await setContext(CONTEXT_KEY[which], next);
    lensEmitter.fire();
    await apply();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('gitGraphPlus.toggleBlameAnnotations', () => toggle('blame')),
    vscode.commands.registerCommand('gitGraphPlus.toggleChangesAnnotations', () => toggle('changes')),
    vscode.commands.registerCommand('gitGraphPlus.toggleHeatmap', () => toggle('heatmap')),
    vscode.window.onDidChangeActiveTextEditor(() => schedule(0)),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== 'file') return;
      if (e.document === vscode.window.activeTextEditor?.document) schedule(250);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc === vscode.window.activeTextEditor?.document) schedule(0);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('gitGraphPlus.codeLens')) lensEmitter.fire();
    }),
  );

  void setContext(CONTEXT_KEY.blame, blameOn);
  void setContext(CONTEXT_KEY.changes, changesOn);
  void setContext(CONTEXT_KEY.heatmap, heatmapOn);
}
