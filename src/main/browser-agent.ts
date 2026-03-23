import { BrowserWindow } from 'electron'
import { log as _log } from './logger'

interface BrowserConsoleEntry {
  level: string
  message: string
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

    this.window.webContents.on('console-message', (_event, level, message) => {
      this.consoleBuffer.push({ level: String(level), message })
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
    const window = this.ensureWindow()
    log(`navigate ${url}`)
    await new Promise<void>((resolvePromise, rejectPromise) => {
      let idleTimer: NodeJS.Timeout | null = null

      const cleanup = (): void => {
        if (idleTimer) clearTimeout(idleTimer)
        window.webContents.removeListener('did-finish-load', handleDidFinishLoad)
        window.webContents.removeListener('did-stop-loading', handleLoading)
        window.webContents.removeListener('did-start-loading', handleLoading)
      }

      const scheduleIdleCheck = (): void => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          if (!window.webContents.isLoading() && !window.webContents.isWaitingForResponse()) {
            cleanup()
            resolvePromise()
          }
        }, 500)
      }

      const handleDidFinishLoad = (): void => {
        scheduleIdleCheck()
      }

      const handleLoading = (): void => {
        scheduleIdleCheck()
      }

      window.webContents.on('did-finish-load', handleDidFinishLoad)
      window.webContents.on('did-stop-loading', handleLoading)
      window.webContents.on('did-start-loading', handleLoading)

      void window.loadURL(url).catch((error: unknown) => {
        cleanup()
        const message = error instanceof Error ? error.message : String(error)
        rejectPromise(new Error(`Navigation failed: ${message}`))
      })
    })
  }

  async screenshot(): Promise<string> {
    const window = this.ensureWindow()
    const image = await window.webContents.capturePage()
    return image.toPNG().toString('base64')
  }

  async click(selector: string): Promise<void> {
    const script = `
      (() => {
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLElement)) {
          throw new Error('Element not found for selector: ${selector}');
        }
        element.click();
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
        const element = document.querySelector(${JSON.stringify(selector)});
        if (!(element instanceof HTMLInputElement) &&
            !(element instanceof HTMLTextAreaElement) &&
            !(element instanceof HTMLElement)) {
          throw new Error('Element not found for selector: ${selector}');
        }
        if ('focus' in element) {
          element.focus();
        }
        if ('value' in element) {
          element.value = ${JSON.stringify(text)};
        } else {
          element.textContent = ${JSON.stringify(text)};
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
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
        const element = document.querySelector(${JSON.stringify(selector)});
        return element instanceof HTMLElement ? element.outerHTML : '';
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
