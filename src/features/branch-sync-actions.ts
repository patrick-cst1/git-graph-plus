import * as vscode from 'vscode';
import { GitService } from '../git/git-service';

/**
 * Push a branch from a right-click menu without checking it out. Returns true
 * when the repository changed and callers should refresh.
 */
export async function runPushBranch(gitService: GitService, branch: string): Promise<boolean> {
  const res = await gitService.pushBranch(branch);
  if (!res.pushed) {
    vscode.window.showWarningMessage(vscode.l10n.t('noRemotesToPushTo'));
    return false;
  }
  vscode.window.showInformationMessage(vscode.l10n.t('pushed'));
  return true;
}

/**
 * Pull a branch without checking it out, fast-forward only. A diverged branch
 * offers "Checkout & Pull" (optionally switching back afterwards); a branch
 * checked out in another worktree is reported instead. Returns true when the
 * repository changed and callers should refresh.
 */
export async function runPullBranchFastForward(
  gitService: GitService,
  branch: string,
  source?: { remote: string; remoteBranch: string },
): Promise<boolean> {
  const res = await gitService.pullBranchFastForward(branch, source);
  switch (res.status) {
    case 'fetched': {
      vscode.window.showInformationMessage(vscode.l10n.t('pulled'));
      return true;
    }
    case 'current-branch': {
      if (source) {
        await gitService.pull(source.remote, source.remoteBranch);
        vscode.window.showInformationMessage(vscode.l10n.t('pulled'));
        return true;
      }
      return false;
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
      const checkoutAndPull = vscode.l10n.t('checkoutAndPull');
      const action = await vscode.window.showWarningMessage(
        vscode.l10n.t('pullNotFastForward', branch),
        { modal: true },
        checkoutAndPull,
      );
      if (action !== checkoutAndPull) {
        return false;
      }
      const before = (await gitService.branches()).find(b => !b.remote && b.current)?.name;
      await gitService.checkout(branch);
      await gitService.pull(res.remote, res.remoteBranch);
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
