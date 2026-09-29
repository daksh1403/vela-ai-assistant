export interface Config {
  CALLMISSED_API_KEY: string
  CALLMISSED_BASE_URL?: string
  CHAT_MODEL?: string
  IMAGE_MODEL?: string
  VOICE_NAME?: string
  VOICE_LANGUAGE?: string
  VOICE_MAX_DURATION_SECONDS?: string
  APP_ENV?: string
  RATE_GATE?: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
}

type Dependencies = { fetcher?: typeof fetch; limit?: (client: string, operation: string, maximum: number) => Promise<boolean>; now?: () => number }
type ErrorBody = { error: { code: string; message: string; request_id: string } }
const MAX_BODY = 40_000
const SYSTEM_PROMPT = 'You are Vela. Speak naturally and keep responses brief.'
const encoder = new TextEncoder()

class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

function reply(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })
}

function errorResponse(error: unknown, requestId: string): Response {
  const issue = error instanceof AppError ? error : new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred.')
  return reply({ error: { code: issue.code, message: issue.message, request_id: requestId } } satisfies ErrorBody, issue.status)
}

function upstreamError(status: number): AppError {
  if (status === 429) return new AppError(429, 'UPSTREAM_RATE_LIMIT', 'The AI service is busy. Try again shortly.')
  if (status === 401 || status === 402 || status === 403) return new AppError(503, 'PROVIDER_CONFIGURATION', 'AI service is unavailable right now.')
  if (status < 500) return new AppError(502, 'UPSTREAM_REJECTED', 'The AI service could not process this request.')
  return new AppError(503, 'UPSTREAM_UNAVAILABLE', 'AI service is temporarily unavailable.')
}

async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].toLowerCase() !== 'application/json') {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send JSON with Content-Type: application/json.')
  }
  const reader = request.body?.getReader()
  if (!reader) throw new AppError(400, 'INVALID_INPUT', 'A JSON body is required.')
  let total = 0
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_BODY) { await reader.cancel(); throw new AppError(413, 'REQUEST_TOO_LARGE', 'The request is too large.') }
    chunks.push(value)
  }
  try {
    const joined = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder().decode(joined)) as unknown
  } catch {
    throw new AppError(422, 'INVALID_INPUT', 'Check the supplied fields and try again.')
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(422, 'INVALID_INPUT', 'Check the supplied fields and try again.')
  return value as Record<string, unknown>
}

function chatMessages(value: unknown): { role: 'user' | 'assistant'; content: string }[] {
  const messages = record(value).messages
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 30) throw new AppError(422, 'INVALID_INPUT', 'Send between 1 and 30 messages.')
  let total = 0
  const result = messages.map(item => {
    const row = record(item)
    if ((row.role !== 'user' && row.role !== 'assistant') || typeof row.content !== 'string' || !row.content.trim() || row.content.length > 8000) throw new AppError(422, 'INVALID_INPUT', 'A message is empty or too long.')
    total += row.content.length
    return { role: row.role as 'user' | 'assistant', content: row.content }
  })
  if (total > 30_000 || result.at(-1)?.role !== 'user') throw new AppError(422, 'INVALID_INPUT', 'Conversation is too long or has no new user message.')
  return result
}

function promptFrom(value: unknown): string {
  const prompt = record(value).prompt
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) throw new AppError(422, 'INVALID_INPUT', 'Enter a prompt up to 2,000 characters.')
  return prompt.trim()
}

function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }

async function sign(key: string, sessionId: string): Promise<string> {
  const imported = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(sessionId)))
  return Array.from(signature, item => item.toString(16).padStart(2, '0')).join('')
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index++) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return mismatch === 0
}

function config(env: Config) {
  if (!env.CALLMISSED_API_KEY || env.CALLMISSED_API_KEY.startsWith('replace-')) throw new AppError(503, 'NOT_READY', 'AI service is not configured.')
  const base = (env.CALLMISSED_BASE_URL ?? 'https://api.callmissed.com/v1').replace(/\/$/, '')
  if (!base.startsWith('https://')) throw new AppError(503, 'NOT_READY', 'AI service is not configured.')
  return {
    base,
    chatModel: env.CHAT_MODEL ?? 'sarvam-105b-conversations',
    imageModel: env.IMAGE_MODEL ?? 'sdxl-lightning',
    voice: env.VOICE_NAME ?? 'shubh',
    language: env.VOICE_LANGUAGE ?? 'en-IN',
    duration: Math.max(30, Math.min(3600, Number(env.VOICE_MAX_DURATION_SECONDS ?? 300))),
  }
}

