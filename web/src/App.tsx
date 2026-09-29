import { lazy, Suspense, useEffect, useState } from 'react'
import { ArrowRight, AudioLines, Image as ImageIcon, MessageSquareText, Moon, Sun, Sparkles } from 'lucide-react'
import ErrorBoundary from './ErrorBoundary'
const ChatPage = lazy(() => import('./ChatPage'))
const ImagePage = lazy(() => import('./ImagePage'))
const VoicePage = lazy(() => import('./VoicePage'))

type Page = 'home' | 'chat' | 'image' | 'voice'
const items = [
  { id: 'chat' as Page, label: 'Chat', icon: MessageSquareText, description: 'Think out loud, ask anything, and keep the conversation going.' },
  { id: 'image' as Page, label: 'Images', icon: ImageIcon, description: 'Turn a clear idea into a visual you can save and share.' },
  { id: 'voice' as Page, label: 'Voice', icon: AudioLines, description: 'Speak naturally with an assistant that can listen and respond.' },
]

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [dark, setDark] = useState(() => { try { return window.localStorage?.getItem('vela-theme') === 'dark' } catch { return false } })
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try { window.localStorage?.setItem('vela-theme', dark ? 'dark' : 'light') } catch { /* Appearance stays in memory. */ }
  }, [dark])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])
  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => setPage('home')} aria-label="Vela home"><span className="brand-mark"><Sparkles size={19} strokeWidth={2.1}/></span><span>vela<span className="brand-period">.</span></span></button>
      <div className="sidebar-label">WORKSPACE</div>
      <nav aria-label="Main navigation" className="sidebar-nav">
        {items.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setPage(id)} aria-current={page === id ? 'page' : undefined} className={`nav-item ${page === id ? 'active' : ''}`}><Icon size={18}/><span>{label}</span><ArrowRight size={15} className="nav-arrow"/></button>)}
      </nav>
      <div className="sidebar-foot"><div className="status-line"><span className={`status-dot ${online ? '' : 'offline'}`}/>{online ? 'Network online' : 'You are offline'}</div><button className="theme-button" onClick={() => setDark(!dark)} aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`}>{dark ? <Sun size={17}/> : <Moon size={17}/>}<span>{dark ? 'Light mode' : 'Dark mode'}</span></button></div>
    </aside>
    <div className="main-column">
      <header className="topbar"><button className="mobile-brand" onClick={() => setPage('home')}><span className="brand-mark"><Sparkles size={16}/></span>vela<span className="brand-period">.</span></button><span className="topbar-context">{page === 'home' ? 'Your creative workspace' : items.find(item => item.id === page)?.label}</span><span className="topbar-right"><span className={`status-dot ${online ? '' : 'offline'}`}/>{online ? 'Online' : 'Offline'}</span></header>
      <main className="main-content">
        {page === 'home' && <section className="home-view"><div className="hero-kicker"><span className="kicker-line"/> ONE ASSISTANT · THREE WAYS TO EXPLORE</div><h1>Ideas move<br/><em>better together.</em></h1><p className="hero-copy">A quiet space to ask, imagine, and speak. Choose the way you want to begin.</p><div className="feature-grid">{items.map(({ id, label, icon: Icon, description }, index) => <button className="feature-card" key={id} onClick={() => setPage(id)}><span className="card-number">0{index + 1} / 03</span><span className="card-icon"><Icon size={24} strokeWidth={1.7}/></span><span className="card-title">{label}</span><span className="card-copy">{description}</span><span className="card-link">Open {label.toLowerCase()} <ArrowRight size={17}/></span></button>)}</div><div className="home-note"><span className="home-note-star">✳</span> Your conversation stays in this browser session. Start fresh whenever you like.</div></section>}
        <ErrorBoundary key={page}><Suspense fallback={<div className="view-loading" role="status">Opening your workspace…</div>}>
          {page === 'chat' && <ChatPage />}
          {page === 'image' && <ImagePage />}
          {page === 'voice' && <VoicePage active={page === 'voice'} />}
        </Suspense></ErrorBoundary>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">{items.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setPage(id)} aria-current={page === id ? 'page' : undefined} className={page === id ? 'active' : ''}><Icon size={20}/><span>{label}</span></button>)}</nav>
    </div>
  </div>
}
