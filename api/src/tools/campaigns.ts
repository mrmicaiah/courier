/**
 * Campaign Management Tools
 * Placeholder - will be populated with full implementation
 */

import { z } from "zod";
import type { ToolContext } from '../types';

export function registerCampaignTools(ctx: ToolContext) {
  const { server, env } = ctx;

  // TODO: Migrate all campaign tools from mcp.js
  server.tool("courier_list_campaigns", {
    status: z.enum(["draft", "scheduled", "sent"]).optional(),
    list_id: z.string().optional(),
    limit: z.number().optional().default(20),
    offset: z.number().optional().default(0)
  }, async ({ status, list_id, limit, offset }) => {
    const actualLimit = Math.min(Math.max(1, limit || 20), 100);
    const actualOffset = Math.max(0, offset || 0);
    
    let query = 'SELECT e.*, l.name as list_name FROM emails e LEFT JOIN lists l ON e.list_id = l.id';
    const conditions: string[] = [];
    const params: any[] = [];
    
    if (status) { conditions.push('e.status = ?'); params.push(status); }
    if (list_id) { conditions.push('e.list_id = ?'); params.push(list_id); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ` ORDER BY e.updated_at DESC LIMIT ? OFFSET ?`;
    params.push(actualLimit, actualOffset);
    
    const results = await env.DB.prepare(query).bind(...params).all();
    const total = await env.DB.prepare('SELECT COUNT(*) as total FROM emails').first() as any;
    
    if (!results.results?.length) {
      return { content: [{ type: "text", text: "📭 No campaigns found" }] };
    }
    
    let out = `📨 **Email Campaigns** (showing ${results.results.length} of ${total?.total || 0})\n\n`;
    for (const e of results.results as any[]) {
      const icon = e.status === 'sent' ? '✅' : e.status === 'scheduled' ? '⏰' : '📝';
      out += `${icon} **${e.subject}**\n   Status: ${e.status}${e.sent_count ? ` (sent to ${e.sent_count})` : ''}`;
      if (e.scheduled_at) out += `\n   Scheduled: ${e.scheduled_at}`;
      out += `\n   List: ${e.list_name || '(all)'}\n   ID: ${e.id}\n\n`;
    }
    if (total?.total > actualOffset + results.results.length) {
      out += `\n📄 _More campaigns available. Use offset: ${actualOffset + actualLimit} to see next page._`;
    }
    
    return { content: [{ type: "text", text: out }] };
  });
}
