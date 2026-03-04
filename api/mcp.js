/**
 * Courier MCP Server
 * Exposes email marketing tools directly to Claude via MCP protocol
 * Updated: 2026-03-04 - Fix email sending tools to actually send via Resend
 */

import { generateId, sendEmailViaSES, renderEmail, isValidEmail } from './lib.js';

// Tool definitions
const TOOLS = [
  { name: "courier_list_lists", description: "List all email lists", inputSchema: { type: "object", properties: {}, required: [] } },
  { name: "courier_get_list", description: "Get details of a specific list", inputSchema: { type: "object", properties: { list_id: { type: "string", description: "List ID or slug" } }, required: ["list_id"] } },
  { name: "courier_create_list", description: "Create a new email list", inputSchema: { type: "object", properties: { name: { type: "string", description: "List name" }, from_name: { type: "string", description: "Sender name" }, from_email: { type: "string", description: "Sender email" }, slug: { type: "string", description: "URL-safe identifier" }, description: { type: "string" }, reply_to: { type: "string" }, notify_email: { type: "string", description: "Email for new subscriber notifications" }, campaign_template_id: { type: "string", description: "Template ID for campaign emails" }, sequence_template_id: { type: "string", description: "Template ID for sequence emails" } }, required: ["name", "from_name", "from_email"] } },
  { name: "courier_update_list", description: "Update an existing list", inputSchema: { type: "object", properties: { list_id: { type: "string" }, name: { type: "string" }, slug: { type: "string" }, from_name: { type: "string" }, from_email: { type: "string" }, reply_to: { type: "string" }, notify_email: { type: "string" }, description: { type: "string" }, status: { type: "string", enum: ["active", "paused"] }, campaign_template_id: { type: "string", description: "Template ID for campaign emails" }, sequence_template_id: { type: "string", description: "Template ID for sequence emails" } }, required: ["list_id"] } },
  { name: "courier_delete_list", description: "Delete a list permanently. Cannot delete lists with active subscribers unless force=true", inputSchema: { type: "object", properties: { list_id: { type: "string", description: "List ID to delete" }, force: { type: "boolean", default: false, description: "Force delete even if list has subscribers (will unsubscribe them)" } }, required: ["list_id"] } },
  { name: "courier_list_templates", description: "List all email templates", inputSchema: { type: "object", properties: { category: { type: "string" }, list_id: { type: "string" } }, required: [] } },
  { name: "courier_get_template", description: "Get a specific template", inputSchema: { type: "object", properties: { template_id: { type: "string" } }, required: ["template_id"] } },
  { name: "courier_add_template", description: "Create a new email template", inputSchema: { type: "object", properties: { name: { type: "string" }, subject: { type: "string" }, body_html: { type: "string", description: "HTML email content" }, description: { type: "string" }, category: { type: "string" }, list_id: { type: "string" } }, required: ["name", "subject", "body_html"] } },
  { name: "courier_delete_template", description: "Delete a template", inputSchema: { type: "object", properties: { template_id: { type: "string" } }, required: ["template_id"] } },
  { name: "courier_list_campaigns", description: "List email campaigns with optional filtering and pagination", inputSchema: { type: "object", properties: { status: { type: "string", enum: ["draft", "scheduled", "sent"] }, list_id: { type: "string" }, limit: { type: "number", default: 20, description: "Max results (default 20, max 100)" }, offset: { type: "number", default: 0, description: "Skip this many results for pagination" } }, required: [] } },
  { name: "courier_get_campaign", description: "Get campaign details", inputSchema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] } },
  { name: "courier_create_campaign", description: "Create a new email campaign", inputSchema: { type: "object", properties: { subject: { type: "string" }, body_html: { type: "string" }, list_id: { type: "string" }, title: { type: "string" }, preview_text: { type: "string" } }, required: ["subject", "body_html"] } },
  { name: "courier_update_campaign", description: "Update a campaign", inputSchema: { type: "object", properties: { campaign_id: { type: "string" }, subject: { type: "string" }, body_html: { type: "string" }, list_id: { type: "string" }, title: { type: "string" }, preview_text: { type: "string" } }, required: ["campaign_id"] } },
  { name: "courier_delete_campaign", description: "Delete a draft campaign (cannot delete sent campaigns)", inputSchema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] } },
  { name: "courier_preview_campaign", description: "Preview a campaign and see recipient count", inputSchema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] } },
  { name: "courier_campaign_stats", description: "Get campaign statistics", inputSchema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] } },
  { name: "courier_duplicate_campaign", description: "Duplicate an existing campaign", inputSchema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] } },
  { name: "courier_schedule_campaign", description: "Schedule a campaign for later", inputSchema: { type: "object", properties: { campaign_id: { type: "string" }, scheduled_at: { type: "string", description: "ISO 8601 datetime" } }, required: ["campaign_id", "scheduled_at"] } },
  { name: "courier_cancel_schedule", description: "Cancel a scheduled campaign", inputSchema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] } },
  { name: "courier_send_test", description: "Send a test email to a specific address", inputSchema: { type: "object", properties: { campaign_id: { type: "string" }, email: { type: "string" } }, required: ["campaign_id", "email"] } },
  { name: "courier_send_now", description: "Send a campaign immediately to all subscribers", inputSchema: { type: "object", properties: { campaign_id: { type: "string" } }, required: ["campaign_id"] } },
  { name: "courier_list_sequences", description: "List email sequences", inputSchema: { type: "object", properties: { list_id: { type: "string" }, status: { type: "string", enum: ["draft", "active", "paused"] } }, required: [] } },
  { name: "courier_get_sequence", description: "Get sequence details with steps", inputSchema: { type: "object", properties: { sequence_id: { type: "string" } }, required: ["sequence_id"] } },
  { name: "courier_create_sequence", description: "Create a new email sequence", inputSchema: { type: "object", properties: { name: { type: "string" }, list_id: { type: "string" }, description: { type: "string" }, trigger_type: { type: "string", enum: ["subscribe", "manual", "tag"], default: "subscribe" }, trigger_value: { type: "string", description: "For tag triggers, the tag name that triggers this sequence" } }, required: ["name", "list_id"] } },
  { name: "courier_update_sequence", description: "Update a sequence", inputSchema: { type: "object", properties: { sequence_id: { type: "string" }, name: { type: "string" }, description: { type: "string" }, status: { type: "string", enum: ["draft", "active", "paused"] }, trigger_type: { type: "string", enum: ["subscribe", "manual", "tag"] }, trigger_value: { type: "string" } }, required: ["sequence_id"] } },
  { name: "courier_delete_sequence", description: "Delete a sequence", inputSchema: { type: "object", properties: { sequence_id: { type: "string" } }, required: ["sequence_id"] } },
  { name: "courier_add_sequence_step", description: "Add a step to a sequence", inputSchema: { type: "object", properties: { sequence_id: { type: "string" }, subject: { type: "string" }, body_html: { type: "string" }, delay_minutes: { type: "number", default: 0, description: "0=immediate, 1440=1 day, 10080=1 week" }, preview_text: { type: "string" }, send_at_time: { type: "string", description: "Specific time to send (HH:MM in 24h format, e.g. '09:00'). Set to null for immediate delivery based on delay_minutes." } }, required: ["sequence_id", "subject", "body_html"] } },
  { name: "courier_update_sequence_step", description: "Update a sequence step", inputSchema: { type: "object", properties: { sequence_id: { type: "string" }, step_id: { type: "string" }, subject: { type: "string" }, body_html: { type: "string" }, delay_minutes: { type: "number" }, preview_text: { type: "string" }, status: { type: "string", enum: ["active", "paused"] }, send_at_time: { type: "string", description: "Specific time to send (HH:MM in 24h format, e.g. '09:00'). Use 'null' or empty string to clear and enable immediate delivery." } }, required: ["sequence_id", "step_id"] } },
  { name: "courier_delete_sequence_step", description: "Delete a sequence step", inputSchema: { type: "object", properties: { sequence_id: { type: "string" }, step_id: { type: "string" } }, required: ["sequence_id", "step_id"] } },
  { name: "courier_reorder_sequence_steps", description: "Reorder sequence steps", inputSchema: { type: "object", properties: { sequence_id: { type: "string" }, step_ids: { type: "array", items: { type: "string" } } }, required: ["sequence_id", "step_ids"] } },
  { name: "courier_enroll_in_sequence", description: "Enroll an email in a sequence", inputSchema: { type: "object", properties: { sequence_id: { type: "string" }, email: { type: "string" } }, required: ["sequence_id", "email"] } },
  { name: "courier_sequence_enrollments", description: "List sequence enrollments", inputSchema: { type: "object", properties: { sequence_id: { type: "string" }, status: { type: "string", enum: ["active", "completed", "cancelled"] }, limit: { type: "number", default: 50 } }, required: ["sequence_id"] } },
  { name: "courier_list_subscribers", description: "List subscribers for a list", inputSchema: { type: "object", properties: { list_id: { type: "string", description: "List ID or slug" }, limit: { type: "number", default: 50 } }, required: [] } },
  { name: "courier_add_subscriber", description: "Add a subscriber to a list. Creates the lead if they don't exist. Reactivates if previously unsubscribed.", inputSchema: { type: "object", properties: { list_id: { type: "string", description: "List ID or slug" }, email: { type: "string", description: "Subscriber email address" }, name: { type: "string", description: "Subscriber name (optional)" } }, required: ["list_id", "email"] } },
  { name: "courier_delete_subscriber", description: "Delete/unsubscribe subscribers", inputSchema: { type: "object", properties: { subscription_id: { type: "string" }, subscription_ids: { type: "array", items: { type: "string" } }, permanent: { type: "boolean", default: false } }, required: [] } },
  { name: "courier_stats", description: "Get overall platform statistics including opens, clicks, unsubscribes, and performance metrics", inputSchema: { type: "object", properties: {}, required: [] } }
];

