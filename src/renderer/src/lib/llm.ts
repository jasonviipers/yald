import { DEFAULT_BACKEND_URL } from '@shared/backend-url'

export interface ModelOption {
  id: string
  label: string
}

export interface OllamaConfig {
  apiKey?: string
  baseUrl?: string
}

export const OLLAMA_BASE_URL = DEFAULT_BACKEND_URL

export const AVAILABLE_MODELS: ModelOption[] = [
  { id: 'minimax-m2.7', label: 'MiniMax M2.7' },
  { id: 'nemotron-3-super', label: 'Nemotron 3 Super' },
  { id: 'qwen3.5:397b', label: 'Qwen 3.5' },
  { id: 'qwen3-coder-next', label: 'Qwen3 Coder Next' },
  { id: 'qwen3-vl:235b-instruct', label: 'Qwen3 VL' },
  { id: 'devstral-small-2:24b', label: 'Devstral Small 2' },
  { id: 'ministral-3:14b', label: 'Ministral 3' },
  { id: 'minimax-m2.5', label: 'MiniMax M2.5' },
  { id: 'glm-5', label: 'GLM-5' },
  { id: 'qwen3-next:80b', label: 'Qwen3 Next' },
  { id: 'rnj-1:8b', label: 'rnj-1' },
  { id: 'kimi-k2.5', label: 'Kimi K2.5' },
  { id: 'nemotron-3-nano:30b', label: 'Nemotron 3 Nano' },
  { id: 'devstral-2:123b', label: 'Devstral 2' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
  { id: 'cogito-2.1:671b', label: 'Cogito 2.1' },
  { id: 'glm-4.7', label: 'GLM-4.7' },
  { id: 'minimax-m2', label: 'MiniMax M2' },
  { id: 'glm-4.6', label: 'GLM-4.6' },
  { id: 'deepseek-v3.2', label: 'DeepSeek V3.2' },
  { id: 'minimax-m2.1', label: 'MiniMax M2.1' },
  { id: 'kimi-k2-thinking', label: 'Kimi K2 Thinking' },
  { id: 'mistral-large-3:675b', label: 'Mistral Large 3' },
  { id: 'kimi-k2:1t', label: 'Kimi K2' },
  { id: 'gpt-oss:120b', label: 'GPT OSS' },
  { id: 'qwen3-coder:480b', label: 'Qwen3 Coder' },
  { id: 'deepseek-v3.1:671b', label: 'DeepSeek V3.1' },
  { id: 'gemma3:27b', label: 'Gemma 3' }
]
