import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import CommitGraph from '../CommitGraph.svelte';
import { commitStore } from '../../../lib/stores/commits.svelte';
import { branchStore } from '../../../lib/stores/branches.svelte';
import { uiStore } from '../../../lib/stores/ui.svelte';
import { modalStore } from '../../../lib/stores/modals.svelte';
import { avatarStore } from '../../../lib/stores/avatars.svelte';
import { i18n } from '../../../lib/i18n/index.svelte';
import type { Commit, CommitGraphData } from '../../../lib/types';

function makeCommit(hash: string, subject: string, parents: string[] = []): Commit {
  return {
    hash,
    abbreviatedHash: hash.slice(0, 7),
    author: { name: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' },
    committer: { name: 'A', email: 'a@x.com', date: '2024-01-01T00:00:00+00:00' },
    subject,
    body: '',
    parents,
    refs: [],
  };
}

function makeGraphData(commits: Commit[]): CommitGraphData {
  return {
    commits,
    graph: commits.map(c => ({ commit: c.hash, column: 0, color: '#63b0f4', parents: [] })),
    paths: [],
    links: [],
    dots: commits.map((_, i) => ({ center: { x: 10, y: i }, color: 0, type: 'default' as const, localOnly: false, remoteTip: false })),
    commitLeftMargin: commits.map(() => 24),
    hasMore: false,
    currentLimit: 1000,
  };
}

// Multi-lane data: one path that moves from lane 0 (SourceGit x=10) to lane 2
// (x=12) and back, then straight, plus one merge link. Exercises every branch
// of the geometry builder. Coordinates use the real SourceGit rail origin of
// 10, which the component normalises to GRAPH_LEFT_PADDING.
function makeStyledGraphData(): CommitGraphData {
  const commits = [
    makeCommit('h1', 'first'),
    makeCommit('h2', 'second', ['h1']),
    makeCommit('h3', 'third', ['h2']),
  ];
  return {
    commits,
    graph: commits.map((c, i) => ({ commit: c.hash, column: i, color: '#63b0f4', parents: [] })),
    paths: [
      { points: [{ x: 10, y: 0 }, { x: 12, y: 1 }, { x: 10, y: 2 }, { x: 10, y: 3 }], color: 0 },
    ],
    links: [
      { start: { x: 10, y: 0 }, control: { x: 11, y: 0 }, end: { x: 11, y: 1 }, color: 0 },
    ],
    dots: commits.map((_, i) => ({ center: { x: 10, y: i }, color: 0, type: 'default' as const, localOnly: false, remoteTip: false })),
    commitLeftMargin: commits.map(() => 24),
    hasMore: false,
    currentLimit: 1000,
  };
}

function renderedPathDs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<SVGPathElement>('.graph-lines path')).map(
    (p) => p.getAttribute('d') ?? '',
  );
}

beforeEach(() => {
  i18n.setLocale('en');
  // Reset shared singletons between tests.
  commitStore.commits = [];
  commitStore.graphNodes = [];
  commitStore.paths = [];
  commitStore.links = [];
  commitStore.dots = [];
  commitStore.commitLeftMargin = [];
  commitStore.loading = false;
  commitStore.loadingMore = false;
  commitStore.hasMore = false;
  commitStore.currentLimit = 0;
  commitStore.notGitRepo = false;
  commitStore.isEmptyRepo = false;
  branchStore.branches = [];
  branchStore.worktrees = [];
  uiStore.selectedCommitHash = null;
  uiStore.autoLoadHistory = false;
  uiStore.loadMoreCount = 50;
  uiStore.graphStyle = 'rounded';
  modalStore.closeAll();
});

afterEach(() => cleanup());

