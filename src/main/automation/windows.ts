import { exec, execFile } from 'child_process';
import { MatchMode, PasteResult, WindowAutomation, WindowInfo } from './types';

// Windows backend: everything goes through PowerShell, so no native Node
// bindings are needed.

function listWindows(): Promise<WindowInfo[]> {
  return new Promise((resolve) => {
    const psScript = `
      Get-Process | Where-Object { $_.MainWindowTitle -ne '' } |
      Select-Object ProcessName, MainWindowTitle |
      ConvertTo-Json
    `;

    exec(
      `powershell -Command "${psScript.replace(/\n/g, ' ')}"`,
      (error: Error | null, stdout: string) => {
        if (error) {
          resolve([]);
          return;
        }

        try {
          const result = JSON.parse(stdout);
          // Handle single result (not an array)
          const windows = Array.isArray(result) ? result : [result];
          resolve(
            windows.map((w: { ProcessName: string; MainWindowTitle: string }) => ({
              title: w.MainWindowTitle,
              processName: w.ProcessName,
            }))
          );
        } catch {
          resolve([]);
        }
      }
    );
  });
}

function focusAndPaste(pattern: string, matchMode: MatchMode, pressEnter: boolean): Promise<PasteResult> {
  return new Promise((resolve) => {
    // Escape single quotes in the pattern for PowerShell
    const escapedPattern = pattern.replace(/'/g, "''");

    // Build the match condition based on mode
    let matchCondition: string;
    switch (matchMode) {
      case 'exact':
        matchCondition = `$_.MainWindowTitle -eq '${escapedPattern}'`;
        break;
      case 'contains':
        matchCondition = `$_.MainWindowTitle -like '*${escapedPattern}*'`;
        break;
      case 'regex':
        matchCondition = `$_.MainWindowTitle -match '${escapedPattern}'`;
        break;
    }

    // Use a simpler approach: separate commands
    const psScript = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Win32Helper {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@

$allWindows = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object ProcessName, MainWindowTitle
Write-Host "DEBUG: Available windows:"
$allWindows | ForEach-Object { Write-Host "  - $($_.ProcessName): $($_.MainWindowTitle)" }
Write-Host "DEBUG: Looking for pattern '${escapedPattern}' with condition: ${matchCondition}"

$proc = Get-Process | Where-Object { $_.MainWindowTitle -ne '' -and (${matchCondition}) } | Select-Object -First 1
if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) {
    Write-Host "DEBUG: Found window - $($proc.ProcessName): $($proc.MainWindowTitle)"
    [Win32Helper]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Start-Sleep -Milliseconds 300
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    ${pressEnter ? `Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')` : ''}
    Write-Output 'SUCCESS'
} else {
    Write-Host "DEBUG: No matching window found"
    Write-Output 'NOTFOUND'
}
`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          console.error('PowerShell error:', error);
          console.error('stderr:', stderr);
          resolve({
            success: false,
            error: 'Failed to execute: ' + (error.message || 'Unknown error'),
          });
        } else if (stdout.includes('SUCCESS')) {
          console.log('PowerShell debug output:', stdout);
          resolve({ success: true });
        } else {
          console.log('PowerShell output:', stdout);
          console.log('Pattern used:', pattern);
          console.log('Match mode:', matchMode);
          resolve({
            success: false,
            error: 'Window not found matching pattern: ' + pattern,
          });
        }
      }
    );
  });
}

export const windowsAutomation: WindowAutomation = {
  isSupported: () => true,
  listWindows,
  focusAndPaste,
};
