import { AccessToken } from 'livekit-server-sdk'
import { config } from '../config'
import type { LiveKitTokenRequest, LiveKitTokenResponse } from '../types'

export function validateTokenRequest(body: LiveKitTokenRequest): LiveKitTokenRequest {
  const identity = body.identity?.trim()
  const roomName = body.roomName?.trim()

  if (!identity) {
    throw new Error('identity is required')
  }
  if (!roomName) {
    throw new Error('roomName is required')
  }

  return {
    identity,
    roomName,
    metadata: body.metadata?.trim() || undefined
  }
}

export async function createToken(body: LiveKitTokenRequest): Promise<LiveKitTokenResponse> {
  const request = validateTokenRequest(body)
  const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: request.identity,
    metadata: request.metadata,
    ttl: config.livekit.tokenTtl
  })

  token.addGrant({
    room: request.roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true
  })

  return {
    token: await token.toJwt(),
    url: config.livekit.url
  }
}
