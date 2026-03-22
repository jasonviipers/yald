import { ElectronAPI } from '@electron-toolkit/preload'
import type { yaldAPI } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: unknown
    yald: yaldAPI
  }
}
