import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toast } from 'sonner'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { createAutomationRunWorkspaceAction } from './automation-run-workspace-action'
import type { AutomationRun } from '../../../../shared/automations-types'
import type { AutomationsPageActionContext } from './automations-page-action-context'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), message: vi.fn() }
}))

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: vi.fn()
}))

const mockGetState = vi.fn()
vi.mock('@/store', () => ({
  useAppStore: { getState: () => mockGetState() }
}))

// Regression coverage for #21213: a run dispatched on a paired remote runtime carries
// pane-key/pty-id metadata the local window's tab/layout/pty ledgers can never resolve,
// so View run used to dead-end with "Run terminal is unavailable." even though
// activating the run's workspace surfaces the live session.
describe('openRunWorkspace pane-key resolution failure', () => {
  const run = {
    id: 'run-1',
    automationId: 'automation-1',
    status: 'completed',
    workspaceId: 'wt-1',
    terminalPaneKey: 'tab-1:6bcf637a-03b4-44fe-899b-f3b8c1bbe987',
    terminalPtyId: 'pty-1'
  } as unknown as AutomationRun

  const selectedRow = { key: 'row-1' }
  const worktree = { id: 'wt-1' }

  const context = {
    store: {
      repoForRow: () => ({ id: 'repo-1' }),
      worktreeForRow: (_row: unknown, _repo: unknown, workspaceId: string) =>
        workspaceId === 'wt-1' ? worktree : null
    },
    list: { selectedRow }
  } as unknown as AutomationsPageActionContext

  const openAction = createAutomationRunWorkspaceAction(context)

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetState.mockReturnValue({
      getTab: () => undefined,
      terminalLayoutsByTabId: {},
      ptyIdsByTabId: {},
      setTabLayout: vi.fn(),
      setActiveTab: vi.fn(),
      setActiveTabType: vi.fn()
    })
  })

  it('activates the run workspace instead of dead-ending when the pane key cannot be resolved', () => {
    vi.mocked(activateAndRevealWorktree).mockReturnValue(true as never)

    openAction(run)

    expect(activateAndRevealWorktree).toHaveBeenCalledWith('wt-1')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('still surfaces the unavailable label when the workspace cannot be activated', () => {
    vi.mocked(activateAndRevealWorktree).mockReturnValue(false as never)

    openAction(run)

    expect(activateAndRevealWorktree).toHaveBeenCalledWith('wt-1')
    expect(toast.error).toHaveBeenCalledWith('Run terminal is unavailable.')
  })

  it('still focuses the exact pane when local resolution succeeds', () => {
    const setTabLayout = vi.fn()
    const setActiveTab = vi.fn()
    mockGetState.mockReturnValue({
      getTab: () => ({ id: 'tab-1' }),
      terminalLayoutsByTabId: {
        'tab-1': {
          root: { type: 'leaf', leafId: '6bcf637a-03b4-44fe-899b-f3b8c1bbe987' },
          ptyIdsByLeafId: {}
        }
      },
      ptyIdsByTabId: { 'tab-1': ['pty-1'] },
      setTabLayout,
      setActiveTab,
      setActiveTabType: vi.fn()
    })
    vi.mocked(activateAndRevealWorktree).mockReturnValue(true as never)

    openAction(run)

    expect(setTabLayout).toHaveBeenCalled()
    expect(setActiveTab).toHaveBeenCalledWith('tab-1')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
