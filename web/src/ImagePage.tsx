import { FormEvent, useRef, useState } from 'react'
import { ArrowRight, Download, Image as ImageIcon, RotateCcw, Sparkles } from 'lucide-react'
import { apiFetch, errorMessage } from './api'
import { inspiration } from './creative'

type ImageResult = { image: string; mime_type: 'image/png' | 'image/jpeg' | 'image/webp' }
const examples = ['A quiet reading nook at sunrise, editorial photography', 'A futuristic botanical garden, soft daylight', 'Minimal ceramic forms in cobalt and cream']

export default function ImagePage({ initialPrompt = '' }: { initialPrompt?: string }) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [result, setResult] = useState<ImageResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)
  const lastPrompt = useRef('')
  async function generate(value: string) {
    if (!value.trim() || busyRef.current) return
    busyRef.current = true; setBusy(true); setError(''); setResult(null)
    lastPrompt.current = value.trim()
    try { setResult(await apiFetch<ImageResult>('/images', { prompt: value.trim() })) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { busyRef.current = false; setBusy(false) }
  }
  function submit(event: FormEvent) { event.preventDefault(); void generate(prompt) }
  function download() {
    if (!result) return
    const link = document.createElement('a')
    link.href = `data:${result.mime_type};base64,${result.image}`
    link.download = `vela-image.${result.mime_type.split('/')[1]}`
    link.click()
  }
  return <section className="workspace image-workspace"><div className="page-heading"><div><span className="eyebrow">FROM YOUR MIND TO THE CANVAS</span><h2>Image studio</h2><p>A few words. A world that didn’t exist before.</p></div></div>
    <div className="image-layout"><div className="image-controls"><div className="controls-heading"><span className="card-icon"><Sparkles size={18}/></span><div><strong>Let’s make something</strong><span>Start with a picture in your head.</span></div></div><form onSubmit={submit}><label htmlFor="image-prompt" className="field-label">Your idea</label><textarea id="image-prompt" rows={6} maxLength={2000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="A sculptural lamp on a desk by a rain-streaked window, soft film grain..." disabled={busy}/><div className="field-meta"><span>Include subject, style, lighting, and mood.</span><span>{prompt.length}/2000</span></div><button className="primary-button image-submit" type="submit" disabled={!prompt.trim() || busy}><Sparkles size={17}/>{busy ? 'Creating your image…' : 'Generate image'}<ArrowRight size={17}/></button></form><div className="prompt-ideas"><div className="small-heading">BORROW A LITTLE INSPIRATION</div>{examples.map(example => <button key={example} onClick={() => setPrompt(example)} disabled={busy}>{example}<ArrowRight size={15}/></button>)}</div><div className="prompt-thumbnails">{inspiration.map(item => <button key={item.title} onClick={() => setPrompt(item.prompt)} disabled={busy} aria-label={`Use prompt: ${item.title}`}><img src={item.image} alt=""/><span>{item.category}</span></button>)}</div></div>
      <div className={`image-preview ${result ? 'has-image' : ''}`} aria-live="polite">{busy ? <div className="preview-state"><div className="generating-orbit"><Sparkles size={28}/></div><h3>Making room for your idea</h3><p>Image generation can take a little while. Keep this page open.</p></div> : result ? <><img src={`data:${result.mime_type};base64,${result.image}`} alt={`Generated image: ${lastPrompt.current}`}/><div className="preview-actions"><span>Created with Vela</span><div><button onClick={() => void generate(lastPrompt.current)} title="Regenerate"><RotateCcw size={17}/><span>Regenerate</span></button><button onClick={download} title="Download image"><Download size={17}/><span>Download</span></button></div></div></> : <div className="preview-state canvas-empty"><div className="canvas-art" aria-hidden="true"><span className="canvas-frame frame-back"/><span className="canvas-frame frame-front"><span className="canvas-sun"/><span className="canvas-hill"/><ImageIcon size={25}/></span><span className="canvas-spark">✦</span></div><span className="eyebrow">AN OPEN CANVAS</span><h3>Give your imagination a view.</h3><p>Describe your idea on the left.<br/>We’ll meet you here with an image.</p><span className="preview-pill"><Sparkles size={12}/> One prompt. Endless directions.</span></div>}</div></div>
    {error && <div className="inline-error" role="alert"><span>{error}</span><button onClick={() => void generate(lastPrompt.current)} disabled={busy}><RotateCcw size={15}/> Retry</button></div>}
  </section>
}
