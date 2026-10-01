import { lazy, Suspense, useEffect, useState } from 'react'
import { ArrowUpRight, AudioLines, ChevronRight, Command, House, Image as ImageIcon, MessageSquareText, Moon, Plus, Sparkles, Sun } from 'lucide-react'
import ErrorBoundary from './ErrorBoundary'
import HomePage from './HomePage'
const ChatPage = lazy(() => import('./ChatPage'))
const ImagePage = lazy(() => import('./ImagePage'))
const VoicePage = lazy(() => import('./VoicePage'))

export type Page = 'home' | 'chat' | 'image' | 'voice'
const items = [
  { id: 'home' as Page, label: 'Overview', icon: House },
  { id: 'chat' as Page, label: 'Chat', icon: MessageSquareText },
  { id: 'image' as Page, label: 'Images', icon: ImageIcon },
  { id: 'voice' as Page, label: 'Voice', icon: AudioLines },
]
const titles: Record<Page, string> = { home: 'Overview', chat: 'Conversation', image: 'Image studio', voice: 'Voice room' }

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [draft, setDraft] = useState('')
  const [conversationKey, setConversationKey] = useState(0)
  const [dark, setDark] = useState(() => { try { return window.localStorage?.getItem('vela-theme') !== 'light' } catch { return true } })
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#101014' : '#f5f4f9')
    try { window.localStorage?.setItem('vela-theme', dark ? 'dark' : 'light') } catch { /* Appearance stays in memory. */ }
  }, [dark])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  function navigate(next: Page, prompt = '') { setDraft(prompt); setPage(next) }
  function newChat() { setDraft(''); setConversationKey(key => key + 1); setPage('chat') }
  const themeToggle = <button className="theme-button" onClick={() => setDark(!dark)} aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}>{dark ? <Sun size={17}/> : <Moon size={17}/>}<span>{dark ? 'Light appearance' : 'Dark appearance'}</span></button>
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('home')} aria-label="Vela home"><span className="brand-mark"><Sparkles size={21} strokeWidth={1.7}/></span><span>vela<span className="brand-period">.</span></span><span className="brand-tag">STUDIO</span></button>
      <button className="sidebar-create" onClick={newChat}><Plus size={17}/> New conversation <ArrowUpRight size={15}/></button>
      <div className="sidebar-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation" className="sidebar-nav">
        {items.map(({ id, label, icon: Icon }) => <button key={id} aria-label={label} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined} className={`nav-item ${page === id ? 'active' : ''}`}><Icon size={18}/><span>{label}</span>{id === 'voice' && <span className="nav-live">LIVE</span>}<span className="nav-indicator"/></button>)}
      </nav>
      <div className="sidebar-notice"><span className="notice-icon"><Command size={16}/></span><p>A space for your<br/><strong>next big idea.</strong></p><span className="notice-orbit"/></div>
      <div className="sidebar-foot">{themeToggle}<div className="session-card"><span className="session-avatar">Y</span><div><strong>Your workspace</strong><span>Private browser session</span></div><span className={`status-dot ${online ? '' : 'offline'}`}/></div></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><button className="mobile-brand" onClick={() => navigate('home')} aria-label="Vela home"><Sparkles size={20}/> vela.</button><span className="topbar-context">Workspace <ChevronRight size={13}/><strong>{titles[page]}</strong></span><div className="topbar-right"><span className="network-status"><span className={`status-dot ${online ? '' : 'offline'}`}/>{online ? 'Network online' : 'Offline'}</span><span className="topbar-divider"/><span className="topbar-caption">MAKE SOMETHING GOOD</span><div className="mobile-theme">{themeToggle}</div></div></header>
      <main className="main-content" id="main-content" tabIndex={-1}>
        {page === 'home' && <HomePage navigate={navigate}/>}
        <ErrorBoundary key={page}><Suspense fallback={<div className="view-loading" role="status"><Sparkles size={24}/>Opening your workspace…</div>}>
          {page === 'chat' && <ChatPage key={conversationKey} initialDraft={draft}/>}
          {page === 'image' && <ImagePage initialPrompt={draft}/>}
          {page === 'voice' && <VoicePage active={page === 'voice'}/>}
        </Suspense></ErrorBoundary>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">{items.map(({ id, label, icon: Icon }) => <button key={id} aria-label={label} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined} className={page === id ? 'active' : ''}><Icon size={20}/><span>{label}</span></button>)}</nav>
    </div>
  </div>
}
