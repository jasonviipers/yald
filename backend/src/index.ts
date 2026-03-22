import { upgradeWebSocket, websocket } from 'hono/bun'
import { createApp } from './app'
import { config } from './config'

const app = createApp(upgradeWebSocket)

async function startAgentWorkerSafely(): Promise<void> {
  try {
    const { startAgentWorker } = await import('./agent')
    await startAgentWorker()
  } catch (error) {
    console.error('[agent] worker unavailable; continuing without LiveKit agent', error)
  }
}

void startAgentWorkerSafely()

export default {
  port: config.port,
  fetch: app.fetch,
  websocket
}
