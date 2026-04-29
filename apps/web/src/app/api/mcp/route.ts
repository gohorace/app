import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/mcp/auth'
import { TOOLS, TOOL_BY_NAME } from '@/lib/mcp/tools'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MCP_PROTOCOL_VERSION = '2025-06-18'
const SERVER_INFO = { name: 'horace', version: '0.1.0' }

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string; data?: unknown } }

function rpcError(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data !== undefined ? { data } : {}) } }
}

function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

export async function POST(req: NextRequest) {
  const ctx = await authenticateRequest(req)
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let msg: JsonRpcRequest
  try {
    msg = (await req.json()) as JsonRpcRequest
  } catch {
    return NextResponse.json(rpcError(null, -32700, 'Parse error'), { status: 400 })
  }

  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return NextResponse.json(rpcError(msg.id ?? null, -32600, 'Invalid Request'), { status: 400 })
  }

  // Notifications have no id and expect no response.
  const isNotification = msg.id === undefined || msg.id === null
  const id = msg.id ?? null

  try {
    switch (msg.method) {
      case 'initialize': {
        const result = {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        }
        return NextResponse.json(rpcResult(id, result))
      }

      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'notifications/progress': {
        return new NextResponse(null, { status: 202 })
      }

      case 'ping': {
        return NextResponse.json(rpcResult(id, {}))
      }

      case 'tools/list': {
        const tools = TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }))
        return NextResponse.json(rpcResult(id, { tools }))
      }

      case 'tools/call': {
        const params = (msg.params ?? {}) as { name?: string; arguments?: unknown }
        const tool = params.name ? TOOL_BY_NAME[params.name] : undefined
        if (!tool) {
          return NextResponse.json(
            rpcResult(id, {
              isError: true,
              content: [{ type: 'text', text: `Unknown tool: ${params.name ?? '<missing>'}` }],
            }),
          )
        }
        try {
          const result = await tool.handler(params.arguments ?? {}, ctx)
          return NextResponse.json(
            rpcResult(id, {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
              structuredContent: result,
            }),
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return NextResponse.json(
            rpcResult(id, {
              isError: true,
              content: [{ type: 'text', text: message }],
            }),
          )
        }
      }

      default: {
        if (isNotification) return new NextResponse(null, { status: 202 })
        return NextResponse.json(rpcError(id, -32601, `Method not found: ${msg.method}`))
      }
    }
  } catch (err) {
    console.error('[mcp] handler error', err)
    const message = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json(rpcError(id, -32603, message), { status: 500 })
  }
}

// Streamable HTTP transport allows GET for an optional server→client SSE
// stream. We don't emit notifications in v1, so respond 405 to indicate that.
export async function GET() {
  return new NextResponse('Method Not Allowed', { status: 405 })
}
