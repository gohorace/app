import { Inbox } from 'lucide-react'

export const dynamic = 'force-dynamic'

export default function DigestPage() {
  return (
    <div className="flex-1 overflow-y-auto pb-20 md:pb-0">
      <div className="p-4 md:p-8 max-w-3xl">
        <div
          className="flex flex-col items-start gap-3 rounded-xl border p-6"
          style={{
            background: '#FAF7F2',
            borderColor: 'rgba(140,123,107,0.2)',
          }}
        >
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg"
            style={{ background: 'rgba(196,98,45,0.1)' }}
          >
            <Inbox style={{ width: 18, height: 18, color: '#C4622D' }} />
          </div>
          <h1
            className="font-display"
            style={{ fontSize: 22, color: '#1A1612', letterSpacing: '-0.01em' }}
          >
            Digest
          </h1>
          <p style={{ fontSize: 14, color: '#8C7B6B', lineHeight: 1.55 }}>
            Your daily and weekly summaries will live here. Coming soon.
          </p>
        </div>
      </div>
    </div>
  )
}
