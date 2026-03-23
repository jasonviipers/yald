import { BrowserWindow } from 'electron'
import { log as _log } from './logger'

interface BrowserConsoleEntry {
  level: string
  message: string
}

// Electron 28+ passes a typed event object instead of positional args.
// Define the shape here so we don't depend on a specific @electron/types version.
interface ConsoleMessageEventParams {
  level: number // 0=verbose, 1=info, 2=warning, 3=error
  message: string
  lineNumber: number
  sourceId: string
}

const CONSOLE_LEVEL_MAP: Record<number, string> = {
  0: 'verbose',
  1: 'info',
  2: 'warning',
  3: 'error'
}

function log(message: string): void {
  _log('browser-agent', message)
}

export class BrowserAgentManager {
  private window: BrowserWindow | null = null
  private consoleBuffer: BrowserConsoleEntry[] = []

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    this.window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // Electron 28+ changed 'console-message' from positional args to a typed event object.
    // The old overload is fully removed from the type definitions, so we attach the listener
    // via the generic EventEmitter `.on(event, listener)` to avoid the TS overload error,
    // then read the new event shape at runtime.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(this.window.webContents as any).on('console-message', (event: ConsoleMessageEventParams) => {
      const level = CONSOLE_LEVEL_MAP[event.level] ?? String(event.level)
      const message = event.message ?? ''
      this.consoleBuffer.push({ level, message })
      if (this.consoleBuffer.length > 500) {
        this.consoleBuffer.shift()
      }
    })

    this.window.on('closed', () => {
      this.window = null
      this.consoleBuffer = []
    })

    return this.window
  }

  async navigate(url: string): Promise<void> {
    const win = this.ensureWindow()
    log(`navigate ${url}`)
    await new Promise<void>((resolvePromise, rejectPromise) => {
      let idleTimer: NodeJS.Timeout | null = null

      const cleanup = (): void => {
        if (idleTimer) clearTimeout(idleTimer)
        win.webContents.removeListener('did-finish-load', onFinish)
        win.webContents.removeListener('did-stop-loading', onLoading)
        win.webContents.removeListener('did-start-loading', onLoading)
      }

      const scheduleIdleCheck = (): void => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          if (!win.webContents.isLoading() && !win.webContents.isWaitingForResponse()) {
            cleanup()
            resolvePromise()
          }
        }, 500)
      }

      const onFinish = (): void => scheduleIdleCheck()
      const onLoading = (): void => scheduleIdleCheck()

      win.webContents.on('did-finish-load', onFinish)
      win.webContents.on('did-stop-loading', onLoading)
      win.webContents.on('did-start-loading', onLoading)

      void win.loadURL(url).catch((error: unknown) => {
        cleanup()
        const message = error instanceof Error ? error.message : String(error)
        rejectPromise(new Error(`Navigation failed: ${message}`))
      })
    })
  }

  async screenshot(): Promise<string> {
    const win = this.ensureWindow()
    const image = await win.webContents.capturePage()
    return image.toPNG().toString('base64')
  }

  async click(selector: string): Promise<void> {
    const script = `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!(el instanceof HTMLElement)) {
          throw new Error('Element not found: ' + ${JSON.stringify(selector)});
        }
        el.click();
      })();
    `
    try {
      await this.ensureWindow().webContents.executeJavaScript(script)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Browser click failed: ${message}`)
    }
  }

  async type(selector: string, text: string): Promise<void> {
    const script = `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!(el instanceof HTMLElement)) {
          throw new Error('Element not found: ' + ${JSON.stringify(selector)});
        }
        el.focus();
        if ('value' in el) {
          el.value = ${JSON.stringify(text)};
        } else {
          el.textContent = ${JSON.stringify(text)};
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      })();
    `
    try {
      await this.ensureWindow().webContents.executeJavaScript(script)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Browser type failed: ${message}`)
    }
  }

  async readDom(selector: string): Promise<string> {
    const script = `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        return el instanceof HTMLElement ? el.outerHTML : '';
      })();
    `
    try {
      const result = await this.ensureWindow().webContents.executeJavaScript(script)
      return typeof result === 'string' ? result : ''
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`Browser readDom failed: ${message}`)
    }
  }

  async consoleLogs(): Promise<Array<{ level: string; message: string }>> {
    const result = [...this.consoleBuffer]
    this.consoleBuffer = []
    return result
  }

  async close(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      this.window = null
      this.consoleBuffer = []
      return
    }
    const target = this.window
    this.window = null
    this.consoleBuffer = []
    target.destroy()
  }
}
