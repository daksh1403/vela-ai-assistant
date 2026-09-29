import { FormEvent, useRef, useState } from 'react'
import { ArrowRight, Download, Image as ImageIcon, RotateCcw, Sparkles } from 'lucide-react'
import { apiFetch, errorMessage } from './api'

type ImageResult = { image: string; mime_type: 'image/png' | 'image/jpeg' | 'image/webp' }
const examples = ['A quiet reading nook at sunrise, editorial photography', 'A futuristic botanical garden, soft daylight', 'Minimal ceramic forms in cobalt and cream']

export default function ImagePage() {
  const [prompt, setPrompt] = useState('')
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
  return <section className="workspace image-workspace"><div className="page-heading"><div><span className="eyebrow">THE CANVAS</span><h2>Make an image</h2><p>Describe what you see in your mind. Vela will bring it into view.</p></div></div>
    <div className="image-layout"><div className="image-controls"><form onSubmit={submit}><label htmlFor="image-prompt" className="field-label">Your idea</label><textarea id="image-prompt" rows={6} maxLength={2000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="A sculptural lamp on a desk by a rain-streaked window, soft film grain..." disabled={busy}/><div className="field-meta"><span>Include subject, style, lighting, and mood.</span><span>{prompt.length}/2000</span></div><button className="primary-button image-submit" type="submit" disabled={!prompt.trim() || busy}><Sparkles size={17}/>{busy ? 'Creating your image…' : 'Generate image'}<ArrowRight size={17}/></button></form><div className="prompt-ideas"><div className="small-heading">NEED A STARTING POINT?</div>{examples.map(example => <button key={example} onClick={() => setPrompt(example)} disabled={busy}>{example}<ArrowRight size={15}/></button>)}</div></div>
      <div className={`image-preview ${result ? 'has-image' : ''}`} aria-live="polite">{busy ? <div className="preview-state"><div className="generating-orbit"><Sparkles size={28}/></div><h3>Making room for your idea</h3><p>Image generation can take a little while. Keep this page open.</p></div> : result ? <><img src={`data:${result.mime_type};base64,${result.image}`} alt={`Generated image: ${lastPrompt.current}`}/><div className="preview-actions"><span>Created with Vela</span><div><button onClick={() => void generate(lastPrompt.current)} title="Regenerate"><RotateCcw size={17}/><span>Regenerate</span></button><button onClick={download} title="Download image"><Download size={17}/><span>Download</span></button></div></div></> : <div className="preview-state"><span className="preview-placeholder"><ImageIcon size={35} strokeWidth={1.5}/></span><h3>Your canvas is ready.</h3><p>Write a prompt and your image will appear here.</p></div>}</div></div>
    {error && <div className="inline-error" role="alert"><span>{error}</span><button onClick={() => void generate(lastPrompt.current)} disabled={busy}><RotateCcw size={15}/> Retry</button></div>}
  </section>
}
