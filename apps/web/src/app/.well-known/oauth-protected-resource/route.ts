import { NextResponse } from 'next/server'
import { getAppUrl } from '@/lib/url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// RFC 9728 — OAuth 2.0 Protected Resource Metadata.
// Tells MCP clients which authorization server protects /api/mcp.
export async function GET() {
  const url = getAppUrl()
  return NextResponse.json({
    resource: `${url}/api/mcp`,
    authorization_servers: [url],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  })
}
