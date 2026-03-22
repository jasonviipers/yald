import { useEffect, useRef } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import type { NormalizedEvent } from '@shared/types'

export function useClaudeEvents() {
  const handleNormalizedEvent = useSessionStore((state) => state.handleNormalizedEvent)
  const handleStatusChange = useSessionStore((state) => state.handleStatusChange)
  const handleError = useSessionStore((state) => state.handleError)

  const chunkBufferRef = useRef<Map<string, string>>(new Map())
  const rafIdRef = useRef<number>(0)

  useEffect(() => {
    const flushChunks = () => {
      rafIdRef.current = 0
      const buffer = chunkBufferRef.current
      if (buffer.size === 0) return

      for (const [tabId, text] of buffer) {
        handleNormalizedEvent(tabId, { type: 'text_chunk', text } as NormalizedEvent)
      }
      buffer.clear()
    }

    const unsubEvent = window.yald.onEvent((tabId, event) => {
      if (event.type === 'text_chunk') {
        const buffer = chunkBufferRef.current
        const existing = buffer.get(tabId) || ''
        buffer.set(tabId, existing + (event as any).text)

        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(flushChunks)
        }
        return
      }

      if ((event.type === 'task_update' || event.type === 'task_complete') && rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        flushChunks()
      }

      handleNormalizedEvent(tabId, event)
    })

    const unsubStatus = window.yald.onTabStatusChange((tabId, newStatus, oldStatus) => {
      handleStatusChange(tabId, newStatus, oldStatus)
    })

    const unsubError = window.yald.onError((tabId, error) => {
      handleError(tabId, error)
    })

    return () => {
      unsubEvent()
      unsubStatus()
      unsubError()
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      chunkBufferRef.current.clear()
    }
  }, [handleError, handleNormalizedEvent, handleStatusChange])
}
