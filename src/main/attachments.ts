import { readFile } from 'fs/promises'
import type { Attachment, ProviderContext } from '../shared/types'

const DEFAULT_VISION_MODEL = 'qwen3-vl:235b-instruct'

const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export interface ModelImageAttachment {
  attachmentId: string
  base64Data: string
  mediaType: string
  name: string
}

export interface ResolvedModelAttachments {
  images: ModelImageAttachment[]
  promptPrefix: string
}

function isLikelyVisionCapableModel(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return (
    normalized.includes('vl') ||
    normalized.includes('vision') ||
    normalized.includes('gemma3') ||
    normalized.includes('gemini') ||
    normalized.includes('llava')
  )
}

function parseDataUrl(dataUrl: string): { base64Data: string; mediaType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim())
  if (!match) return null
  return {
    mediaType: match[1],
    base64Data: match[2]
  }
}

function buildPromptPrefix(
  attachments: Attachment[],
  imageNames: string[],
  imageIds: string[]
): string {
  const supportedImageIds = new Set(imageIds)
  const unsupportedItems = attachments.filter((attachment) => {
    if (attachment.type !== 'image') return true
    return !supportedImageIds.has(attachment.id)
  })

  const sections: string[] = []

  if (imageNames.length > 0) {
    sections.push(`Attached images: ${imageNames.join(', ')}`)
  }

  if (unsupportedItems.length > 0) {
    sections.push(
      ['Attached files:', ...unsupportedItems.map((attachment) => `- ${attachment.path}`)].join(
        '\n'
      )
    )
  }

  return sections.join('\n\n')
}

async function loadImageAttachment(attachment: Attachment): Promise<ModelImageAttachment | null> {
  if (attachment.type !== 'image') return null

  const parsedDataUrl = attachment.dataUrl ? parseDataUrl(attachment.dataUrl) : null
  const mediaType = parsedDataUrl?.mediaType || attachment.mimeType || 'image/png'

  if (!SUPPORTED_IMAGE_MIME_TYPES.has(mediaType)) {
    return null
  }

  if (parsedDataUrl) {
    return {
      attachmentId: attachment.id,
      base64Data: parsedDataUrl.base64Data,
      mediaType,
      name: attachment.name
    }
  }

  if (!attachment.path) return null

  try {
    const fileBuffer = await readFile(attachment.path)
    return {
      attachmentId: attachment.id,
      base64Data: fileBuffer.toString('base64'),
      mediaType,
      name: attachment.name
    }
  } catch {
    return null
  }
}

export async function resolveModelAttachments(
  attachments: Attachment[] | undefined
): Promise<ResolvedModelAttachments> {
  const safeAttachments = Array.isArray(attachments) ? attachments : []
  const images = (
    await Promise.all(safeAttachments.map((attachment) => loadImageAttachment(attachment)))
  ).filter((attachment): attachment is ModelImageAttachment => attachment !== null)

  return {
    images,
    promptPrefix: buildPromptPrefix(
      safeAttachments,
      images.map((image) => image.name),
      images.map((image) => image.attachmentId)
    )
  }
}

export function resolveProviderForAttachments(
  provider: ProviderContext,
  attachments: Attachment[] | undefined
): ProviderContext {
  const hasImageAttachment = Array.isArray(attachments)
    ? attachments.some((attachment) => attachment.type === 'image')
    : false

  if (!hasImageAttachment || isLikelyVisionCapableModel(provider.model)) {
    return provider
  }

  return {
    ...provider,
    model: DEFAULT_VISION_MODEL
  }
}
