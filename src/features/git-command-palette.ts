// Git Command Palette: one quick pick that guides the common git operations
// (fetch/pull/push, branch/tag/stash, checkout/merge/rebase/reset,
// cherry-pick/revert, amend, undo, continue/abort, clean). Modal-based
// operations are delegated to the existing commands; the rest run directly on
// the active repository's GitService.

import * as vscode from 'vscode';
import type { GitService } from '../git/git-service';

export interface GitCommandPaletteOptions {
  /** GitService of the active repository. */
  getService: () => GitService;
  /** Refresh the sidebar and the graph panel after a command ran. */
  refresh: () => void;
}

interface PaletteEntry extends vscode.QuickPickItem {
  id: string;
}

export function registerGitCommandPalette(
  context: vscode.ExtensionContext,
  options: GitCommandPaletteOptions,
): void {
  const service = () => options.getService();

  const fail = (err: unknown): void => {
    vscode.window.showErrorMessage(
      `Commit Timeline: ${err instanceof Error ? err.message : String(err)}`,
    );
  };

  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    try {
      await action();
      options.refresh();
      vscode.window.setStatusBarMessage(`Commit Timeline: ${label}`, 4000);
    } catch (err) {
      fail(err);
    }
  };

  async function pickRef(title: string, options2?: { includeTags?: boolean; includeHead?: boolean }): Promise<string | undefined> {
    const [branches, tags] = await Promise.all([
      service().branches(),
      options2?.includeTags ? service().tags() : Promise.resolve([]),
    ]);
    const items: Array<vscode.QuickPickItem & { ref: string }> = branches
      .filter((b) => !b.remote)
      .map((b) => ({
        label: `$(git-branch) ${b.name}`,
        description: b.current ? 'current' : b.upstream ?? '',
        ref: b.name,
      }));
    if (options2?.includeTags) {
      items.push(...tags.map((t) => ({ label: `$(tag) ${t.name}`, description: 'tag', ref: t.name })));
    }
    if (options2?.includeHead) {
      items.push({ label: '$(git-commit) HEAD', description: 'current commit', ref: 'HEAD' });
    }
    const picked = await vscode.window.showQuickPick(items, { title, placeHolder: title, matchOnDescription: true });
    return picked?.ref;
  }

  async function inputRef(title: string, prompt: string): Promise<string | undefined> {
    const value = await vscode.window.showInputBox({
      title,
      prompt,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim().startsWith('-') ? 'Ref must not start with "-"' : undefined),
    });
    const ref = value?.trim();
    return ref ? ref : undefined;
  }

  async function runPaletteEntry(id: string): Promise<void> {
    switch (id) {
      case 'fetch':
      case 'pull':
      case 'push':
      case 'stash':
      case 'branch':
      case 'tag':
        await vscode.commands.executeCommand(`gitGraphPlus.${id === 'stash' ? 'stashSave' : id === 'branch' ? 'createBranch' : id === 'tag' ? 'createTag' : id}`);
        return;
      case 'amend': {
        const head = await service().searchByHash('HEAD');
        const value = await vscode.window.showInputBox({
          title: 'Amend Last Commit',
          prompt: 'New commit message',
          value: head?.subject ?? '',
          ignoreFocusOut: true,
          validateInput: (v) => (v.trim() ? undefined : 'The message cannot be empty'),
        });
        if (value === undefined) return;
        await run('amended the last commit', () => service().amendCommit({ message: value.trim() }));
        return;
      }
      case 'checkout': {
        const ref = await pickRef('Checkout Branch');
        if (!ref) return;
        await run(`checked out ${ref}`, () => service().checkout(ref));
        return;
      }
      case 'merge': {
        const ref = await pickRef('Merge Branch into Current');
        if (!ref) return;
        await run(`merged ${ref}`, () => service().merge(ref));
        return;
      }
      case 'rebase': {
        const ref = await pickRef('Rebase Current Branch onto');
        if (!ref) return;
        await run(`rebased onto ${ref}`, () => service().rebase(ref, { autostash: true }));
        return;
      }
      case 'reset': {
        const mode = await vscode.window.showQuickPick(
          [
            { label: 'Soft', description: 'keep the working tree and the index', mode: 'soft' as const },
            { label: 'Mixed', description: 'keep the working tree, reset the index', mode: 'mixed' as const },
            { label: 'Hard', description: 'discard the working tree changes', mode: 'hard' as const },
          ],
          { title: 'Reset Current Branch — Mode' },
        );
        if (!mode) return;
        const ref = await pickRef('Reset Current Branch — Target', { includeTags: true, includeHead: true });
        if (!ref) return;
        if (mode.mode === 'hard') {
          const confirmed = await vscode.window.showWarningMessage(
            `Hard reset ${ref}? Uncommitted changes will be lost.`,
            { modal: true },
            'Reset',
          );
          if (confirmed !== 'Reset') return;
        }
        await run(`reset (${mode.mode}) to ${ref}`, () => service().reset(ref, mode.mode));
        return;
      }
      case 'cherry-pick': {
        const ref = await inputRef('Cherry-Pick Commit', 'Commit hash to cherry-pick');
        if (!ref) return;
        await run(`cherry-picked ${ref.slice(0, 7)}`, () => service().cherryPick(ref));
        return;
      }
      case 'revert': {
        const ref = await inputRef('Revert Commit', 'Commit hash to revert');
        if (!ref) return;
        await run(`reverted ${ref.slice(0, 7)}`, () => service().revert(ref));
        return;
      }
      case 'undo': {
        const confirmed = await vscode.window.showWarningMessage(
          'Undo the last commit? Its changes stay in the working tree (soft reset).',
          { modal: true },
          'Undo',
        );
        if (confirmed !== 'Undo') return;
        await run('undid the last commit', () => service().reset('HEAD~1', 'soft'));
        return;
      }
      case 'continue': {
        const state = await service().getOperationState();
        if (!state.type) {
          vscode.window.showInformationMessage('Commit Timeline: no operation in progress.');
          return;
        }
        await run(`continued the ${state.type}`, () => service().continueOperation());
        return;
      }
      case 'abort': {
        const state = await service().getOperationState();
        if (!state.type) {
          vscode.window.showInformationMessage('Commit Timeline: no operation in progress.');
          return;
        }
        const confirmed = await vscode.window.showWarningMessage(
          `Abort the ${state.type} in progress?`,
          { modal: true },
          'Abort',
        );
        if (confirmed !== 'Abort') return;
        await run(`aborted the ${state.type}`, () => service().abortOperation());
        return;
      }
      case 'clean': {
        const confirmed = await vscode.window.showWarningMessage(
          'Delete all untracked files and directories?',
          { modal: true },
          'Delete',
        );
        if (confirmed !== 'Delete') return;
        await run('removed untracked files', () => service().clean(true, true));
        return;
      }
      default:
        return;
    }
  }

  const ENTRIES: PaletteEntry[] = [
    { id: 'fetch', label: '$(cloud-download) Fetch', description: 'from the default remote' },
    { id: 'pull', label: '$(arrow-down) Pull', description: 'from the upstream' },
    { id: 'push', label: '$(arrow-up) Push', description: 'to the upstream' },
    { id: 'amend', label: '$(edit) Amend Last Commit…', description: 'edit the last commit message' },
    { id: 'stash', label: '$(archive) Stash Changes…' },
    { id: 'branch', label: '$(git-branch) Create Branch…' },
    { id: 'tag', label: '$(tag) Create Tag…' },
    { id: 'checkout', label: '$(check) Checkout Branch…' },
    { id: 'merge', label: '$(git-merge) Merge Branch into Current…' },
    { id: 'rebase', label: '$(git-pull-request) Rebase Current onto…', description: 'autostash' },
    { id: 'reset', label: '$(history) Reset Current Branch…' },
    { id: 'cherry-pick', label: '$(git-commit) Cherry-Pick Commit…' },
    { id: 'revert', label: '$(discard) Revert Commit…' },
    { id: 'undo', label: '$(reply) Undo Last Commit', description: 'keep the changes (soft reset)' },
    { id: 'continue', label: '$(debug-continue) Continue Current Operation' },
    { id: 'abort', label: '$(stop) Abort Current Operation' },
    { id: 'clean', label: '$(trash) Clean Untracked Files…' },
  ];

  context.subscriptions.push(
    vscode.commands.registerCommand('gitGraphPlus.gitCommandPalette', async () => {
      const picked = await vscode.window.showQuickPick(ENTRIES, {
        title: 'Git Command Palette',
        placeHolder: 'Run a Git command…',
        matchOnDescription: true,
      });
      if (!picked) return;
      await runPaletteEntry(picked.id);
    }),
  );
}
