import { describe, expect, test } from 'bun:test'
import { validateTokenRequest } from './token'

describe('validateTokenRequest', () => {
  test('rejects blank identity', () => {
    expect(() =>
      validateTokenRequest({
        identity: '   ',
        roomName: 'room'
      })
    ).toThrow('identity is required')
  })

  test('rejects blank room name', () => {
    expect(() =>
      validateTokenRequest({
        identity: 'user',
        roomName: '   '
      })
    ).toThrow('roomName is required')
  })
})
