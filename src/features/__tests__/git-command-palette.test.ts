import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: unknown[]) => unknown>,
  quickPickResults: [] as unknown[],
  inputBoxResults: [] as Array<string | undefined>,
  warningResults: [] as Array<string | undefined>,
  executeCommand: vi.fn(async () => undefined),
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  setStatusBarMessage: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: {
    registerCommand: (id: string, cb: (...args: unknown[]) => unknown) => {
      H.handlers[id] = cb;
      return { dispose() {} };
    },
    executeCommand: H.executeCommand,
  },
  window: {
    showQuickPick: vi.fn(async () => H.quickPickResults.shift()),
    showInputBox: vi.fn(async () => H.inputBoxResults.shift()),
    showWarningMessage: vi.fn(async () => H.warningResults.shift()),
    showInformationMessage: H.showInformationMessage,
    showErrorMessage: H.showErrorMessage,
    setStatusBarMessage: H.setStatusBarMessage,
  },
}));

import { registerGitCommandPalette } from '../git-command-palette';
import type { GitService } from '../../git/git-service';

function mockService(): GitService {
  return {
    branches: vi.fn(async () => [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h'.repeat(40) },
      { name: 'feature', current: false, ahead: 0, behind: 0, hash: 'g'.repeat(40) },
    ]),
    tags: vi.fn(async () => []),
    searchByHash: vi.fn(async () => ({ subject: 'old subject' })),
    amendCommit: vi.fn(async () => {}),
    checkout: vi.fn(async () => {}),
    merge: vi.fn(async () => {}),
    rebase: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
    cherryPick: vi.fn(async () => {}),
    revert: vi.fn(async () => {}),
    getOperationState: vi.fn(async () => ({ type: null })),
    continueOperation: vi.fn(async () => {}),
    abortOperation: vi.fn(async () => {}),
    clean: vi.fn(async () => {}),
  } as unknown as GitService;
}

function setup() {
  const service = mockService();
  const refresh = vi.fn();
  registerGitCommandPalette({ subscriptions: [] } as never, {
    getService: () => service,
    refresh,
  });
  return { service, refresh };
}

async function runPalette(id: string, ...extraPicks: unknown[]): Promise<void> {
  H.quickPickResults.push({ id }, ...extraPicks);
  await H.handlers['gitGraphPlus.gitCommandPalette']();
}

describe('git command palette', () => {
  beforeEach(() => {
    H.handlers = {};
    H.quickPickResults = [];
    H.inputBoxResults = [];
    H.warningResults = [];
    H.executeCommand.mockClear();
    H.showInformationMessage.mockClear();
    H.showErrorMessage.mockClear();
    H.setStatusBarMessage.mockClear();
  });

  it('delegates modal commands to the existing commands', async () => {
    setup();
    await runPalette('fetch');
    expect(H.executeCommand).toHaveBeenCalledWith('gitGraphPlus.fetch');
    await runPalette('stash');
    expect(H.executeCommand).toHaveBeenCalledWith('gitGraphPlus.stashSave');
    await runPalette('branch');
    expect(H.executeCommand).toHaveBeenCalledWith('gitGraphPlus.createBranch');
  });

  it('checks out a picked branch and refreshes', async () => {
    const { service, refresh } = setup();
    await runPalette('checkout', { ref: 'feature' });
    expect(service.checkout).toHaveBeenCalledWith('feature');
    expect(refresh).toHaveBeenCalled();
  });

  it('amends the last commit with the typed message', async () => {
    const { service, refresh } = setup();
    H.inputBoxResults.push('new subject');
    await runPalette('amend');
    expect(service.amendCommit).toHaveBeenCalledWith({ message: 'new subject' });
    expect(refresh).toHaveBeenCalled();
  });

  it('hard reset asks for confirmation and can be cancelled', async () => {
    const { service } = setup();
    H.warningResults.push(undefined);
    await runPalette('reset', { mode: 'hard' }, { ref: 'HEAD' });
    expect(service.reset).not.toHaveBeenCalled();

    await runPalette('reset', { mode: 'soft' }, { ref: 'HEAD~1' });
    expect(service.reset).toHaveBeenCalledWith('HEAD~1', 'soft');
  });

  it('reports when there is no operation to continue or abort', async () => {
    const { service } = setup();
    await runPalette('abort');
    expect(service.abortOperation).not.toHaveBeenCalled();
    expect(H.showInformationMessage).toHaveBeenCalledWith('Commit Timeline: no operation in progress.');
  });

  it('aborts a running operation after confirmation', async () => {
    const { service } = setup();
    (service.getOperationState as ReturnType<typeof vi.fn>).mockResolvedValue({ type: 'merge' });
    H.warningResults.push('Abort');
    await runPalette('abort');
    expect(service.abortOperation).toHaveBeenCalled();
  });

  it('shows an error message when a command fails', async () => {
    const { service } = setup();
    (service.checkout as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('checkout failed'));
    await runPalette('checkout', { ref: 'feature' });
    expect(H.showErrorMessage).toHaveBeenCalledWith('Commit Timeline: checkout failed');
  });

  it('does nothing when the palette is dismissed', async () => {
    const { service } = setup();
    await H.handlers['gitGraphPlus.gitCommandPalette']();
    expect(service.checkout).not.toHaveBeenCalled();
  });
});
