/**
 * List Management Tools
 * 
 * Tools for managing email lists
 */

import { z } from "zod";
import type { ToolContext } from '../types';
import { generateId } from '../lib';

export function registerListTools(ctx: ToolContext) {
  const { server, env } = ctx;

  server.tool(
    "courier_list_lists",
    "List all email lists",
    {},
    async () => {
      const results = await env.DB.prepare(`
        SELECT l.*, 
          (SELECT COUNT(*) FROM subscriptions s WHERE s.list_id = l.id AND s.status = 'active') as subscriber_count,
          ct.name as campaign_template_name, st.name as sequence_template_name
        FROM lists l
        LEFT JOIN templates ct ON l.campaign_template_id = ct.id
        LEFT JOIN templates st ON l.sequence_template_id = st.id
        WHERE l.status != 'archived' ORDER BY l.created_at DESC
      `).all();
      
      if (!results.results?.length) {
        return { content: [{ type: "text", text: "📭 No email lists found" }] };
      }
      
      let out = `📋 **Email Lists** (${results.results.length})\n\n`;
      for (const l of results.results as any[]) {
        out += `• **${l.name}**${l.status !== 'active' ? ` [${l.status}]` : ''} (${l.subscriber_count || 0} subscribers)\n`;
        out += `  Slug: ${l.slug}\n  From: ${l.from_name} <${l.from_email}>\n`;
        if (l.notify_email) out += `  📬 Notifications: ${l.notify_email}\n`;
        if (l.sequence_template_name) out += `  📧 Sequence Template: ${l.sequence_template_name}\n`;
        if (l.campaign_template_name) out += `  📨 Campaign Template: ${l.campaign_template_name}\n`;
        out += `  ID: ${l.id}\n\n`;
      }
      
      return { content: [{ type: "text", text: out }] };
    }
  );

  server.tool(
    "courier_get_list",
    "Get details of a specific list",
    {
      list_id: z.string().describe("List ID or slug")
    },
    async ({ list_id }) => {
      const l = await env.DB.prepare(`
        SELECT l.*, ct.name as campaign_template_name, st.name as sequence_template_name
        FROM lists l LEFT JOIN templates ct ON l.campaign_template_id = ct.id
        LEFT JOIN templates st ON l.sequence_template_id = st.id
        WHERE l.id = ? OR l.slug = ?
      `).bind(list_id, list_id).first() as any;
      
      if (!l) {
        return { content: [{ type: "text", text: "⛔ List not found" }] };
      }
      
      const subs = await env.DB.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE list_id = ? AND status = ?')
        .bind(l.id, 'active').first() as any;
      
      let out = `📋 **${l.name}**\n\n**ID:** ${l.id}\n**Slug:** ${l.slug}\n**Status:** ${l.status}\n**From:** ${l.from_name} <${l.from_email}>\n`;
      if (l.reply_to) out += `**Reply-To:** ${l.reply_to}\n`;
      if (l.notify_email) out += `**Lead Notifications:** ${l.notify_email}\n`;
      if (l.description) out += `**Description:** ${l.description}\n`;
      out += `**Subscribers:** ${subs?.count || 0}\n`;
      out += `\n**Templates:**\n• Sequence: ${l.sequence_template_name || '⚠️ Not set'} ${l.sequence_template_id ? `(${l.sequence_template_id})` : ''}\n`;
      out += `• Campaign: ${l.campaign_template_name || '(Not set)'} ${l.campaign_template_id ? `(${l.campaign_template_id})` : ''}\n`;
      out += `\n**Created:** ${l.created_at}\n`;
      
      return { content: [{ type: "text", text: out }] };
    }
  );

  server.tool(
    "courier_create_list",
    "Create a new email list",
    {
      name: z.string().describe("List name"),
      from_name: z.string().describe("Sender name"),
      from_email: z.string().describe("Sender email"),
      slug: z.string().optional().describe("URL-safe identifier"),
      description: z.string().optional(),
      reply_to: z.string().optional(),
      notify_email: z.string().optional().describe("Email for new subscriber notifications"),
      campaign_template_id: z.string().optional().describe("Template ID for campaign emails"),
      sequence_template_id: z.string().optional().describe("Template ID for sequence emails")
    },
    async ({ name, from_name, from_email, slug, description, reply_to, notify_email, campaign_template_id, sequence_template_id }) => {
      const id = generateId();
      const finalSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const now = new Date().toISOString();
      
      await env.DB.prepare(`
        INSERT INTO lists (id, name, slug, from_name, from_email, reply_to, description, notify_email, campaign_template_id, sequence_template_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).bind(id, name, finalSlug, from_name, from_email, reply_to || null, description || null, notify_email || null, campaign_template_id || null, sequence_template_id || null, now, now).run();
      
      let msg = `✅ List created: **${name}**\nID: ${id}\nSlug: ${finalSlug}`;
      if (notify_email) msg += `\n📬 Lead notifications: ${notify_email}`;
      if (sequence_template_id) msg += `\n📧 Sequence template linked`;
      if (campaign_template_id) msg += `\n📨 Campaign template linked`;
      if (!sequence_template_id) msg += `\n\n⚠️ No sequence template set - sequences will use basic styling`;
      
      return { content: [{ type: "text", text: msg }] };
    }
  );

  server.tool(
    "courier_update_list",
    "Update an existing list",
    {
      list_id: z.string(),
      name: z.string().optional(),
      slug: z.string().optional(),
      from_name: z.string().optional(),
      from_email: z.string().optional(),
      reply_to: z.string().optional(),
      notify_email: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["active", "paused"]).optional(),
      campaign_template_id: z.string().optional().describe("Template ID for campaign emails"),
      sequence_template_id: z.string().optional().describe("Template ID for sequence emails")
    },
    async (args) => {
      const updates: string[] = [];
      const values: any[] = [];
      
      if (args.name !== undefined) { updates.push('name = ?'); values.push(args.name); }
      if (args.slug !== undefined) { updates.push('slug = ?'); values.push(args.slug); }
      if (args.from_name !== undefined) { updates.push('from_name = ?'); values.push(args.from_name); }
      if (args.from_email !== undefined) { updates.push('from_email = ?'); values.push(args.from_email); }
      if (args.reply_to !== undefined) { updates.push('reply_to = ?'); values.push(args.reply_to); }
      if (args.notify_email !== undefined) { updates.push('notify_email = ?'); values.push(args.notify_email); }
      if (args.description !== undefined) { updates.push('description = ?'); values.push(args.description); }
      if (args.status !== undefined) { updates.push('status = ?'); values.push(args.status); }
      if (args.campaign_template_id !== undefined) { updates.push('campaign_template_id = ?'); values.push(args.campaign_template_id || null); }
      if (args.sequence_template_id !== undefined) { updates.push('sequence_template_id = ?'); values.push(args.sequence_template_id || null); }
      
      if (updates.length === 0) {
        return { content: [{ type: "text", text: "⛔ No updates provided" }] };
      }
      
      updates.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(args.list_id);
      
      await env.DB.prepare(`UPDATE lists SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      
      let msg = '✅ List updated';
      if (args.notify_email) msg += `\n📬 Lead notifications: ${args.notify_email}`;
      else if (args.notify_email === '') msg += '\n🔕 Lead notifications disabled';
      if (args.sequence_template_id) msg += '\n📧 Sequence template linked';
      if (args.campaign_template_id) msg += '\n📨 Campaign template linked';
      
      return { content: [{ type: "text", text: msg }] };
    }
  );

  server.tool(
    "courier_delete_list",
    "Delete a list permanently. Cannot delete lists with active subscribers unless force=true",
    {
      list_id: z.string().describe("List ID to delete"),
      force: z.boolean().optional().default(false).describe("Force delete even if list has subscribers")
    },
    async ({ list_id, force }) => {
      const l = await env.DB.prepare('SELECT * FROM lists WHERE id = ?').bind(list_id).first() as any;
      if (!l) {
        return { content: [{ type: "text", text: "⛔ List not found" }] };
      }
      
      const activeSubs = await env.DB.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE list_id = ? AND status = ?')
        .bind(list_id, 'active').first() as any;
      const sequences = await env.DB.prepare('SELECT COUNT(*) as count FROM sequences WHERE list_id = ?')
        .bind(list_id).first() as any;
      const campaigns = await env.DB.prepare('SELECT COUNT(*) as count FROM emails WHERE list_id = ?')
        .bind(list_id).first() as any;
      
      if (activeSubs?.count > 0 && !force) {
        return { content: [{ type: "text", text: `⛔ Cannot delete list "${l.name}" - it has ${activeSubs.count} active subscriber(s).\n\n**Details:**\n• Active Subscribers: ${activeSubs.count}\n• Sequences: ${sequences?.count || 0}\n• Campaigns: ${campaigns?.count || 0}\n\nTo delete anyway, use \`force: true\`. This will unsubscribe all subscribers from this list.` }] };
      }
      
      await env.DB.prepare('DELETE FROM sequence_enrollments WHERE sequence_id IN (SELECT id FROM sequences WHERE list_id = ?)').bind(list_id).run();
      await env.DB.prepare('DELETE FROM sequence_steps WHERE sequence_id IN (SELECT id FROM sequences WHERE list_id = ?)').bind(list_id).run();
      await env.DB.prepare('DELETE FROM sequences WHERE list_id = ?').bind(list_id).run();
      await env.DB.prepare('DELETE FROM subscriptions WHERE list_id = ?').bind(list_id).run();
      await env.DB.prepare('UPDATE emails SET list_id = NULL WHERE list_id = ?').bind(list_id).run();
      await env.DB.prepare('UPDATE templates SET list_id = NULL WHERE list_id = ?').bind(list_id).run();
      await env.DB.prepare('DELETE FROM lists WHERE id = ?').bind(list_id).run();
      
      return { content: [{ type: "text", text: `✅ List "${l.name}" deleted\n\n**Cleaned up:**\n• ${activeSubs?.count || 0} subscriptions removed\n• ${sequences?.count || 0} sequences deleted\n• ${campaigns?.count || 0} campaigns unlinked` }] };
    }
  );
}
