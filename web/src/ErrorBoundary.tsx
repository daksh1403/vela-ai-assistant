import { Component, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State { return { failed: true } }
  componentDidCatch() {
    // Do not log component details: they may contain private prompt text.
  }
  render() {
    if (this.state.failed) return <div className="view-loading" role="alert"><h2>This view needs a fresh start.</h2><p>Reload the page to continue.</p><button className="primary-button" onClick={() => location.reload()}>Reload Vela</button></div>
    return this.props.children
  }
}
