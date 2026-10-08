import type { HookInstallAgent } from '../../shared/telemetry-events'
import { track } from '../telemetry/client'

/**
 * Why (#26604): the telemetry docs promise raw error messages never leave the
 * machine — they can contain paths and user names, e.g.
 * "EACCES: permission denied, open '/home/<user>/.claude/settings.json'".
 * Only system error codes or error class names are safe to report.
 */
function describeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) {
      return code.slice(0, 64)
    }
    return error.constructor.name
  }
  return 'unknown'
}

export function recordManagedHookInstallFailure(agent: HookInstallAgent, error: unknown): void {
  try {
    track('agent_hook_install_failed', {
      agent,
      error_code: describeErrorCode(error)
    })
  } catch (telemetryError) {
    console.error('[agent-hooks] Failed to record install-failure telemetry:', telemetryError)
  }
}
