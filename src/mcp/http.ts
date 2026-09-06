import { z } from 'zod';
import { MCP_TOOLS, describeToolError } from './tools';
import type { Services } from '../services';
import { SERVICE } from '../config';

// Stateless MCP-over-HTTP JSON-RPC dispatcher: initialize, ping, tools/list,
// tools/call. No sessions, no SSE. Everything below is built once at load.

const SERVER_INFO = { name: SERVICE.name, version: SERVICE.version };
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LATEST = '2025-06-18';

const TOOLS = new Map(MCP_TOOLS.map((def) => [def.name, { def, schema: z.object(def.inputSchema) }]));
const TOOLS_LIST = {
  tools: MCP_TOOLS.map((def) => ({
    name: def.name,
    title: def.title,
    description: def.description,
    inputSchema: z.toJSONSchema(z.object(def.inputSchema), { io: 'input' }),
  })),
};

type Id = string | number;
const ok = (id: Id, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const fail = (id: Id | null, code: number, message: string) => ({ jsonrpc: '2.0' as const, id, error: { code, message } });
export const MCP_PARSE_ERROR = fail(null, -32700, 'Parse error: body is not valid JSON');

async function one(msg: unknown, svc: Services): Promise<object | null> {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) return fail(null, -32600, 'Invalid Request');
  const { id, method, params } = msg as { id?: unknown; method?: unknown; params?: any };
  if (id === undefined || id === null) return null; // notification
  if (typeof id !== 'string' && typeof id !== 'number') return fail(null, -32600, 'id must be string or number');
  if (typeof method !== 'string') return fail(id, -32600, 'method must be a string');

  switch (method) {
    case 'initialize':
      return ok(id, { protocolVersion: SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : LATEST, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, TOOLS_LIST);
    case 'tools/call': {
      const name = params?.name;
      const entry = typeof name === 'string' ? TOOLS.get(name) : undefined;
      if (!entry) return fail(id, -32602, `Unknown tool: ${String(name)}`);
      const parsed = entry.schema.safeParse(params?.arguments ?? {});
      if (!parsed.success) {
        return ok(id, { content: [{ type: 'text', text: describeToolError(parsed.error) }], isError: true });
      }
      try {
        const text = await entry.def.handler(parsed.data as Record<string, unknown>, svc);
        return ok(id, { content: [{ type: 'text', text }] });
      } catch (err) {
        return ok(id, { content: [{ type: 'text', text: describeToolError(err) }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

/** Dispatch a parsed JSON-RPC body (single or batch). Returns null for notification-only input. */
export async function dispatchMcp(body: unknown, svc: Services): Promise<object | object[] | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => one(m, svc)))).filter((r): r is object => r !== null);
    return out.length ? out : null;
  }
  return one(body, svc);
}
