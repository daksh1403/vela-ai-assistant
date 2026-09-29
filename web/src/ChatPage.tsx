import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react'
import { ArrowUp, Copy, MessageSquareText, Plus, RotateCcw, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChatMessage, errorMessage, streamChat } from './api'

function CodeBlock({ children }: { children: ReactNode }) {
  const codeRef = useRef<HTMLPreElement>(null)
  return <div className="code-wrap"><button className="copy-code" onClick={() => navigator.clipboard.writeText(codeRef.current?.textContent ?? '')} aria-label="Copy code"><Copy size={14}/></button><pre ref={codeRef}>{children}</pre></div>
}

function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
    code: ({ children, className }) => <code className={className}>{children}</code>,
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  }}>{children}</ReactMarkdown>
}

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const busyRef = useRef(false)
  const generationRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldStickRef = useRef(true)
  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => { if (shouldStickRef.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [messages])

  async function send(text: string, history = messages) {
    if (!text.trim() || busyRef.current) return
    busyRef.current = true
    const generation = ++generationRef.current
    setLoading(true)
    setError('')
    const next: ChatMessage[] = [...history.filter(message => !message.failed), { role: 'user', content: text.trim() }]
    setMessages([...next, { role: 'assistant', content: '' }])
    setDraft('')
    shouldStickRef.current = true
    const abort = new AbortController()
    abortRef.current = abort
    let reply = ''
    try {
      await streamChat(next, abort.signal, delta => {
        if (generation !== generationRef.current) return
        reply += delta
        setMessages([...next, { role: 'assistant', content: reply }])
      })
      if (!reply.trim()) throw new Error('empty response')
    } catch (cause) {
      if (!abort.signal.aborted && generation === generationRef.current) {
        setMessages([...next, { role: 'assistant', content: reply || 'Response interrupted.', failed: true }])
        setError(reply ? 'The answer stopped early. You can retry this message.' : errorMessage(cause))
      }
    } finally {
      if (generation === generationRef.current) {
        busyRef.current = false
        setLoading(false)
        abortRef.current = null
      }
    }
  }
  function reset() { generationRef.current += 1; abortRef.current?.abort(); abortRef.current = null; busyRef.current = false; setLoading(false); setMessages([]); setError(''); setDraft('') }
  function submit(event: FormEvent) { event.preventDefault(); void send(draft) }
  function retry() {
    const lastUser = [...messages].reverse().find(message => message.role === 'user')
    if (!lastUser) return
    const history = messages.slice(0, messages.lastIndexOf(lastUser))
    void send(lastUser.content, history)
  }
  return <section className="workspace chat-workspace">
    <div className="page-heading"><div><span className="eyebrow">THE CONVERSATION</span><h2>Chat with Vela</h2><p>Follow a thought wherever it goes.</p></div><button className="quiet-button" onClick={reset}><Plus size={17}/> New conversation</button></div>
    <div className="chat-panel" ref={scrollRef} onScroll={event => { const el = event.currentTarget; shouldStickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120 }} aria-live="polite">
      {messages.length === 0 ? <div className="chat-empty"><span className="empty-symbol"><MessageSquareText size={29}/></span><h3>A good question starts here.</h3><p>Ask for an explanation, a fresh perspective, or help shaping an idea.</p><div className="suggestions">{['Explain a complex idea simply', 'Help me draft a thoughtful email', 'Brainstorm a weekend project'].map(suggestion => <button key={suggestion} onClick={() => void send(suggestion)}>{suggestion}<ArrowUp size={14}/></button>)}</div></div> : <div className="message-list">{messages.map((message, index) => <div className={`message-row ${message.role}`} key={index}><div className="message-avatar">{message.role === 'assistant' ? <Sparkles size={15}/> : 'Y'}</div><div className="message-body"><span className="message-name">{message.role === 'assistant' ? 'Vela' : 'You'}</span>{message.content ? <div className="markdown"><Markdown>{message.content}</Markdown></div> : <div className="typing"><span/><span/><span/></div>}</div></div>)}</div>}
    </div>
    {error && <div className="inline-error" role="alert"><span>{error}</span><button onClick={retry} disabled={loading}><RotateCcw size={15}/> Retry</button></div>}
    <form className="composer" onSubmit={submit}><label htmlFor="chat-input" className="sr-only">Message Vela</label><textarea id="chat-input" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (draft.trim()) void send(draft) } }} maxLength={8000} rows={2} placeholder="Ask Vela anything..." disabled={loading}/><button type="submit" className="send-button" disabled={!draft.trim() || loading} aria-label="Send message"><ArrowUp size={19}/></button><div className="composer-hint">{loading ? 'Vela is writing…' : 'Enter to send · Shift+Enter for a new line'}</div></form>
  </section>
}
