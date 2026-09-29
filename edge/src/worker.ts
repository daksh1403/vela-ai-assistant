import { createHandler, type Config } from './service.js'

interface WorkerEnv extends Config {
  RATE_GATE: { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
}

const handler = createHandler()

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return handler(request, env)
  },
}

export class RateGate {
  constructor(private state: { storage: { get<T>(key: string): Promise<T | undefined>; put(key: string, value: number[]): Promise<void> } }) {}
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const operation = url.searchParams.get('operation') ?? ''
    const limit = Number(url.searchParams.get('limit') ?? 0)
    if (!['chat', 'image', 'voice'].includes(operation) || !Number.isInteger(limit) || limit < 1 || limit > 100) return new Response(null, { status: 400 })
    const now = Date.now()
    const previous = (await this.state.storage.get<number[]>(operation)) ?? []
    const recent = previous.filter(timestamp => timestamp > now - 60_000)
    if (recent.length >= limit) return new Response(null, { status: 429 })
    recent.push(now)
    await this.state.storage.put(operation, recent)
    return new Response(null, { status: 204 })
  }
}
