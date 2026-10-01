import { memo, type ReactNode, useRef } from 'react'
import { Copy } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function CodeBlock({ children }: { children: ReactNode }) {
  const codeRef = useRef<HTMLPreElement>(null)
  return <div className="code-wrap"><button className="copy-code" onClick={() => navigator.clipboard.writeText(codeRef.current?.textContent ?? '')} aria-label="Copy code"><Copy size={14}/></button><pre ref={codeRef}>{children}</pre></div>
}
const components = {
  a: ({ children, href }: { children?: ReactNode; href?: string }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  code: ({ children, className }: { children?: ReactNode; className?: string }) => <code className={className}>{children}</code>,
  pre: ({ children }: { children?: ReactNode }) => <CodeBlock>{children}</CodeBlock>,
}
const plugins = [remarkGfm]
export default memo(function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={plugins} components={components}>{children}</ReactMarkdown>
})