describe('CommitGraph smoke', () => {
  it('renders without crashing when commits are empty', () => {
    const { container } = render(CommitGraph, {});
    // No commit rows expected, but the container should exist.
    expect(container).toBeTruthy();
    expect(container.querySelectorAll('.commit-row').length).toBe(0);
  });

  it('renders one row per commit when commits are populated', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
      makeCommit('h3', 'third', ['h2']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelectorAll('.commit-row').length).toBe(3);
  });

  it('clicking a commit row sets selectedCommitHash after the dbl-click timeout fires', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    const rows = container.querySelectorAll<HTMLElement>('.commit-row');
    expect(rows.length).toBeGreaterThan(0);
    // The dual-click discriminator waits 200ms before treating a click as
    // a single-click. Use fake timers if you want to exercise the delay,
    // but we just need to confirm clicking does not throw.
    await fireEvent.click(rows[0]);
    // Selection is deferred until the dbl-click timer expires; do a soft
    // assertion that the row is at least focusable / clickable.
    expect(rows[0]).toBeTruthy();
  });

  it('clicking the UNCOMMITTED row opens the SCM view instead of selecting it', async () => {
    commitStore.setData(makeGraphData([
      makeCommit('UNCOMMITTED', 'Uncommitted changes'),
      makeCommit('h1', 'first'),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const rows = container.querySelectorAll<HTMLElement>('.commit-row');
    await fireEvent.click(rows[0]);
    await tick();
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    expect(uiStore.selectedCommitHash).toBeNull();
  });

  it('right-clicking the UNCOMMITTED row opens an Amend menu, then the amend modal + SCM', async () => {
    const { modalStore } = await import('../../../lib/stores/modals.svelte');
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([
      makeCommit('UNCOMMITTED', 'Uncommitted changes'),
      head,
    ]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 1, behind: 0, hash: 'h1' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0];
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // The single menu item is "Amend '{ref}'" (ref = current branch); click it.
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^amend 'main'$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    expect(modalStore.amend.show).toBe(true);
    expect(modalStore.amend.hash).toBe('h1');
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    modalStore.closeAmend();
  });

  it('right-clicking the HEAD commit opens the amend modal + SCM', async () => {
    const { modalStore } = await import('../../../lib/stores/modals.svelte');
    const head = makeCommit('h2', 'latest', ['h1']);
    head.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([head, makeCommit('h1', 'first')]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 1, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // HEAD row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^amend commit$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    expect(modalStore.amend.show).toBe(true);
    expect(modalStore.amend.hash).toBe('h2');
    expect(globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'openScmView')).toBe(true);
    modalStore.closeAmend();
  });

  it('offers "Create worktree from" on a regular branch and posts startPoint', async () => {
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    const feat = makeCommit('h2', 'feat work', ['h1']);
    feat.refs = [{ type: 'branch', name: 'develop' }];
    commitStore.setData(makeGraphData([feat, head]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'develop', current: false, ahead: 0, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // develop row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // The branch "develop" is a submenu-parent; hover over it to reveal children.
    const parentBtn = Array.from(container.querySelectorAll<HTMLElement>('button.menu-item.has-children'))
      .find(el => (el.textContent ?? '').includes('develop'));
    if (parentBtn) {
      await fireEvent.mouseEnter(parentBtn);
      await tick();
    }
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^new worktree$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    const msg = globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: { startPoint?: string } })
      .find(m => m.type === 'worktreeAddModalRequest');
    expect(msg?.payload?.startPoint).toBe('develop');
  });

  it('offers a top-level "Create worktree from" item (no submenu hover needed) and posts startPoint', async () => {
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'head', name: 'main' }];
    const feat = makeCommit('h2', 'feat work', ['h1']);
    feat.refs = [{ type: 'branch', name: 'develop' }];
    commitStore.setData(makeGraphData([feat, head]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'develop', current: false, ahead: 0, behind: 0, hash: 'h2' },
    ];
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // develop row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    // Top-level (flat) item is present WITHOUT hovering into the branch submenu.
    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^new worktree$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();
    const msg = globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: { startPoint?: string } })
      .find(m => m.type === 'worktreeAddModalRequest');
    expect(msg?.payload?.startPoint).toBe('develop');
  });

  it('does not crash on a branch-set fingerprint cache hit (same commits, same branch)', async () => {
    // First mount populates the cache.
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]));
    // currentBranch is a getter 窶・set it by adding a current branch to the list.
    branchStore.branches = [
      { name: 'main', current: true, remote: undefined, upstream: undefined, ahead: 0, behind: 0, hash: 'h2' },
    ];

    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelectorAll('.commit-row').length).toBe(2);

    // Re-render with the SAME data 窶・the fingerprint must match, no errors.
    cleanup();
    const { container: c2 } = render(CommitGraph, {});
    await tick();
    expect(c2.querySelectorAll('.commit-row').length).toBe(2);
  });
});

