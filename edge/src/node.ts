import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { createHandler, type Config } from './service.js'

const env: Config = {
  CALLMISSED_API_KEY: process.env.CALLMISSED_API_KEY ?? '',
  CALLMISSED_BASE_URL: process.env.CALLMISSED_BASE_URL,
  CHAT_MODEL: process.env.CHAT_MODEL,
  IMAGE_MODEL: process.env.IMAGE_MODEL,
  VOICE_NAME: process.env.VOICE_NAME,
  VOICE_LANGUAGE: process.env.VOICE_LANGUAGE,
  VOICE_MAX_DURATION_SECONDS: process.env.VOICE_MAX_DURATION_SECONDS,
  APP_ENV: process.env.APP_ENV ?? 'development',
}

const counts = new Map<string, number[]>()
const handler = createHandler({ limit: async (ip, operation, maximum) => {
  const key = `${ip}:${operation}`
  const now = Date.now()
  const recent = (counts.get(key) ?? []).filter(timestamp => timestamp > now - 60_000)
  if (recent.length >= maximum) return false
  recent.push(now)
  counts.set(key, recent)
  if (counts.size > 10_000) for (const [entry, times] of counts) if (times.at(-1)! < now - 60_000) counts.delete(entry)
  return true
} })

const server = createServer(async (req, res) => {
  try {
    const url = `http://localhost:${process.env.PORT ?? 8000}${req.url ?? '/'}`
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    const request = new Request(url, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' } as RequestInit)
    const response = await handler(request, env)
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()))
    if (response.body) Readable.fromWeb(response.body as import('node:stream/web').ReadableStream).pipe(res)
    else res.end()
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end('{"error":{"code":"INTERNAL_ERROR","message":"An unexpected error occurred."}}')
  }
})

server.listen(Number(process.env.PORT ?? 8000), '0.0.0.0')
const shutdown = () => server.close(() => process.exit(0))
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
