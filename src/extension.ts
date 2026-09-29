import * as vscode from 'vscode';
import * as path from 'path';
import { existsSync } from 'fs';
import { setGitBinaryPath } from './git/git-binary';
import { MainPanel } from './panels/MainPanel';
import { GitService } from './git/git-service';
import { FileWatcher } from './services/file-watcher';
import { BranchesViewProvider } from './views/branches-view';
import { RemotesViewProvider } from './views/remotes-view';
import { TagsViewProvider } from './views/tags-view';
import { StashesViewProvider } from './views/stashes-view';
import { WorktreesViewProvider } from './views/worktrees-view';
import { StatusBarManager } from './views/status-bar';
import { BlameService } from './services/blame-service';
import { registerEditorBlame } from './features/editor-blame';
import { registerEditorAnnotations } from './features/editor-annotations';
import { registerRevisionNavigator } from './features/revision-navigator';
import { registerGitCommandPalette } from './features/git-command-palette';
import { FileHistoryViewProvider, type FileHistoryViewState } from './views/file-history-view';
import { SearchCompareViewProvider, type SearchCompareState } from './views/search-compare-view';
import { FileVisualHistoryPanel } from './panels/FileVisualHistoryPanel';
import { toGitUri } from './utils/git-uri';
import { getRepoRootForFile } from './services/repo-resolver';
import { RepoDiscoveryService } from './services/repo-discovery';
import { samePath } from './utils/path';
import { resolveDefaultWorktreePath } from './utils/worktree-path';
import { readTimeoutMs } from './utils/config';

/**
 * Resolve the `git.path` setting to an existing executable. The setting may be
 * a single path or an array of candidates (VS Code uses the first that exists).
 * Returns undefined when nothing is configured or none of the candidates exist.
 */
export function resolveConfiguredGitPath(): string | undefined {
  const cfg = vscode.workspace.getConfiguration('git').get<string | string[] | null>('path');
  const candidates = Array.isArray(cfg) ? cfg : cfg ? [cfg] : [];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return undefined;
}

