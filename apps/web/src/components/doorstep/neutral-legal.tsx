/**
 * HOR-282: neutral, Horace-free legal pages for the onthedoorstep.app host.
 *
 * The brand invariant: a prospect (often a researching vendor) must never
 * encounter the Horace name, brand, or voice on any Doorstep surface. The
 * marketing /privacy page is Horace-branded, so these standalone variants
 * render instead when the request host is the neutral Doorstep host. Plain,
 * utility-grade, self-contained styling — no shared marketing chrome.
 *
 * Contact mailboxes (privacy@ / hello@onthedoorstep.app) must be
 * provisioned for the domain — flagged as a config action in the HOR-282
 * handoff.
 */

const PRIVACY_EMAIL = 'privacy@onthedoorstep.app'
const GENERAL_EMAIL = 'hello@onthedoorstep.app'

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main
      style={{
        maxWidth: '40rem',
        margin: '0 auto',
        padding: '3rem 1.25rem 4rem',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        color: '#1a1a1a',
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>{title}</h1>
      <p style={{ color: '#6b6b6b', fontSize: '0.875rem', marginTop: 0 }}>Last updated: 21 May 2026</p>
      {children}
    </main>
  )
}

export function DoorstepPrivacy() {
  return (
    <Shell title="Privacy">
      <p>
        Doorstep is a sign-in service that real-estate agents use to collect contact details — at an
        open home, or through a form on their own website.
      </p>
      <h2 style={{ fontSize: '1.125rem', marginTop: '2rem' }}>What we collect</h2>
      <p>
        The name and mobile number you enter, and a device identifier so the agent can recognise you
        if you visit again. We don&apos;t ask for anything else, and we don&apos;t verify your number.
      </p>
      <h2 style={{ fontSize: '1.125rem', marginTop: '2rem' }}>Why we collect it</h2>
      <p>So the agent running the sign-in can follow up with you. That&apos;s the only purpose.</p>
      <h2 style={{ fontSize: '1.125rem', marginTop: '2rem' }}>Who gets it</h2>
      <p>
        The agent who created the sign-in, and the tools they use to manage their contacts. We
        don&apos;t sell your details or use them for advertising.
      </p>
      <h2 style={{ fontSize: '1.125rem', marginTop: '2rem' }}>Where it&apos;s held</h2>
      <p>
        Your data is stored on servers in Australia and encrypted in transit and at rest. We handle
        it in line with the Australian Privacy Principles under the <em>Privacy Act 1988</em> (Cth).
      </p>
      <h2 style={{ fontSize: '1.125rem', marginTop: '2rem' }}>Your choices</h2>
      <p>
        You can ask us what we hold about you, correct it, or have it deleted. Email{' '}
        <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> and we&apos;ll respond within 30 days.
      </p>
      <p style={{ marginTop: '2rem', color: '#6b6b6b', fontSize: '0.875rem' }}>
        Questions? <a href="/contact">Contact us</a>.
      </p>
    </Shell>
  )
}

export function DoorstepContact() {
  return (
    <Shell title="Contact">
      <p>Doorstep is a sign-in service for real-estate agents.</p>
      <p>
        If you signed in at an open home or on an agent&apos;s website and want your details
        accessed, corrected, or removed, email{' '}
        <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> and we&apos;ll take care of it.
      </p>
      <p>
        For anything else, reach us at <a href={`mailto:${GENERAL_EMAIL}`}>{GENERAL_EMAIL}</a>.
      </p>
      <p style={{ marginTop: '2rem', color: '#6b6b6b', fontSize: '0.875rem' }}>
        See our <a href="/privacy">privacy policy</a>.
      </p>
    </Shell>
  )
}
