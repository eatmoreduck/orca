import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import {
  createTestStore,
  makeTabGroup,
  makeUnifiedTab,
  makeWorktree,
  seedStore
} from './store-test-helpers'
import { createStoreCascadesMockApi } from './store-cascades-test-harness'

const mockUnregisterPtyDataHandlers = vi.hoisted(() => vi.fn<() => unknown[]>(() => []))
const mockRestorePtyDataHandlersAfterFailedShutdown = vi.hoisted(() => vi.fn())

// Mock sonner (imported by repos.ts)
vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: mockRestorePtyDataHandlersAfterFailedShutdown,
  unregisterPtyDataHandlers: mockUnregisterPtyDataHandlers
}))

// Mock agent-status (imported by terminal-helpers)
vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return {
    ...actual,
    detectAgentStatusFromTitle: vi.fn().mockReturnValue(null)
  }
})

const mockApi = createStoreCascadesMockApi()

// Regression coverage for #21016: closeEmptyGroup used to gate on
// `group.tabOrder.length === 0`, so a group whose tabOrder retained a ghost id (or an
// id now owned by a sibling group) rendered a blank strip that could never be closed.
describe('closeEmptyGroup with drifted tabOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.worktrees.updateMeta.mockResolvedValue({})
  })

  const seedSplitWithGhostGroup = (
    store: ReturnType<typeof createTestStore>,
    ghostTabOrder: string[],
    opts?: { activeWorktreeId?: string }
  ) => {
    const wt = 'repo1::/path/wt1'
    seedStore(store, {
      worktreesByRepo: {
        repo1: [makeWorktree({ id: wt, repoId: 'repo1', path: '/path/wt1' })]
      },
      activeWorktreeId: opts?.activeWorktreeId ?? wt,
      activeTabType: 'terminal',
      activeTabTypeByWorktree: { [wt]: 'terminal' },
      unifiedTabsByWorktree: {
        [wt]: [
          makeUnifiedTab({
            id: 'survivor-tab',
            entityId: 'survivor-tab',
            worktreeId: wt,
            groupId: 'group-live',
            contentType: 'terminal'
          })
        ]
      },
      groupsByWorktree: {
        [wt]: [
          makeTabGroup({
            id: 'group-ghost',
            worktreeId: wt,
            activeTabId: null,
            tabOrder: ghostTabOrder
          }),
          makeTabGroup({
            id: 'group-live',
            worktreeId: wt,
            activeTabId: 'survivor-tab',
            tabOrder: ['survivor-tab']
          })
        ]
      },
      layoutByWorktree: {
        [wt]: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: { type: 'leaf', groupId: 'group-ghost' },
          second: { type: 'leaf', groupId: 'group-live' }
        }
      },
      activeGroupIdByWorktree: { [wt]: 'group-ghost' }
    })
    return wt
  }

  it('closes a group whose tabOrder holds a tab owned by the sibling group', () => {
    const store = createTestStore()
    const wt = seedSplitWithGhostGroup(store, ['survivor-tab'])

    expect(store.getState().closeEmptyGroup(wt, 'group-ghost')).toBe(true)

    const s = store.getState()
    expect(s.groupsByWorktree[wt]?.map((group) => group.id)).toEqual(['group-live'])
    expect(s.activeGroupIdByWorktree[wt]).toBe('group-live')
    expect(s.layoutByWorktree[wt]).toEqual({ type: 'leaf', groupId: 'group-live' })
    // Why: the foreign tabOrder entry must not take the real tab down with the group.
    expect(s.unifiedTabsByWorktree[wt]?.map((tab) => tab.id)).toEqual(['survivor-tab'])
    expect(s.unifiedTabsByWorktree[wt]?.[0]?.groupId).toBe('group-live')
  })

  it('closes a group whose tabOrder holds only a ghost id', () => {
    const store = createTestStore()
    const wt = seedSplitWithGhostGroup(store, ['ghost-tab-1'])

    expect(store.getState().closeEmptyGroup(wt, 'group-ghost')).toBe(true)

    const s = store.getState()
    expect(s.groupsByWorktree[wt]?.map((group) => group.id)).toEqual(['group-live'])
    expect(s.layoutByWorktree[wt]).toEqual({ type: 'leaf', groupId: 'group-live' })
  })

  it('closes a stale-tabOrder group in a worktree that is not active', () => {
    const store = createTestStore()
    seedSplitWithGhostGroup(store, [], { activeWorktreeId: 'repo1::/path/wt1' })

    const wt2 = 'repo1::/path/wt2'
    seedStore(store, {
      worktreesByRepo: {
        repo1: [
          makeWorktree({ id: 'repo1::/path/wt1', repoId: 'repo1', path: '/path/wt1' }),
          makeWorktree({ id: wt2, repoId: 'repo1', path: '/path/wt2' })
        ]
      },
      groupsByWorktree: {
        [wt2]: [
          makeTabGroup({
            id: 'group-wt2-ghost',
            worktreeId: wt2,
            activeTabId: null,
            tabOrder: ['ghost-tab-2']
          })
        ]
      },
      layoutByWorktree: { [wt2]: { type: 'leaf', groupId: 'group-wt2-ghost' } },
      activeGroupIdByWorktree: { [wt2]: 'group-wt2-ghost' }
    })

    expect(store.getState().closeEmptyGroup(wt2, 'group-wt2-ghost')).toBe(true)

    const s = store.getState()
    expect(s.groupsByWorktree[wt2] ?? []).toEqual([])
    expect(s.layoutByWorktree[wt2]).toBeUndefined()
  })

  it('still refuses a group that owns a live tab even when tabOrder is empty', () => {
    const store = createTestStore()
    const wt = 'repo1::/path/wt1'
    seedStore(store, {
      worktreesByRepo: {
        repo1: [makeWorktree({ id: wt, repoId: 'repo1', path: '/path/wt1' })]
      },
      activeWorktreeId: wt,
      activeTabType: 'terminal',
      activeTabTypeByWorktree: { [wt]: 'terminal' },
      unifiedTabsByWorktree: {
        [wt]: [
          makeUnifiedTab({
            id: 'unlisted-live-tab',
            entityId: 'unlisted-live-tab',
            worktreeId: wt,
            groupId: 'group-drift',
            contentType: 'terminal'
          })
        ]
      },
      groupsByWorktree: {
        [wt]: [
          // Why: tabOrder drifts the other way here — empty while the group still owns a
          // live tab. Collapsing that group would orphan the tab, so the guard must hold.
          makeTabGroup({ id: 'group-drift', worktreeId: wt, activeTabId: null, tabOrder: [] }),
          makeTabGroup({
            id: 'group-live',
            worktreeId: wt,
            activeTabId: 'survivor-tab',
            tabOrder: ['survivor-tab']
          })
        ]
      },
      layoutByWorktree: {
        [wt]: {
          type: 'split',
          direction: 'horizontal',
          ratio: 0.5,
          first: { type: 'leaf', groupId: 'group-drift' },
          second: { type: 'leaf', groupId: 'group-live' }
        }
      },
      activeGroupIdByWorktree: { [wt]: 'group-drift' }
    })

    expect(store.getState().closeEmptyGroup(wt, 'group-drift')).toBe(false)

    const s = store.getState()
    expect(s.groupsByWorktree[wt]?.map((group) => group.id)).toEqual(['group-drift', 'group-live'])
    expect(s.unifiedTabsByWorktree[wt]?.map((tab) => tab.id)).toEqual(['unlisted-live-tab'])
  })

  it('still closes a truly empty group', () => {
    const store = createTestStore()
    const wt = seedSplitWithGhostGroup(store, [])

    expect(store.getState().closeEmptyGroup(wt, 'group-ghost')).toBe(true)

    const s = store.getState()
    expect(s.groupsByWorktree[wt]?.map((group) => group.id)).toEqual(['group-live'])
  })

  it('merges a ghost-tabOrder group into its sibling via mergeGroupIntoSibling', () => {
    const store = createTestStore()
    const wt = seedSplitWithGhostGroup(store, ['ghost-tab-1'])

    expect(store.getState().mergeGroupIntoSibling(wt, 'group-ghost')).toBe('group-live')

    const s = store.getState()
    expect(s.groupsByWorktree[wt]?.map((group) => group.id)).toEqual(['group-live'])
    expect(s.unifiedTabsByWorktree[wt]?.map((tab) => tab.id)).toEqual(['survivor-tab'])
  })
})
