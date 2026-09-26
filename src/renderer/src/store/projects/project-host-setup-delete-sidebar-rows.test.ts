import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  Project,
  ProjectHostSetup,
  ProjectHostSetupDeleteResult
} from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'
import type { DetectedWorktreeListResult, Worktree } from '../../../../shared/worktree/types'
import { clearRuntimeCompatibilityCacheForTests } from '../../runtime/runtime-rpc-client'
import { createTestStore, makeWorktree } from '../slices/store-test-helpers'

// A setup deleted from Settings removes the repo from the window's own catalog here, so a later
// repos:changed refetch can no longer see the removal: the deleted repo's worktree rows stayed
// in the sidebar, headed "Unknown" once the header fallback ran. The delete has to prune those
// rows itself, the way removeProject does.

const keptRepo: Repo = {
  id: 'repo-kept',
  path: '/kept',
  displayName: 'Kept',
  badgeColor: '#000',
  addedAt: 1,
  executionHostId: 'local'
}

const removedRepo: Repo = {
  id: 'repo-gone',
  path: '/gone',
  displayName: 'Gone',
  badgeColor: '#111',
  addedAt: 2,
  executionHostId: 'local'
}

// The same raw id published by a paired runtime host must keep its rows when only the
// local setup is deleted.
const runtimeTwinRepo: Repo = {
  id: 'repo-gone',
  path: '/gone',
  displayName: 'Gone',
  badgeColor: '#111',
  addedAt: 2,
  executionHostId: 'runtime:env-1'
}

const goneProject: Project = {
  id: 'project-gone',
  displayName: 'Gone',
  badgeColor: '#111',
  sourceRepoIds: ['repo-gone'],
  createdAt: 1,
  updatedAt: 1
}

const goneSetup: ProjectHostSetup = {
  id: 'setup-gone',
  projectId: goneProject.id,
  hostId: 'local',
  repoId: removedRepo.id,
  path: removedRepo.path,
  displayName: 'Gone',
  setupState: 'ready',
  setupMethod: 'imported-existing-folder',
  createdAt: 1,
  updatedAt: 1
}

const deleteHostSetup = vi.fn()

beforeEach(() => {
  clearRuntimeCompatibilityCacheForTests()
  deleteHostSetup.mockReset()
  vi.stubGlobal('window', {
    api: {
      projects: { deleteHostSetup },
      runtimeEnvironments: { call: vi.fn() }
    }
  })
})

function worktreeFor(repoId: string, hostId?: Worktree['hostId']) {
  return makeWorktree({
    id: `${repoId}::/${repoId}-wt`,
    repoId,
    path: `/${repoId}/wt`,
    ...(hostId ? { hostId } : {})
  })
}

function detectedFor(repoId: string, hostId?: Worktree['hostId']): DetectedWorktreeListResult {
  return {
    repoId,
    authoritative: true,
    source: 'git',
    worktrees: [
      {
        ...worktreeFor(repoId, hostId),
        ownership: 'orca-managed',
        selectedCheckout: false,
        visible: true
      }
    ]
  }
}

describe('deleteProjectHostSetup prunes the deleted repo worktree rows', () => {
  it('drops the deleted repo rows and clears sidebar references, keeping the rest', async () => {
    deleteHostSetup.mockResolvedValue({
      project: goneProject,
      setup: goneSetup,
      repo: removedRepo
    } satisfies ProjectHostSetupDeleteResult)
    const store = createTestStore()
    const keptWorktrees = [worktreeFor(keptRepo.id)]
    const keptDetected = detectedFor(keptRepo.id)
    store.setState({
      repos: [keptRepo, removedRepo],
      projects: [goneProject],
      projectHostSetups: [goneSetup],
      worktreesByRepo: {
        [keptRepo.id]: keptWorktrees,
        [removedRepo.id]: [worktreeFor(removedRepo.id)]
      },
      detectedWorktreesByRepo: {
        [keptRepo.id]: keptDetected,
        [removedRepo.id]: detectedFor(removedRepo.id)
      },
      activeRepoId: removedRepo.id,
      filterRepoIds: [removedRepo.id]
    })

    const result = await store.getState().deleteProjectHostSetup({ setupId: goneSetup.id })

    expect(result).not.toBeNull()
    expect(deleteHostSetup).toHaveBeenCalledWith({ setupId: goneSetup.id })
    const state = store.getState()
    expect(state.repos.map((repo) => repo.id)).toEqual([keptRepo.id])
    expect(state.projectHostSetups).toEqual([])
    expect(state.worktreesByRepo).not.toHaveProperty(removedRepo.id)
    expect(state.detectedWorktreesByRepo).not.toHaveProperty(removedRepo.id)
    expect(state.worktreesByRepo[keptRepo.id]).toBe(keptWorktrees)
    expect(state.detectedWorktreesByRepo[keptRepo.id]).toBe(keptDetected)
    expect(state.activeRepoId).toBeNull()
    expect(state.filterRepoIds).toEqual([])
  })

  it('keeps the rows when a sibling host still publishes the same repo id', async () => {
    deleteHostSetup.mockResolvedValue({
      project: goneProject,
      setup: goneSetup,
      repo: removedRepo
    } satisfies ProjectHostSetupDeleteResult)
    const store = createTestStore()
    const sharedRows = [worktreeFor(removedRepo.id)]
    const sharedDetected = detectedFor(removedRepo.id)
    store.setState({
      repos: [removedRepo, runtimeTwinRepo],
      projects: [goneProject],
      projectHostSetups: [goneSetup],
      worktreesByRepo: { [removedRepo.id]: sharedRows },
      detectedWorktreesByRepo: { [removedRepo.id]: sharedDetected }
    })

    await store.getState().deleteProjectHostSetup({ setupId: goneSetup.id })

    const state = store.getState()
    expect(state.repos.map((repo) => repo.executionHostId)).toEqual(['runtime:env-1'])
    expect(state.worktreesByRepo[removedRepo.id]).toBe(sharedRows)
    expect(state.detectedWorktreesByRepo[removedRepo.id]).toBe(sharedDetected)
  })

  it('leaves the rows untouched when the deleted setup carried no repo', async () => {
    deleteHostSetup.mockResolvedValue({
      project: goneProject,
      setup: goneSetup
    } satisfies ProjectHostSetupDeleteResult)
    const store = createTestStore()
    const rows = [worktreeFor(removedRepo.id)]
    const detected = detectedFor(removedRepo.id)
    store.setState({
      repos: [removedRepo],
      projects: [goneProject],
      projectHostSetups: [goneSetup],
      worktreesByRepo: { [removedRepo.id]: rows },
      detectedWorktreesByRepo: { [removedRepo.id]: detected }
    })
    const sortEpochBefore = store.getState().sortEpoch

    await store.getState().deleteProjectHostSetup({ setupId: goneSetup.id })

    const state = store.getState()
    expect(state.repos.map((repo) => repo.id)).toEqual([removedRepo.id])
    expect(state.worktreesByRepo[removedRepo.id]).toBe(rows)
    expect(state.detectedWorktreesByRepo[removedRepo.id]).toBe(detected)
    expect(state.sortEpoch).toBe(sortEpochBefore)
  })
})