async function callProvider(env: Config, path: string, method: string, body: unknown, timeout: number, fetcher: typeof fetch): Promise<Response> {
  const cfg = config(env)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const response = await fetcher(`${cfg.base}/${path}`, {
      method, headers: { Authorization: `Bearer ${env.CALLMISSED_API_KEY}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal,
    })
    if (!response.ok) { clearTimeout(timer); throw upstreamError(response.status) }
    if (!response.body) { clearTimeout(timer); return response }
    const reader = response.body.getReader()
    const stream = new ReadableStream<Uint8Array>({
      async pull(sink) {
        try {
          const { value, done } = await reader.read()
          if (done) { clearTimeout(timer); sink.close() }
          else sink.enqueue(value)
        } catch (cause) { clearTimeout(timer); sink.error(cause) }
      },
      async cancel() { clearTimeout(timer); await reader.cancel() },
    })
    return new Response(stream, { status: response.status, headers: response.headers })
  } catch (cause) {
    clearTimeout(timer)
    if (cause instanceof AppError) throw cause
    if (controller.signal.aborted) throw new AppError(504, 'UPSTREAM_TIMEOUT', 'The AI service took too long to respond.')
    throw new AppError(503, 'UPSTREAM_UNAVAILABLE', 'AI service is temporarily unavailable.')
  }
}

async function checkedJson(response: Response): Promise<Record<string, unknown>> {
  try { return record(await response.json()) }
  catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw new AppError(504, 'UPSTREAM_TIMEOUT', 'The AI service took too long to respond.')
    throw new AppError(502, 'UPSTREAM_MALFORMED', 'The AI service returned an invalid response.')
  }
}

async function rateLimit(request: Request, env: Config, operation: string, maximum: number, deps: Dependencies): Promise<void> {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'
  const allowed = deps.limit ? await deps.limit(ip, operation, maximum) : env.RATE_GATE ?
    (await env.RATE_GATE.get(env.RATE_GATE.idFromName(ip)).fetch(new Request(`https://rate.internal/check?operation=${operation}&limit=${maximum}`))).ok : true
  if (!allowed) throw new AppError(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.')
}

function ndjsonStream(upstream: Response): ReadableStream<Uint8Array> {
  const reader = upstream.body?.getReader()
  if (!reader) throw new AppError(502, 'UPSTREAM_MALFORMED', 'The AI service returned an empty response.')
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) {
            if (!finished) controller.enqueue(encoder.encode(JSON.stringify({ error: 'The response ended early. Please retry.' }) + '\n'))
            controller.close(); return
          }
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const data = line.slice(6).trim()
            if (data === '[DONE]') { finished = true; controller.enqueue(encoder.encode('{"done":true}\n')); controller.close(); await reader.cancel(); return }
            try {
              const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; error?: unknown }
              if (parsed.error) { controller.enqueue(encoder.encode('{"error":"The AI service stopped responding."}\n')); controller.close(); await reader.cancel(); return }
              const delta = parsed.choices?.[0]?.delta?.content
              if (typeof delta === 'string' && delta) controller.enqueue(encoder.encode(JSON.stringify({ delta }) + '\n'))
            } catch { /* Ignore malformed provider events; fail if stream never completes. */ }
          }
          if (controller.desiredSize !== null && controller.desiredSize <= 0) return
        }
      } catch {
        controller.enqueue(encoder.encode('{"error":"The AI service connection was interrupted."}\n'))
        controller.close()
      }
    },
    async cancel() { await reader.cancel() },
  })
}

