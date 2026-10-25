import type { IDecoration, IBufferLine, IBufferRange, Terminal } from '@xterm/xterm'

/**
 * Sibling-row underlines for hard-wrapped links (#33553).
 *
 * A TUI that writes each row of a long URL itself (OSC 8 reopened per row, or plain
 * text padded per row) produces one link per row: clicks and the hover strip are
 * correct, but the underline only covers the hovered row, which reads as "this click
 * opens half a URL". xterm underlines the hovered link's range only (its own TODO in
 * OscLinkProvider notes the gap), so the sibling rows are underlined here instead —
 * per-row hit ranges stay untouched.
 */

/** A 1-based buffer row segment to underline (inclusive x). */
export type LinkRowSegment = { y: number; startX: number; endX: number }

type BufferLike = { getLine(y: number): IBufferLine | undefined }

function lineCellUrlId(line: IBufferLine | undefined, x: number): number {
  // The public cell API omits hyperlink metadata; sniff the runtime shape like
  // terminal-osc-link-cells.ts does instead of casting to internals.
  const cell = line?.getCell(x)
  if (
    !cell ||
    !('hasExtendedAttrs' in cell) ||
    typeof cell.hasExtendedAttrs !== 'function' ||
    !cell.hasExtendedAttrs()
  ) {
    return 0
  }
  const extended = (cell as { extended?: unknown }).extended
  if (typeof extended !== 'object' || extended === null) {
    return 0
  }
  const urlId = (extended as { urlId?: unknown }).urlId
  return typeof urlId === 'number' && urlId > 0 ? urlId : 0
}

/** The first contiguous run of cells carrying `urlId` on one line; 0-based x, inclusive. */
export function oscLinkSegmentOnLine(
  line: IBufferLine | undefined,
  urlId: number
): { startX: number; endX: number } | null {
  if (!line || urlId <= 0) {
    return null
  }
  let run: { startX: number; endX: number } | null = null
  let best: { startX: number; endX: number } | null = null
  for (let x = 0; x < line.length; x++) {
    if (lineCellUrlId(line, x) === urlId) {
      run = run ?? { startX: x, endX: x }
      run.endX = x
    } else if (run) {
      best = best ?? run
      run = null
    }
  }
  return best ?? run
}

/**
 * The rows adjacent to `hoveredY` (1-based) that carry the same OSC 8 link id as the
 * cell at `hoveredX` (1-based). The hovered row itself is excluded — xterm already
 * underlines its own range.
 */
export function oscLinkSiblingSegments(
  buffer: BufferLike,
  hoveredY: number,
  hoveredX: number
): LinkRowSegment[] {
  const hoveredLine = buffer.getLine(hoveredY - 1)
  const urlId = lineCellUrlId(hoveredLine, hoveredX - 1)
  if (urlId <= 0) {
    return []
  }
  const segments: LinkRowSegment[] = []
  for (const direction of [-1, 1]) {
    let y = hoveredY + direction
    for (;;) {
      const segment = oscLinkSegmentOnLine(buffer.getLine(y - 1), urlId)
      // Why a whole-row run: a TUI that reopens the link writes one contiguous run per
      // row; a row with no cell carrying the id ends the link.
      if (!segment) {
        break
      }
      segments.push({ y, startX: segment.startX + 1, endX: segment.endX + 1 })
      y += direction
    }
  }
  return segments
}

/** IBufferRange values (start.x 1-based inclusive, end.x exclusive) as inclusive segments. */
export function linkRowSegmentsFromRanges(ranges: readonly IBufferRange[]): LinkRowSegment[] {
  return ranges.map((range) => ({
    y: range.start.y,
    startX: range.start.x,
    endX: range.end.x - 1
  }))
}

export type SiblingLinkUnderliner = {
  underline: (segments: readonly LinkRowSegment[]) => void
  clear: () => void
}

/** Draws 1px bottom borders over the given rows via decorations; markers scroll with the buffer. */
export function createSiblingLinkUnderliner(
  terminal: Pick<Terminal, 'registerDecoration' | 'registerMarker'> & {
    buffer: Terminal['buffer']
  }
): SiblingLinkUnderliner {
  let active: IDecoration[] = []
  const applyUnderline = (element: HTMLElement): void => {
    element.style.borderBottom = '1px solid'
    element.style.pointerEvents = 'none'
    element.style.height = '100%'
  }
  return {
    underline(segments) {
      this.clear()
      const buffer = terminal.buffer.active
      // registerMarker offsets from the cursor (pane-scroll.ts uses the same recipe).
      const cursorAbsoluteY = buffer.baseY + buffer.cursorY
      for (const segment of segments) {
        const marker = terminal.registerMarker(segment.y - 1 - cursorAbsoluteY)
        if (!marker) {
          continue
        }
        const decoration = terminal.registerDecoration({
          marker,
          // Decoration x is 0-based; LinkRowSegment x is 1-based.
          x: segment.startX - 1,
          width: segment.endX - segment.startX + 1
        })
        if (!decoration) {
          continue
        }
        if (decoration.element) {
          applyUnderline(decoration.element)
        } else {
          decoration.onRender(applyUnderline)
        }
        active.push(decoration)
      }
    },
    clear() {
      for (const decoration of active) {
        decoration.dispose()
      }
      active = []
    }
  }
}