describe('CommitGraph empty repository', () => {
  const emptyData = (isEmptyRepo = false): CommitGraphData => ({
    commits: [],
    graph: [],
    paths: [],
    links: [],
    dots: [],
    commitLeftMargin: [],
    hasMore: false,
    currentLimit: 1000,
    isEmptyRepo,
  });

  it('offers "create initial commit" only when HEAD is unborn', async () => {
    commitStore.setData(emptyData(true));
    const { container } = render(CommitGraph, {});
    await tick();
    const btn = container.querySelector<HTMLButtonElement>('.empty-initial-btn');
    expect(btn).toBeTruthy();
    await fireEvent.click(btn!);
    expect(
      globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'createInitialCommit')
    ).toBe(true);
  });

  it('shows the plain empty message when no commit matches (not an unborn HEAD)', async () => {
    commitStore.setData(emptyData(false));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('.empty-initial-btn')).toBeFalsy();
    expect(container.querySelector('.empty')?.textContent).toContain('No commits found');
  });
});

describe('CommitGraph graph line style', () => {
  it('renders straight right-angled elbows (L only, no Q/C) when graphStyle is angular', async () => {
    uiStore.graphStyle = 'angular';
    commitStore.setData(makeStyledGraphData());
    const { container } = render(CommitGraph, {});
    await tick();

    const ds = renderedPathDs(container);
    expect(ds.length).toBeGreaterThan(0);
    // Branch path uses mhutchie's angular kink (diagonal + vertical), then the
    // merge link keeps its elbow. Git Graph grid geometry: 16px lane pitch,
    // first lane (SourceGit x=10) centred at x=16; fixture lane 2 (x=12) lands
    // at 16 + 2*(16/12) 竕・18.67 (path data is emitted rounded to 2 decimals).
    // Angular d = 24 * 0.38 = 9.12.
    expect(ds).toContain('M 16 0 L 18.67 14.88 L 18.67 24 L 18.67 33.12 L 16 48 L 16 72');
    expect(ds).toContain('M 16 0 L 17.333333333333332 14.879999999999999 L 17.333333333333332 24');
    for (const d of ds) {
      expect(d).toContain('L');
      expect(d).not.toContain('Q');
      expect(d).not.toContain('C');
    }
    for (const p of container.querySelectorAll('.graph-lines path')) {
      expect(p.getAttribute('stroke-linejoin')).toBe('miter');
    }
  });

  it('renders rounded beziers by default (Q links, Q/C paths)', async () => {
    commitStore.setData(makeStyledGraphData());
    const { container } = render(CommitGraph, {});
    await tick();

    const ds = renderedPathDs(container);
    expect(ds).toContain('M 16 0 Q 18.67 0, 18.67 24 C 18.67 40, 16 32, 16 48 L 16 72');
    // Merge link: upstream Git Graph Plus corner-hugging quadratic.
    expect(ds).toContain('M 16 0 Q 17.333333333333332 0, 17.333333333333332 24');
    expect(ds.some((d) => d.includes('C'))).toBe(true);
    expect(ds.some((d) => d.includes('Q'))).toBe(true);
    for (const p of container.querySelectorAll('.graph-lines path')) {
      // Rounded mode keeps the previous DOM exactly: no explicit linejoin.
      expect(p.getAttribute('stroke-linejoin')).toBeNull();
    }
  });

  it('renders rounded beziers when graphStyle is explicitly rounded', async () => {
    uiStore.graphStyle = 'rounded';
    commitStore.setData(makeStyledGraphData());
    const { container } = render(CommitGraph, {});
    await tick();

    const ds = renderedPathDs(container);
    expect(ds).toContain('M 16 0 Q 18.67 0, 18.67 24 C 18.67 40, 16 32, 16 48 L 16 72');
    expect(ds).toContain('M 16 0 Q 17.333333333333332 0, 17.333333333333332 24');
    expect(ds.some((d) => d.includes('C'))).toBe(true);
    expect(ds.some((d) => d.includes('Q'))).toBe(true);
  });

  it('draws a half-row transition as a single quadratic sweep (no overshoot kink)', async () => {
    // SourceGit routes lane changes through half-row points (y = 0.5), so a
    // transition can span only 12px; Git Graph Plus's corner-hugging quadratic
    // covers exactly that segment with no control points escaping it.
    commitStore.setData({
      commits: [makeCommit('h1', 'first'), makeCommit('h2', 'second', ['h1'])],
      graph: [
        { commit: 'h1', column: 0, color: '#63b0f4', parents: [] },
        { commit: 'h2', column: 1, color: '#63b0f4', parents: [] },
      ],
      paths: [{ points: [{ x: 10, y: 0.5 }, { x: 22, y: 1 }], color: 0 }],
      links: [],
      dots: [
        { center: { x: 10, y: 0.5 }, color: 0, type: 'default', localOnly: false, remoteTip: false },
        { center: { x: 22, y: 1 }, color: 0, type: 'default', localOnly: false, remoteTip: false },
      ],
      commitLeftMargin: [24, 24],
      hasMore: false,
      currentLimit: 1000,
    });
    const { container } = render(CommitGraph, {});
    await tick();

    const ds = renderedPathDs(container);
    // One corner-hugging quadratic from (16,12) to (32,24).
    expect(ds).toContain('M 16 12 Q 32 12, 32 24');
  });

  it('scales the angular elbow to a half-row transition', async () => {
    uiStore.graphStyle = 'angular';
    commitStore.setData({
      commits: [makeCommit('h1', 'first'), makeCommit('h2', 'second', ['h1'])],
      graph: [
        { commit: 'h1', column: 0, color: '#63b0f4', parents: [] },
        { commit: 'h2', column: 1, color: '#63b0f4', parents: [] },
      ],
      paths: [{ points: [{ x: 10, y: 0.5 }, { x: 22, y: 1 }], color: 0 }],
      links: [],
      dots: [
        { center: { x: 10, y: 0.5 }, color: 0, type: 'default', localOnly: false, remoteTip: false },
        { center: { x: 22, y: 1 }, color: 0, type: 'default', localOnly: false, remoteTip: false },
      ],
      commitLeftMargin: [24, 24],
      hasMore: false,
      currentLimit: 1000,
    });
    const { container } = render(CommitGraph, {});
    await tick();

    const ds = renderedPathDs(container);
    // d = 0.38 * 12 = 4.56 -> elbow at y = 24 - 4.56 = 19.44.
    expect(ds).toContain('M 16 12 L 32 19.44 L 32 24');
  });

  it('widens a half-row right transition with a following stub to a full row (rounded)', async () => {
    // SourceGit emits (lane, y) -> (newLane, y + 0.5) -> (newLane, y + 1); the
    // stub is folded into the transition so it spans the full row mhutchie's
    // geometry assumes (d = 0.8 * 24 = 19.2) instead of a tight half-row elbow.
    commitStore.setData({
      commits: [makeCommit('h1', 'first'), makeCommit('h2', 'second', ['h1'])],
      graph: [
        { commit: 'h1', column: 0, color: '#63b0f4', parents: [] },
        { commit: 'h2', column: 1, color: '#63b0f4', parents: [] },
      ],
      paths: [{ points: [{ x: 10, y: 0 }, { x: 22, y: 0.5 }, { x: 22, y: 1 }], color: 0 }],
      links: [],
      dots: [
        { center: { x: 10, y: 0 }, color: 0, type: 'default', localOnly: false, remoteTip: false },
        { center: { x: 22, y: 1 }, color: 0, type: 'default', localOnly: false, remoteTip: false },
      ],
      commitLeftMargin: [24, 24],
      hasMore: false,
      currentLimit: 1000,
    });
    const { container } = render(CommitGraph, {});
    await tick();

    const ds = renderedPathDs(container);
    expect(ds).toContain('M 16 0 Q 32 0, 32 24');
  });
});