export function activate(context: vscode.ExtensionContext) {
  // Status bar is always visible regardless of workspace state
  const statusBar = new StatusBarManager();
  context.subscriptions.push(statusBar);

  // Persistent avatar cache lives under globalStorage so every window reuses
  // the same avatars instead of re-fetching from gravatar.com (issue #38).
  MainPanel.setAvatarCacheDir(vscode.Uri.joinPath(context.globalStorageUri, 'avatars').fsPath);

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    context.subscriptions.push(
      vscode.commands.registerCommand('git-graph-plus.open', () => {
        vscode.window.showWarningMessage('Commit Timeline: No workspace folder open.');
      }),
      vscode.commands.registerCommand('gitGraphPlus.open', () => {
        vscode.window.showWarningMessage('Commit Timeline: No workspace folder open.');
      }),
    );
    // VS Code does not re-run activate() when the user opens a folder later
    // (e.g. starts from an empty window and uses File → Open Folder). The
    // extension would silently stay in no-workspace mode forever. When a
    // folder appears, prompt to reload so a fresh activate runs against the
    // new workspace.
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
        if (e.added.length === 0) return;
        const reload = await vscode.window.showInformationMessage(
          vscode.l10n.t('Commit Timeline: Reload window to activate the extension for the newly opened folder?'),
          vscode.l10n.t('Reload'),
        );
        if (reload) {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      }),
    );
    return;
  }

  let activeRepoPath = workspaceFolder.uri.fsPath;

  // Resolve the git executable so the extension works when git is not on PATH
  // (e.g. portable/MSYS2 installs configured via `git.path`). The configured
  // path takes precedence; otherwise we fall back to the path the built-in git
  // extension resolved (set below once its API is available), then to PATH. #18
  let apiGitPath: string | undefined;
  const applyGitPath = () => setGitBinaryPath(resolveConfiguredGitPath() ?? apiGitPath);
  applyGitPath();

  let activeGitService = new GitService(activeRepoPath);
  activeGitService.setDefaultTimeout(readTimeoutMs());

  // Git env (askpass) resolved from the built-in git extension; applied to
  // every GitService we create for editor-level features too.
  let injectedGitEnv: Record<string, string> | undefined;

  // Per-repo GitService cache for editor-level features (blame, history).
  // The active repo keeps its long-lived service above; this map covers files
  // in other workspace repos without recreating a service per request.
  const repoGitServices = new Map<string, GitService>();
  function gitServiceForRepo(repoRoot: string): GitService {
    const key = repoRoot.toLowerCase();
    let service = repoGitServices.get(key);
    if (!service) {
      service = new GitService(repoRoot);
      service.setDefaultTimeout(readTimeoutMs());
      if (injectedGitEnv) service.setExtraEnv(injectedGitEnv);
      repoGitServices.set(key, service);
    }
    return service;
  }

  // Shared blame cache behind current-line blame, status bar and hovers.
  const blameService = new BlameService(gitServiceForRepo);

  // Inject VS Code's built-in git extension askpass env so authentication prompts work
  const builtinGit = vscode.extensions.getExtension('vscode.git');
  if (builtinGit) {
    const waitForGit = builtinGit.isActive ? Promise.resolve(builtinGit.exports) : Promise.resolve(builtinGit.activate());
    waitForGit.then((ext: { getAPI(version: number): { git: { env?: Record<string, string>; path?: string } } }) => {
      try {
        const git = ext.getAPI(1)?.git;
        if (git?.env) {
          activeGitService.setExtraEnv(git.env);
          MainPanel.setExtraEnv(git.env);
          injectedGitEnv = git.env;
        }
        // The built-in extension's resolved path already honors `git.path`; adopt
        // it as the fallback for when the user hasn't set a valid `git.path`.
        if (typeof git?.path === 'string' && git.path) {
          apiGitPath = git.path;
          applyGitPath();
        }
      } catch { /* built-in git extension API unavailable */ }
    }).catch(() => {});
  }

  // Re-resolve when the user changes `git.path` at runtime.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('git.path')) applyGitPath();
      if (e.affectsConfiguration('gitGraphPlus.timeout')) activeGitService.setDefaultTimeout(readTimeoutMs());
    }),
  );

  // --- Tree View Providers ---
  const branchesProvider = new BranchesViewProvider(activeGitService);
  const remotesProvider = new RemotesViewProvider(activeGitService);
  const tagsProvider = new TagsViewProvider(activeGitService);
  const stashesProvider = new StashesViewProvider(activeGitService);
  const worktreesProvider = new WorktreesViewProvider(activeGitService);

  const branchesView = vscode.window.createTreeView('gitGraphPlus.branches', { treeDataProvider: branchesProvider });
  const remotesView = vscode.window.createTreeView('gitGraphPlus.remotes', { treeDataProvider: remotesProvider });
  const tagsView = vscode.window.createTreeView('gitGraphPlus.tags', { treeDataProvider: tagsProvider });
  const stashesView = vscode.window.createTreeView('gitGraphPlus.stashes', { treeDataProvider: stashesProvider });
  const worktreesView = vscode.window.createTreeView('gitGraphPlus.worktrees', { treeDataProvider: worktreesProvider });

  const initialRepoName = path.basename(activeRepoPath);
  branchesView.description = initialRepoName;
  remotesView.description = initialRepoName;
  tagsView.description = initialRepoName;
  stashesView.description = initialRepoName;
  worktreesView.description = initialRepoName;

  context.subscriptions.push(
    branchesProvider,
    remotesProvider,
    tagsProvider,
    stashesProvider,
    worktreesProvider,
    branchesView,
    remotesView,
    tagsView,
    stashesView,
    worktreesView,
  );

  // Prefetch all tree view data in parallel so first expand is instant
  Promise.all([
    branchesProvider.prefetch(),
    remotesProvider.prefetch(),
    tagsProvider.prefetch(),
    stashesProvider.prefetch(),
    worktreesProvider.prefetch(),
  ]).catch((err) => { console.warn('Commit Timeline: sidebar prefetch failed:', err instanceof Error ? err.message : err); });

  // --- File Watcher ---
  // This watcher owns the sidebar; the graph panel runs its own FileWatcher
  // (with a smarter partial-refresh path). When the panel is open, calling
  // postRefresh() here just duplicated that panel watcher's graph refresh;
  // when it's closed there's no panel to refresh. So this only refreshes the
  // sidebar. (The sidebar refresh shares one debounce timer with the panel
  // watcher's onSidebarRefresh, so they coalesce rather than double up.)
  let fileWatcher = new FileWatcher(activeRepoPath, () => {
    refreshAll();
  });
  fileWatcher.enabled = vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('autoRefresh', true);
  context.subscriptions.push({ dispose: () => fileWatcher.dispose() });

  // Working-tree saves are already caught by FileWatcher's '**' watcher (it
  // classifies them as 'status' and refreshes both the sidebar and the panel,
  // debounced and gated on the autoRefresh setting). A separate
  // onDidSaveTextDocument handler here only duplicated that work — firing an
  // immediate, un-debounced full refresh on every save in any workspace repo,
  // even when autoRefresh was off — so it was removed.

  // --- Auto-detect Git Repo if root isn't one ---
  RepoDiscoveryService.discoverRepos([activeRepoPath]).then(repos => {
    if (repos.length > 0 && !repos.some(r => samePath(r.path, activeRepoPath))) {
      const firstRepo = repos[0].path;
      activeRepoPath = firstRepo;
      activeGitService = new GitService(activeRepoPath);
      activeGitService.setDefaultTimeout(readTimeoutMs());

      // Re-inject environment if needed
      if (builtinGit && builtinGit.exports) {
        try {
          const env = (builtinGit.exports as any).getAPI(1)?.git?.env;
          if (env) { activeGitService.setExtraEnv(env); }
        } catch { /* ignore */ }
      }
      
      // Update providers
      branchesProvider.setGitService(activeGitService);
      remotesProvider.setGitService(activeGitService);
      tagsProvider.setGitService(activeGitService);
      stashesProvider.setGitService(activeGitService);
      worktreesProvider.setGitService(activeGitService);

      // Update view descriptions
      const repoName = path.basename(activeRepoPath);
      branchesView.description = repoName;
      remotesView.description = repoName;
      tagsView.description = repoName;
      stashesView.description = repoName;
      worktreesView.description = repoName;

      // Update file watcher (sidebar-only; see the watcher above for why).
      fileWatcher.dispose();
      fileWatcher = new FileWatcher(activeRepoPath, () => {
        refreshAll();
      });
      fileWatcher.enabled = vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('autoRefresh', true);
    }
  }).catch((err) => { console.warn('Commit Timeline: repo discovery failed:', err instanceof Error ? err.message : err); });

  // When workspace folders change (multi-root add/remove), re-discover repos
  // so the repo dropdown in the panel reflects reality. The panel-side
  // discovery cache is invalidated by sendRepoList(true).
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      RepoDiscoveryService.clearCache();
      MainPanel.currentPanel?.sendRepoList(true).catch(() => {});
      doSidebarRefresh();
    }),
  );

  let sidebarRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let sidebarRefreshing = false;
  let sidebarRefreshQueued = false;
  /** Extra sidebar refreshes registered after refreshAll is defined (File History). */
  let sidebarExtras: (() => void) | undefined;
  context.subscriptions.push({
    dispose: () => {
      if (sidebarRefreshTimer) {
        clearTimeout(sidebarRefreshTimer);
        sidebarRefreshTimer = null;
      }
    },
  });
  async function doSidebarRefresh() {
    if (sidebarRefreshing) { sidebarRefreshQueued = true; return; }
    sidebarRefreshing = true;
    try {
      await Promise.all([
        branchesProvider.refresh(),
        remotesProvider.refresh(),
        tagsProvider.refresh(),
        stashesProvider.refresh(),
        worktreesProvider.refresh(),
      ]);

      // Reveal current branch in sidebar (auto-expands folders)
      // ONLY if the view is already visible to prevent jumping to the SCM tab
      const currentItem = branchesProvider.getCurrentItem();
      if (currentItem && branchesView.visible) {
        // Small delay to ensure the tree view has processed the data change
        setTimeout(() => {
          branchesView.reveal(currentItem, { select: false, focus: false, expand: true }).then(undefined, () => {});
        }, 100);
      }
    } finally {
      sidebarRefreshing = false;
      if (sidebarRefreshQueued) {
        sidebarRefreshQueued = false;
        // Re-run once more to pick up changes that arrived during refresh.
        doSidebarRefresh();
      }
    }
  }
  function refreshAll() {
    // HEAD may have moved (commit, checkout, rebase, …): drop cached blame so
    // the next editor update reflects it.
    blameService.invalidateAll();
    sidebarExtras?.();
    if (sidebarRefreshTimer) { clearTimeout(sidebarRefreshTimer); }
    sidebarRefreshTimer = setTimeout(() => {
      sidebarRefreshTimer = null;
      doSidebarRefresh();
    }, 300);
  }

  function switchToRepo(newPath: string) {
    if (samePath(newPath, activeRepoPath)) { return; }
    activeRepoPath = newPath;
    blameService.invalidateAll();
    activeGitService = new GitService(newPath);
    activeGitService.setDefaultTimeout(readTimeoutMs());

    if (builtinGit) {
      const ext = builtinGit.exports;
      if (ext) {
        try {
          const env = ext.getAPI(1)?.git?.env;
          if (env) { activeGitService.setExtraEnv(env); }
        } catch { /* ignore */ }
      }
    }

    branchesProvider.setGitService(activeGitService);
    remotesProvider.setGitService(activeGitService);
    tagsProvider.setGitService(activeGitService);
    stashesProvider.setGitService(activeGitService);
    worktreesProvider.setGitService(activeGitService);

    const repoName = path.basename(newPath);
    branchesView.description = repoName;
    remotesView.description = repoName;
    tagsView.description = repoName;
    stashesView.description = repoName;
    worktreesView.description = repoName;

    fileWatcher.dispose();
    fileWatcher = new FileWatcher(newPath, () => {
      refreshAll();
    });
    fileWatcher.enabled = vscode.workspace.getConfiguration('gitGraphPlus').get<boolean>('autoRefresh', true);

    // If the webview panel is open, sync it to the new repo as well.
    // MainPanel.switchRepo() will call onRepoChange → switchToRepo again,
    // but the path.resolve guard above prevents an infinite loop.
    MainPanel.currentPanel?.switchRepo(newPath);

    refreshAll();
  }

  MainPanel.onSidebarRefresh = refreshAll;
  MainPanel.onRepoChange = switchToRepo;

  // Editor-level blame features (current-line blame, status bar, hovers),
  // file annotations (blame / changes / heatmap), CodeLens, and the
  // "open commit in the timeline" command they share.
  const showCommitInTimeline = (hash: string): void => {
    MainPanel.createOrShow(context.extensionUri, activeRepoPath);
    MainPanel.currentPanel?.showCommit(hash);
  };
  registerEditorBlame(context, { blameService, showCommit: showCommitInTimeline });
  registerEditorAnnotations(context, {
    blameService,
    getGitServiceForFile: (fsPath) => {
      const root = getRepoRootForFile(fsPath);
      return root ? gitServiceForRepo(root) : undefined;
    },
    showCommit: showCommitInTimeline,
  });

  // --- File History view (SCM sidebar) + revision navigator + history chart ---
  const fileHistoryProvider = new FileHistoryViewProvider({
    getGitServiceForFile: (fsPath) => {
      const root = getRepoRootForFile(fsPath);
      return root ? gitServiceForRepo(root) : undefined;
    },
  });
  const fileHistoryView = vscode.window.createTreeView('gitGraphPlus.fileHistory', {
    treeDataProvider: fileHistoryProvider,
  });

  const updateFileHistoryView = (state: FileHistoryViewState): void => {
    if (!state.relativePath) {
      fileHistoryView.description = undefined;
      fileHistoryView.message = undefined;
      return;
    }
    fileHistoryView.description = state.relativePath;
    if (state.error) {
      fileHistoryView.message = state.error;
    } else if (state.loading && state.count === 0) {
      fileHistoryView.message = 'Loading…';
    } else if (state.lineRange) {
      fileHistoryView.message = `Lines ${state.lineRange.start}-${state.lineRange.end}` +
        (state.count === 0 ? ' — no changes found' : '');
    } else if (state.count === 0) {
      fileHistoryView.message = 'No committed history for this file yet.';
    } else {
      fileHistoryView.message = undefined;
    }
  };
  updateFileHistoryView({
    relativePath: undefined, loading: false, count: 0, hasMore: false,
  });

  const fileServiceFor = (fsPath: string): { root: string; service: GitService; rel: string } | undefined => {
    const root = getRepoRootForFile(fsPath);
    if (!root) return undefined;
    return { root, service: gitServiceForRepo(root), rel: path.relative(root, fsPath).split(path.sep).join('/') };
  };

  const openFileAtRevision = async (hash: string): Promise<void> => {
    const fsPath = fileHistoryProvider.getFilePath();
    if (!fsPath) return;
    await vscode.window.showTextDocument(toGitUri(fsPath, hash), { preview: true });
  };

  const compareWithPreviousRevision = async (hash: string): Promise<void> => {
    const fsPath = fileHistoryProvider.getFilePath();
    if (!fsPath) return;
    const found = fileServiceFor(fsPath);
    if (!found) return;
    const base = await found.service.resolveDiffBaseRef(hash);
    const baseRef = (await found.service.fileExistsAtRef(base, found.rel))
      ? base
      : await found.service.getEmptyTreeRef();
    await vscode.commands.executeCommand(
      'vscode.diff',
      toGitUri(fsPath, baseRef),
      toGitUri(fsPath, hash),
      `${found.rel} (${hash.slice(0, 7)})`,
    );
  };

  context.subscriptions.push(
    fileHistoryProvider,
    fileHistoryView,
    fileHistoryProvider.onDidChangeState(updateFileHistoryView),
    vscode.window.onDidChangeActiveTextEditor((editor) => fileHistoryProvider.setActiveEditor(editor)),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.scheme === 'file') fileHistoryProvider.schedule(400);
    }),
    vscode.commands.registerCommand('gitGraphPlus.fileHistory.loadMore', () => fileHistoryProvider.loadMore()),
    vscode.commands.registerCommand('gitGraphPlus.fileHistory.refresh', () => fileHistoryProvider.refresh()),
    vscode.commands.registerCommand('gitGraphPlus.fileHistory.clearLineFilter', () => fileHistoryProvider.clearLineRange()),
    vscode.commands.registerCommand('gitGraphPlus.fileHistory.openRevision', (item: { commit?: { hash?: string } } | undefined) => {
      const hash = item?.commit?.hash;
      if (hash) void openFileAtRevision(hash);
    }),
    vscode.commands.registerCommand('gitGraphPlus.fileHistory.compareWithPrevious', (item: { commit?: { hash?: string } } | undefined) => {
      const hash = item?.commit?.hash;
      if (hash) void compareWithPreviousRevision(hash);
    }),
    vscode.commands.registerCommand('gitGraphPlus.fileHistory.copySha', (item: { commit?: { hash?: string } } | undefined) => {
      const hash = item?.commit?.hash;
      if (hash) void vscode.env.clipboard.writeText(hash);
    }),
    vscode.commands.registerCommand('gitGraphPlus.showLineHistory', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== 'file') return;
      const selection = editor.selection;
      const start = (selection.isEmpty ? selection.active.line : selection.start.line) + 1;
      const end = (selection.isEmpty ? selection.active.line : selection.end.line) + 1;
      fileHistoryProvider.showLineRange(editor, start, end);
      await vscode.commands.executeCommand('gitGraphPlus.fileHistory.focus');
    }),
    vscode.commands.registerCommand('gitGraphPlus.showFileVisualHistory', () => {
      const editor = vscode.window.activeTextEditor;
      const fsPath = editor && editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
      if (!fsPath) {
        vscode.window.showInformationMessage('Commit Timeline: open a file first.');
        return;
      }
      const found = fileServiceFor(fsPath);
      if (!found) {
        vscode.window.showInformationMessage('Commit Timeline: the file is not inside a git repository.');
        return;
      }
      FileVisualHistoryPanel.createOrShow(fsPath, found.rel, found.service);
    }),
  );
  sidebarExtras = () => fileHistoryProvider.schedule(600);
  fileHistoryProvider.setActiveEditor(vscode.window.activeTextEditor);
  registerRevisionNavigator(context, {
    getGitServiceForFile: (fsPath) => {
      const root = getRepoRootForFile(fsPath);
      return root ? gitServiceForRepo(root) : undefined;
    },
  });

  // --- Search & Compare view + Git Command Palette ---
  const searchCompareProvider = new SearchCompareViewProvider({ getService: () => activeGitService });
  const searchCompareView = vscode.window.createTreeView('gitGraphPlus.searchCompare', {
    treeDataProvider: searchCompareProvider,
  });
  const updateSearchCompareView = (state: SearchCompareState): void => {
    if (state.error) {
      searchCompareView.message = state.error;
    } else if (state.loading) {
      searchCompareView.message = 'Loading…';
    } else if (state.mode === 'search' && !state.query) {
      searchCompareView.message = 'Run “Search Commits” to search messages, authors and hashes.';
    } else if (state.mode === 'compare' && !state.base) {
      searchCompareView.message = 'Run “Compare Refs” to diff two branches or tags.';
    } else if (state.count === 0) {
      searchCompareView.message = state.mode === 'search'
        ? 'No commits match the search.'
        : 'No files differ between the refs.';
    } else {
      searchCompareView.message = undefined;
    }
    searchCompareView.description = state.mode === 'compare' && state.base
      ? `${state.base} → ${state.head}`
      : undefined;
  };
  updateSearchCompareView(searchCompareProvider.getState());

  const pickRefForCompare = async (title: string): Promise<string | undefined> => {
    const [branches, tags] = await Promise.all([activeGitService.branches(), activeGitService.tags()]);
    const items: Array<vscode.QuickPickItem & { ref: string }> = [
      ...branches.filter((b) => !b.remote).map((b) => ({
        label: `$(git-branch) ${b.name}`,
        description: b.current ? 'current' : b.upstream ?? '',
        ref: b.name,
      })),
      ...tags.map((t) => ({ label: `$(tag) ${t.name}`, description: 'tag', ref: t.name })),
      { label: '$(git-commit) HEAD', description: 'current commit', ref: 'HEAD' },
    ];
    const picked = await vscode.window.showQuickPick(items, { title, placeHolder: title, matchOnDescription: true });
    return picked?.ref;
  };

  context.subscriptions.push(
    searchCompareProvider,
    searchCompareView,
    searchCompareProvider.onDidChangeState(updateSearchCompareView),
    vscode.commands.registerCommand('gitGraphPlus.searchCompare.search', async () => {
      const query = await vscode.window.showInputBox({
        title: 'Search Commits',
        prompt: 'Message text, author name, or commit hash',
        ignoreFocusOut: true,
      });
      if (query === undefined || !query.trim()) return;
      await searchCompareProvider.search(query);
      await vscode.commands.executeCommand('gitGraphPlus.searchCompare.focus');
    }),
    vscode.commands.registerCommand('gitGraphPlus.searchCompare.compare', async () => {
      const base = await pickRefForCompare('Compare Refs — Base');
      if (!base) return;
      const head = await pickRefForCompare('Compare Refs — Head');
      if (!head) return;
      await searchCompareProvider.compare(base, head);
      await vscode.commands.executeCommand('gitGraphPlus.searchCompare.focus');
    }),
    vscode.commands.registerCommand('gitGraphPlus.searchCompare.refresh', () => searchCompareProvider.refresh()),
    vscode.commands.registerCommand('gitGraphPlus.searchCompare.clear', () => searchCompareProvider.clear()),
    vscode.commands.registerCommand('gitGraphPlus.searchCompare.openFileDiff', async (item: { diff?: { file?: string } } | undefined) => {
      const file = item?.diff?.file;
      const base = searchCompareProvider.getBase();
      const head = searchCompareProvider.getHead();
      if (!file || !base || !head) return;
      try {
        const leftRef = (await activeGitService.fileExistsAtRef(base, file)) ? base : await activeGitService.getEmptyTreeRef();
        const rightRef = (await activeGitService.fileExistsAtRef(head, file)) ? head : await activeGitService.getEmptyTreeRef();
        const fsPath = path.join(activeRepoPath, file);
        await vscode.commands.executeCommand(
          'vscode.diff',
          toGitUri(fsPath, leftRef),
          toGitUri(fsPath, rightRef),
          `${file} (${base} ↔ ${head})`,
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Commit Timeline: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
  registerGitCommandPalette(context, {
    getService: () => activeGitService,
    refresh: () => {
      refreshAll();
      MainPanel.currentPanel?.postRefresh();
    },
  });

  function getWorktreeUri(wtItem: { worktree?: { path?: string } } | undefined): vscode.Uri | undefined {
    const wtPath = wtItem?.worktree?.path;
    return wtPath ? vscode.Uri.file(wtPath) : undefined;
  }

  function openWorktree(wtItem: { worktree?: { path?: string } } | undefined): void {
    const uri = getWorktreeUri(wtItem);
    if (!uri) { return; }
    vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
  }

  function openWorktreeInFileExplorer(wtItem: { worktree?: { path?: string } } | undefined): void {
    const uri = getWorktreeUri(wtItem);
    if (!uri) { return; }
    vscode.env.openExternal(uri);
  }

  // Auto-switch sidebar when the active editor moves to a different repo
  if (builtinGit) {
    const waitForGitApi = builtinGit.isActive
      ? Promise.resolve(builtinGit.exports)
      : Promise.resolve(builtinGit.activate());
    waitForGitApi.then((ext: {
      getAPI(version: number): {
        repositories: { rootUri: vscode.Uri; ui: { selected: boolean; onDidChange: vscode.Event<void> } }[];
        onDidOpenRepository: vscode.Event<{ rootUri: vscode.Uri; ui: { selected: boolean; onDidChange: vscode.Event<void> } }>;
        getRepository(uri: vscode.Uri): { rootUri: vscode.Uri } | null;
      }
    }) => {
      try {
        const gitApi = ext.getAPI(1);

        function watchRepo(repo: { rootUri: vscode.Uri; ui: { selected: boolean; onDidChange: vscode.Event<void> } }) {
          context.subscriptions.push(
            repo.ui.onDidChange(() => {
              if (repo.ui.selected) { switchToRepo(repo.rootUri.fsPath); }
            })
          );
        }

        for (const repo of gitApi.repositories) { watchRepo(repo); }
        context.subscriptions.push(gitApi.onDidOpenRepository(watchRepo));

        context.subscriptions.push(
          vscode.window.onDidChangeActiveTextEditor(editor => {
            if (!editor) { return; }
            const repo = gitApi.getRepository(editor.document.uri);
            if (repo?.rootUri) { switchToRepo(repo.rootUri.fsPath); }
          })
        );
      } catch { /* git API unavailable */ }
    }).catch(() => {});
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('git-graph-plus.open', (sourceControl?: vscode.SourceControl) => {
      if (sourceControl?.rootUri) { switchToRepo(sourceControl.rootUri.fsPath); }
      MainPanel.createOrShow(context.extensionUri, activeRepoPath);
    }),
    vscode.commands.registerCommand('gitGraphPlus.open', (sourceControl?: vscode.SourceControl) => {
      if (sourceControl?.rootUri) { switchToRepo(sourceControl.rootUri.fsPath); }
      MainPanel.createOrShow(context.extensionUri, activeRepoPath);
    }),
    vscode.commands.registerCommand('gitGraphPlus.refresh', () => {
      refreshAll();
      MainPanel.currentPanel?.postRefresh();
    }),
    vscode.commands.registerCommand('gitGraphPlus.fetch', () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'fetch' });
    }),
    vscode.commands.registerCommand('gitGraphPlus.pull', () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'pull' });
    }),
    vscode.commands.registerCommand('gitGraphPlus.push', () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'push' });
    }),
    vscode.commands.registerCommand('gitGraphPlus.publishBranch', () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'push' });
    }),
    vscode.commands.registerCommand('gitGraphPlus.checkoutBranch', (branchItem) => {
      if (branchItem?.branch) {
        activeGitService.checkout(branchItem.branch.name).then(() => {
          refreshAll();
          MainPanel.currentPanel?.postRefresh();
        }).catch(err => vscode.window.showErrorMessage(err.message));
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.checkoutRemoteBranch', (branchItem) => {
      if (branchItem?.branch) {
        const ref = branchItem.branch.name; // e.g. origin/main
        const localName = ref.split('/').slice(1).join('/');
        MainPanel.showModalWithPanel(context.extensionUri, { modal: 'checkoutRemote', remoteName: ref, localName });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.mergeBranch', (branchItem) => {
      const branchName = branchItem?.branch?.name;
      if (branchName) {
        MainPanel.showModalWithPanel(context.extensionUri, { modal: 'mergeBranch', branchName });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.stashApply', (stashItem) => {
      const index = stashItem?.index ?? 0;
      activeGitService.stashApply(index).then(() => {
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
      }).catch(err => vscode.window.showErrorMessage(err.message));
    }),
    vscode.commands.registerCommand('gitGraphPlus.stashPop', (stashItem) => {
      const index = stashItem?.index ?? 0;
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'stashPop', index, message: stashItem?.stash?.message ?? `stash@{${index}}` });
    }),
    vscode.commands.registerCommand('gitGraphPlus.createBranch', () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'createBranch' });
    }),
    vscode.commands.registerCommand('gitGraphPlus.stashSave', () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'stashSave' });
    }),
    vscode.commands.registerCommand('gitGraphPlus.createTag', () => {
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'createTag' });
    }),
    vscode.commands.registerCommand('gitGraphPlus.pushTag', (tagItem) => {
      const tagName = tagItem?.tag?.name;
      if (tagName) {
        activeGitService.pushTag(tagName).then(() => {
          refreshAll();
          MainPanel.currentPanel?.postRefresh();
          vscode.window.showInformationMessage(`Pushed tag ${tagName}`);
        }).catch(err => vscode.window.showErrorMessage(err.message));
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.pushAllTags', () => {
      activeGitService.pushAllTags().then(() => {
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
        vscode.window.showInformationMessage(`Pushed all tags`);
      }).catch(err => vscode.window.showErrorMessage(err.message));
    }),
    vscode.commands.registerCommand('gitGraphPlus.deleteRemoteTag', (tagItem) => {
      const tagName = tagItem?.tag?.name;
      if (tagName) {
        MainPanel.showModalWithPanel(context.extensionUri, { modal: 'deleteRemoteTag', tagName });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.deleteBranch', (branchItem) => {
      const branchName = branchItem?.branch?.name;
      if (branchName) {
        MainPanel.showModalWithPanel(context.extensionUri, { modal: 'deleteBranch', branchName });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.renameBranch', (branchItem) => {
      const oldName = branchItem?.branch?.name;
      if (oldName) {
        MainPanel.showModalWithPanel(context.extensionUri, { modal: 'renameBranch', branchName: oldName });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.deleteTag', (tagItem) => {
      const tagName = tagItem?.tag?.name;
      if (tagName) {
        MainPanel.showModalWithPanel(context.extensionUri, { modal: 'deleteTag', tagName });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.stashDrop', (stashItem) => {
      const index = stashItem?.index ?? 0;
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'stashDrop', index, message: stashItem?.stash?.message ?? `stash@{${index}}` });
    }),
    vscode.commands.registerCommand('gitGraphPlus.addWorktree', async () => {
      const defaultPath = await resolveDefaultWorktreePath(activeGitService, activeRepoPath);
      MainPanel.showModalWithPanel(context.extensionUri, { modal: 'addWorktree', defaultPath });
    }),
    vscode.commands.registerCommand('gitGraphPlus.pruneWorktrees', () => {
      activeGitService.worktreePrune().then(() => {
        refreshAll();
        MainPanel.currentPanel?.postRefresh();
        vscode.window.showInformationMessage(`Pruned worktrees`);
      }).catch((err: Error) => vscode.window.showErrorMessage(err.message));
    }),
    vscode.commands.registerCommand('gitGraphPlus.showRemoteBranchMenu', (branchItem) => {
      const branch = branchItem?.branch;
      if (branch) {
        const remote = branch.name.split('/')[0];
        const branchName = branch.name.split('/').slice(1).join('/');
        vscode.window.showQuickPick([
          { label: `Checkout as local branch...`, id: 'checkout' },
          { label: `Delete remote branch ${branch.name}`, id: 'delete' },
        ]).then(selected => {
          if (selected?.id === 'delete') {
            MainPanel.showModalWithPanel(context.extensionUri, { modal: 'deleteRemoteBranch', remote, name: branchName });
          } else if (selected?.id === 'checkout') {
            const localName = branchName;
            MainPanel.showModalWithPanel(context.extensionUri, { modal: 'checkoutRemote', remoteName: branch.name, localName });
          }
        });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.showBranchMenu', (branchItem) => {
      const branch = branchItem?.branch;
      if (branch) {
        vscode.window.showQuickPick([
          { label: `Checkout ${branch.name}`, id: 'checkout' },
          { label: `Merge into current branch...`, id: 'merge' },
          { label: `Rename ${branch.name}...`, id: 'rename' },
          { label: `Delete ${branch.name}...`, id: 'delete' },
        ]).then(selected => {
          if (!selected) return;
          switch (selected.id) {
            case 'checkout': vscode.commands.executeCommand('gitGraphPlus.checkoutBranch', branchItem); break;
            case 'merge': vscode.commands.executeCommand('gitGraphPlus.mergeBranch', branchItem); break;
            case 'rename': vscode.commands.executeCommand('gitGraphPlus.renameBranch', branchItem); break;
            case 'delete': vscode.commands.executeCommand('gitGraphPlus.deleteBranch', branchItem); break;
          }
        });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.showTagMenu', (tagItem) => {
      const tag = tagItem?.tag;
      if (tag) {
        vscode.window.showQuickPick([
          { label: `Push ${tag.name} to remote`, id: 'push' },
          { label: `Delete tag ${tag.name}`, id: 'delete' },
          { label: `Delete remote tag ${tag.name}`, id: 'deleteRemote' },
        ]).then(selected => {
          if (!selected) return;
          switch (selected.id) {
            case 'push': vscode.commands.executeCommand('gitGraphPlus.pushTag', tagItem); break;
            case 'delete': vscode.commands.executeCommand('gitGraphPlus.deleteTag', tagItem); break;
            case 'deleteRemote': vscode.commands.executeCommand('gitGraphPlus.deleteRemoteTag', tagItem); break;
          }
        });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.showStashMenu', (stashItem) => {
      const stash = stashItem?.stash;
      if (stash) {
        vscode.window.showQuickPick([
          { label: `Apply stash@{${stash.index}}`, id: 'apply' },
          { label: `Pop stash@{${stash.index}}`, id: 'pop' },
          { label: `Drop stash@{${stash.index}}`, id: 'drop' },
        ]).then(selected => {
          if (!selected) return;
          switch (selected.id) {
            case 'apply': vscode.commands.executeCommand('gitGraphPlus.stashApply', stashItem); break;
            case 'pop': vscode.commands.executeCommand('gitGraphPlus.stashPop', stashItem); break;
            case 'drop': vscode.commands.executeCommand('gitGraphPlus.stashDrop', stashItem); break;
          }
        });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.checkoutRemoteBranchExplicit', (branch) => {
      if (branch) {
        const localName = branch.name.split('/').slice(1).join('/');
        MainPanel.showModalWithPanel(context.extensionUri, { modal: 'checkoutRemote', remoteName: branch.name, localName });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.deleteRemoteBranchExplicit', (branch) => {
      if (branch) {
        const remote = branch.name.split('/')[0];
        const branchName = branch.name.split('/').slice(1).join('/');
        MainPanel.showModalWithPanel(context.extensionUri, { modal: 'deleteRemoteBranch', remote, name: branchName });
      }
    }),
    vscode.commands.registerCommand('gitGraphPlus.openWorktree', openWorktree),
    vscode.commands.registerCommand('gitGraphPlus.openWorktreeInFileExplorer', openWorktreeInFileExplorer),
    vscode.commands.registerCommand('gitGraphPlus.removeWorktree', (wtItem) => {
      if (wtItem?.worktree) {
        const wtPath = wtItem.worktree.path;
        const wtBranch = wtItem.worktree.branch;
        MainPanel.showModalWithPanel(context.extensionUri, { modal: 'removeWorktree', path: wtPath, branch: wtBranch });
      }
    }),
  );
}

export function deactivate() {
  MainPanel.onSidebarRefresh = null;
  MainPanel.onRepoChange = null;
}