async function executeTool(name, args, env) {
  const db = env.DB;
  switch (name) {
    case "courier_list_lists": {
      const results = await db.prepare(`
        SELECT l.*, 
          (SELECT COUNT(*) FROM subscriptions s WHERE s.list_id = l.id AND s.status = 'active') as subscriber_count,
          ct.name as campaign_template_name, st.name as sequence_template_name
        FROM lists l
        LEFT JOIN templates ct ON l.campaign_template_id = ct.id
        LEFT JOIN templates st ON l.sequence_template_id = st.id
        WHERE l.status != 'archived' ORDER BY l.created_at DESC
      `).all();
      if (!results.results?.length) return "📭 No email lists found";
      let out = `📋 **Email Lists** (${results.results.length})\n\n`;
      for (const l of results.results) {
        out += `• **${l.name}**${l.status !== 'active' ? ` [${l.status}]` : ''} (${l.subscriber_count || 0} subscribers)\n`;
        out += `  Slug: ${l.slug}\n  From: ${l.from_name} <${l.from_email}>\n`;
        if (l.notify_email) out += `  📬 Notifications: ${l.notify_email}\n`;
        if (l.sequence_template_name) out += `  📧 Sequence Template: ${l.sequence_template_name}\n`;
        if (l.campaign_template_name) out += `  📨 Campaign Template: ${l.campaign_template_name}\n`;
        out += `  ID: ${l.id}\n\n`;
      }
      return out;
    }
    case "courier_get_list": {
      const l = await db.prepare(`
        SELECT l.*, ct.name as campaign_template_name, st.name as sequence_template_name
        FROM lists l LEFT JOIN templates ct ON l.campaign_template_id = ct.id
        LEFT JOIN templates st ON l.sequence_template_id = st.id
        WHERE l.id = ? OR l.slug = ?
      `).bind(args.list_id, args.list_id).first();
      if (!l) return "⛔ List not found";
      const subs = await db.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE list_id = ? AND status = ?').bind(l.id, 'active').first();
      let out = `📋 **${l.name}**\n\n**ID:** ${l.id}\n**Slug:** ${l.slug}\n**Status:** ${l.status}\n**From:** ${l.from_name} <${l.from_email}>\n`;
      if (l.reply_to) out += `**Reply-To:** ${l.reply_to}\n`;
      if (l.notify_email) out += `**Lead Notifications:** ${l.notify_email}\n`;
      if (l.description) out += `**Description:** ${l.description}\n`;
      out += `**Subscribers:** ${subs?.count || 0}\n`;
      out += `\n**Templates:**\n• Sequence: ${l.sequence_template_name || '⚠️ Not set'} ${l.sequence_template_id ? `(${l.sequence_template_id})` : ''}\n`;
      out += `• Campaign: ${l.campaign_template_name || '(Not set)'} ${l.campaign_template_id ? `(${l.campaign_template_id})` : ''}\n`;
      out += `\n**Created:** ${l.created_at}\n`;
      return out;
    }
    case "courier_create_list": {
      const id = generateId();
      const slug = args.slug || args.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const now = new Date().toISOString();
      await db.prepare(`
        INSERT INTO lists (id, name, slug, from_name, from_email, reply_to, description, notify_email, campaign_template_id, sequence_template_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).bind(id, args.name, slug, args.from_name, args.from_email, args.reply_to || null, args.description || null, args.notify_email || null, args.campaign_template_id || null, args.sequence_template_id || null, now, now).run();
      let msg = `✅ List created: **${args.name}**\nID: ${id}\nSlug: ${slug}`;
      if (args.notify_email) msg += `\n📬 Lead notifications: ${args.notify_email}`;
      if (args.sequence_template_id) msg += `\n📧 Sequence template linked`;
      if (args.campaign_template_id) msg += `\n📨 Campaign template linked`;
      if (!args.sequence_template_id) msg += `\n\n⚠️ No sequence template set - sequences will use basic styling`;
      return msg;
    }
    case "courier_update_list": {
      const updates = []; const values = [];
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
      if (updates.length === 0) return "⛔ No updates provided";
      updates.push('updated_at = ?'); values.push(new Date().toISOString()); values.push(args.list_id);
      await db.prepare(`UPDATE lists SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      let msg = '✅ List updated';
      if (args.notify_email) msg += `\n📬 Lead notifications: ${args.notify_email}`;
      else if (args.notify_email === '') msg += '\n🔕 Lead notifications disabled';
      if (args.sequence_template_id) msg += '\n📧 Sequence template linked';
      if (args.campaign_template_id) msg += '\n📨 Campaign template linked';
      return msg;
    }
    case "courier_delete_list": {
      const l = await db.prepare('SELECT * FROM lists WHERE id = ?').bind(args.list_id).first();
      if (!l) return "⛔ List not found";
      const activeSubs = await db.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE list_id = ? AND status = ?').bind(args.list_id, 'active').first();
      const sequences = await db.prepare('SELECT COUNT(*) as count FROM sequences WHERE list_id = ?').bind(args.list_id).first();
      const campaigns = await db.prepare('SELECT COUNT(*) as count FROM emails WHERE list_id = ?').bind(args.list_id).first();
      if (activeSubs?.count > 0 && !args.force) {
        return `⛔ Cannot delete list "${l.name}" - it has ${activeSubs.count} active subscriber(s).\n\n**Details:**\n• Active Subscribers: ${activeSubs.count}\n• Sequences: ${sequences?.count || 0}\n• Campaigns: ${campaigns?.count || 0}\n\nTo delete anyway, use \`force: true\`. This will unsubscribe all subscribers from this list.`;
      }
      await db.prepare('DELETE FROM sequence_enrollments WHERE sequence_id IN (SELECT id FROM sequences WHERE list_id = ?)').bind(args.list_id).run();
      await db.prepare('DELETE FROM sequence_steps WHERE sequence_id IN (SELECT id FROM sequences WHERE list_id = ?)').bind(args.list_id).run();
      await db.prepare('DELETE FROM sequences WHERE list_id = ?').bind(args.list_id).run();
      await db.prepare('DELETE FROM subscriptions WHERE list_id = ?').bind(args.list_id).run();
      await db.prepare('UPDATE emails SET list_id = NULL WHERE list_id = ?').bind(args.list_id).run();
      await db.prepare('UPDATE templates SET list_id = NULL WHERE list_id = ?').bind(args.list_id).run();
      await db.prepare('DELETE FROM lists WHERE id = ?').bind(args.list_id).run();
      return `✅ List "${l.name}" deleted\n\n**Cleaned up:**\n• ${activeSubs?.count || 0} subscriptions removed\n• ${sequences?.count || 0} sequences deleted\n• ${campaigns?.count || 0} campaigns unlinked`;
    }
    case "courier_list_templates": {
      let query = 'SELECT * FROM templates'; const conditions = []; const params = [];
      if (args.category) { conditions.push('category = ?'); params.push(args.category); }
      if (args.list_id) { conditions.push('list_id = ?'); params.push(args.list_id); }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY created_at DESC';
      const results = await db.prepare(query).bind(...params).all();
      if (!results.results?.length) return "📭 No templates found";
      let out = `📧 **Email Templates** (${results.results.length})\n\n`;
      for (const t of results.results) {
        out += `• **${t.name}**${t.category ? ` [${t.category}]` : ''}\n  Subject: ${t.subject || '(none)'}\n  ID: ${t.id}\n\n`;
      }
      return out;
    }
    case "courier_get_template": {
      const t = await db.prepare('SELECT * FROM templates WHERE id = ?').bind(args.template_id).first();
      if (!t) return "⛔ Template not found";
      return `📧 **${t.name}**\n\nID: ${t.id}\nCategory: ${t.category || '(none)'}\nSubject: ${t.subject || '(none)'}\nDescription: ${t.description || '(none)'}\nCreated: ${t.created_at}\n\n---\n\n**HTML Preview:**\n\`\`\`html\n${t.body_html?.slice(0, 500)}${t.body_html?.length > 500 ? '...' : ''}\n\`\`\``;
    }
    case "courier_add_template": {
      const id = generateId(); const now = new Date().toISOString();
      await db.prepare('INSERT INTO templates (id, name, subject, body_html, description, category, list_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, args.name, args.subject, args.body_html, args.description || null, args.category || null, args.list_id || null, now, now).run();
      return `✅ Template created: **${args.name}**\nID: ${id}`;
    }
    case "courier_delete_template": {
      await db.prepare('DELETE FROM templates WHERE id = ?').bind(args.template_id).run();
      return "✅ Template deleted";
    }
    case "courier_list_campaigns": {
      const limit = Math.min(Math.max(1, args.limit || 20), 100);
      const offset = Math.max(0, args.offset || 0);
      let query = 'SELECT e.*, l.name as list_name FROM emails e LEFT JOIN lists l ON e.list_id = l.id';
      const conditions = []; const params = [];
      if (args.status) { conditions.push('e.status = ?'); params.push(args.status); }
      if (args.list_id) { conditions.push('e.list_id = ?'); params.push(args.list_id); }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ` ORDER BY e.updated_at DESC LIMIT ? OFFSET ?`; params.push(limit, offset);
      const results = await db.prepare(query).bind(...params).all();
      const total = await db.prepare('SELECT COUNT(*) as total FROM emails').first();
      if (!results.results?.length) return "📭 No campaigns found";
      let out = `📨 **Email Campaigns** (showing ${results.results.length} of ${total?.total || 0})\n\n`;
      for (const e of results.results) {
        const icon = e.status === 'sent' ? '✅' : e.status === 'scheduled' ? '⏰' : '📝';
        out += `${icon} **${e.subject}**\n   Status: ${e.status}${e.sent_count ? ` (sent to ${e.sent_count})` : ''}`;
        if (e.scheduled_at) out += `\n   Scheduled: ${e.scheduled_at}`;
        out += `\n   List: ${e.list_name || '(all)'}\n   ID: ${e.id}\n\n`;
      }
      if (total?.total > offset + results.results.length) out += `\n📄 _More campaigns available. Use offset: ${offset + limit} to see next page._`;
      return out;
    }
    case "courier_get_campaign": {
      const e = await db.prepare('SELECT e.*, l.name as list_name FROM emails e LEFT JOIN lists l ON e.list_id = l.id WHERE e.id = ?').bind(args.campaign_id).first();
      if (!e) return "⛔ Campaign not found";
      const icon = e.status === 'sent' ? '✅' : e.status === 'scheduled' ? '⏰' : '📝';
      let out = `${icon} **${e.subject}**\n\n**ID:** ${e.id}\n**Status:** ${e.status}\n**List:** ${e.list_name || '(all)'}\n`;
      if (e.preview_text) out += `**Preview:** ${e.preview_text}\n`;
      if (e.scheduled_at) out += `**Scheduled:** ${e.scheduled_at}\n`;
      if (e.sent_at) out += `**Sent:** ${e.sent_at}\n`;
      if (e.sent_count) out += `**Sent to:** ${e.sent_count}\n`;
      out += `**Created:** ${e.created_at}\n\n---\n\n**Content:**\n\`\`\`html\n${e.body_html?.slice(0, 1000)}${e.body_html?.length > 1000 ? '\n...(truncated)' : ''}\n\`\`\``;
      return out;
    }
    case "courier_create_campaign": {
      const id = generateId(); const now = new Date().toISOString();
      await db.prepare('INSERT INTO emails (id, subject, body_html, list_id, title, preview_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'draft\', ?, ?)').bind(id, args.subject, args.body_html, args.list_id || null, args.title || null, args.preview_text || null, now, now).run();
      return `✅ Campaign created: **${args.subject}**\nID: ${id}\nStatus: draft`;
    }
    case "courier_update_campaign": {
      const updates = []; const values = [];
      if (args.subject !== undefined) { updates.push('subject = ?'); values.push(args.subject); }
      if (args.body_html !== undefined) { updates.push('body_html = ?'); values.push(args.body_html); }
      if (args.list_id !== undefined) { updates.push('list_id = ?'); values.push(args.list_id); }
      if (args.title !== undefined) { updates.push('title = ?'); values.push(args.title); }
      if (args.preview_text !== undefined) { updates.push('preview_text = ?'); values.push(args.preview_text); }
      if (updates.length === 0) return "⛔ No updates provided";
      updates.push('updated_at = ?'); values.push(new Date().toISOString()); values.push(args.campaign_id);
      await db.prepare(`UPDATE emails SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      return "✅ Campaign updated";
    }
    case "courier_delete_campaign": {
      const e = await db.prepare('SELECT status, subject FROM emails WHERE id = ?').bind(args.campaign_id).first();
      if (!e) return "⛔ Campaign not found";
      if (e.status === 'sent') return "⛔ Cannot delete a sent campaign";
      await db.prepare('DELETE FROM emails WHERE id = ?').bind(args.campaign_id).run();
      return `✅ Campaign "${e.subject}" deleted`;
    }
    case "courier_preview_campaign": {
      const e = await db.prepare('SELECT e.*, l.name as list_name FROM emails e LEFT JOIN lists l ON e.list_id = l.id WHERE e.id = ?').bind(args.campaign_id).first();
      if (!e) return "⛔ Campaign not found";
      let recipientCount = 0;
      if (e.list_id) {
        const count = await db.prepare('SELECT COUNT(*) as c FROM subscriptions WHERE list_id = ? AND status = ?').bind(e.list_id, 'active').first();
        recipientCount = count?.c || 0;
      } else {
        const count = await db.prepare('SELECT COUNT(DISTINCT lead_id) as c FROM subscriptions WHERE status = ?').bind('active').first();
        recipientCount = count?.c || 0;
      }
      let out = `📬 **Campaign Preview**\n\n**Subject:** ${e.subject}\n**List:** ${e.list_name || '(all)'}\n**Recipients:** ${recipientCount}\n`;
      if (recipientCount === 0) out += `\n⚠️ No subscribers will receive this!`;
      return out;
    }
    case "courier_campaign_stats": {
      const e = await db.prepare('SELECT * FROM emails WHERE id = ?').bind(args.campaign_id).first();
      if (!e) return "⛔ Campaign not found";
      let stats = { sent: 0, opened: 0, clicked: 0, bounced: 0 };
      try {
        const result = await db.prepare('SELECT COUNT(*) as sent, SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened, SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked, SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) as bounced FROM email_sends WHERE email_id = ?').bind(args.campaign_id).first();
        if (result) stats = result;
      } catch (err) {}
      let topLinks = [];
      try {
        const result = await db.prepare('SELECT ec.url, COUNT(*) as clicks FROM email_clicks ec JOIN email_sends es ON ec.send_id = es.id WHERE es.email_id = ? GROUP BY ec.url ORDER BY clicks DESC LIMIT 5').bind(args.campaign_id).all();
        topLinks = result.results || [];
      } catch (err) {}
      const sent = stats?.sent || 0, opened = stats?.opened || 0, clicked = stats?.clicked || 0, bounced = stats?.bounced || 0;
      let out = `📊 **Campaign Stats: ${e.subject}**\n\n**Status:** ${e.status}\n`;
      if (e.sent_at) out += `**Sent:** ${e.sent_at}\n`;
      out += `\n**Delivery:**\n• Sent: ${sent}\n• Bounced: ${bounced} (${sent ? Math.round(bounced/sent*100) : 0}%)\n`;
      out += `\n**Engagement:**\n• Opened: ${opened} (${sent ? Math.round(opened/sent*100) : 0}%)\n• Clicked: ${clicked} (${sent ? Math.round(clicked/sent*100) : 0}%)\n• Click-to-Open: ${opened ? Math.round(clicked/opened*100) : 0}%\n`;
      if (topLinks.length > 0) {
        out += `\n**Top Clicked Links:**\n`;
        for (const link of topLinks) out += `• ${link.url.length > 50 ? link.url.slice(0, 47) + '...' : link.url} (${link.clicks})\n`;
      }
      return out;
    }
    case "courier_duplicate_campaign": {
      const orig = await db.prepare('SELECT * FROM emails WHERE id = ?').bind(args.campaign_id).first();
      if (!orig) return "⛔ Campaign not found";
      const id = generateId(); const now = new Date().toISOString();
      await db.prepare('INSERT INTO emails (id, subject, body_html, list_id, title, preview_text, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'draft\', ?, ?)').bind(id, `Copy of ${orig.subject}`, orig.body_html, orig.list_id, orig.title ? `Copy of ${orig.title}` : null, orig.preview_text, now, now).run();
      return `✅ Campaign duplicated\nNew ID: ${id}`;
    }
    case "courier_schedule_campaign": {
      await db.prepare('UPDATE emails SET status = ?, scheduled_at = ?, updated_at = ? WHERE id = ?').bind('scheduled', args.scheduled_at, new Date().toISOString(), args.campaign_id).run();
      return `⏰ Campaign scheduled for **${new Date(args.scheduled_at).toLocaleString()}**`;
    }
    case "courier_cancel_schedule": {
      await db.prepare('UPDATE emails SET status = ?, scheduled_at = NULL, updated_at = ? WHERE id = ?').bind('draft', new Date().toISOString(), args.campaign_id).run();
      return "✅ Schedule cancelled - campaign returned to draft";
    }
    
    // ==================== FIXED: courier_send_test - Now actually sends via Resend ====================
    case "courier_send_test": {
      // Validate email
      if (!args.email || !isValidEmail(args.email)) {
        return "⛔ Valid email address required";
      }
      
      // Get campaign with list info
      // Bind audit: 1 ?, 1 bind ✅
      const email = await db.prepare(`
        SELECT e.*, l.from_name, l.from_email, l.campaign_template_id 
        FROM emails e 
        LEFT JOIN lists l ON e.list_id = l.id 
        WHERE e.id = ?
      `).bind(args.campaign_id).first();
      
      if (!email) return "⛔ Campaign not found";
      
      // Get template if list has one
      let template = null;
      if (email.campaign_template_id) {
        // Bind audit: 1 ?, 1 bind ✅
        template = await db.prepare('SELECT * FROM templates WHERE id = ?')
          .bind(email.campaign_template_id).first();
      }
      
      // Create fake subscriber for rendering
      const fakeSubscriber = { name: 'Test User', email: args.email };
      const fakeSendId = 'test-' + generateId();
      const baseUrl = 'https://email-bot-server.micaiah-tasks.workers.dev';
      
      // Render the email with template
      const renderedHtml = renderEmail(email, fakeSubscriber, fakeSendId, baseUrl, email, template);
      
      try {
        // Actually send via Resend
        const messageId = await sendEmailViaSES(
          env,
          args.email,
          '[TEST] ' + email.subject,
          renderedHtml,
          email.body_text,
          email.from_name,
          email.from_email
        );
        
        return `✅ Test email sent to **${args.email}**\nResend Message ID: ${messageId}\nUsed template: ${template ? template.name : 'none'}`;
      } catch (err) {
        console.error('Send test email error:', err);
        return `⛔ Failed to send test email: ${err.message}`;
      }
    }
    
    // ==================== FIXED: courier_send_now - Now actually sends to all subscribers ====================
    case "courier_send_now": {
      // Get campaign with list info
      // Bind audit: 1 ?, 1 bind ✅
      const email = await db.prepare(`
        SELECT e.*, l.from_name, l.from_email, l.campaign_template_id 
        FROM emails e 
        LEFT JOIN lists l ON e.list_id = l.id 
        WHERE e.id = ?
      `).bind(args.campaign_id).first();
      
      if (!email) return "⛔ Campaign not found";
      if (email.status === 'sent') return "⛔ Campaign already sent";
      
      // Get template if list has one
      let template = null;
      if (email.campaign_template_id) {
        // Bind audit: 1 ?, 1 bind ✅
        template = await db.prepare('SELECT * FROM templates WHERE id = ?')
          .bind(email.campaign_template_id).first();
      }
      
      // Get subscribers
      let subscribers;
      if (email.list_id) {
        // Bind audit: 2 ?, 2 binds ✅
        subscribers = await db.prepare(`
          SELECT l.id, l.email, l.name, s.id as subscription_id
          FROM subscriptions s
          JOIN leads l ON s.lead_id = l.id
          WHERE s.list_id = ? AND s.status = 'active'
        `).bind(email.list_id).all();
      } else {
        // Send to all non-bounced leads
        subscribers = await db.prepare(`
          SELECT id, email, name FROM leads 
          WHERE unsubscribed_at IS NULL AND (bounce_count IS NULL OR bounce_count < 3)
        `).all();
      }
      
      if (!subscribers.results || subscribers.results.length === 0) {
        // Mark as sent with 0 count
        const now = new Date().toISOString();
        // Bind audit: 4 ?, 4 binds ✅
        await db.prepare(`
          UPDATE emails SET status = 'sent', sent_at = ?, sent_count = 0, updated_at = ? WHERE id = ?
        `).bind(now, now, args.campaign_id).run();
        
        return "⚠️ No active subscribers found - campaign marked as sent with 0 recipients";
      }
      
      const baseUrl = 'https://email-bot-server.micaiah-tasks.workers.dev';
      let sent = 0;
      let failed = 0;
      const errors = [];
      
      // Send to each subscriber
      for (const subscriber of subscribers.results) {
        try {
          const sendId = generateId();
          const renderedHtml = renderEmail(email, subscriber, sendId, baseUrl, email, template);
          
          const messageId = await sendEmailViaSES(
            env,
            subscriber.email,
            email.subject,
            renderedHtml,
            email.body_text,
            email.from_name,
            email.from_email
          );
          
          // Record the send
          // Bind audit: 6 ?, 6 binds ✅
          await db.prepare(`
            INSERT INTO email_sends (id, email_id, lead_id, subscription_id, ses_message_id, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'sent', ?)
          `).bind(sendId, args.campaign_id, subscriber.id, subscriber.subscription_id || null, messageId, new Date().toISOString()).run();
          
          sent++;
        } catch (e) {
          failed++;
          errors.push({ email: subscriber.email, error: e.message });
          console.error('Failed to send to ' + subscriber.email + ':', e);
        }
      }
      
      // Update campaign status
      const now = new Date().toISOString();
      // Bind audit: 4 ?, 4 binds ✅
      await db.prepare(`
        UPDATE emails SET status = 'sent', sent_at = ?, sent_count = ?, updated_at = ? WHERE id = ?
      `).bind(now, sent, now, args.campaign_id).run();
      
      let out = `✅ **Campaign sent!**\n\n• Delivered: ${sent}\n• Failed: ${failed}\n• Total: ${subscribers.results.length}`;
      if (template) out += `\n• Template: ${template.name}`;
      if (errors.length > 0) {
        out += `\n\n**Errors (first 5):**`;
        for (const err of errors.slice(0, 5)) {
          out += `\n• ${err.email}: ${err.error}`;
        }
      }
      return out;
    }
    
    case "courier_list_sequences": {
      let query = `SELECT s.*, l.name as list_name, (SELECT COUNT(*) FROM sequence_steps WHERE sequence_id = s.id) as step_count, (SELECT COUNT(*) FROM sequence_enrollments WHERE sequence_id = s.id AND status = 'active') as active_enrollments FROM sequences s LEFT JOIN lists l ON s.list_id = l.id`;
      const conditions = []; const params = [];
      if (args.list_id) { conditions.push('s.list_id = ?'); params.push(args.list_id); }
      if (args.status) { conditions.push('s.status = ?'); params.push(args.status); }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY s.created_at DESC';
      const results = await db.prepare(query).bind(...params).all();
      if (!results.results?.length) return "📭 No sequences found";
      let out = `🔄 **Email Sequences** (${results.results.length})\n\n`;
      for (const s of results.results) {
        const icon = s.status === 'active' ? '✅' : s.status === 'paused' ? '⏸️' : '📝';
        let triggerDisplay = s.trigger_type;
        if (s.trigger_type === 'tag' && s.trigger_value) triggerDisplay = `tag: "${s.trigger_value}"`;
        else if (s.trigger_value) triggerDisplay = `${s.trigger_type} (${s.trigger_value})`;
        out += `${icon} **${s.name}**\n   List: ${s.list_name || '(none)'}\n   Trigger: ${triggerDisplay}\n   Steps: ${s.step_count || 0} | Active: ${s.active_enrollments || 0}\n   ID: ${s.id}\n\n`;
      }
      return out;
    }
    case "courier_get_sequence": {
      const s = await db.prepare('SELECT s.*, l.name as list_name FROM sequences s LEFT JOIN lists l ON s.list_id = l.id WHERE s.id = ?').bind(args.sequence_id).first();
      if (!s) return "⛔ Sequence not found";
      const steps = await db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position ASC').bind(args.sequence_id).all();
      const stats = await db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'active\' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN status = \'completed\' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status = \'cancelled\' THEN 1 ELSE 0 END) as cancelled FROM sequence_enrollments WHERE sequence_id = ?').bind(args.sequence_id).first();
      const icon = s.status === 'active' ? '✅' : s.status === 'paused' ? '⏸️' : '📝';
      let triggerDisplay = s.trigger_type;
      if (s.trigger_type === 'tag' && s.trigger_value) triggerDisplay = `tag: "${s.trigger_value}"`;
      else if (s.trigger_value) triggerDisplay = `${s.trigger_type} (${s.trigger_value})`;
      let out = `${icon} **${s.name}**\n\n**ID:** ${s.id}\n**Status:** ${s.status}\n**List:** ${s.list_name || '(none)'}\n**Trigger:** ${triggerDisplay}\n`;
      if (s.description) out += `**Description:** ${s.description}\n`;
      out += `\n**Enrollments:**\n• Total: ${stats?.total || 0}\n• Active: ${stats?.active || 0}\n• Completed: ${stats?.completed || 0}\n• Cancelled: ${stats?.cancelled || 0}\n`;
      if (steps.results?.length) {
        out += `\n**Steps:**\n`;
        for (const step of steps.results) {
          const delay = step.delay_minutes === 0 ? 'Immediately' : step.delay_minutes < 60 ? `${step.delay_minutes}m` : step.delay_minutes < 1440 ? `${Math.round(step.delay_minutes / 60)}h` : `${Math.round(step.delay_minutes / 1440)}d`;
          const sendTime = step.send_at_time ? ` @ ${step.send_at_time}` : '';
          out += `${step.position}. [${delay}${sendTime}] ${step.subject}${step.status !== 'active' ? ` (${step.status})` : ''}\n   ID: ${step.id}\n`;
        }
      } else { out += `\n⚠️ No steps configured yet.`; }
      return out;
    }
    case "courier_create_sequence": {
      const id = generateId(); const now = new Date().toISOString();
      await db.prepare('INSERT INTO sequences (id, name, list_id, description, trigger_type, trigger_value, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'draft\', ?, ?)').bind(id, args.name, args.list_id, args.description || null, args.trigger_type || 'subscribe', args.trigger_value || null, now, now).run();
      let msg = `✅ Sequence created: **${args.name}**\nID: ${id}\nStatus: draft`;
      if (args.trigger_type === 'tag' && args.trigger_value) msg += `\nTrigger: tag "${args.trigger_value}"`;
      msg += `\n\nNext: Add steps with courier_add_sequence_step`;
      return msg;
    }
    case "courier_update_sequence": {
      const updates = []; const values = [];
      if (args.name !== undefined) { updates.push('name = ?'); values.push(args.name); }
      if (args.description !== undefined) { updates.push('description = ?'); values.push(args.description); }
      if (args.status !== undefined) { updates.push('status = ?'); values.push(args.status); }
      if (args.trigger_type !== undefined) { updates.push('trigger_type = ?'); values.push(args.trigger_type); }
      if (args.trigger_value !== undefined) { updates.push('trigger_value = ?'); values.push(args.trigger_value); }
      if (updates.length === 0) return "⛔ No updates provided";
      updates.push('updated_at = ?'); values.push(new Date().toISOString()); values.push(args.sequence_id);
      await db.prepare(`UPDATE sequences SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

      // When activating a subscribe-triggered sequence, link it as the list's welcome_sequence_id
      if (args.status === 'active') {
        try {
          const seq = await db.prepare(
            'SELECT id, trigger_type, list_id FROM sequences WHERE id = ?'
          ).bind(args.sequence_id).first();
          if (seq && seq.trigger_type === 'subscribe' && seq.list_id) {
            const linkNow = new Date().toISOString();
            await db.prepare(
              'UPDATE lists SET welcome_sequence_id = ?, updated_at = ? WHERE id = ? AND (welcome_sequence_id IS NULL OR welcome_sequence_id = ?)'
            ).bind(seq.id, linkNow, seq.list_id, seq.id).run();
          }
        } catch (e) {
          console.error('Failed to link welcome_sequence_id:', e);
        }
      }

      let msg = '✅ Sequence updated';
      if (args.status === 'active') msg += '\n\n🟢 Sequence is now ACTIVE - new subscribers will be auto-enrolled';
      return msg;
    }
    case "courier_delete_sequence": {
      await db.prepare('DELETE FROM sequence_steps WHERE sequence_id = ?').bind(args.sequence_id).run();
      await db.prepare('DELETE FROM sequence_enrollments WHERE sequence_id = ?').bind(args.sequence_id).run();
      await db.prepare('DELETE FROM sequences WHERE id = ?').bind(args.sequence_id).run();
      return "✅ Sequence deleted";
    }
    case "courier_add_sequence_step": {
      const id = generateId(); const now = new Date().toISOString();
      const last = await db.prepare('SELECT MAX(position) as pos FROM sequence_steps WHERE sequence_id = ?').bind(args.sequence_id).first();
      const position = (last?.pos || 0) + 1;
      const sendAtTime = args.send_at_time || null;
      await db.prepare('INSERT INTO sequence_steps (id, sequence_id, position, subject, body_html, delay_minutes, preview_text, send_at_time, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'active\', ?, ?)').bind(id, args.sequence_id, position, args.subject, args.body_html, args.delay_minutes || 0, args.preview_text || null, sendAtTime, now, now).run();
      const delay = (args.delay_minutes || 0) === 0 ? 'immediately' : args.delay_minutes < 60 ? `after ${args.delay_minutes} minutes` : args.delay_minutes < 1440 ? `after ${Math.round(args.delay_minutes / 60)} hours` : `after ${Math.round(args.delay_minutes / 1440)} days`;
      let msg = `✅ Step ${position} added: **${args.subject}**\nSends: ${delay}`;
      if (sendAtTime) msg += ` at ${sendAtTime}`;
      msg += `\nID: ${id}`;
      return msg;
    }
    case "courier_update_sequence_step": {
      const updates = []; const values = [];
      if (args.subject !== undefined) { updates.push('subject = ?'); values.push(args.subject); }
      if (args.body_html !== undefined) { updates.push('body_html = ?'); values.push(args.body_html); }
      if (args.delay_minutes !== undefined) { updates.push('delay_minutes = ?'); values.push(args.delay_minutes); }
      if (args.preview_text !== undefined) { updates.push('preview_text = ?'); values.push(args.preview_text); }
      if (args.status !== undefined) { updates.push('status = ?'); values.push(args.status); }
      if (args.send_at_time !== undefined) {
        updates.push('send_at_time = ?');
        if (args.send_at_time === 'null' || args.send_at_time === '' || args.send_at_time === null) { values.push(null); }
        else { values.push(args.send_at_time); }
      }
      if (updates.length === 0) return "⛔ No updates provided";
      updates.push('updated_at = ?'); values.push(new Date().toISOString()); values.push(args.step_id);
      await db.prepare(`UPDATE sequence_steps SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      let msg = "✅ Step updated";
      if (args.send_at_time === 'null' || args.send_at_time === '' || args.send_at_time === null) msg += "\n⏰ Send time cleared - will now send based on delay only";
      else if (args.send_at_time) msg += `\n⏰ Send time set to ${args.send_at_time}`;
      return msg;
    }
    case "courier_delete_sequence_step": {
      await db.prepare('DELETE FROM sequence_steps WHERE id = ?').bind(args.step_id).run();
      return "✅ Step deleted";
    }
    case "courier_reorder_sequence_steps": {
      for (let i = 0; i < args.step_ids.length; i++) {
        await db.prepare('UPDATE sequence_steps SET position = ? WHERE id = ?').bind(i + 1, args.step_ids[i]).run();
      }
      return "✅ Steps reordered";
    }
    case "courier_enroll_in_sequence": {
      const lead = await db.prepare('SELECT * FROM leads WHERE email = ?').bind(args.email).first();
      if (!lead) return "⛔ Email not found in leads";
      const seq = await db.prepare('SELECT list_id FROM sequences WHERE id = ?').bind(args.sequence_id).first();
      if (!seq) return "⛔ Sequence not found";
      const sub = await db.prepare('SELECT id FROM subscriptions WHERE lead_id = ? AND list_id = ?').bind(lead.id, seq.list_id).first();
      if (!sub) return "⛔ Lead is not subscribed to this sequence's list";
      const id = generateId(); const now = new Date().toISOString();
      await db.prepare('INSERT INTO sequence_enrollments (id, subscription_id, sequence_id, current_step, status, enrolled_at, created_at) VALUES (?, ?, ?, 1, \'active\', ?, ?)').bind(id, sub.id, args.sequence_id, now, now).run();
      return `✅ Enrolled **${args.email}** in sequence\nEnrollment ID: ${id}`;
    }
    case "courier_sequence_enrollments": {
      let query = 'SELECT se.*, l.email, l.name FROM sequence_enrollments se JOIN subscriptions s ON se.subscription_id = s.id JOIN leads l ON s.lead_id = l.id WHERE se.sequence_id = ?';
      const params = [args.sequence_id];
      if (args.status) { query += ' AND se.status = ?'; params.push(args.status); }
      query += ' ORDER BY se.enrolled_at DESC LIMIT ?'; params.push(args.limit || 50);
      const results = await db.prepare(query).bind(...params).all();
      if (!results.results?.length) return "📭 No enrollments found";
      let out = `👥 **Sequence Enrollments** (${results.results.length})\n\n`;
      for (const e of results.results) {
        const icon = e.status === 'active' ? '🟢' : e.status === 'completed' ? '✅' : '❌';
        out += `${icon} ${e.name || '(no name)'} <${e.email}>\n   Step: ${e.current_step} | Enrolled: ${e.enrolled_at?.split('T')[0]}\n`;
      }
      return out;
    }
    
    // ==================== FIXED: courier_list_subscribers - Now resolves slug to UUID ====================
    case "courier_list_subscribers": {
      let query, params;
      if (args.list_id) {
        // First resolve the list by ID or slug
        // Bind audit: 2 ?, 2 binds ✅
        const list = await db.prepare('SELECT id, name FROM lists WHERE id = ? OR slug = ?')
          .bind(args.list_id, args.list_id).first();
        if (!list) return "⛔ List not found";
        
        // Bind audit: 2 ?, 2 binds ✅
        query = "SELECT s.id as subscription_id, s.subscribed_at, l.email, l.name FROM subscriptions s JOIN leads l ON s.lead_id = l.id WHERE s.list_id = ? AND s.status = 'active' ORDER BY s.subscribed_at DESC LIMIT ?";
        params = [list.id, args.limit || 50];
      } else {
        query = 'SELECT l.id, l.email, l.name, l.created_at FROM leads l ORDER BY l.created_at DESC LIMIT ?';
        params = [args.limit || 50];
      }
      const results = await db.prepare(query).bind(...params).all();
      if (!results.results?.length) return "📭 No subscribers found";
      let out = `👥 **Subscribers** (${results.results.length})\n\n`;
      for (const s of results.results.slice(0, 30)) out += `• ${s.name || '(no name)'} <${s.email}>\n  ID: ${s.subscription_id || s.id}\n`;
      if (results.results.length > 30) out += `\n... and ${results.results.length - 30} more`;
      return out;
    }
    
    case "courier_add_subscriber": {
      // Validate email
      if (!args.email || !isValidEmail(args.email)) {
        return "⛔ Valid email address required";
      }
      
      // Find list by ID or slug
      // Bind audit: 2 ?, 2 binds ✅
      let list = await db.prepare('SELECT * FROM lists WHERE id = ? OR slug = ?')
        .bind(args.list_id, args.list_id).first();
      if (!list) {
        return "⛔ List not found";
      }
      
      const email = args.email.toLowerCase().trim();
      const now = new Date().toISOString();
      
      // Check if lead exists
      // Bind audit: 1 ?, 1 bind ✅
      let lead = await db.prepare('SELECT * FROM leads WHERE email = ?')
        .bind(email).first();
      let leadId;
      
      if (!lead) {
        // Create new lead
        // Bind audit: 5 ?, 5 binds ✅
        const result = await db.prepare(`
          INSERT INTO leads (email, name, source, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(email, args.name || null, 'manual', now, now).run();
        leadId = result.meta.last_row_id;
      } else {
        leadId = lead.id;
      }
      
      // Check for existing subscription
      // Bind audit: 2 ?, 2 binds ✅
      const existingSub = await db.prepare(
        'SELECT * FROM subscriptions WHERE lead_id = ? AND list_id = ?'
      ).bind(leadId, list.id).first();
      
      if (existingSub) {
        if (existingSub.status === 'active') {
          return `⚠️ **${email}** is already subscribed to **${list.name}**`;
        }
        // Reactivate
        // Bind audit: 2 ?, 2 binds ✅
        await db.prepare(`
          UPDATE subscriptions SET status = 'active', unsubscribed_at = NULL, subscribed_at = ? WHERE id = ?
        `).bind(now, existingSub.id).run();
        return `✅ Reactivated **${email}** on **${list.name}**\nSubscription ID: ${existingSub.id}`;
      }
      
      // Create new subscription
      const subId = generateId();
      // Bind audit: 6 ?, 6 binds ✅
      await db.prepare(`
        INSERT INTO subscriptions (id, lead_id, list_id, status, source, subscribed_at, created_at)
        VALUES (?, ?, ?, 'active', 'manual', ?, ?)
      `).bind(subId, leadId, list.id, now, now).run();
      
      return `✅ Added **${email}**${args.name ? ` (${args.name})` : ''} to **${list.name}**\nSubscription ID: ${subId}`;
    }
    case "courier_delete_subscriber": {
      const ids = args.subscription_ids || (args.subscription_id ? [args.subscription_id] : []);
      if (!ids.length) return "⛔ Provide subscription_id or subscription_ids";
      const now = new Date().toISOString();
      for (const id of ids) {
        await db.prepare('DELETE FROM sequence_enrollments WHERE subscription_id = ?').bind(id).run();
        if (args.permanent) {
          const sub = await db.prepare('SELECT lead_id FROM subscriptions WHERE id = ?').bind(id).first();
          await db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id).run();
          if (sub?.lead_id) {
            const otherSubs = await db.prepare('SELECT COUNT(*) as c FROM subscriptions WHERE lead_id = ?').bind(sub.lead_id).first();
            if (!otherSubs?.c || otherSubs.c === 0) {
              await db.prepare('DELETE FROM email_sends WHERE lead_id = ?').bind(sub.lead_id).run();
              await db.prepare('DELETE FROM touches WHERE lead_id = ?').bind(sub.lead_id).run();
              await db.prepare('DELETE FROM leads WHERE id = ?').bind(sub.lead_id).run();
            }
          }
        } else {
          await db.prepare("UPDATE subscriptions SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?").bind(now, id).run();
        }
      }
      return `✅ ${ids.length} subscriber(s) ${args.permanent ? 'permanently deleted' : 'unsubscribed'}`;
    }
    case "courier_stats": {
      let totalLeads = 0, todayLeads = 0, weekLeads = 0, monthLeads = 0;
      let activeSubs = 0, unsubscribed = 0;
      let emailStats = { total_sends: 0, opens: 0, clicks: 0, bounces: 0 };
      let campaigns = { total: 0, drafts: 0, scheduled: 0, sent: 0 };
      let sequences = { total: 0, active: 0, drafts: 0 };
      let activeEnrollments = 0, lists = 0;
      try { const r = await db.prepare('SELECT COUNT(*) as c FROM leads').first(); totalLeads = r?.c || 0; } catch (e) {}
      try { const r = await db.prepare("SELECT COUNT(*) as c FROM leads WHERE date(created_at) = date('now')").first(); todayLeads = r?.c || 0; } catch (e) {}
      try { const r = await db.prepare("SELECT COUNT(*) as c FROM leads WHERE created_at > datetime('now', '-7 days')").first(); weekLeads = r?.c || 0; } catch (e) {}
      try { const r = await db.prepare("SELECT COUNT(*) as c FROM leads WHERE created_at > datetime('now', '-30 days')").first(); monthLeads = r?.c || 0; } catch (e) {}
      try { const r = await db.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active'").first(); activeSubs = r?.c || 0; } catch (e) {}
      try { const r = await db.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'unsubscribed'").first(); unsubscribed = r?.c || 0; } catch (e) {}
      try { const r = await db.prepare("SELECT COUNT(*) as total_sends, SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opens, SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicks, SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) as bounces FROM email_sends WHERE created_at > datetime('now', '-30 days')").first(); if (r) emailStats = r; } catch (e) {}
      try { const r = await db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts, SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled, SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent FROM emails").first(); if (r) campaigns = r; } catch (e) {}
      try { const r = await db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts FROM sequences").first(); if (r) sequences = r; } catch (e) {}
      try { const r = await db.prepare("SELECT COUNT(*) as c FROM sequence_enrollments WHERE status = 'active'").first(); activeEnrollments = r?.c || 0; } catch (e) {}
      try { const r = await db.prepare("SELECT COUNT(*) as c FROM lists WHERE status != 'archived'").first(); lists = r?.c || 0; } catch (e) {}
      const sent = emailStats?.total_sends || 0, opens = emailStats?.opens || 0, clicks = emailStats?.clicks || 0, bounces = emailStats?.bounces || 0;
      let out = `📊 **Courier Platform Stats**\n\n`;
      out += `**📧 Lists & Subscribers**\n• Lists: ${lists}\n• Active Subscriptions: ${activeSubs}\n• Unsubscribed: ${unsubscribed}\n• Total Leads: ${totalLeads}\n`;
      out += `\n**📈 Lead Growth**\n• Today: +${todayLeads}\n• This Week: +${weekLeads}\n• This Month: +${monthLeads}\n`;
      out += `\n**📨 Campaigns**\n• Total: ${campaigns?.total || 0}\n• Drafts: ${campaigns?.drafts || 0}\n• Scheduled: ${campaigns?.scheduled || 0}\n• Sent: ${campaigns?.sent || 0}\n`;
      out += `\n**🔄 Sequences**\n• Total: ${sequences?.total || 0}\n• Active: ${sequences?.active || 0}\n• Drafts: ${sequences?.drafts || 0}\n• Active Enrollments: ${activeEnrollments}\n`;
      out += `\n**📬 Email Performance (Last 30 Days)**\n• Emails Sent: ${sent}\n• Opens: ${opens} (${sent ? Math.round(opens/sent*100) : 0}%)\n• Clicks: ${clicks} (${sent ? Math.round(clicks/sent*100) : 0}%)\n• Bounces: ${bounces} (${sent ? Math.round(bounces/sent*100) : 0}%)\n`;
      if (opens > 0) out += `• Click-to-Open Rate: ${Math.round(clicks/opens*100)}%\n`;
      return out;
    }
    default:
      return `⛔ Unknown tool: ${name}`;
  }
}

// MCP Protocol Handler
export async function handleMCP(request, env) {
  const url = new URL(request.url);
  if (url.searchParams.get('debug') === 'init') {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'courier', version: '1.0.0' }, capabilities: { tools: {} } } }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  if (url.searchParams.get('debug') === 'tools') {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: TOOLS } }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
  if (url.searchParams.get('debug') === 'test') {
    try {
      const result = await executeTool('courier_stats', {}, env);
      return new Response(JSON.stringify({ success: true, result }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    } catch (error) {
      return new Response(JSON.stringify({ success: false, error: error.message, stack: error.stack }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (request.method === 'GET') {
    const messageEndpoint = `${url.origin}/sse`;
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    (async () => {
      try {
        await writer.write(encoder.encode(`event: endpoint\ndata: ${JSON.stringify({ url: messageEndpoint })}\n\n`));
        for (let i = 0; i < 6; i++) { await new Promise(r => setTimeout(r, 5000)); await writer.write(encoder.encode(': keepalive\n\n')); }
      } catch (e) {} finally { try { await writer.close(); } catch (e) {} }
    })();
    return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }
  if (request.method === 'POST') {
    let id = null;
    try {
      const message = await request.json();
      id = message.id;
      const { method, params } = message;
      let result;
      switch (method) {
        case 'initialize':
          result = { protocolVersion: '2024-11-05', serverInfo: { name: 'courier', version: '1.0.0' }, capabilities: { tools: {} } };
          break;
        case 'tools/list':
          result = { tools: TOOLS };
          break;
        case 'tools/call':
          try {
            const toolResult = await executeTool(params.name, params.arguments || {}, env);
            result = { content: [{ type: 'text', text: toolResult }] };
          } catch (toolError) {
            result = { content: [{ type: 'text', text: `⛔ Error: ${toolError.message}` }], isError: true };
          }
          break;
        case 'notifications/initialized':
          return new Response(JSON.stringify({ jsonrpc: '2.0', id, result: {} }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
        default:
          return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    } catch (error) {
      console.error('MCP Error:', error);
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: error.message || 'Internal error' } }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
  }
  return new Response('Method not allowed', { status: 405 });
}
