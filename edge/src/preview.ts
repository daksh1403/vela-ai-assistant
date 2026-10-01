/** Review-only Worker. It has no provider key and never calls the production API. */
interface PreviewEnv { ASSETS: { fetch(request: Request): Promise<Response> } }
const banner = '<aside class="vela-preview-banner" aria-label="Preview notice">UI preview · Chat and images use demo responses. Live voice is available on the production site.</aside>'
const headers = { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store', 'X-Vela-Preview': 'demo' }
function json(body: unknown, status = 200) { return Response.json(body, { status, headers }) }
export default {
  async fetch(request: Request, env: PreviewEnv): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/__preview.css') return new Response('.vela-preview-banner{position:sticky;top:0;z-index:100;padding:9px 18px;text-align:center;background:#202020;color:#f5f5f5;font:11px/1.6 system-ui,sans-serif;border-bottom:1px solid #383838} @media(max-width:600px){.vela-preview-banner{font-size:9px;padding:7px 13px}}', { headers: { ...headers, 'Content-Type': 'text/css' } })
    if (path === '/api/v1/health/live' || path === '/api/v1/health/ready') return json({ status: 'ok', environment: 'preview', demo: true })
    if (path.startsWith('/api/')) {
      if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'This preview route expects POST.' } }, 405)
      // Reject large bodies before reading; the review API accepts no private credentials.
      const reader = request.body?.getReader()
      let bytes = 0
      if (reader) {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          bytes += chunk.value.byteLength
          if (bytes > 40_000) { await reader.cancel(); return json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Your preview request is too large.' } }, 413) }
        }
      }
      if (path === '/api/v1/chat/stream') {
        const answer = '**A little curiosity goes a long way.**\n\nThis is a demo response for reviewing Vela’s conversation layout. On the live site, Vela responds to your prompt.\n\nTry an idea from a few angles:\n\n- Start with what you want to make.\n- Describe what would make it useful.\n- Pick one small step to begin.\n\n```text\nAn idea → a conversation → something worth making\n```'
        const encoder = new TextEncoder()
        const chunks = answer.match(/.{1,35}/gs) ?? []
        let index = 0
        const stream = new ReadableStream({
          async pull(controller) {
            if (index < chunks.length) {
              await new Promise(resolve => setTimeout(resolve, 65))
              controller.enqueue(encoder.encode(JSON.stringify({ delta: chunks[index++] }) + '\n'))
            } else { controller.enqueue(encoder.encode('{"done":true}\n')); controller.close() }
          },
        })
        return new Response(stream, { headers: { ...headers, 'Content-Type': 'application/x-ndjson' } })
      }
      if (path === '/api/v1/images') {
        // A fixed photograph exercises preview/download states without a paid generation.
        const sample = await env.ASSETS.fetch(new Request(new URL('/preview-example.jpg', request.url)))
        if (!sample.ok || !sample.headers.get('Content-Type')?.startsWith('image/jpeg')) return json({ error: { code: 'PREVIEW_ASSET_MISSING', message: 'The preview example image could not be loaded.' } }, 503)
        const data = new Uint8Array(await sample.arrayBuffer())
        let binary = ''
        for (const byte of data) binary += String.fromCharCode(byte)
        return json({ image: btoa(binary), mime_type: 'image/jpeg' })
      }
      return json({ error: { code: 'PREVIEW_ONLY', message: 'Live voice is unavailable in this UI preview. Review the voice room layout here and use the production site for a real conversation.' } }, 503)
    }
    const response = await env.ASSETS.fetch(request)
    const nextHeaders = new Headers(response.headers)
    for (const [name, value] of Object.entries(headers)) nextHeaders.set(name, value)
    if (response.headers.get('Content-Type')?.includes('text/html')) {
      nextHeaders.delete('Content-Length')
      nextHeaders.delete('ETag')
      const html = (await response.text()).replace('<head>', '<head><link rel="stylesheet" href="/__preview.css">').replace('<body>', `<body>${banner}`)
      return new Response(html, { status: response.status, headers: nextHeaders })
    }
    return new Response(response.body, { status: response.status, headers: nextHeaders })
  },
}
