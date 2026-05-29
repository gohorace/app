import { describe, it, expect } from 'vitest'
import { formatConnectionRequest } from './slack'

const base = {
  agencyName: 'Acme Realty',
  agencyId: 'ws-123',
  agentName: 'Sarah Chen',
  agentEmail: 'sarah@acme.example',
  crm: 'Rex',
}

describe('formatConnectionRequest', () => {
  it('includes everything the team needs to action it', () => {
    const msg = formatConnectionRequest({ ...base, inbound: true, outbound: true })
    expect(msg).toContain('New connection request')
    expect(msg).toContain('Acme Realty')
    expect(msg).toContain('ws-123')
    expect(msg).toContain('Sarah Chen')
    expect(msg).toContain('sarah@acme.example')
    expect(msg).toContain('Rex')
  })

  it('renders intent from the direction flags', () => {
    expect(formatConnectionRequest({ ...base, inbound: true, outbound: true })).toContain(
      'Contacts in + Doorstep leads out',
    )
    expect(formatConnectionRequest({ ...base, inbound: true, outbound: false })).toContain(
      'Pull contacts in',
    )
    expect(formatConnectionRequest({ ...base, inbound: false, outbound: true })).toContain(
      'Send Doorstep leads out',
    )
  })
})
