import { describe, expect, it, vi } from 'vitest'
import preview from '../src/preview.js'
const post = (path: string, body = '{}') => new Request(`https://preview.test${path}`, { method: 'POST', body })
describe('review Worker isolation', () => {
  it('labels preview HTML and health without provider credentials', async () => {
    const assets = vi.fn().mockResolvedValue(new Response('<html><head></head><body><div id="root"></div></body></html>', { headers: { 'Content-Type': 'text/html' } }))
    const env = { ASSETS: { fetch: assets } }
    const html = await preview.fetch(new Request('https://preview.test/'), env)
    expect(await html.text()).toContain('UI preview')
    expect(html.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
    const health = await preview.fetch(new Request('https://preview.test/api/v1/health/ready'), env)
    expect(await health.json()).toEqual({ status: 'ok', environment: 'preview', demo: true })
    expect(assets).toHaveBeenCalledTimes(1)
  })
  it('streams deterministic demo content and rejects live voice', async () => {
    const assets = vi.fn()
    const env = { ASSETS: { fetch: assets } }
    const chat = await preview.fetch(post('/api/v1/chat/stream'), env)
    const events = (await chat.text()).trim().split('\n').map(line => JSON.parse(line))
    expect(events.map(event => event.delta ?? '').join('')).toContain('demo response')
    expect(events.at(-1)).toEqual({ done: true })
    const voice = await preview.fetch(post('/api/v1/voice/sessions'), env)
    expect(voice.status).toBe(503)
    expect(await voice.text()).toContain('unavailable in this UI preview')
    expect(assets).not.toHaveBeenCalled()
  })
  it('uses a same-origin sample image and bounds requests', async () => {
    const assets = vi.fn().mockResolvedValue(new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } }))
    const env = { ASSETS: { fetch: assets } }
    const image = await preview.fetch(post('/api/v1/images'), env)
    expect(await image.json()).toEqual({ image: '/9j/', mime_type: 'image/jpeg' })
    expect(assets.mock.calls[0][0].url).toBe('https://preview.test/preview-example.jpg')
    expect((await preview.fetch(post('/api/v1/images', 'a'.repeat(40_001)), env)).status).toBe(413)
    expect(assets).toHaveBeenCalledTimes(1)
  })
})
