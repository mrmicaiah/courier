/**
 * Subscriber Management Tools
 */

import { z } from "zod";
import type { ToolContext } from '../types';
import { generateId, isValidEmail } from '../lib';

export function registerSubscriberTools(ctx: ToolContext) {
  const { server, env } = ctx;

  server.tool("courier_list_subscribers", {
    list_id: z.string().optional(),
    limit: z.number().optional().default(50)
  }, async ({ list_id, limit }) => {
    let query, params;
    if (list_id) {
      query = "SELECT s.id as subscription_id, s.subscribed_at, l.email, l.name FROM subscriptions s JOIN leads l ON s.lead_id = l.id WHERE s.list_id = ? AND s.status = 'active' ORDER BY s.subscribed_at DESC LIMIT ?";
      params = [list_id, limit || 50];
    } else {
      query = 'SELECT l.id, l.email, l.name, l.created_at FROM leads l ORDER BY l.created_at DESC LIMIT ?';
      params = [limit || 50];
    }
    
    const results = await env.DB.prepare(query).bind(...params).all();
    
    if (!results.results?.length) {
      return { content: [{ type: "text", text: "📭 No subscribers found" }] };
    }
    
    let out = `👥 **Subscribers** (${results.results.length})\n\n`;
    for (const s of (results.results as any[]).slice(0, 30)) {
      out += `• ${s.name || '(no name)'} <${s.email}>\n  ID: ${s.subscription_id || s.id}\n`;
    }
    if (results.results.length > 30) out += `\n... and ${results.results.length - 30} more`;
    
    return { content: [{ type: "text", text: out }] };
  });

  server.tool("courier_add_subscriber", {
    list_id: z.string().describe("List ID or slug"),
    email: z.string().describe("Subscriber email address"),
    name: z.string().optional().describe("Subscriber name")
  }, async ({ list_id, email, name }) => {
    if (!email || !isValidEmail(email)) {
      return { content: [{ type: "text", text: "⛔ Valid email address required" }] };
    }
    
    const list = await env.DB.prepare('SELECT * FROM lists WHERE id = ? OR slug = ?')
      .bind(list_id, list_id).first() as any;
    if (!list) {
      return { content: [{ type: "text", text: "⛔ List not found" }] };
    }
    
    const normalizedEmail = email.toLowerCase().trim();
    const now = new Date().toISOString();
    
    let lead = await env.DB.prepare('SELECT * FROM leads WHERE email = ?')
      .bind(normalizedEmail).first() as any;
    let leadId;
    
    if (!lead) {
      const result = await env.DB.prepare(`
        INSERT INTO leads (email, name, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(normalizedEmail, name || null, 'manual', now, now).run();
      leadId = result.meta.last_row_id;
    } else {
      leadId = lead.id;
    }
    
    const existingSub = await env.DB.prepare(
      'SELECT * FROM subscriptions WHERE lead_id = ? AND list_id = ?'
    ).bind(leadId, list.id).first() as any;
    
    if (existingSub) {
      if (existingSub.status === 'active') {
        return { content: [{ type: "text", text: `⚠️ **${normalizedEmail}** is already subscribed to **${list.name}**` }] };
      }
      await env.DB.prepare(`
        UPDATE subscriptions SET status = 'active', unsubscribed_at = NULL, subscribed_at = ? WHERE id = ?
      `).bind(now, existingSub.id).run();
      return { content: [{ type: "text", text: `✅ Reactivated **${normalizedEmail}** on **${list.name}**\nSubscription ID: ${existingSub.id}` }] };
    }
    
    const subId = generateId();
    await env.DB.prepare(`
      INSERT INTO subscriptions (id, lead_id, list_id, status, source, subscribed_at, created_at)
      VALUES (?, ?, ?, 'active', 'manual', ?, ?)
    `).bind(subId, leadId, list.id, now, now).run();
    
    return { content: [{ type: "text", text: `✅ Added **${normalizedEmail}**${name ? ` (${name})` : ''} to **${list.name}**\nSubscription ID: ${subId}` }] };
  });

  server.tool("courier_delete_subscriber", {
    subscription_id: z.string().optional(),
    subscription_ids: z.array(z.string()).optional(),
    permanent: z.boolean().optional().default(false)
  }, async ({ subscription_id, subscription_ids, permanent }) => {
    const ids = subscription_ids || (subscription_id ? [subscription_id] : []);
    if (!ids.length) {
      return { content: [{ type: "text", text: "⛔ Provide subscription_id or subscription_ids" }] };
    }
    
    const now = new Date().toISOString();
    for (const id of ids) {
      await env.DB.prepare('DELETE FROM sequence_enrollments WHERE subscription_id = ?').bind(id).run();
      if (permanent) {
        const sub = await env.DB.prepare('SELECT lead_id FROM subscriptions WHERE id = ?').bind(id).first() as any;
        await env.DB.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id).run();
        if (sub?.lead_id) {
          const otherSubs = await env.DB.prepare('SELECT COUNT(*) as c FROM subscriptions WHERE lead_id = ?').bind(sub.lead_id).first() as any;
          if (!otherSubs?.c || otherSubs.c === 0) {
            await env.DB.prepare('DELETE FROM email_sends WHERE lead_id = ?').bind(sub.lead_id).run();
            await env.DB.prepare('DELETE FROM touches WHERE lead_id = ?').bind(sub.lead_id).run();
            await env.DB.prepare('DELETE FROM leads WHERE id = ?').bind(sub.lead_id).run();
          }
        }
      } else {
        await env.DB.prepare("UPDATE subscriptions SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?").bind(now, id).run();
      }
    }
    
    return { content: [{ type: "text", text: `✅ ${ids.length} subscriber(s) ${permanent ? 'permanently deleted' : 'unsubscribed'}` }] };
  });
}
