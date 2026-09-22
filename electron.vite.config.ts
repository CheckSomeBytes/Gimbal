import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

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
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    }
  }
})
