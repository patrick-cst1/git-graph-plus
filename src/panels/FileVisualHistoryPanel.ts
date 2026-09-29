// Visual File History: a standalone webview panel that charts a file's commit
// history — commits per time bucket, stacked by author — so the user can see
// at a glance when a file was most active and who changed it.

import * as vscode from 'vscode';
import type { GitService } from '../git/git-service';
import { buildVisualHistory, type VisualHistoryData } from '../git/visual-history';
import { renderFileVisualHistoryHtml } from './file-visual-history-html';

const MAX_COMMITS = 500;

export class FileVisualHistoryPanel {
  static currentPanel: FileVisualHistoryPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly gitService: GitService;
  private readonly fsPath: string;
  private readonly relativePath: string;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(
    fsPath: string,
    relativePath: string,
    gitService: GitService,
  ): void {
    if (FileVisualHistoryPanel.currentPanel) {
      const panel = FileVisualHistoryPanel.currentPanel;
      if (panel.fsPath === fsPath) {
        panel.panel.reveal(undefined, true);
        void panel.load();
        return;
      }
      panel.dispose();
    }
    const created = new FileVisualHistoryPanel(fsPath, relativePath, gitService);
    FileVisualHistoryPanel.currentPanel = created;
    void created.load();
  }

  private constructor(fsPath: string, relativePath: string, gitService: GitService) {
    this.fsPath = fsPath;
    this.relativePath = relativePath;
    this.gitService = gitService;
    this.panel = vscode.window.createWebviewPanel(
      'gitGraphPlus.fileVisualHistory',
      `File History: ${relativePath.split('/').pop() ?? relativePath}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.render();
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage((message: { type?: string }) => {
      if (message?.type === 'refresh') void this.load();
    }, null, this.disposables);
  }

  private async load(): Promise<void> {
    try {
      const commits = await this.gitService.fileHistory(this.relativePath, { limit: MAX_COMMITS });
      const data = buildVisualHistory(commits.map((c) => ({
        hash: c.hash,
        author: c.author.name || 'unknown',
        date: c.author.date,
      })));
      this.panel.webview.html = this.render(data, commits.length);
    } catch (err) {
      this.panel.webview.html = this.render(undefined, undefined, err instanceof Error ? err.message : 'Failed to load history.');
    }
  }

  private render(data?: VisualHistoryData, loaded?: number, error?: string): string {
    return renderFileVisualHistoryHtml({
      relativePath: this.relativePath,
      rootPath: this.gitService.rootPath,
      data,
      loaded,
      cap: MAX_COMMITS,
      error,
    });
  }

  dispose(): void {
    FileVisualHistoryPanel.currentPanel = undefined;
    this.panel.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