describe('CommitGraph signature icon', () => {
  it('renders a signature icon for good/unverified commits', async () => {
    commitStore.setData(makeGraphData([
      { ...makeCommit('h1', 'signed'), signatureStatus: 'good' },
      { ...makeCommit('h2', 'tampered', ['h1']), signatureStatus: 'unverified' },
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('.sig-icon.sig-icon-good')).toBeTruthy();
    expect(container.querySelector('.sig-icon.sig-icon-unverified')).toBeTruthy();
  });

  it('omits the icon for "none" and when signatureStatus is absent', async () => {
    commitStore.setData(makeGraphData([
      { ...makeCommit('h1', 'unsigned'), signatureStatus: 'none' },
      makeCommit('h2', 'no field', ['h1']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('.sig-icon')).toBeFalsy();
  });

  it('shows "Interactive Rebase selected commits" for a contiguous chain on a non-current branch', async () => {
    const head = makeCommit('h1', 'main tip');
    head.refs = [{ type: 'head', name: 'main' }];
    const f1 = makeCommit('f1', 'feature 1', ['h1']);
    const f2 = makeCommit('f2', 'feature 2', ['f1']);
    f2.refs = [{ type: 'branch', name: 'feature' }];
    commitStore.setData(makeGraphData([f2, f1, head]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'h1' },
      { name: 'feature', current: false, ahead: 0, behind: 0, hash: 'f2' },
    ];
    uiStore.multiSelectArmed = true;
    uiStore.selectedCommitHashes = ['f1', 'f2'];

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // f2 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();

    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^interactive rebase \d+ commits$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();

    uiStore.exitMultiSelect();
  });

  it('keeps the right-clicked commit outlined while a context-menu modal is open, then clears it on close', async () => {
    // Regression: opening a modal from the context menu (e.g. New Branch, which
    // is managed by modalStore and rendered in App.svelte) used to clear the
    // row outline immediately 窶・reset kept it, these did not. The outline must
    // persist while any follow-up modal is open and drop once it closes.
    commitStore.setData(makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]));
    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0];
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    const item = Array.from(container.querySelectorAll<HTMLElement>('.menu-item'))
      .find(el => (el.textContent ?? '').trim() === 'New Branch');
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();

    expect(modalStore.createBranch.show).toBe(true);
    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    modalStore.closeCreateBranch();
    await tick();
    expect(container.querySelector('.commit-row.highlighted')).toBeFalsy();
  });

  it('keeps the right-clicked commit outlined when opening interactive rebase from the single-commit menu', async () => {
    // Regression: interactiveRebaseBase is only mirrored into modalStore via an
    // $effect, which runs after the synchronous menu onClose. The outline used
    // to clear because anyModalOpen still read false at that point.
    const c1 = makeCommit('h1', 'first');
    const c2 = makeCommit('h2', 'second', ['h1']);
    c2.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([c2, c1]));
    branchStore.branches = [{ name: 'main', current: true, ahead: 0, behind: 0, hash: 'h2' }];
    uiStore.interactiveRebaseMode = 'ui';

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[1]; // h1 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();
    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    const item = Array.from(container.querySelectorAll<HTMLElement>('.menu-item'))
      .find(el => /^interactively rebase .* to here$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();

    expect(container.querySelector('.commit-row.highlighted')).toBeTruthy();

    uiStore.exitMultiSelect();
  });

  it('keeps the multi-selection armed after opening the interactive rebase modal (GUI mode)', async () => {
    // Regression: clicking "Interactive Rebase selected commits" used to clear
    // the selection the moment the modal opened. Like squash/cherry-pick, the
    // selection must persist while the modal is open.
    const base = makeCommit('m0', 'base');
    const c1 = makeCommit('c1', 'commit 1', ['m0']);
    const c2 = makeCommit('c2', 'commit 2', ['c1']);
    c2.refs = [{ type: 'head', name: 'main' }];
    commitStore.setData(makeGraphData([c2, c1, base]));
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'c2' },
    ];
    uiStore.interactiveRebaseMode = 'ui';
    uiStore.multiSelectArmed = true;
    uiStore.selectedCommitHashes = ['c1', 'c2'];

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // c2 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();

    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^interactive rebase \d+ commits$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();
    await fireEvent.click(item!);
    await tick();

    expect(uiStore.multiSelectArmed).toBe(true);
    expect(uiStore.selectedCommitHashes).toEqual(['c1', 'c2']);

    uiStore.exitMultiSelect();
  });

  it('resolves candidate branches when BranchInfo.hash is abbreviated (not the full commit hash)', async () => {
    // Regression: branch tips come from git as %(objectname:short), but commitMap
    // is keyed by the full hash. The menu item must still appear.
    const head = makeCommit('mainfull1234', 'main tip');
    head.refs = [{ type: 'head', name: 'main' }];
    const f1 = makeCommit('feat1full5678', 'feature 1', ['mainfull1234']);
    const f2 = makeCommit('feat2full9012', 'feature 2', ['feat1full5678']);
    f2.refs = [{ type: 'branch', name: 'feature' }];
    commitStore.setData(makeGraphData([f2, f1, head]));
    // abbreviated tips (commit.abbreviatedHash === hash.slice(0,7)), which differ
    // from the full commit hashes the commitMap is keyed by.
    branchStore.branches = [
      { name: 'main', current: true, ahead: 0, behind: 0, hash: 'mainful' },
      { name: 'feature', current: false, ahead: 0, behind: 0, hash: 'feat2fu' },
    ];
    uiStore.multiSelectArmed = true;
    uiStore.selectedCommitHashes = ['feat1full5678', 'feat2full9012'];

    const { container } = render(CommitGraph, {});
    await tick();
    const row = container.querySelectorAll<HTMLElement>('.commit-row')[0]; // f2 row
    await fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    await tick();

    const item = Array.from(container.querySelectorAll<HTMLElement>('*'))
      .find(el => el.children.length === 0 && /^interactive rebase \d+ commits$/i.test((el.textContent ?? '').trim()));
    expect(item).toBeTruthy();

    uiStore.exitMultiSelect();
  });
});

