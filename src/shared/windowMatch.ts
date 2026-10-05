import { WindowTarget } from './types';

// Case-insensitive window title matching, the same rules PowerShell applies
// for -eq, -like and -match in the Windows backend. Backends that enumerate
// windows themselves (macOS, Linux) match with this, and Settings uses it to
// dry-run the target.
//
// Throws a SyntaxError for an invalid regex pattern.
export function createWindowTitleMatcher(
  pattern: string,
  matchMode: WindowTarget['matchMode']
): (title: string) => boolean {
  if (matchMode === 'regex') {
    const re = new RegExp(pattern, 'i');
    return (title) => re.test(title);
  }
  const needle = pattern.toLowerCase();
  return (title) => {
    const lower = title.toLowerCase();
    return matchMode === 'exact' ? lower === needle : lower.includes(needle);
  };
}
