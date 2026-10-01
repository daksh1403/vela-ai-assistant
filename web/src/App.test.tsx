import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('product flows', () => {
  it('opens chat and streams an answer', async () => {
    const user = userEvent.setup()
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"delta":"Hello there"}\n{"done":true}\n'))
      controller.close()
    } })
    vi.mocked(fetch).mockResolvedValue(new Response(stream, { status: 200 }))
    render(<App />)
    await user.click(screen.getByRole('button', { name: /open chat/i }))
    await user.type(await screen.findByLabelText('Message Vela'), 'Hello')
    await user.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Hello there')).toBeInTheDocument()
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('shows image generation and its result', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ image: 'iVBORw0KGgo=', mime_type: 'image/png' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(<App />)
    await user.click(screen.getByRole('button', { name: /open images/i }))
    await user.type(await screen.findByLabelText('Your idea'), 'A blue vase')
    await user.click(screen.getByRole('button', { name: /generate image/i }))
    await waitFor(() => expect(screen.getByAltText(/generated image: a blue vase/i)).toBeInTheDocument())
  })

  it('carries an overview prompt into chat without making a paid request', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByLabelText('Your starting idea'), 'Help me plan a new project')
    await user.click(screen.getByRole('button', { name: 'Continue in chat' }))
    expect(await screen.findByLabelText('Message Vela')).toHaveValue('Help me plan a new project')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('carries an inspiration prompt into the image studio', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Try prompt: Otherworldly landscapes' }))
    expect((await screen.findByLabelText('Your idea') as HTMLTextAreaElement).value).toContain('alpine landscape')
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })

  it('shows a useful microphone permission error', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) } })
    vi.stubGlobal('RTCPeerConnection', class {})
    render(<App />)
    await user.click(screen.getByRole('button', { name: /open voice/i }))
    await user.click(await screen.findByRole('button', { name: /start conversation/i }))
    expect(await screen.findByText(/Microphone permission is required/)).toBeInTheDocument()
    expect(vi.mocked(fetch)).not.toHaveBeenCalled()
  })
})
