import { describe, expect, test } from 'bun:test'
import { buildMessages, getInboundBearerToken } from './llm'

describe('voice llm helpers', () => {
  test('buildMessages appends the new user turn', () => {
    expect(buildMessages([{ role: 'system', content: 'hi' }], 'hello')).toEqual([
      { role: 'system', content: 'hi' },
      { role: 'user', content: 'hello' }
    ])
  })

  test('extracts bearer token from authorization header', () => {
    expect(getInboundBearerToken('Bearer abc123')).toBe('abc123')
    expect(getInboundBearerToken(undefined)).toBeUndefined()
  })
})
