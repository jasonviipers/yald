export const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8787'

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

export function isOllamaCloudUrl(value: string | null | undefined): boolean {
  const candidate = value?.trim()
  if (!candidate) return false

  try {
    const parsed = new URL(candidate)
    return parsed.hostname === 'ollama.com' || parsed.hostname.endsWith('.ollama.com')
  } catch {
    return false
  }
}

export function resolveBackendUrl(
  configuredBaseUrl?: string | null,
  envBackendUrl?: string | null
): string {
  const configured = configuredBaseUrl?.trim()
  if (configured && !isOllamaCloudUrl(configured)) {
    return trimTrailingSlash(configured)
  }

  const envValue = envBackendUrl?.trim()
  if (envValue && !isOllamaCloudUrl(envValue)) {
    return trimTrailingSlash(envValue)
  }

  return DEFAULT_BACKEND_URL
}