export function createHandler(deps: Dependencies = {}) {
  const fetcher = deps.fetcher ?? fetch
  const now = deps.now ?? Date.now
  return async (request: Request, env: Config): Promise<Response> => {
    const started = now()
    const supplied = request.headers.get('x-request-id') ?? ''
    const requestId = /^[A-Za-z0-9]{1,64}$/.test(supplied) ? supplied : crypto.randomUUID().replaceAll('-', '')
    const url = new URL(request.url)
    const path = url.pathname
    let status = 500
    let operation = 'none'
    try {
      let response: Response
      if (request.method === 'GET' && path === '/api/v1/health/live') response = reply({ status: 'ok', service: 'vela-edge', version: '0.1.0', environment: env.APP_ENV ?? 'production' })
      else if (request.method === 'GET' && path === '/api/v1/health/ready') { config(env); response = reply({ status: 'ok', service: 'vela-edge', version: '0.1.0', environment: env.APP_ENV ?? 'production' }) }
      else if (request.method === 'POST' && (path === '/api/v1/chat' || path === '/api/v1/chat/stream')) {
        operation = 'chat'
        const messages = chatMessages(await readJson(request))
        await rateLimit(request, env, 'chat', 12, deps)
        const streaming = path.endsWith('/stream')
        const upstream = await callProvider(env, 'chat/completions', 'POST', { model: config(env).chatModel, messages, stream: streaming, max_tokens: 1200 }, 45_000, fetcher)
        if (streaming) response = new Response(ndjsonStream(upstream), { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
        else {
          const data = await checkedJson(upstream)
          const content = (data.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content
          if (typeof content !== 'string' || !content.trim()) throw new AppError(502, 'UPSTREAM_MALFORMED', 'The AI service returned an invalid response.')
          response = reply({ answer: content })
        }
      } else if (request.method === 'POST' && path === '/api/v1/images') {
        operation = 'image'
        const prompt = promptFrom(await readJson(request))
        await rateLimit(request, env, 'image', 3, deps)
        const upstream = await callProvider(env, 'images/generations', 'POST', { model: config(env).imageModel, prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }, 120_000, fetcher)
        const data = await checkedJson(upstream)
        const image = (data.data as { b64_json?: unknown }[] | undefined)?.[0]?.b64_json
        if (typeof image !== 'string' || image.length > 28_000_000 || !/^(iVBOR|\/9j\/|UklGR)/.test(image)) throw new AppError(502, 'UPSTREAM_MALFORMED', 'The AI service returned an invalid image.')
        const mime_type = image.startsWith('iVBOR') ? 'image/png' : image.startsWith('/9j/') ? 'image/jpeg' : 'image/webp'
        response = reply({ image, mime_type })
      } else if (request.method === 'POST' && path === '/api/v1/voice/sessions') {
        operation = 'voice_create'
        if (Object.keys(record(await readJson(request))).length) throw new AppError(422, 'INVALID_INPUT', 'Voice configuration cannot be changed here.')
        await rateLimit(request, env, 'voice', 2, deps)
        const cfg = config(env)
        const upstream = await callProvider(env, 'voice/sessions', 'POST', { system_prompt: SYSTEM_PROMPT, greeting: "Hello, I'm Vela. What would you like to explore?", voice: cfg.voice, language: cfg.language, max_duration_seconds: cfg.duration }, 45_000, fetcher)
        const data = await checkedJson(upstream)
        if (typeof data.id !== 'string' || !uuid(data.id) || typeof data.ws_url !== 'string' || !data.ws_url.startsWith('wss://') || typeof data.token !== 'string' || !data.token) throw new AppError(502, 'UPSTREAM_MALFORMED', 'The AI service returned an invalid voice session.')
        response = reply({ id: data.id, ws_url: data.ws_url, token: data.token, end_token: await sign(env.CALLMISSED_API_KEY, data.id), max_duration_seconds: cfg.duration })
      } else {
        const match = path.match(/^\/api\/v1\/voice\/sessions\/([^/]+)\/(end|transcript)$/)
        if (request.method !== 'POST' || !match || !uuid(match[1])) throw new AppError(404, 'NOT_FOUND', 'This endpoint was not found.')
        operation = match[2] === 'end' ? 'voice_end' : 'voice_transcript'
        const body = record(await readJson(request))
        if (typeof body.end_token !== 'string' || !safeEqual(body.end_token, await sign(env.CALLMISSED_API_KEY, match[1]))) throw new AppError(403, 'INVALID_SESSION', 'This voice session is unavailable.')
        const suffix = match[2] === 'end' ? '' : '/transcript?format=json'
        const upstream = await callProvider(env, `voice/sessions/${match[1]}${suffix}`, match[2] === 'end' ? 'DELETE' : 'GET', undefined, 10_000, fetcher)
        if (match[2] === 'end') response = new Response(null, { status: 204 })
        else {
          const rows = await upstream.json() as unknown
          if (!Array.isArray(rows)) throw new AppError(502, 'UPSTREAM_MALFORMED', 'The AI service returned an invalid transcript.')
          response = reply({ turns: rows.filter(row => row && typeof row === 'object').slice(0, 100).map(row => ({ user: String(row.user_transcript ?? ''), agent: String(row.agent_response ?? '') })) })
        }
      }
      status = response.status
      response.headers.set('X-Request-ID', requestId)
      response.headers.set('Cache-Control', 'no-store')
      response.headers.set('X-Content-Type-Options', 'nosniff')
      response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
      return response
    } catch (cause) {
      const response = errorResponse(cause, requestId)
      status = response.status
      response.headers.set('X-Request-ID', requestId)
      response.headers.set('Cache-Control', 'no-store')
      return response
    } finally {
      console.log(JSON.stringify({ timestamp: new Date().toISOString(), severity: status >= 500 ? 'error' : 'info', message: 'http_request', request_id: requestId, route: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/i, ':id'), method: request.method, status, latency_ms: now() - started, operation }))
    }
  }
}
