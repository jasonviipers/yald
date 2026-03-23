import { useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'

export function usePipelineEvents(): void {
  const handlePipelineStage = useSessionStore((state) => state.handlePipelineStage)
  const handlePipelineLog = useSessionStore((state) => state.handlePipelineLog)
  const handleSandboxReady = useSessionStore((state) => state.handleSandboxReady)
  const handlePipelineComplete = useSessionStore((state) => state.handlePipelineComplete)
  const handlePipelineError = useSessionStore((state) => state.handlePipelineError)

  useEffect(() => {
    const unsubStage = window.yald.onPipelineStage((tabId, stage) => {
      handlePipelineStage(tabId, stage)
    })
    const unsubLog = window.yald.onPipelineLog((tabId, line) => {
      handlePipelineLog(tabId, line)
    })
    const unsubSandboxReady = window.yald.onSandboxReady((tabId, url) => {
      handleSandboxReady(tabId, url)
    })
    const unsubComplete = window.yald.onPipelineComplete((tabId, summary) => {
      handlePipelineComplete(tabId, summary)
    })
    const unsubError = window.yald.onPipelineError((tabId, error) => {
      handlePipelineError(tabId, error)
    })

    return () => {
      unsubStage()
      unsubLog()
      unsubSandboxReady()
      unsubComplete()
      unsubError()
    }
  }, [
    handlePipelineComplete,
    handlePipelineError,
    handlePipelineLog,
    handlePipelineStage,
    handleSandboxReady
  ])
}
