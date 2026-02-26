/**
 * Template Management Tools
 */

import { z } from "zod";
import type { ToolContext } from '../types';
import { generateId } from '../lib';

export function registerTemplateTools(ctx: ToolContext) {
  const { server, env } = ctx;

  server.tool("courier_list_templates", {
    category: z.string().optional(),
    list_id: z.string().optional()
  }, async ({ category, list_id }) => {
    let query = 'SELECT * FROM templates';
    const conditions: string[] = [];
    const params: any[] = [];
    
    if (category) { conditions.push('category = ?'); params.push(category); }
    if (list_id) { conditions.push('list_id = ?'); params.push(list_id); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY created_at DESC';
    
    const results = await env.DB.prepare(query).bind(...params).all();
    
    if (!results.results?.length) {
      return { content: [{ type: "text", text: "📭 No templates found" }] };
    }
    
    let out = `📧 **Email Templates** (${results.results.length})\n\n`;
    for (const t of results.results as any[]) {
      out += `• **${t.name}**${t.category ? ` [${t.category}]` : ''}\n  Subject: ${t.subject || '(none)'}\n  ID: ${t.id}\n\n`;
    }
    
    return { content: [{ type: "text", text: out }] };
  });

  server.tool("courier_get_template", {
    template_id: z.string()
  }, async ({ template_id }) => {
    const t = await env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(template_id).first() as any;
    if (!t) {
      return { content: [{ type: "text", text: "⛔ Template not found" }] };
    }
    
    return { content: [{ type: "text", text: `📧 **${t.name}**\n\nID: ${t.id}\nCategory: ${t.category || '(none)'}\nSubject: ${t.subject || '(none)'}\nDescription: ${t.description || '(none)'}\nCreated: ${t.created_at}\n\n---\n\n**HTML Preview:**\n\`\`\`html\n${t.body_html?.slice(0, 500)}${t.body_html?.length > 500 ? '...' : ''}\n\`\`\`` }] };
  });

  server.tool("courier_add_template", {
    name: z.string(),
    subject: z.string(),
    body_html: z.string().describe("HTML email content"),
    description: z.string().optional(),
    category: z.string().optional(),
    list_id: z.string().optional()
  }, async ({ name, subject, body_html, description, category, list_id }) => {
    const id = generateId();
    const now = new Date().toISOString();
    
    await env.DB.prepare('INSERT INTO templates (id, name, subject, body_html, description, category, list_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, subject, body_html, description || null, category || null, list_id || null, now, now).run();
    
    return { content: [{ type: "text", text: `✅ Template created: **${name}**\nID: ${id}` }] };
  });

  server.tool("courier_delete_template", {
    template_id: z.string()
  }, async ({ template_id }) => {
    await env.DB.prepare('DELETE FROM templates WHERE id = ?').bind(template_id).run();
    return { content: [{ type: "text", text: "✅ Template deleted" }] };
  });
}
