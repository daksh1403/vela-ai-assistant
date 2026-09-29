export type ApiError = { error: { code: string; message: string; request_id?: string } }

export class RequestError extends Error {
  constructor(message: string, public requestId?: string, public status?: number) {
    super(message)
  }
}

export async function apiFetch<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      cache: 'no-store',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new RequestError('Connection lost. Check your network and try again.')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null) as ApiError | null
    throw new RequestError(data?.error?.message ?? 'Something went wrong. Please try again.', data?.error?.request_id, response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export function errorMessage(error: unknown): string {
  if (error instanceof RequestError) return `${error.message}${error.requestId ? ` · Ref ${error.requestId.slice(0, 8)}` : ''}`
  return 'Something went wrong. Please try again.'
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string; failed?: boolean }

export async function streamChat(
  messages: ChatMessage[],
  signal: AbortSignal,
  onDelta: (delta: string) => void,
): Promise<void> {
  let response: Response
  try {
    response = await fetch('/api/v1/chat/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.map(({ role, content }) => ({ role, content })) }),
      signal, cache: 'no-store',
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new RequestError('Connection lost. Check your network and try again.')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null) as ApiError | null
    throw new RequestError(data?.error?.message ?? 'The AI service is unavailable.', data?.error?.request_id, response.status)
  }
  if (!response.body) throw new RequestError('The response stream could not start.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as { delta?: string; done?: boolean; error?: string }
        if (event.error) throw new RequestError(event.error)
        if (event.delta) onDelta(event.delta)
        if (event.done) finished = true
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (!finished) throw new RequestError('The response ended early. Please retry.')
}
