/**
 * Sequence Management Tools
 * Placeholder - will be populated with full implementation
 */

import { z } from "zod";
import type { ToolContext } from '../types';

export function registerSequenceTools(ctx: ToolContext) {
  const { server, env } = ctx;

  // TODO: Migrate all sequence tools from mcp.js
  // For now, register a placeholder
  server.tool("courier_list_sequences", {
    list_id: z.string().optional(),
    status: z.enum(["draft", "active", "paused"]).optional()
  }, async ({ list_id, status }) => {
    let query = `SELECT s.*, l.name as list_name, 
      (SELECT COUNT(*) FROM sequence_steps WHERE sequence_id = s.id) as step_count,
      (SELECT COUNT(*) FROM sequence_enrollments WHERE sequence_id = s.id AND status = 'active') as active_enrollments 
      FROM sequences s LEFT JOIN lists l ON s.list_id = l.id`;
    const conditions: string[] = [];
    const params: any[] = [];
    
    if (list_id) { conditions.push('s.list_id = ?'); params.push(list_id); }
    if (status) { conditions.push('s.status = ?'); params.push(status); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY s.created_at DESC';
    
    const results = await env.DB.prepare(query).bind(...params).all();
    
    if (!results.results?.length) {
      return { content: [{ type: "text", text: "📭 No sequences found" }] };
    }
    
    let out = `🔄 **Email Sequences** (${results.results.length})\n\n`;
    for (const s of results.results as any[]) {
      const icon = s.status === 'active' ? '✅' : s.status === 'paused' ? '⏸️' : '📝';
      let triggerDisplay = s.trigger_type;
      if (s.trigger_type === 'tag' && s.trigger_value) triggerDisplay = `tag: "${s.trigger_value}"`;
      out += `${icon} **${s.name}**\n   List: ${s.list_name || '(none)'}\n   Trigger: ${triggerDisplay}\n   Steps: ${s.step_count || 0} | Active: ${s.active_enrollments || 0}\n   ID: ${s.id}\n\n`;
    }
    
    return { content: [{ type: "text", text: out }] };
  });
}
