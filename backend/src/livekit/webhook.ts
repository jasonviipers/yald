import { WebhookReceiver, type WebhookEvent } from 'livekit-server-sdk'
import { config } from '../config'

const receiver = new WebhookReceiver(config.livekit.apiKey, config.livekit.apiSecret)

export async function verifyAndParse(body: string, authHeader?: string): Promise<WebhookEvent> {
  return await receiver.receive(body, authHeader)
}
