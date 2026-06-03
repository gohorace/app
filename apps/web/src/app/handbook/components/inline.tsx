import { ReactNode } from 'react'

// Tiny inline-markup renderer for the copy in content.ts:
//   **text** -> <strong>, *text* -> <em>.  No nesting.
export function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1] !== undefined) nodes.push(<strong key={k++}>{m[1]}</strong>)
    else nodes.push(<em key={k++}>{m[2]}</em>)
    last = re.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
