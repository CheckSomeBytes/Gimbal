import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';

// A single long-lived, hidden PowerShell process that finds, focuses and
// pastes into windows. Starting powershell.exe and compiling the C# helper for
// every paste took a second or more each time; this process does both once and
// then answers JSON requests on stdin, one line each.
//
// Requests carry the window pattern as JSON data. It is never part of the
// script text, so a pattern can't run commands (see the injection fix that
// moved it into an environment variable first).

export type WindowMatchMode = 'exact' | 'contains' | 'regex';

export type WindowHelperRequest =
  | { op: 'list' }
  | { op: 'paste'; pattern: string; mode: WindowMatchMode; enter: boolean };

export interface WindowHelperResponse {
  status: 'OK' | 'SUCCESS' | 'NOFOCUS' | 'NOTFOUND' | 'ERROR' | 'TIMEOUT';
  windows?: { title: string; processName: string }[];
  matched?: string | null;
  error?: string;
}

// Enumerates every top-level window, not just each process's "main" window.
// Get-Process only reports MainWindowTitle, so apps that hold several windows
// (Slack, Chrome, PowerPoint) were invisible unless Windows happened to
// designate the wanted one as main.
const GIMBAL_WIN_TYPE = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public class GimbalWin {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
    public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

    public class Win { public IntPtr Handle; public string Title; public string ProcessName; }

    public static List<Win> All() {
        var res = new List<Win>();
        EnumWindows((h, l) => {
            // Minimized windows still count: they are restorable targets.
            if (!IsWindowVisible(h) && !IsIconic(h)) return true;
            var sb = new StringBuilder(512);
            GetWindowText(h, sb, 512);
            if (sb.Length == 0) return true;
            string pname = "";
            try {
                uint pid; GetWindowThreadProcessId(h, out pid);
                pname = Process.GetProcessById((int)pid).ProcessName;
            } catch {}
            res.Add(new Win { Handle = h, Title = sb.ToString(), ProcessName = pname });
            return true;
        }, IntPtr.Zero);
        return res;
    }

    // SetForegroundWindow is refused unless the calling thread owns the
    // foreground. Attaching to the current foreground thread lifts that.
    public static bool Focus(IntPtr h) {
        if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
        IntPtr fg = GetForegroundWindow();
        uint targetPid, fgPid;
        uint targetThread = GetWindowThreadProcessId(h, out targetPid);
        uint fgThread = GetWindowThreadProcessId(fg, out fgPid);
        uint thisThread = GetCurrentThreadId();
        if (fgThread != thisThread) AttachThreadInput(thisThread, fgThread, true);
        BringWindowToTop(h);
        bool ok = SetForegroundWindow(h);
        if (fgThread != thisThread) AttachThreadInput(thisThread, fgThread, false);
        for (int i = 0; i < 20 && GetForegroundWindow() != h; i++) System.Threading.Thread.Sleep(25);
        return GetForegroundWindow() == h;
    }
}
'@
`;

// Matching is case-insensitive throughout, like the Settings "Test" button.
// "contains" is a literal substring match (-like would treat [ ] ? * in titles
// as wildcards).
export const WINDOW_HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
${GIMBAL_WIN_TYPE}
Add-Type -AssemblyName System.Windows.Forms
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $res = @{}
  try {
    $req = $line | ConvertFrom-Json
    $res.id = $req.id
    $all = [GimbalWin]::All()
    if ($req.op -eq 'list') {
      $res.windows = @($all | ForEach-Object { @{ title = $_.Title; processName = $_.ProcessName } })
      $res.status = 'OK'
    } else {
      $p = [string]$req.pattern
      $win = $null
      foreach ($w in $all) {
        $t = $w.Title
        $hit = switch ($req.mode) {
          'exact'    { $t -eq $p }
          'contains' { $t.IndexOf($p, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 }
          'regex'    { $t -match $p }
          default    { $false }
        }
        if ($hit) { $win = $w; break }
      }
      if (-not $win) {
        $res.status = 'NOTFOUND'
      } elseif (-not [GimbalWin]::Focus($win.Handle)) {
        $res.status = 'NOFOCUS'
        $res.matched = $win.Title
      } else {
        $res.matched = $win.Title
        Start-Sleep -Milliseconds 150
        [System.Windows.Forms.SendKeys]::SendWait('^v')
        if ($req.enter) {
          Start-Sleep -Milliseconds 100
          [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
        }
        $res.status = 'SUCCESS'
      }
    }
  } catch {
    $res.status = 'ERROR'
    $res.error = $_.Exception.Message
  }
  [Console]::Out.WriteLine(($res | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}
`;

// Requests are ASCII-only on the wire, so the console's input code page can't
// mangle non-ASCII window titles in a pattern.
function toAsciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export class WindowHelper {
  private proc: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<number, (res: WindowHelperResponse) => void>();
  private nextId = 1;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly command = 'powershell.exe',
    private readonly requestTimeoutMs = 10000,
    private readonly startTimeoutMs = 30000
  ) {}

  /** Start the process ahead of the first request, so that one is fast too. */
  start(): Promise<void> {
    if (this.ready) return this.ready;

    const proc = spawn(
      this.command,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOW_HELPER_SCRIPT],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    this.proc = proc;

    this.ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Window helper did not start in time'));
        this.stop();
      }, this.startTimeoutMs);

      createInterface({ input: proc.stdout! }).on('line', (line) => {
        let msg: { ready?: boolean; id?: number } & WindowHelperResponse;
        try {
          msg = JSON.parse(line.replace(/^﻿/, ''));
        } catch {
          return; // Stray output (e.g. a warning); requests are matched by id.
        }
        if (msg.ready) {
          clearTimeout(timer);
          resolve();
          return;
        }
        const done = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
        if (done) {
          this.pending.delete(msg.id!);
          done(msg);
        }
      });
      proc.stderr!.on('data', (data) => console.error('[WindowHelper]', String(data).trim()));
      proc.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      proc.on('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`Window helper exited (${code})`));
        if (this.proc === proc) this.reset(`Window helper exited (${code})`);
      });
    });
    // A failed start is retried by the next request.
    const ready = this.ready;
    ready.catch(() => {
      if (this.ready === ready) this.reset('Window helper failed to start');
    });
    return ready;
  }

  /** Run fn with exclusive use of the helper: requests never overlap. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Send one request. Call inside exclusive() so requests don't interleave. */
  async send(request: WindowHelperRequest): Promise<WindowHelperResponse> {
    try {
      await this.start();
    } catch (error) {
      return { status: 'ERROR', error: error instanceof Error ? error.message : String(error) };
    }
    const proc = this.proc;
    if (!proc?.stdin) return { status: 'ERROR', error: 'Window helper is not running' };

    const id = this.nextId++;
    return new Promise<WindowHelperResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // The helper may be stuck (SendWait blocks on a hung window); start a
        // fresh one for the next request.
        this.stop();
        resolve({ status: 'TIMEOUT' });
      }, this.requestTimeoutMs);
      this.pending.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });
      proc.stdin!.write(toAsciiJson({ ...request, id }) + '\n');
    });
  }

  stop(): void {
    const proc = this.proc;
    this.reset('Window helper stopped');
    proc?.kill();
  }

  private reset(reason: string): void {
    this.proc = null;
    this.ready = null;
    for (const done of this.pending.values()) done({ status: 'ERROR', error: reason });
    this.pending.clear();
  }
}
