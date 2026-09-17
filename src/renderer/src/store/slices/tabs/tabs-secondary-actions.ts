import type { TabGroupLayoutNode } from '../../../../../shared/tab-types'
import type { TabsSlice, TabsSliceGet, TabsSliceSet } from './tabs-slice-contract'
import { findGroupAndWorktree, findTabAndWorktree } from '../tab-group-state'
import { findSiblingGroupId, updateSplitRatio } from './tabs-layout'

export function createTabsSecondaryActions(
  set: TabsSliceSet,
  get: TabsSliceGet
): Pick<TabsSlice, 'copyUnifiedTabToGroup' | 'mergeGroupIntoSibling' | 'setTabGroupSplitRatio'> {
  return {
    copyUnifiedTabToGroup: (tabId, targetGroupId, init) => {
      const foundTab = findTabAndWorktree(get().unifiedTabsByWorktree, tabId)
      const foundTarget = findGroupAndWorktree(get().groupsByWorktree, targetGroupId)
      if (!foundTab || !foundTarget || foundTab.worktreeId !== foundTarget.worktreeId) {
        return null
      }
      const { tab, worktreeId } = foundTab
      return get().createUnifiedTab(worktreeId, tab.contentType, {
        entityId: init?.entityId ?? tab.entityId,
        executionHostId: tab.executionHostId,
        label: init?.label ?? tab.label,
        generatedLabel: init?.generatedLabel ?? tab.generatedLabel,
        quickCommandLabel: init?.quickCommandLabel ?? tab.quickCommandLabel,
        customLabel: init?.customLabel ?? tab.customLabel,
        color: init?.color ?? tab.color,
        isPinned: init?.isPinned ?? tab.isPinned,
        id: init?.id,
        targetGroupId
      })
    },

    mergeGroupIntoSibling: (worktreeId, groupId) => {
      const state = get()
      const groups = state.groupsByWorktree[worktreeId] ?? []
      const sourceGroup = groups.find((candidate) => candidate.id === groupId)
      const layout = state.layoutByWorktree[worktreeId]
      if (!sourceGroup || !layout || groups.length <= 1) {
        return null
      }
      const targetGroupId = findSiblingGroupId(layout, groupId)
      if (!targetGroupId) {
        return null
      }

      const orderedSourceTabs = (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(
        (tab) => tab.groupId === groupId
      )
      // Why owned-first: tabOrder can omit owned tabs, and stranding one would leave this
      // call reporting a merge while the source group survives closeEmptyGroup's owned-tab
      // guard (#21016). tabOrder order is preserved for listed tabs; unlisted tabs append.
      const listedIds = new Set(sourceGroup.tabOrder)
      const sourceTabs = [
        ...orderedSourceTabs.filter((tab) => listedIds.has(tab.id)),
        ...orderedSourceTabs.filter((tab) => !listedIds.has(tab.id))
      ]
      for (const tab of sourceTabs) {
        get().moveUnifiedTabToGroup(tab.id, targetGroupId, { recordInteraction: false })
      }
      get().closeEmptyGroup(worktreeId, groupId)
      get().recordFeatureInteraction?.('terminal-panes')
      return targetGroupId
    },

    setTabGroupSplitRatio: (worktreeId, nodePath, ratio) => {
      set((state) => {
        const currentLayout = state.layoutByWorktree[worktreeId]
        if (!currentLayout) {
          return state
        }
        // Why: an unchanged ratio must not mint fresh root state — every store
        // subscriber wakes on the new reference (STA-3328).
        let targetNode: TabGroupLayoutNode | undefined = currentLayout
        for (const segment of nodePath.length > 0 ? nodePath.split('.') : []) {
          targetNode =
            targetNode &&
            targetNode.type === 'split' &&
            (segment === 'first' || segment === 'second')
              ? targetNode[segment]
              : undefined
        }
        if (!targetNode || targetNode.type !== 'split' || (targetNode.ratio ?? 0.5) === ratio) {
          return state
        }
        return {
          layoutByWorktree: {
            ...state.layoutByWorktree,
            // Why: split ratios belong to the tab-group model (not transient UI), so persist them for restores and multi-step group ops.
            [worktreeId]: updateSplitRatio(
              currentLayout,
              nodePath.length > 0 ? nodePath.split('.') : [],
              ratio
            )
          }
        }
      })
    }
  }
}
