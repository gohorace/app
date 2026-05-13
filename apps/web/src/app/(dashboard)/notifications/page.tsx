import { Bell } from 'lucide-react'

export const dynamic = 'force-dynamic'

// HOR-123 — V1 stub. Will become the dispatcher view that surfaces every
// Worth-watching? + Newly-known prompt in one place. The dispatcher itself
// is deferred (see HOR-122 deferred list).
export default function NotificationsPage() {
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
            <Bell style={{ width: 18, height: 18, color: '#C4622D' }} />
          </div>
          <h1
            className="font-display"
            style={{ fontSize: 22, color: '#1A1612', letterSpacing: '-0.01em' }}
          >
            Notifications
          </h1>
          <p style={{ fontSize: 14, color: '#8C7B6B', lineHeight: 1.55 }}>
            Every prompt Horace surfaces will land here — Worth-watching properties,
            Newly-known contacts, and the rest. The dispatcher is coming together;
            check back soon.
          </p>
        </div>
      </div>
    </div>
  )
}
