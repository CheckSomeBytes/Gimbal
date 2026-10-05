import { accessSync, constants, existsSync, statSync } from 'fs';
import { dirname, isAbsolute } from 'path';
import { ResolvedBackupDirectory } from '../shared/types';

// The configured backup folder travels with the config (exports, synced
// folders), so it can name a place that doesn't exist on this computer: a
// Windows path on macOS or Linux, another user's home folder, an unplugged
// drive. Using it anyway either fails or, for a Windows path on POSIX, quietly
// creates a folder named "C:\Users\..." relative to the working directory.
// These helpers decide whether the configured folder is usable here; callers
// fall back to the default without overwriting the setting, since the cause
// may be temporary (e.g. the drive comes back).

// Whether `dir` is an absolute path in this OS's own syntax. path.isAbsolute
// isn't enough on Windows, where "/Users/me" counts as absolute (rooted on the
// current drive) but came from macOS or Linux.
export function isNativeAbsolutePath(dir: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform === 'win32') {
    return /^[a-zA-Z]:[\\/]/.test(dir) || /^\\\\[^\\]+\\[^\\]+/.test(dir);
  }
  return isAbsolute(dir);
}

// Whether a backup folder can be used or created at `dir`: the nearest
// existing ancestor (or `dir` itself) must be a writable directory.
function canCreateOrWrite(dir: string): boolean {
  let current = dir;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  try {
    if (!statSync(current).isDirectory()) return false;
    accessSync(current, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveBackupDirectory(
  configured: string | undefined,
  getDefault: () => string
): ResolvedBackupDirectory {
  if (!configured) {
    return { directory: getDefault() };
  }
  if (isNativeAbsolutePath(configured) && canCreateOrWrite(configured)) {
    return { directory: configured };
  }
  return { directory: getDefault(), unavailable: configured };
}