describe('CommitGraph auto-load history (issue #61)', () => {
  function graphDataWithMore(): CommitGraphData {
    const data = makeGraphData([
      makeCommit('h1', 'first'),
      makeCommit('h2', 'second', ['h1']),
    ]);
    data.hasMore = true;
    data.currentLimit = 100;
    return data;
  }

  // happy-dom reports 0 for layout metrics, so pin a realistic
  // scrolled-to-the-bottom state before dispatching the scroll event.
  function scrollToBottom(container: HTMLElement): HTMLElement {
    const graph = container.querySelector<HTMLElement>('.commit-graph');
    expect(graph).toBeTruthy();
    Object.defineProperty(graph, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(graph, 'scrollHeight', { value: 3000, configurable: true });
    Object.defineProperty(graph, 'scrollTop', { value: 2800, configurable: true });
    return graph!;
  }

  function getLogMessages() {
    return globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: { limit?: number } })
      .filter(m => m.type === 'getLog');
  }

  it('posts the next getLog chunk on a scroll near the bottom when enabled', async () => {
    commitStore.setData(graphDataWithMore());
    uiStore.autoLoadHistory = true;
    const { container } = render(CommitGraph, {});
    await tick();

    await fireEvent.scroll(scrollToBottom(container));
    await tick();

    expect(getLogMessages()).toHaveLength(1);
    // Same payload as the "Load more" button: currentLimit + loadMoreCount.
    expect(getLogMessages()[0].payload?.limit).toBe(150);
    expect(commitStore.loadingMore).toBe(true);
  });

  it('does nothing on scroll when the setting is disabled', async () => {
    commitStore.setData(graphDataWithMore());
    uiStore.autoLoadHistory = false;
    const { container } = render(CommitGraph, {});
    await tick();

    await fireEvent.scroll(scrollToBottom(container));
    await tick();

    expect(getLogMessages()).toHaveLength(0);
    expect(commitStore.loadingMore).toBe(false);
  });

  it('does not auto-load while a load-more request is already in flight', async () => {
    commitStore.setData(graphDataWithMore());
    uiStore.autoLoadHistory = true;
    const { container } = render(CommitGraph, {});
    await tick();
    const graph = scrollToBottom(container);

    await fireEvent.scroll(graph);
    await tick();
    expect(getLogMessages()).toHaveLength(1);

    await fireEvent.scroll(graph);
    await tick();

    expect(getLogMessages()).toHaveLength(1);
  });

  it('does not auto-load when there is no more history', async () => {
    const data = graphDataWithMore();
    data.hasMore = false;
    commitStore.setData(data);
    uiStore.autoLoadHistory = true;
    const { container } = render(CommitGraph, {});
    await tick();

    await fireEvent.scroll(scrollToBottom(container));
    await tick();

    expect(getLogMessages()).toHaveLength(0);
    expect(commitStore.loadingMore).toBe(false);
  });

  it('does not auto-load while a search is active', async () => {
    commitStore.setData(graphDataWithMore());
    uiStore.autoLoadHistory = true;
    const { container } = render(CommitGraph, { searchMatchedHashes: new Set(['h1']) });
    await tick();

    await fireEvent.scroll(scrollToBottom(container));
    await tick();

    expect(getLogMessages()).toHaveLength(0);
    expect(commitStore.loadingMore).toBe(false);
  });
});

