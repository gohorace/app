import { describe, it, expect } from 'vitest'
import {
  projectContactSource,
  ingestionMethodsForSource,
  composeAddress,
  mapContact,
  mapProperty,
  mapRelationship,
  type ContactRow,
  type PropertyRow,
  type EngagementRow,
} from './mappers'

describe('projectContactSource', () => {
  it('maps internal ingestion methods to the public enum', () => {
    expect(projectContactSource('api')).toBe('api')
    expect(projectContactSource('crm_sync_rex')).toBe('crm_sync')
    expect(projectContactSource('crm_sync_vaultre')).toBe('crm_sync')
    expect(projectContactSource('manual')).toBe('manual')
    expect(projectContactSource('csv_import')).toBe('manual')
    expect(projectContactSource('inspection_capture')).toBe('doorstep_buyer_enquiry')
    expect(projectContactSource('embed_capture')).toBe('doorstep_buyer_enquiry')
    expect(projectContactSource('portal_enquiry')).toBe('doorstep_buyer_enquiry')
  })
  it('falls back to manual for null/unknown', () => {
    expect(projectContactSource(null)).toBe('manual')
    expect(projectContactSource('something_new')).toBe('manual')
  })
})

describe('ingestionMethodsForSource', () => {
  it('is the reverse of the projection', () => {
    expect(ingestionMethodsForSource('crm_sync')).toContain('crm_sync_rex')
    expect(ingestionMethodsForSource('manual')).toEqual(['manual', 'csv_import'])
    expect(ingestionMethodsForSource('doorstep_buyer_enquiry')).toContain('embed_capture')
    // No producing path yet → matches nothing.
    expect(ingestionMethodsForSource('doorstep_appraisal_request')).toEqual([])
  })
})

describe('composeAddress', () => {
  it('builds the full display string from structured parts', () => {
    const row: PropertyRow = {
      id: 'x',
      gnaf_address_detail_pid: 'GAQLD1',
      street_number: '42',
      street_name: 'Maple Street',
      suburb: 'Paddington',
      state: 'QLD',
      postcode: '4064',
      created_at: 't',
    }
    expect(composeAddress(row)).toEqual({
      full: '42 Maple Street, Paddington QLD 4064',
      street: '42 Maple Street',
      suburb: 'Paddington',
      state: 'QLD',
      postcode: '4064',
    })
  })
  it('tolerates missing parts', () => {
    const row: PropertyRow = {
      id: 'x',
      gnaf_address_detail_pid: null,
      street_number: null,
      street_name: 'Maple Street',
      suburb: null,
      state: null,
      postcode: null,
      created_at: 't',
    }
    const a = composeAddress(row)
    expect(a.street).toBe('Maple Street')
    expect(a.full).toBe('Maple Street')
    expect(a.suburb).toBeNull()
  })
})

describe('mapContact', () => {
  it('projects shape, lowercases email, filters external_ids', () => {
    const row: ContactRow = {
      id: '11111111-2222-4333-8444-555566667777',
      email: 'Sarah.Chen@Example.com',
      phone: '+61400123456',
      first_name: 'Sarah',
      last_name: 'Chen',
      source: 'website',
      ingestion_method: 'embed_capture',
      external_ids: { rex: 'rex_99', bad: 123 },
      created_at: 'c',
      updated_at: 'u',
    }
    const out = mapContact(row)
    expect(out.id.startsWith('con_')).toBe(true)
    expect(out.email).toBe('sarah.chen@example.com')
    expect(out.source).toBe('doorstep_buyer_enquiry')
    expect(out.external_ids).toEqual({ rex: 'rex_99' }) // non-string dropped
    // Internal-only fields never leak.
    expect(out).not.toHaveProperty('ingestion_method')
    expect(out).not.toHaveProperty('workspace_id')
    expect(out).not.toHaveProperty('score')
  })
})

describe('mapProperty / mapRelationship', () => {
  it('maps property with prefixed id + gnaf_id', () => {
    const out = mapProperty({
      id: '11111111-2222-4333-8444-555566667777',
      gnaf_address_detail_pid: 'GAQLD157395421',
      street_number: '42',
      street_name: 'Maple Street',
      suburb: 'Paddington',
      state: 'QLD',
      postcode: '4064',
      created_at: 'c',
    })
    expect(out.id.startsWith('prp_')).toBe(true)
    expect(out.gnaf_id).toBe('GAQLD157395421')
    expect(out.address.full).toContain('Paddington')
  })
  it('maps relationship with all ids prefixed', () => {
    const row: EngagementRow = {
      id: '11111111-1111-4111-8111-111111111111',
      contact_id: '22222222-2222-4222-8222-222222222222',
      property_id: '33333333-3333-4333-8333-333333333333',
      type: 'website_engagement',
      first_engaged_at: 'f',
      last_engaged_at: 'l',
      engagement_count: 7,
    }
    const out = mapRelationship(row)
    expect(out.id.startsWith('rel_')).toBe(true)
    expect(out.contact_id.startsWith('con_')).toBe(true)
    expect(out.property_id.startsWith('prp_')).toBe(true)
    expect(out.engagement_count).toBe(7)
  })
})
