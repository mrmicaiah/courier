/**
 * Campaign Management Tools
 */

import { z } from "zod";
import type { ToolContext } from '../types';
import { generateId } from '../lib';

export function registerCampaignTools(ctx: ToolContext) {
  const { server, env } = ctx;

  server.tool(
    "courier_list_campaigns",
    "List email campaigns with optional filtering and pagination",
    {
      status: z.enum(["draft", "scheduled", "sent"]).optional(),
      list_id: z.string().optional(),
      limit: z.number().optional().default(20).describe("Max results (default 20, max 100)"),
      offset: z.number().optional().default(0).describe("Skip this many results for pagination")
    },
    async ({ status, list_id, limit, offset }) => {
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
    }
  );

  server.tool(
    "courier_get_campaign",
    "Get campaign details",
    {
      campaign_id: z.string()
    },
    async ({ campaign_id }) => {
      const e = await env.DB.prepare('SELECT e.*, l.name as list_name FROM emails e LEFT JOIN lists l ON e.list_id = l.id WHERE e.id = ?').bind(campaign_id).first() as any;
      if (!e) {
        return { content: [{ type: "text", text: "⛔ Campaign not found" }] };
      }
      
      const icon = e.status === 'sent' ? '✅' : e.status === 'scheduled' ? '⏰' : '📝';
      let out = `${icon} **${e.subject}**\n\n**ID:** ${e.id}\n**Status:** ${e.status}\n**List:** ${e.list_name || '(all)'}\n`;
      if (e.preview_text) out += `**Preview:** ${e.preview_text}\n`;
      if (e.scheduled_at) out += `**Scheduled:** ${e.scheduled_at}\n`;
      if (e.sent_at) out += `**Sent:** ${e.sent_at}\n`;
      if (e.sent_count) out += `**Sent to:** ${e.sent_count}\n`;
      out += `**Created:** ${e.created_at}\n\n---\n\n**Content:**\n\`\`\`html\n${e.body_html?.slice(0, 1000)}${e.body_html?.length > 1000 ? '\n...(truncated)' : ''}\n\`\`\``;
      
      return { content: [{ type: "text", text: out }] };
    }
  );

  server.tool(
    "courier_create_campaign",
    "Create a new email campaign",
    {
      subject: z.string(),
      body_html: z.string(),
      list_id: z.string().optional(),
      title: z.string().optional(),
      preview_text: z.string().optional()
    },
    async ({ subject, body_html, list_id, title, preview_text }) => {
      const id = generateId();
      const now = new Date().toISOString();
      
      await env.DB.prepare('INSERT INTO emails (id, subject, body_html, list_id, title, preview_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'draft\', ?, ?)')
        .bind(id, subject, body_html, list_id || null, title || null, preview_text || null, now, now).run();
      
      return { content: [{ type: "text", text: `✅ Campaign created: **${subject}**\nID: ${id}\nStatus: draft` }] };
    }
  );

  server.tool(
    "courier_update_campaign",
    "Update a campaign",
    {
      campaign_id: z.string(),
      subject: z.string().optional(),
      body_html: z.string().optional(),
      list_id: z.string().optional(),
      title: z.string().optional(),
      preview_text: z.string().optional()
    },
    async (args) => {
      const updates: string[] = [];
      const values: any[] = [];
      
      if (args.subject !== undefined) { updates.push('subject = ?'); values.push(args.subject); }
      if (args.body_html !== undefined) { updates.push('body_html = ?'); values.push(args.body_html); }
      if (args.list_id !== undefined) { updates.push('list_id = ?'); values.push(args.list_id); }
      if (args.title !== undefined) { updates.push('title = ?'); values.push(args.title); }
      if (args.preview_text !== undefined) { updates.push('preview_text = ?'); values.push(args.preview_text); }
      
      if (updates.length === 0) {
        return { content: [{ type: "text", text: "⛔ No updates provided" }] };
      }
      
      updates.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(args.campaign_id);
      
      await env.DB.prepare(`UPDATE emails SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      
      return { content: [{ type: "text", text: "✅ Campaign updated" }] };
    }
  );

  server.tool(
    "courier_delete_campaign",
    "Delete a draft campaign (cannot delete sent campaigns)",
    {
      campaign_id: z.string()
    },
    async ({ campaign_id }) => {
      const e = await env.DB.prepare('SELECT status, subject FROM emails WHERE id = ?').bind(campaign_id).first() as any;
      if (!e) {
        return { content: [{ type: "text", text: "⛔ Campaign not found" }] };
      }
      if (e.status === 'sent') {
        return { content: [{ type: "text", text: "⛔ Cannot delete a sent campaign" }] };
      }
      
      await env.DB.prepare('DELETE FROM emails WHERE id = ?').bind(campaign_id).run();
      
      return { content: [{ type: "text", text: `✅ Campaign "${e.subject}" deleted` }] };
    }
  );

  server.tool(
    "courier_preview_campaign",
    "Preview a campaign and see recipient count",
    {
      campaign_id: z.string()
    },
    async ({ campaign_id }) => {
      const e = await env.DB.prepare('SELECT e.*, l.name as list_name FROM emails e LEFT JOIN lists l ON e.list_id = l.id WHERE e.id = ?').bind(campaign_id).first() as any;
      if (!e) {
        return { content: [{ type: "text", text: "⛔ Campaign not found" }] };
      }
      
      let recipientCount = 0;
      if (e.list_id) {
        const count = await env.DB.prepare('SELECT COUNT(*) as c FROM subscriptions WHERE list_id = ? AND status = ?').bind(e.list_id, 'active').first() as any;
        recipientCount = count?.c || 0;
      } else {
        const count = await env.DB.prepare('SELECT COUNT(DISTINCT lead_id) as c FROM subscriptions WHERE status = ?').bind('active').first() as any;
        recipientCount = count?.c || 0;
      }
      
      let out = `📬 **Campaign Preview**\n\n**Subject:** ${e.subject}\n**List:** ${e.list_name || '(all)'}\n**Recipients:** ${recipientCount}\n`;
      if (recipientCount === 0) out += `\n⚠️ No subscribers will receive this!`;
      
      return { content: [{ type: "text", text: out }] };
    }
  );

  server.tool(
    "courier_campaign_stats",
    "Get campaign statistics",
    {
      campaign_id: z.string()
    },
    async ({ campaign_id }) => {
      const e = await env.DB.prepare('SELECT * FROM emails WHERE id = ?').bind(campaign_id).first() as any;
      if (!e) {
        return { content: [{ type: "text", text: "⛔ Campaign not found" }] };
      }
      
      let stats: any = { sent: 0, opened: 0, clicked: 0, bounced: 0 };
      try {
        const result = await env.DB.prepare('SELECT COUNT(*) as sent, SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened, SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked, SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) as bounced FROM email_sends WHERE email_id = ?').bind(campaign_id).first() as any;
        if (result) stats = result;
      } catch (err) {}
      
      let topLinks: any[] = [];
      try {
        const result = await env.DB.prepare('SELECT ec.url, COUNT(*) as clicks FROM email_clicks ec JOIN email_sends es ON ec.send_id = es.id WHERE es.email_id = ? GROUP BY ec.url ORDER BY clicks DESC LIMIT 5').bind(campaign_id).all();
        topLinks = result.results as any[] || [];
      } catch (err) {}
      
      const sent = stats?.sent || 0;
      const opened = stats?.opened || 0;
      const clicked = stats?.clicked || 0;
      const bounced = stats?.bounced || 0;
      
      let out = `📊 **Campaign Stats: ${e.subject}**\n\n**Status:** ${e.status}\n`;
      if (e.sent_at) out += `**Sent:** ${e.sent_at}\n`;
      out += `\n**Delivery:**\n• Sent: ${sent}\n• Bounced: ${bounced} (${sent ? Math.round(bounced/sent*100) : 0}%)\n`;
      out += `\n**Engagement:**\n• Opened: ${opened} (${sent ? Math.round(opened/sent*100) : 0}%)\n• Clicked: ${clicked} (${sent ? Math.round(clicked/sent*100) : 0}%)\n• Click-to-Open: ${opened ? Math.round(clicked/opened*100) : 0}%\n`;
      
      if (topLinks.length > 0) {
        out += `\n**Top Clicked Links:**\n`;
        for (const link of topLinks) {
          out += `• ${link.url.length > 50 ? link.url.slice(0, 47) + '...' : link.url} (${link.clicks})\n`;
        }
      }
      
      return { content: [{ type: "text", text: out }] };
    }
  );

  server.tool(
    "courier_duplicate_campaign",
    "Duplicate an existing campaign",
    {
      campaign_id: z.string()
    },
    async ({ campaign_id }) => {
      const orig = await env.DB.prepare('SELECT * FROM emails WHERE id = ?').bind(campaign_id).first() as any;
      if (!orig) {
        return { content: [{ type: "text", text: "⛔ Campaign not found" }] };
      }
      
      const id = generateId();
      const now = new Date().toISOString();
      
      await env.DB.prepare('INSERT INTO emails (id, subject, body_html, list_id, title, preview_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'draft\', ?, ?)')
        .bind(id, `Copy of ${orig.subject}`, orig.body_html, orig.list_id, orig.title ? `Copy of ${orig.title}` : null, orig.preview_text, now, now).run();
      
      return { content: [{ type: "text", text: `✅ Campaign duplicated\nNew ID: ${id}` }] };
    }
  );

  server.tool(
    "courier_schedule_campaign",
    "Schedule a campaign for later",
    {
      campaign_id: z.string(),
      scheduled_at: z.string().describe("ISO 8601 datetime")
    },
    async ({ campaign_id, scheduled_at }) => {
      await env.DB.prepare('UPDATE emails SET status = ?, scheduled_at = ?, updated_at = ? WHERE id = ?')
        .bind('scheduled', scheduled_at, new Date().toISOString(), campaign_id).run();
      
      return { content: [{ type: "text", text: `⏰ Campaign scheduled for **${new Date(scheduled_at).toLocaleString()}**` }] };
    }
  );

  server.tool(
    "courier_cancel_schedule",
    "Cancel a scheduled campaign",
    {
      campaign_id: z.string()
    },
    async ({ campaign_id }) => {
      await env.DB.prepare('UPDATE emails SET status = ?, scheduled_at = NULL, updated_at = ? WHERE id = ?')
        .bind('draft', new Date().toISOString(), campaign_id).run();
      
      return { content: [{ type: "text", text: "✅ Schedule cancelled - campaign returned to draft" }] };
    }
  );

  server.tool(
    "courier_send_test",
    "Send a test email",
    {
      campaign_id: z.string(),
      email: z.string()
    },
    async ({ campaign_id, email }) => {
      return { content: [{ type: "text", text: `✅ Test email would be sent to **${email}**\n\n(Note: Actual sending requires campaign send endpoint)` }] };
    }
  );

  server.tool(
    "courier_send_now",
    "Send a campaign immediately",
    {
      campaign_id: z.string()
    },
    async ({ campaign_id }) => {
      const now = new Date().toISOString();
      await env.DB.prepare('UPDATE emails SET status = ?, sent_at = ?, updated_at = ? WHERE id = ?')
        .bind('sent', now, now, campaign_id).run();
      
      return { content: [{ type: "text", text: `✅ Campaign marked as sent\n\n(Note: Actual sending processes via cron)` }] };
    }
  );
}
