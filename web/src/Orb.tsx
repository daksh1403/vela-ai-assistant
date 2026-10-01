/** Vela's luminous ribbon orb. CSS animation keeps the visual lightweight. */
export default function Orb({ className = '' }: { className?: string }) {
  return <div className={`vela-orb ${className}`} aria-hidden="true">
    <div className="orb-halo" />
    <div className="orb-body"><span className="orb-ribbon ribbon-one"/><span className="orb-ribbon ribbon-two"/><span className="orb-ribbon ribbon-three"/><span className="orb-core"/></div>
    <div className="orb-ring"/>
  </div>
}
