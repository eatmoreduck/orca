import { homedir } from 'node:os'
import { mergePersistedWindowsPath } from '../pty/windows-environment-path'

// Why (#23214): AppImage and other desktop launches can strip PATH and HOME from
// the process environment. Probes then ENOENT into "not installed", and gh/git
// lose the user's credentials without HOME. These are floors for missing values
// only — an inherited value is never overridden, and os.homedir() still resolves
// the passwd entry when HOME itself is unset.
const POSIX_FALLBACK_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

function stringOnlyProcessEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

export function buildLocalPreflightEnv(): Record<string, string> | undefined {
  if (process.platform !== 'win32') {
    const env = stringOnlyProcessEnv(process.env)
    let floored = false
    if (!env.HOME) {
      env.HOME = homedir()
      floored = true
    }
    if (!env.PATH) {
      env.PATH = POSIX_FALLBACK_PATH
      floored = true
    }
    return floored ? env : undefined
  }
  const env = stringOnlyProcessEnv(process.env)
  // Why: newly installed CLIs update persisted Windows Path, but the running
  // Electron process keeps its old environment until we merge it explicitly.
  mergePersistedWindowsPath(env)
  return env
}
