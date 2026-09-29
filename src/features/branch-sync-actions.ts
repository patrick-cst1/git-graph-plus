import * as vscode from 'vscode';
import { GitService } from '../git/git-service';

/**
 * Pulls a branch from an explicit source, honouring the dialog's rebase/stash
 * choices. A branch that is strictly behind is fast-forwarded in place without
 * a checkout (the options are moot for a fast-forward); a diverged branch is
 * checked out, pulled with the chosen strategy, and the user is offered a
 * switch back. Returns true when the repository changed and callers should
 * refresh.
 */
export async function runPullBranch(
  gitService: GitService,
  branch: string,
  source: { remote: string; remoteBranch: string },
  options: { rebase?: boolean; stash?: boolean },
): Promise<boolean> {
  const res = await gitService.pullBranchFastForward(branch, source);
  switch (res.status) {
    case 'fetched': {
      vscode.window.showInformationMessage(vscode.l10n.t('pulled'));
      return true;
    }
    case 'current-branch': {
      await pullIntoCurrent(gitService, source, options);
      vscode.window.showInformationMessage(vscode.l10n.t('pulled'));
      return true;
    }
    case 'no-upstream': {
      vscode.window.showWarningMessage(vscode.l10n.t('pullNothingToPull', branch));
      return false;
    }
    case 'checked-out': {
      vscode.window.showErrorMessage(vscode.l10n.t('pullBranchCheckedOut', branch));
      return false;
    }
    case 'non-fast-forward': {
      const before = (await gitService.branches()).find(b => !b.remote && b.current)?.name;
      if (options.stash) {
        await gitService.stashSave('Auto-stash before pull');
      }
      try {
        await gitService.checkout(branch);
        await gitService.pull(source.remote, source.remoteBranch, { rebase: options.rebase });
      } finally {
        if (options.stash) {
          try {
            await gitService.stashPop(0);
          } catch {
            vscode.window.showWarningMessage(vscode.l10n.t('stashPopAfterPullFailed'));
          }
        }
      }
      if (before && before !== branch) {
        const switchBack = vscode.l10n.t('switchBackTo', before);
        const picked = await vscode.window.showInformationMessage(vscode.l10n.t('switchedToForPull', branch), switchBack);
        if (picked === switchBack) {
          await gitService.checkout(before);
        }
      } else {
        vscode.window.showInformationMessage(vscode.l10n.t('switchedToForPull', branch));
      }
      return true;
    }
  }
}

async function pullIntoCurrent(
  gitService: GitService,
  source: { remote: string; remoteBranch: string },
  options: { rebase?: boolean; stash?: boolean },
): Promise<void> {
  if (options.stash) {
    await gitService.stashSave('Auto-stash before pull');
  }
  try {
    await gitService.pull(source.remote, source.remoteBranch, { rebase: options.rebase });
  } finally {
    if (options.stash) {
      try {
        await gitService.stashPop(0);
      } catch {
        vscode.window.showWarningMessage(vscode.l10n.t('stashPopAfterPullFailed'));
      }
    }
  }
}
