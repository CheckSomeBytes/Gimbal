import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import type { Plugin } from 'vite'

// Content-Security-Policy for the built renderer: only the app's own scripts
// run, and the only remote content is the Google Fonts stylesheet. Build-only,
// because the dev server injects an inline React Refresh script that this
// policy would block.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'gimbal-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`
      )
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/main/main.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          preload: resolve(__dirname, 'src/preload/preload.ts'),
          countdownPreload: resolve(__dirname, 'src/preload/countdownPreload.ts')
        },
        // Preloads run sandboxed: require() resolves only Electron's
        // built-ins, never a relative file. If two entries share an import
        // Rollup hoists it into chunks/, and the preload then dies with
        // "module not found" - which leaves window.electronAPI undefined and
        // the window blank. Emit each entry as its own self-contained file
        // and never split. countdownPreload.ts deliberately avoids importing
        // anything shared so there is nothing to hoist.
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          manualChunks: undefined
        },
        preserveEntrySignatures: 'strict'
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [react(), contentSecurityPolicy()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
})
