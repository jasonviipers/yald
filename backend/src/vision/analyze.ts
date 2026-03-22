import type { VisionAnalyzeRequest, VisionAnalyzeResponse } from '../types'
import { requestProviderChat } from '../voice/llm'

const DEFAULT_VISION_MODEL = 'qwen3-vl:235b-instruct'

const VISION_RESPONSE_SCHEMA = {
  type: 'object',
  required: ['summary', 'guidance', 'confidence', 'suggestedAction', 'model'],
  properties: {
    summary: {
      type: 'string',
      description: 'A short description of what changed or what matters on screen right now.'
    },
    guidance: {
      type: 'string',
      description: 'A short actionable recommendation for the user right now.'
    },
    confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high']
    },
    suggestedAction: {
      type: 'string',
      enum: [
        'none',
        'create_tab',
        'toggle_settings',
        'toggle_voice',
        'hide_window',
        'move_left',
        'move_right',
        'move_up',
        'move_down'
      ]
    },
    actionReason: {
      type: 'string',
      description: 'Why the suggested action would help. Leave empty if no action is needed.'
    },
    model: {
      type: 'string',
      description: 'The model that produced this response.'
    }
  }
} as const

function resolveVisionModel(model: string): string {
  const normalized = model.trim().toLowerCase()
  if (normalized.includes('vl') || normalized.includes('vision') || normalized.includes('gemma3')) {
    return model
  }
  return DEFAULT_VISION_MODEL
}

function extractMessageContent(payload: Record<string, unknown>): string {
  const message = payload.message
  if (!message || typeof message !== 'object') {
    throw new Error('Vision response did not include a message')
  }

  const content = (message as { content?: unknown }).content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Vision response content was empty')
  }

  return content
}

function parseVisionResponse(content: string, model: string): VisionAnalyzeResponse {
  const parsed = JSON.parse(content) as Partial<VisionAnalyzeResponse>
  const summary = parsed.summary?.trim()
  const guidance = parsed.guidance?.trim()
  if (!summary || !guidance) {
    throw new Error('Vision response was missing summary or guidance')
  }

  return {
    summary,
    guidance,
    confidence:
      parsed.confidence === 'low' || parsed.confidence === 'high' ? parsed.confidence : 'medium',
    suggestedAction: parsed.suggestedAction || 'none',
    actionReason: parsed.actionReason?.trim() || undefined,
    model: parsed.model?.trim() || model
  }
}

function buildPrompt(request: VisionAnalyzeRequest): string {
  const previousSummary = request.previousSummary?.trim()
  const customPrompt = request.prompt?.trim()

  const sections = [
    'You are a realtime vision copilot embedded inside an Electron desktop app.',
    'Look only at the provided application screenshot.',
    'Return concise feedback that helps the user understand what is happening and what to do next.',
    'Prefer stability: if the screenshot has not materially changed, keep the summary and guidance close to the previous observation.',
    'Only suggest an action when a visible UI state strongly indicates that one of the allowed app actions would help.',
    'Allowed actions: none, create_tab, toggle_settings, toggle_voice, hide_window, move_left, move_right, move_up, move_down.',
    'Do not invent hidden state. Base the response only on visible UI.'
  ]

  if (previousSummary) {
    sections.push(`Previous summary: ${previousSummary}`)
  }

  if (customPrompt) {
    sections.push(`Extra instruction: ${customPrompt}`)
  }

  sections.push(
    'Focus on blockers, obvious errors, active tasks, and the single best next step. Keep both summary and guidance to one or two short sentences.'
  )

  return sections.join('\n')
}

export async function analyzeVisionScreenshot(
  request: VisionAnalyzeRequest
): Promise<VisionAnalyzeResponse> {
  const model = resolveVisionModel(request.provider.model)
  const provider = {
    ...request.provider,
    model
  }

  const payload = await requestProviderChat(provider, {
    model,
    stream: false,
    format: VISION_RESPONSE_SCHEMA,
    messages: [
      {
        role: 'system',
        content: buildPrompt(request)
      },
      {
        role: 'user',
        content: 'Analyze the current application state and return structured JSON.',
        images: [request.screenshotBase64]
      }
    ]
  })

  return parseVisionResponse(extractMessageContent(payload), model)
}
