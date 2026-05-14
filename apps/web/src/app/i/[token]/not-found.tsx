/**
 * HOR-151 — Public capture 404.
 *
 * Renders when /i/[token] calls notFound() (invalid token, soft-deleted
 * inspection, cancelled inspection). Deliberately generic — no Horace
 * voice, no reveal of why the link doesn't work, no link back into the
 * dashboard. Same aesthetic as the capture page so a prospect with a
 * stale link doesn't feel they've fallen off the agent's surface.
 */

export default function CaptureNotFound() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        background: '#FAF7F2',
        padding: '40px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-body, system-ui)',
        color: '#3D332B',
      }}
    >
      <div style={{ maxWidth: 360, textAlign: 'center' }}>
        <h1
          className="font-display"
          style={{ fontSize: 22, fontWeight: 500, marginBottom: 10 }}
        >
          This open home isn&rsquo;t accepting sign-ins.
        </h1>
        <p style={{ fontSize: 14, color: '#5E5246' }}>
          Have a chat to the agent for the right link.
        </p>
      </div>
    </main>
  )
}
