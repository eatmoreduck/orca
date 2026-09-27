import { describe, expect, it } from 'vitest'
import {
  hasQuietCodexReadyPrompt,
  hasQuietMuseReadyPrompt,
  isTuiIdleSatisfied,
  type TuiIdleEvidenceRecord,
  type TuiIdleSatisfactionInput
} from './tui-idle-evidence'

const QUIESCENCE_MS = 3000

function record(overrides: Partial<TuiIdleEvidenceRecord> = {}): TuiIdleEvidenceRecord {
  return {
    lastAgentStatus: null,
    lastOutputAt: Date.now() - QUIESCENCE_MS * 2,
    lastOscTitle: 'tmp',
    ...overrides
  }
}

function input(overrides: Partial<TuiIdleSatisfactionInput> = {}): TuiIdleSatisfactionInput {
  return {
    record: record(),
    readPositiveBodyEvidence: () => false,
    readMuseReadyBodyEvidence: () => true,
    readCodexReadyBodyEvidence: () => false,
    agent: 'muse',
    firstPartyStatus: null,
    quiescenceMs: QUIESCENCE_MS,
    ...overrides
  }
}

describe('hasQuietMuseReadyPrompt', () => {
  it('settles a Muse ready screen once the stream has gone quiet', () => {
    expect(hasQuietMuseReadyPrompt(record(), 'muse', () => true, QUIESCENCE_MS)).toBe(true)
  })

  it('refuses while the pane is still streaming', () => {
    expect(
      hasQuietMuseReadyPrompt(
        record({ lastOutputAt: Date.now() }),
        'muse',
        () => true,
        QUIESCENCE_MS
      )
    ).toBe(false)
  })

  it('refuses without an output clock, like the tier-3 lane', () => {
    expect(
      hasQuietMuseReadyPrompt(record({ lastOutputAt: null }), 'muse', () => true, QUIESCENCE_MS)
    ).toBe(false)
  })

  it('refuses without a ready screen', () => {
    expect(hasQuietMuseReadyPrompt(record(), 'muse', () => false, QUIESCENCE_MS)).toBe(false)
  })

  it('covers adopted panes that carry no launch metadata', () => {
    expect(hasQuietMuseReadyPrompt(record(), null, () => true, QUIESCENCE_MS)).toBe(true)
    expect(hasQuietMuseReadyPrompt(record(), undefined, () => true, QUIESCENCE_MS)).toBe(true)
  })

  it('refuses another agent quoting Muse in its scrollback', () => {
    expect(hasQuietMuseReadyPrompt(record(), 'codex', () => true, QUIESCENCE_MS)).toBe(false)
  })
})

describe('isTuiIdleSatisfied muse lane', () => {
  it('settles a quiet Muse pane with no title signal at all', () => {
    expect(isTuiIdleSatisfied(input())).toBe(true)
  })

  it('lets a fresh first-party working status veto the Muse body', () => {
    expect(
      isTuiIdleSatisfied(input({ firstPartyStatus: { state: 'working', updatedAt: Date.now() } }))
    ).toBe(false)
  })
})

describe('hasQuietCodexReadyPrompt', () => {
  it('settles the codex composer once the stream has gone quiet', () => {
    expect(hasQuietCodexReadyPrompt(record(), 'codex', () => true, QUIESCENCE_MS)).toBe(true)
  })

  it('holds a streaming composer to the quiescence demand', () => {
    expect(
      hasQuietCodexReadyPrompt(
        record({ lastOutputAt: Date.now() }),
        'codex',
        () => true,
        QUIESCENCE_MS
      )
    ).toBe(false)
  })

  it('demands an output clock like the Muse lane', () => {
    expect(
      hasQuietCodexReadyPrompt(record({ lastOutputAt: null }), 'codex', () => true, QUIESCENCE_MS)
    ).toBe(false)
  })

  it('refuses a pane that is not a known codex pane', () => {
    expect(hasQuietCodexReadyPrompt(record(), 'gemini', () => true, QUIESCENCE_MS)).toBe(false)
    expect(hasQuietCodexReadyPrompt(record(), null, () => true, QUIESCENCE_MS)).toBe(false)
  })
})

describe('isTuiIdleSatisfied codex composer lane', () => {
  it('settles a known codex pane whose one-shot startup header left the retained tail (#23241)', () => {
    expect(
      isTuiIdleSatisfied(
        input({
          readPositiveBodyEvidence: () => false,
          readMuseReadyBodyEvidence: () => false,
          readCodexReadyBodyEvidence: () => true,
          agent: 'codex'
        })
      )
    ).toBe(true)
  })

  it('lets a fresh first-party working status veto the composer lane', () => {
    expect(
      isTuiIdleSatisfied(
        input({
          readPositiveBodyEvidence: () => false,
          readMuseReadyBodyEvidence: () => false,
          readCodexReadyBodyEvidence: () => true,
          agent: 'codex',
          firstPartyStatus: { state: 'working', updatedAt: Date.now() }
        })
      )
    ).toBe(false)
  })

  it('does not let another agent quoting the codex composer settle', () => {
    expect(
      isTuiIdleSatisfied(
        input({
          readPositiveBodyEvidence: () => false,
          readMuseReadyBodyEvidence: () => false,
          readCodexReadyBodyEvidence: () => true,
          agent: 'gemini'
        })
      )
    ).toBe(false)
  })
})
