import { describe, expect, it, vi } from 'vitest'
import { createHandler, type Config } from '../src/service.js'

const env: Config = { CALLMISSED_API_KEY: 'test-key', APP_ENV: 'test' }
const post = (path: string, body: unknown) => new Request(`https://vela.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

function setup(fetcher: typeof fetch) {
  return createHandler({ fetcher, limit: async () => true })
}

describe('edge API contract', () => {
  it('serves liveness and readiness without exposing configuration', async () => {
    const handler = setup(vi.fn())
    expect((await handler(new Request('https://vela.test/api/v1/health/live'), env)).status).toBe(200)
    const ready = await handler(new Request('https://vela.test/api/v1/health/ready'), env)
    expect(ready.status).toBe(200)
    expect(await ready.text()).not.toContain('test-key')
  })

  it('sends multi-turn chat server side and maps provider errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'Hello' } }] }), { status: 200 })).mockResolvedValueOnce(new Response('', { status: 429 }))
    const handler = setup(fetcher)
    const body = { messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Continue' }] }
    const result = await handler(post('/api/v1/chat', body), env)
    expect(await result.json()).toEqual({ answer: 'Hello' })
    expect(JSON.parse(fetcher.mock.calls[0][1].body).messages).toHaveLength(3)
    const failed = await handler(post('/api/v1/chat', body), env)
    expect(failed.status).toBe(429)
    expect((await failed.json() as { error: { code: string } }).error.code).toBe('UPSTREAM_RATE_LIMIT')
  })

  it('streams chat chunks as NDJSON', async () => {
    const upstream = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n'
    const handler = setup(vi.fn().mockResolvedValue(new Response(upstream)))
    const response = await handler(post('/api/v1/chat/stream', { messages: [{ role: 'user', content: 'Hi' }] }), env)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('{"done":true}')
  })

  it('validates image results, input and rate limits', async () => {
    const image = 'iVBORw0KGgo='
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: image }] })))
    const handler = createHandler({ fetcher, limit: async (_ip, operation) => operation !== 'chat' })
    const result = await handler(post('/api/v1/images', { prompt: 'A blue vase' }), env)
    expect((await result.json() as { mime_type: string }).mime_type).toBe('image/png')
    expect((await handler(post('/api/v1/images', { prompt: ' ' }), env)).status).toBe(422)
    expect((await handler(post('/api/v1/chat', { messages: [{ role: 'user', content: 'Hi' }] }), env)).status).toBe(429)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('issues voice credentials but never returns the permanent key', async () => {
    const id = '7c2b9e30-1d8a-4c5f-9b3d-2f4a6e8b1c2d'
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id, ws_url: 'wss://voice.test', token: 'temporary' }), { status: 201 })).mockResolvedValueOnce(new Response(null, { status: 204 }))
    const handler = setup(fetcher)
    const created = await handler(post('/api/v1/voice/sessions', {}), env)
    const session = await created.json() as { id: string; end_token: string }
    expect(JSON.stringify(session)).not.toContain('test-key')
    expect((await handler(post(`/api/v1/voice/sessions/${id}/end`, { end_token: '0'.repeat(64) }), env)).status).toBe(403)
    expect((await handler(post(`/api/v1/voice/sessions/${id}/end`, { end_token: session.end_token }), env)).status).toBe(204)
  })

  it('handles malformed provider data and timeouts safely', async () => {
    const bad = setup(vi.fn().mockResolvedValue(new Response('{"data":[]}')))
    const malformed = await bad(post('/api/v1/images', { prompt: 'A blue vase' }), env)
    expect((await malformed.json() as { error: { code: string } }).error.code).toBe('UPSTREAM_MALFORMED')
    const timeout = setup(vi.fn().mockRejectedValue(new Error('network down')))
    const unavailable = await timeout(post('/api/v1/images', { prompt: 'A blue vase' }), env)
    expect(unavailable.status).toBe(503)
  })
})
