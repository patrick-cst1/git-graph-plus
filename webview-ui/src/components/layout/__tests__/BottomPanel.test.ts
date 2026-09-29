import { describe, it, expect, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';
import BottomPanel from '../BottomPanel.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import { uiStore } from '../../../lib/stores/ui.svelte';
import { commitStore } from '../../../lib/stores/commits.svelte';
import type { Commit } from '../../../lib/types';

function commit(over: Partial<Commit> = {}): Commit {
  return {
    hash: 'h',
    abbreviatedHash: 'h',
    author: { name: 'A', email: 'a@x.com', date: '' },
    committer: { name: 'A', email: 'a@x.com', date: '' },
    subject: 's',
    body: '',
    parents: [],
    refs: [],
    ...over,
  };
}

beforeEach(() => {
  i18n.setLocale('en');
  uiStore.selectedCommitHash = null;
  uiStore.selectedCommitHashes = [];
  uiStore.comparing = false;
  uiStore.compareRef1 = null;
  uiStore.compareRef2 = null;
  uiStore.compareView = 'files';
  uiStore.comparePeekHash = null;
  uiStore.multiSelectArmed = false;
  commitStore.commits = [];
});

describe('BottomPanel', () => {
  it('shows the empty-state hint when nothing is selected', () => {
    const { container } = render(BottomPanel);
    expect(container.querySelector('.empty')).not.toBeNull();
  });

  it('renders CommitDetails when a commit is selected', () => {
    commitStore.commits = [commit({ hash: 'h1', subject: 'fix' })];
    uiStore.selectedCommitHash = 'h1';
    const { container } = render(BottomPanel);
    expect(container.querySelector('.empty')).toBeNull();
  });

  it('renders the compare view (CommitDetails) when comparing is active', () => {
    uiStore.selectedCommitHash = null;
    uiStore.comparing = true;
    const { container } = render(BottomPanel);
    expect(container.querySelector('.commit-details')).toBeTruthy();
  });

  it('renders a peeked compare commit from the store, with a back button', async () => {
    uiStore.comparing = true;
    uiStore.compareRef1 = 'r1';
    uiStore.compareRef2 = 'r2';
    uiStore.selectedCommitHashes = ['r1', 'r2'];
    uiStore.comparePeekHash = 'peekhash';
    commitStore.rememberCommit(commit({ hash: 'peekhash', subject: 'peeked subject' }));
    const { container } = render(BottomPanel);
    await waitFor(() => {
      expect(container.textContent).toContain('peeked subject');
      expect(container.textContent).toContain('Back to comparison');
    });
  });

  it('prompts to select more when armed with fewer than 2 commits', () => {
    uiStore.selectedCommitHash = null;
    uiStore.comparing = false;
    uiStore.multiSelectArmed = true;
    uiStore.selectedCommitHashes = ['a'];
    const { container } = render(BottomPanel);
    expect(container.querySelector('.empty')?.textContent).toMatch(/select more/i);
  });
});
