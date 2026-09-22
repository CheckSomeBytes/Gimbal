/**
 * Boot smoke test.
 *
 * Builds pass and packaging succeeds even when the app cannot start: a preload
 * that fails to load is a runtime error, invisible to tsc and to electron-vite.
 * That shipped a blank window in v1.6.0-beta.2, where Rollup split the preload
 * into a chunk that a sandboxed preload cannot require().
 *
 * So this launches the real built app and asserts it actually comes up:
 *   - no preload failed to load
 *   - window.electronAPI is exposed, with the expected methods
 *   - React rendered something into #root
 *   - the countdown window opens and exposes its own bridge
 *
 * Run with Electron, not node:  npx electron scripts/smoke-test.js
 * Exits non-zero with a reason on the first failure.
 */
const { app, BrowserWindow } = require('electron');
const { join } = require('path');

const MAIN = join(__dirname, '..', 'out', 'main', 'main.js');
const TIMEOUT_MS = 60000;

// Methods the renderer calls on startup. If the bridge is broken these are the
// symptoms users see first (blank window, no config).
const REQUIRED_API = [
  'loadConfig',
  'saveConfig',
  'openCountdownTimer',
  'onTimerTextScaleChanged',
];

const failures = [];
const notes = [];
let mainWindow = null;
let countdownChecked = false;
let finished = false;

function note(msg) {
  notes.push(msg);
  console.log('  ' + msg);
}

function fail(msg) {
  failures.push(msg);
  console.log('  FAIL: ' + msg);
}

function finish(code) {
  if (finished) return;
  finished = true;
  console.log('');
  if (failures.length) {
    console.log('SMOKE TEST FAILED (' + failures.length + '):');
    failures.forEach((f) => console.log('  - ' + f));
  } else {
    console.log('SMOKE TEST PASSED');
  }
  const exitCode = code !== undefined ? code : failures.length ? 1 : 0;
  // Print the code we intend to exit with: tearing down Electron's windows can
  // race and surface a different one, and CI needs an unambiguous signal.
  console.log('SMOKE TEST EXIT ' + exitCode);
  // Close windows first so the app exits cleanly rather than being killed
  // mid-teardown, which can surface a spurious exit code.
  try {
    BrowserWindow.getAllWindows().forEach((w) => {
      if (!w.isDestroyed()) w.destroy();
    });
  } catch (_) {
    /* already tearing down */
  }
  setTimeout(() => app.exit(exitCode), 150);
}

const timeout = setTimeout(() => {
  fail('timed out after ' + TIMEOUT_MS + 'ms without finishing checks');
  finish(1);
}, TIMEOUT_MS);
timeout.unref?.();

console.log('Booting ' + MAIN);
require(MAIN);

app.on('browser-window-created', (_event, win) => {
  const wc = win.webContents;

  // The failure mode this test exists to catch.
  wc.on('preload-error', (_e, preloadPath, error) => {
    fail('preload failed to load: ' + preloadPath + ' -> ' + error.message);
  });
  wc.on('did-fail-load', (_e, code, desc, url) => {
    fail('page failed to load (' + code + ' ' + desc + '): ' + url);
  });
  wc.on('render-process-gone', (_e, details) => {
    fail('render process gone: ' + JSON.stringify(details));
  });

  wc.once('did-finish-load', async () => {
    if (!mainWindow) {
      mainWindow = win;
      await checkMainWindow(wc);
      return;
    }
    if (!countdownChecked) {
      countdownChecked = true;
      await checkCountdownWindow(wc);
      clearTimeout(timeout);
      finish();
    }
  });
});

async function checkMainWindow(wc) {
  console.log('\nMain window:');
  try {
    const result = await wc.executeJavaScript(
      '(() => ({' +
        ' api: typeof window.electronAPI,' +
        ' methods: window.electronAPI ? Object.keys(window.electronAPI) : [],' +
        ' rootFilled: !!(document.getElementById("root") && document.getElementById("root").children.length)' +
        '}))()'
    );

    if (result.api !== 'object') {
      fail('window.electronAPI is ' + result.api + ' (preload did not run)');
    } else {
      note('window.electronAPI exposed (' + result.methods.length + ' methods)');
      const missing = REQUIRED_API.filter((m) => !result.methods.includes(m));
      if (missing.length) {
        fail('electronAPI missing: ' + missing.join(', '));
      } else {
        note('all required bridge methods present');
      }
    }

    if (!result.rootFilled) {
      fail('#root is empty - the renderer rendered nothing');
    } else {
      note('renderer mounted into #root');
    }
  } catch (error) {
    fail('could not inspect main window: ' + error.message);
  }

  // Open the countdown window through the real IPC path, so its separate
  // preload is exercised too.
  if (failures.length) {
    clearTimeout(timeout);
    finish();
    return;
  }
  try {
    await wc.executeJavaScript(
      'window.electronAPI.openCountdownTimer(10, "Smoke test", {' +
        ' background:"#1a1a2e", text:"#eaeaea", textMuted:"#888888",' +
        ' accent:"#4a9eff", success:"#6bcf7f", danger:"#ff6b6b",' +
        ' fontFamily:"monospace", border:"#4a9eff", textScale:1 })'
    );
  } catch (error) {
    fail('openCountdownTimer threw: ' + error.message);
    clearTimeout(timeout);
    finish();
  }
}

async function checkCountdownWindow(wc) {
  console.log('\nCountdown window:');
  try {
    const result = await wc.executeJavaScript(
      '(() => ({' +
        ' api: typeof window.countdownAPI,' +
        ' setter: window.countdownAPI ? typeof window.countdownAPI.setTextScale : "missing",' +
        ' timer: (document.getElementById("timer") || {}).textContent,' +
        ' readout: (document.getElementById("sizeReadout") || {}).textContent' +
        '}))()'
    );

    if (result.api !== 'object' || result.setter !== 'function') {
      fail('countdownAPI.setTextScale unavailable (api=' + result.api + ', setter=' + result.setter + ')');
    } else {
      note('countdownAPI.setTextScale exposed');
    }

    if (!result.timer) {
      fail('countdown timer element rendered no time');
    } else {
      note('timer rendered ' + result.timer);
    }

    // Click the real button and confirm the size control responds.
    const after = await wc.executeJavaScript(
      '(() => { var b = document.getElementById("sizeUp");' +
        ' if (!b) return "no button"; b.click();' +
        ' return (document.getElementById("sizeReadout") || {}).textContent; })()'
    );
    if (after === result.readout || after === 'no button') {
      fail('text size button did not change the readout (was ' + result.readout + ', now ' + after + ')');
    } else {
      note('A+ button moved readout ' + result.readout + ' -> ' + after);
    }
  } catch (error) {
    fail('could not inspect countdown window: ' + error.message);
  }
}

app.on('window-all-closed', () => finish());