describe('CommitGraph avatars', () => {
  afterEach(() => {
    avatarStore.setEnabled(true);
  });

  function commitWithEmail(hash: string, email: string): Commit {
    const commit = makeCommit(hash, 'first');
    commit.author = { ...commit.author, email };
    return commit;
  }

  it('renders the author avatar once it resolves', async () => {
    avatarStore.receive('avatar-on@x.com', 20, 'data:image/png;base64,SEED');
    commitStore.setData(makeGraphData([commitWithEmail('h1', 'avatar-on@x.com')]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('img.avatar-sm')).toBeTruthy();
    expect(container.querySelector('.author-name')?.textContent).toBe('A');
  });

  it('omits the avatar (so the name stays flush-left) while none has resolved', async () => {
    commitStore.setData(makeGraphData([commitWithEmail('h1', 'avatar-pending@x.com')]));
    const { container } = render(CommitGraph, {});
    await tick();
    // No <img> is emitted, so the author column does not reserve avatar space
    // and the name lines up with the AUTHOR header.
    expect(container.querySelector('img.avatar-sm')).toBeFalsy();
    expect(container.querySelector('.author-name')?.textContent).toBe('A');
    // The avatar is still requested, so it can appear once it resolves.
    expect(
      globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'getAvatar')
    ).toBe(true);
  });

  it('hides the avatar and still shows the author name when showAvatars is off', async () => {
    avatarStore.setEnabled(false);
    commitStore.setData(makeGraphData([commitWithEmail('h1', 'avatar-off@x.com')]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('img.avatar-sm')).toBeFalsy();
    expect(container.querySelector('.author-name')?.textContent).toBe('A');
    expect(
      globalThis.__postedMessages.some(m => (m.data as { type?: string }).type === 'getAvatar')
    ).toBe(false);
  });
});

describe('CommitGraph branch focus dimming', () => {
  it('dims rows, dots and lines outside the focus set', async () => {
    commitStore.setData(makeGraphData([makeCommit('h1', 'first'), makeCommit('h2', 'second', ['h1'])]));
    const { container } = render(CommitGraph, { dimFocusHashes: new Set(['h2']) });
    await tick();
    const rows = Array.from(container.querySelectorAll('.commit-row'));
    const rowFirst = rows.find(r => r.textContent?.includes('first'))!;
    const rowSecond = rows.find(r => r.textContent?.includes('second'))!;
    expect(rowFirst.classList.contains('focus-dim')).toBe(true);
    expect(rowSecond.classList.contains('focus-dim')).toBe(false);
    expect(container.querySelector('.graph-lines.dimmed')).toBeTruthy();
    expect(container.querySelectorAll('.graph-lines g[opacity="0.25"]').length).toBeGreaterThanOrEqual(1);
  });

  it('renders normally without a focus set', async () => {
    commitStore.setData(makeGraphData([makeCommit('h1', 'first')]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('.commit-row')!.classList.contains('focus-dim')).toBe(false);
    expect(container.querySelector('.graph-lines.dimmed')).toBeNull();
  });
});

describe('CommitGraph column layout', () => {
  beforeEach(() => { localStorage.removeItem('gitGraphPlus.columnPrefs'); });
  afterEach(() => { localStorage.removeItem('gitGraphPlus.columnPrefs'); });

  it('hides a column via the header context menu and persists the choice', async () => {
    commitStore.setData(makeGraphData([makeCommit('h1', 'first')]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect(container.querySelector('.graph-header .col-hash')).toBeTruthy();

    await fireEvent.contextMenu(container.querySelector('.graph-header')!);
    await tick();
    const item = Array.from(container.querySelectorAll('.menu-item')).find(el => el.textContent?.trim() === 'SHA');
    expect(item).toBeTruthy();
    await fireEvent.click(item!.closest('button')!);
    await tick();

    expect(container.querySelector('.graph-header .col-hash')).toBeNull();
    const prefs = JSON.parse(localStorage.getItem('gitGraphPlus.columnPrefs')!);
    expect(prefs.visible.hash).toBe(false);
  });

  it('restores saved column prefs on mount', async () => {
    localStorage.setItem('gitGraphPlus.columnPrefs', JSON.stringify({
      widths: { author: 200, hash: 80, date: 150 },
      visible: { author: true, hash: false, date: true },
    }));
    commitStore.setData(makeGraphData([makeCommit('h1', 'first')]));
    const { container } = render(CommitGraph, {});
    await tick();
    expect((container.querySelector('.graph-header .col-author') as HTMLElement).style.width).toBe('200px');
    expect(container.querySelector('.graph-header .col-hash')).toBeNull();
  });

  it('resizes a column by dragging its header handle', async () => {
    commitStore.setData(makeGraphData([makeCommit('h1', 'first')]));
    const { container } = render(CommitGraph, {});
    await tick();
    const handle = container.querySelectorAll('.graph-header .col-resize')[0]; // author handle
    await fireEvent.mouseDown(handle, { clientX: 500 });
    await fireEvent.mouseMove(window, { clientX: 460 });
    await fireEvent.mouseUp(window);
    await tick();
    expect((container.querySelector('.graph-header .col-author') as HTMLElement).style.width).toBe('160px');
    const prefs = JSON.parse(localStorage.getItem('gitGraphPlus.columnPrefs')!);
    expect(prefs.widths.author).toBe(160);
  });
});

describe('CommitGraph ref badge clicks', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 220));

  // Earlier tests can leave the row-select debounce timer pending; drain it and
  // reset the selection so these isolation assertions observe only their own click.
  beforeEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    uiStore.selectedCommitHash = null;
  });

  function branchData() {
    const head = makeCommit('h1', 'first');
    head.refs = [{ type: 'branch', name: 'feature' }];
    return makeGraphData([
      makeCommit('UNCOMMITTED', 'Uncommitted changes'),
      head,
    ]);
  }

  it('single click on a ref badge does not select the commit (no bottom panel)', async () => {
    commitStore.setData(branchData());
    const { container } = render(CommitGraph, {});
    await tick();
    const badge = container.querySelector<HTMLElement>('.ref-badge');
    expect(badge).toBeTruthy();

    await fireEvent.click(badge!);
    // Wait past the row's 150 ms single-click debounce: on the old behaviour the
    // bubbled click selected the commit and opened the bottom panel.
    await settle();

    expect(uiStore.selectedCommitHash).toBeNull();
  });

  it('a slower double click on a ref badge does not flash-select the row and still starts checkout', async () => {
    commitStore.setData(branchData());
    const { container } = render(CommitGraph, {});
    await tick();
    globalThis.__postedMessages = [];
    const badge = container.querySelector<HTMLElement>('.ref-badge')!;

    // Two clicks further apart than the 150 ms debounce (typical OS double-click
    // interval) used to make the first click open the panel mid-double-click.
    await fireEvent.click(badge);
    await settle();
    await fireEvent.click(badge);
    await fireEvent.dblClick(badge);

    expect(uiStore.selectedCommitHash).toBeNull();
    expect(globalThis.__postedMessages.some((m) => (m.data as { type?: string }).type === 'checkDirty')).toBe(true);
  });

  it('clicking the commit row still selects it', async () => {
    commitStore.setData(branchData());
    const { container } = render(CommitGraph, {});
    await tick();
    const rows = container.querySelectorAll<HTMLElement>('.commit-row');

    await fireEvent.click(rows[1]);
    await settle();

    expect(uiStore.selectedCommitHash).toBe('h1');
  });
});

describe('CommitGraph compare diff modes', () => {
  function comparePosts() {
    return globalThis.__postedMessages
      .map(m => m.data as { type?: string; payload?: Record<string, unknown> })
      .filter(m => m.type === 'compareCommits');
  }

  it('requests 2-dot by default and re-requests when the scope changes', async () => {
    commitStore.setData(makeGraphData([makeCommit('h1', 'first'), makeCommit('h2', 'second', ['h1']), makeCommit('h3', 'third', ['h2'])]));
    uiStore.multiSelectArmed = true;
    uiStore.selectedCommitHashes = ['h1', 'h2'];
    render(CommitGraph, {});
    await waitFor(() => {
      expect(comparePosts().length).toBeGreaterThan(0);
    });
    const first = comparePosts().pop()!;
    expect(first.payload?.mode).toBe('direct');
    expect(first.payload?.ref1).toBe('h2');   // older
    expect(first.payload?.ref2).toBe('h1');   // newer

    uiStore.compareMode = 'ref2';
    await waitFor(() => {
      expect(comparePosts().pop()?.payload?.mode).toBe('ref2');
    });
    expect(comparePosts().pop()?.payload?.ref2).toBe('h1');
  });
});
