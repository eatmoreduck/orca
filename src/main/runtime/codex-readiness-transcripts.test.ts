/**
 * Pins the codex composer readiness lane (#23241) to captured transcripts instead of
 * hand-written fixtures, per docs/reference/agent-pty-transcript-capture.md.
 *
 * The lane's hazard is exactly what the captures pin down: the composer placeholder is
 * also painted while a turn runs (codex-busy-mid-turn — the placeholder sits between two
 * "esc to interrupt" status paints, including codex's own "interupt" typo), and it is
 * painted again once the turn ends (codex-busy-turn-ended). Only the second may settle.
 *
 * Scope note: these captures are short enough that the one-shot startup header is still
 * inside the retained tail, so the live-pipeline settles below are also reachable through
 * the pre-existing tier-1 header check. The lane-specific pinning is the matcher
 * assertions on the real bytes; a capture long enough to evict the header mid-turn would
 * pin the live path end to end and is welcome follow-up evidence.
 *
 * Captured from codex-cli 0.156.1 (brew cask) on macOS, PTY 100×30; update dialog skipped
 * with esc, folder trust granted, task "Reply with exactly the word done and nothing else."
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createTranscriptPane } from './agent-transcript-pane-test-harness'
import {
  detectTerminalWaitBlockedReason,
  isCodexComposerPromptPreview
} from './terminal-wait-detection'
import { stripAnsiEscapeSequences } from '../../shared/ansi-escape-sequences'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp') }
}))

const FIXTURE_DIR = join(__dirname, '__fixtures__')

function transcript(name: string): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.txt`), 'utf8')
}

describe('codex readiness from captured terminal bytes', () => {
  it('settles the idle composer over the live wait pipeline (#23241)', async () => {
    const { runtime, handle } = await createTranscriptPane({
      paneTitle: 'codex-idle-composer',
      foregroundProcess: 'codex',
      launchAgent: 'codex',
      data: transcript('codex-idle-composer')
    })
    await expect(
      runtime.waitForTerminal(handle, { condition: 'tui-idle', timeoutMs: 10_000 })
    ).resolves.toMatchObject({ satisfied: true })
  }, 15_000)

  it('settles once the turn has ended and the composer returned', async () => {
    const { runtime, handle } = await createTranscriptPane({
      paneTitle: 'codex-busy-turn-ended',
      foregroundProcess: 'codex',
      launchAgent: 'codex',
      data: transcript('codex-busy-turn-ended')
    })
    await expect(
      runtime.waitForTerminal(handle, { condition: 'tui-idle', timeoutMs: 10_000 })
    ).resolves.toMatchObject({ satisfied: true })
  }, 15_000)

  it('refuses the composer while a turn is in flight, on the real mid-turn bytes', () => {
    const waitText = transcript('codex-busy-mid-turn').toLowerCase()
    expect(waitText).toContain('ask codex to do anything')
    // The status phrase is SGR-fragmented in the raw stream; the matcher strips ANSI
    // before searching for it.
    expect(stripAnsiEscapeSequences(waitText)).toContain('esc to inter')
    expect(isCodexComposerPromptPreview(waitText)).toBe(false)
  })

  it('accepts the composer on the real idle and turn-ended bytes', () => {
    expect(isCodexComposerPromptPreview(transcript('codex-idle-composer').toLowerCase())).toBe(true)
    expect(isCodexComposerPromptPreview(transcript('codex-busy-turn-ended').toLowerCase())).toBe(
      true
    )
  })

  it('finds no actionable blocked prompt on the idle and turn-ended bytes', () => {
    expect(detectTerminalWaitBlockedReason(transcript('codex-idle-composer'))).toBeNull()
    expect(detectTerminalWaitBlockedReason(transcript('codex-busy-turn-ended'))).toBeNull()
  })
})
