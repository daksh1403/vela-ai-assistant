import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, PhoneOff, RotateCcw, Sparkles, MessageSquareText } from 'lucide-react'
import { Room, RoomEvent, Track } from 'livekit-client'
import { apiFetch, errorMessage } from './api'
import Orb from './Orb'

type VoiceSession = { id: string; ws_url: string; token: string; end_token: string; max_duration_seconds: number }
type VoiceState = 'ready' | 'permission' | 'creating' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'reconnecting' | 'disconnected' | 'error'
type Turn = { who: 'You' | 'Vela'; text: string }
const labels: Record<VoiceState, string> = { ready: 'Ready when you are', permission: 'Requesting microphone', creating: 'Preparing your session', connecting: 'Connecting to Vela', listening: 'Listening', thinking: 'Vela is thinking', speaking: 'Vela is speaking', reconnecting: 'Reconnecting', disconnected: 'Session ended', error: 'Connection issue' }

export default function VoicePage({ active }: { active: boolean }) {
  const [state, setState] = useState<VoiceState>('ready')
  const [error, setError] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [seconds, setSeconds] = useState(0)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const roomRef = useRef<Room | null>(null)
  const sessionRef = useRef<VoiceSession | null>(null)
  const audioRef = useRef<HTMLElement[]>([])
  const seenSegmentsRef = useRef(new Set<string>())
  const busyRef = useRef(false)
  const generationRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const cleanup = useCallback((remote = true) => {
    generationRef.current += 1
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    void roomRef.current?.disconnect(true)
    roomRef.current?.removeAllListeners()
    roomRef.current = null
    audioRef.current.forEach(element => element.remove())
    audioRef.current = []
    const session = sessionRef.current
    sessionRef.current = null
    busyRef.current = false
    if (remote && session) {
      void apiFetch<void>(`/voice/sessions/${session.id}/end`, { end_token: session.end_token }).catch(() => {})
    }
  }, [])
  useEffect(() => () => cleanup(), [cleanup])
  useEffect(() => { if (!active) cleanup() }, [active, cleanup])

  async function start() {
    if (busyRef.current || roomRef.current) return
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setError('This browser cannot start a voice call. Use a recent Chrome, Edge, or Firefox over HTTPS.')
      setState('error'); return
    }
    busyRef.current = true
    const generation = ++generationRef.current
    seenSegmentsRef.current.clear()
    setTurns([]); setSeconds(0); setAudioBlocked(false); setError(''); setState('permission')
    let probe: MediaStream | null = null
    try {
      probe = await navigator.mediaDevices.getUserMedia({ audio: true })
      probe.getTracks().forEach(track => track.stop())
      probe = null
      if (generation !== generationRef.current) return
      setState('creating')
      const session = await apiFetch<VoiceSession>('/voice/sessions', {})
      if (generation !== generationRef.current) {
        void apiFetch<void>(`/voice/sessions/${session.id}/end`, { end_token: session.end_token }).catch(() => {})
        return
      }
      sessionRef.current = session
      setState('connecting')
      const room = new Room({ adaptiveStream: true, dynacast: true })
      roomRef.current = room
      room.on(RoomEvent.TrackSubscribed, track => {
        if (track.kind === Track.Kind.Audio) {
          const element = track.attach()
          element.setAttribute('aria-label', 'Vela voice audio')
          document.body.appendChild(element)
          audioRef.current.push(element)
        }
      })
      room.on(RoomEvent.TrackUnsubscribed, track => {
        track.detach().forEach(element => { element.remove(); audioRef.current = audioRef.current.filter(item => item !== element) })
        setState('listening')
      })
      room.on(RoomEvent.ActiveSpeakersChanged, speakers => {
        if (speakers.some(person => !person.isLocal)) setState('speaking')
        else if (speakers.some(person => person.isLocal)) setState('listening')
        else setState('listening')
      })
      room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
        for (const segment of segments) {
          if (!segment.final || !segment.text.trim() || seenSegmentsRef.current.has(segment.id)) continue
          seenSegmentsRef.current.add(segment.id)
          if (participant?.isLocal) setState('thinking')
          setTurns(current => [...current, { who: participant?.isLocal ? 'You' : 'Vela', text: segment.text }])
        }
      })
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => setAudioBlocked(!room.canPlaybackAudio))
      room.on(RoomEvent.Reconnecting, () => setState('reconnecting'))
      room.on(RoomEvent.Reconnected, () => setState('listening'))
      room.on(RoomEvent.Disconnected, () => {
        if (generation === generationRef.current) { cleanup(); setState('disconnected'); setError('Your voice session was disconnected. You can start a new one.') }
      })
      await room.connect(session.ws_url, session.token)
      if (generation !== generationRef.current) return
      await room.localParticipant.setMicrophoneEnabled(true)
      setState('listening')
      const startedAt = Date.now()
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000)
        setSeconds(elapsed)
        if (elapsed >= session.max_duration_seconds) { cleanup(); setState('disconnected') }
      }, 1000)
    } catch (cause) {
      if (generation !== generationRef.current) return
      cleanup()
      const name = cause instanceof Error ? cause.name : ''
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') setError('Microphone permission is required. Allow access in your browser settings and try again.')
      else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') setError('No microphone was found. Connect one and try again.')
      else setError(errorMessage(cause))
      setState('error')
    } finally {
      probe?.getTracks().forEach(track => track.stop())
      if (generation === generationRef.current) busyRef.current = false
    }
  }
  async function end() {
    const session = sessionRef.current
    cleanup(false)
    setState('disconnected'); setError('')
    if (session) {
      try { await apiFetch<void>(`/voice/sessions/${session.id}/end`, { end_token: session.end_token }) }
      catch { setError('Local audio stopped, but session closure was not confirmed. The session will expire automatically.') }
    }
  }
  const activeCall = ['connecting', 'listening', 'thinking', 'speaking', 'reconnecting'].includes(state)
  const loading = ['permission', 'creating', 'connecting'].includes(state)
  return <section className="workspace voice-workspace"><div className="page-heading"><div><span className="eyebrow">THINK OUT LOUD</span><h2>Talk with Vela</h2><p>Sometimes the best ideas start with a conversation.</p></div><div className="voice-time">{activeCall ? `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : 'LIVE VOICE'}</div></div>
    <div className="voice-layout"><div className={`voice-stage ${state}`}><span className="voice-stage-label"><span className="voice-label-dot"/> VOICE ROOM</span><div className={`voice-orb ${state}`}><Orb/></div><div className={`waveform voice-waveform ${activeCall ? 'is-active' : ''}`} aria-hidden="true">{Array.from({ length: 25 }, (_, i) => <span key={i}/>)}</div><div className="voice-state" role="status" aria-live="polite"><span className={`status-dot ${activeCall ? '' : 'muted'}`}/>{labels[state]}</div><p className="voice-guidance">{activeCall ? 'Speak naturally. Vela will respond when you pause.' : 'Use your microphone to have a real-time conversation.'}</p>{audioBlocked && activeCall && <button className="quiet-button" onClick={() => void roomRef.current?.startAudio().then(() => setAudioBlocked(false)).catch(() => setError('Audio playback is blocked. Check this site’s sound permission.'))}>Enable speaker audio</button>}{activeCall || loading ? <button className="end-button" onClick={() => void end()}><PhoneOff size={18}/> End conversation</button> : <button className="primary-button voice-start" onClick={() => void start()}><Mic size={18}/>{state === 'ready' ? 'Start conversation' : 'Start again'}</button>}<div className="voice-note"><MicOff size={14}/> Your microphone is used only while the session is active.</div></div>
      <div className="transcript-panel"><div className="transcript-heading"><Sparkles size={17}/><span>Conversation transcript</span><span className="transcript-badge">LIVE</span></div>{turns.length ? <div className="transcript-list" aria-live="polite">{turns.map((turn, index) => <div className="transcript-turn" key={index}><span>{turn.who}</span><p>{turn.text}</p></div>)}</div> : <div className="transcript-empty"><span className="transcript-empty-icon"><MessageSquareText size={27}/></span><h3>A place for your conversation.</h3><p>Start talking and your words will appear here when a transcript is available.</p></div>}</div></div>
    {error && <div className="inline-error" role="alert"><span>{error}</span>{state !== 'disconnected' && <button onClick={() => void start()}><RotateCcw size={15}/> Retry</button>}</div>}
  </section>
}

