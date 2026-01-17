/**
 * Courier MCP Server
 * Exposes email marketing tools directly to Claude via MCP protocol
 */

import { generateId } from './lib.js';

// Tool definitions
const TOOLS = [
  // Lists
  {
    name: "courier_list_lists",
    description: "List all email lists",
    inputSchema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "courier_get_list",
    description: "Get details of a specific list",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "List ID or slug" }
      },
      required: ["list_id"]
    }
  },
  {
    name: "courier_create_list",
    description: "Create a new email list",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "List name" },
        from_name: { type: "string", description: "Sender name" },
        from_email: { type: "string", description: "Sender email" },
        slug: { type: "string", description: "URL-safe identifier" },
        description: { type: "string" },
        reply_to: { type: "string" },
        notify_email: { type: "string", description: "Email for new subscriber notifications" },
        campaign_template_id: { type: "string", description: "Template ID for campaign emails" },
        sequence_template_id: { type: "string", description: "Template ID for sequence emails" }
      },
      required: ["name", "from_name", "from_email"]
    }
  },
  {
    name: "courier_update_list",
    description: "Update an existing list",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string" },
        name: { type: "string" },
        slug: { type: "string" },
        from_name: { type: "string" },
        from_email: { type: "string" },
        reply_to: { type: "string" },
        notify_email: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["active", "paused"] },
        campaign_template_id: { type: "string", description: "Template ID for campaign emails" },
        sequence_template_id: { type: "string", description: "Template ID for sequence emails" }
      },
      required: ["list_id"]
    }
  },
  {
    name: "courier_delete_list",
    description: "Delete a list permanently. Cannot delete lists with active subscribers unless force=true",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string", description: "List ID to delete" },
        force: { type: "boolean", default: false, description: "Force delete even if list has subscribers (will unsubscribe them)" }
      },
      required: ["list_id"]
    }
  },
  // Templates
  {
    name: "courier_list_templates",
    description: "List all email templates",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string" },
        list_id: { type: "string" }
      },
      required: []
    }
  },
  {
    name: "courier_get_template",
    description: "Get a specific template",
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "string" }
      },
      required: ["template_id"]
    }
  },
  {
    name: "courier_add_template",
    description: "Create a new email template",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        subject: { type: "string" },
        body_html: { type: "string", description: "HTML email content" },
        description: { type: "string" },
        category: { type: "string" },
        list_id: { type: "string" }
      },
      required: ["name", "subject", "body_html"]
    }
  },
  {
    name: "courier_delete_template",
    description: "Delete a template",
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "string" }
      },
      required: ["template_id"]
    }
  },
  // Campaigns
  {
    name: "courier_list_campaigns",
    description: "List email campaigns with optional filtering and pagination",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "scheduled", "sent"] },
        list_id: { type: "string" },
        limit: { type: "number", default: 20, description: "Max results (default 20, max 100)" },
        offset: { type: "number", default: 0, description: "Skip this many results for pagination" }
      },
      required: []
    }
  },
  {
    name: "courier_get_campaign",
    description: "Get campaign details",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" }
      },
      required: ["campaign_id"]
    }
  },
  {
    name: "courier_create_campaign",
    description: "Create a new email campaign",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        body_html: { type: "string" },
        list_id: { type: "string" },
        title: { type: "string" },
        preview_text: { type: "string" }
      },
      required: ["subject", "body_html"]
    }
  },
  {
    name: "courier_update_campaign",
    description: "Update a campaign",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        subject: { type: "string" },
        body_html: { type: "string" },
        list_id: { type: "string" },
        title: { type: "string" },
        preview_text: { type: "string" }
      },
      required: ["campaign_id"]
    }
  },
  {
    name: "courier_delete_campaign",
    description: "Delete a draft campaign (cannot delete sent campaigns)",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" }
      },
      required: ["campaign_id"]
    }
  },
  {
    name: "courier_preview_campaign",
    description: "Preview a campaign and see recipient count",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" }
      },
      required: ["campaign_id"]
    }
  },
  {
    name: "courier_campaign_stats",
    description: "Get campaign statistics",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" }
      },
      required: ["campaign_id"]
    }
  },
  {
    name: "courier_duplicate_campaign",
    description: "Duplicate an existing campaign",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" }
      },
      required: ["campaign_id"]
    }
  },
  {
    name: "courier_schedule_campaign",
    description: "Schedule a campaign for later",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        scheduled_at: { type: "string", description: "ISO 8601 datetime" }
      },
      required: ["campaign_id", "scheduled_at"]
    }
  },
  {
    name: "courier_cancel_schedule",
    description: "Cancel a scheduled campaign",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" }
      },
      required: ["campaign_id"]
    }
  },
  {
    name: "courier_send_test",
    description: "Send a test email",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" },
        email: { type: "string" }
      },
      required: ["campaign_id", "email"]
    }
  },
  {
    name: "courier_send_now",
    description: "Send a campaign immediately",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "string" }
      },
      required: ["campaign_id"]
    }
  },
  // Sequences
  {
    name: "courier_list_sequences",
    description: "List email sequences",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string" },
        status: { type: "string", enum: ["draft", "active", "paused"] }
      },
      required: []
    }
  },
  {
    name: "courier_get_sequence",
    description: "Get sequence details with steps",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string" }
      },
      required: ["sequence_id"]
    }
  },
  {
    name: "courier_create_sequence",
    description: "Create a new email sequence",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        list_id: { type: "string" },
        description: { type: "string" },
        trigger_type: { type: "string", enum: ["subscribe", "manual", "tag"], default: "subscribe" },
        trigger_value: { type: "string", description: "For tag triggers, the tag name that triggers this sequence" }
      },
      required: ["name", "list_id"]
    }
  },
  {
    name: "courier_update_sequence",
    description: "Update a sequence",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string", enum: ["draft", "active", "paused"] },
        trigger_type: { type: "string", enum: ["subscribe", "manual", "tag"] },
        trigger_value: { type: "string" }
      },
      required: ["sequence_id"]
    }
  },
  {
    name: "courier_delete_sequence",
    description: "Delete a sequence",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string" }
      },
      required: ["sequence_id"]
    }
  },
  {
    name: "courier_add_sequence_step",
    description: "Add a step to a sequence",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string" },
        subject: { type: "string" },
        body_html: { type: "string" },
        delay_minutes: { type: "number", default: 0, description: "0=immediate, 1440=1 day, 10080=1 week" },
        preview_text: { type: "string" }
      },
      required: ["sequence_id", "subject", "body_html"]
    }
  },
  {
    name: "courier_update_sequence_step",
    description: "Update a sequence step",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string" },
        step_id: { type: "string" },
        subject: { type: "string" },
        body_html: { type: "string" },
        delay_minutes: { type: "number" },
        preview_text: { type: "string" },
        status: { type: "string", enum: ["active", "paused"] }
      },
      required: ["sequence_id", "step_id"]
    }
  },
  {
    name: "courier_delete_sequence_step",
    description: "Delete a sequence step",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string" },
        step_id: { type: "string" }
      },
      required: ["sequence_id", "step_id"]
    }
  },
  {
    name: "courier_reorder_sequence_steps",
    description: "Reorder sequence steps",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string" },
        step_ids: { type: "array", items: { type: "string" } }
      },
      required: ["sequence_id", "step_ids"]
    }
  },
  {
    name: "courier_enroll_in_sequence",
    description: "Enroll an email in a sequence",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string" },
        email: { type: "string" }
      },
      required: ["sequence_id", "email"]
    }
  },
  {
    name: "courier_sequence_enrollments",
    description: "List sequence enrollments",
    inputSchema: {
      type: "object",
      properties: {
        sequence_id: { type: "string" },
        status: { type: "string", enum: ["active", "completed", "cancelled"] },
        limit: { type: "number", default: 50 }
      },
      required: ["sequence_id"]
    }
  },
  // Subscribers
  {
    name: "courier_list_subscribers",
    description: "List subscribers",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "string" },
        limit: { type: "number", default: 50 }
      },
      required: []
    }
  },
  {
    name: "courier_delete_subscriber",
    description: "Delete/unsubscribe subscribers",
    inputSchema: {
      type: "object",
      properties: {
        subscription_id: { type: "string" },
        subscription_ids: { type: "array", items: { type: "string" } },
        permanent: { type: "boolean", default: false }
      },
      required: []
    }
  },
  // Stats
  {
    name: "courier_stats",
    description: "Get overall platform statistics including opens, clicks, unsubscribes, and performance metrics",
    inputSchema: { type: "object", properties: {}, required: [] }
  }
];

// Tool implementations
async function executeTool(name, args, env) {
  const db = env.DB;
  
  switch (name) {
    // ==================== LISTS ====================
    case "courier_list_lists": {
      const results = await db.prepare(`
        SELECT l.*, 
          (SELECT COUNT(*) FROM subscriptions s WHERE s.list_id = l.id AND s.status = 'active') as subscriber_count,
          ct.name as campaign_template_name,
          st.name as sequence_template_name
        FROM lists l
        LEFT JOIN templates ct ON l.campaign_template_id = ct.id
        LEFT JOIN templates st ON l.sequence_template_id = st.id
        WHERE l.status != 'archived' 
        ORDER BY l.created_at DESC
      `).all();
      if (!results.results?.length) return "📭 No email lists found";
      
      let out = `📋 **Email Lists** (${results.results.length})\n\n`;
      for (const l of results.results) {
        out += `• **${l.name}**${l.status !== 'active' ? ` [${l.status}]` : ''} (${l.subscriber_count || 0} subscribers)\n`;
        out += `  Slug: ${l.slug}\n`;
        out += `  From: ${l.from_name} <${l.from_email}>\n`;
        if (l.notify_email) out += `  📬 Notifications: ${l.notify_email}\n`;
        if (l.sequence_template_name) out += `  📧 Sequence Template: ${l.sequence_template_name}\n`;
        if (l.campaign_template_name) out += `  📨 Campaign Template: ${l.campaign_template_name}\n`;
        out += `  ID: ${l.id}\n\n`;
      }
      return out;
    }
    
    case "courier_get_list": {
      const l = await db.prepare(`
        SELECT l.*, 
          ct.name as campaign_template_name,
          st.name as sequence_template_name
        FROM lists l
        LEFT JOIN templates ct ON l.campaign_template_id = ct.id
        LEFT JOIN templates st ON l.sequence_template_id = st.id
        WHERE l.id = ? OR l.slug = ?
      `).bind(args.list_id, args.list_id).first();
      if (!l) return "⛔ List not found";
      
      const subs = await db.prepare('SELECT COUNT(*) as count FROM subscriptions WHERE list_id = ? AND status = ?').bind(l.id, 'active').first();
      
      let out = `📋 **${l.name}**\n\n`;
      out += `**ID:** ${l.id}\n`;
      out += `**Slug:** ${l.slug}\n`;
      out += `**Status:** ${l.status}\n`;
      out += `**From:** ${l.from_name} <${l.from_email}>\n`;
      if (l.reply_to) out += `**Reply-To:** ${l.reply_to}\n`;
      if (l.notify_email) out += `**Lead Notifications:** ${l.notify_email}\n`;
      if (l.description) out += `**Description:** ${l.description}\n`;
      out += `**Subscribers:** ${subs?.count || 0}\n`;
      out += `\n**Templates:**\n`;
      out += `• Sequence: ${l.sequence_template_name || '⚠️ Not set'} ${l.sequence_template_id ? `(${l.sequence_template_id})` : ''}\n`;
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
      `).bind(
        id, 
        args.name, 
        slug, 
        args.from_name, 
        args.from_email, 
        args.reply_to || null, 
        args.description || null, 
        args.notify_email || null,
        args.campaign_template_id || null,
        args.sequence_template_id || null,
        now, 
        now
      ).run();
      
      let msg = `✅ List created: **${args.name}**\nID: ${id}\nSlug: ${slug}`;
      if (args.notify_email) msg += `\n📬 Lead notifications: ${args.notify_email}`;
      if (args.sequence_template_id) msg += `\n📧 Sequence template linked`;
      if (args.campaign_template_id) msg += `\n📨 Campaign template linked`;
      if (!args.sequence_template_id) msg += `\n\n⚠️ No sequence template set - sequences will use basic styling`;
      return msg;
    }
    
    case "courier_update_list": {
      const updates = [];
      const values = [];
      
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
      
      updates.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(args.list_id);
      
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
      
      const activeSubs = await db.prepare(
        'SELECT COUNT(*) as count FROM subscriptions WHERE list_id = ? AND status = ?'
      ).bind(args.list_id, 'active').first();
      
      const sequences = await db.prepare(
        'SELECT COUNT(*) as count FROM sequences WHERE list_id = ?'
      ).bind(args.list_id).first();
      
      const campaigns = await db.prepare(
        'SELECT COUNT(*) as count FROM emails WHERE list_id = ?'
      ).bind(args.list_id).first();
      
      if (activeSubs?.count > 0 && !args.force) {
        return `⛔ Cannot delete list "${l.name}" - it has ${activeSubs.count} active subscriber(s).\n\n` +
          `**Details:**\n` +
          `• Active Subscribers: ${activeSubs.count}\n` +
          `• Sequences: ${sequences?.count || 0}\n` +
          `• Campaigns: ${campaigns?.count || 0}\n\n` +
          `To delete anyway, use \`force: true\`. This will unsubscribe all subscribers from this list.`;
      }
      
      // Delete sequence enrollments
      await db.prepare(`
        DELETE FROM sequence_enrollments 
        WHERE sequence_id IN (SELECT id FROM sequences WHERE list_id = ?)
      `).bind(args.list_id).run();
      
      // Delete sequence steps
      await db.prepare(`
        DELETE FROM sequence_steps 
        WHERE sequence_id IN (SELECT id FROM sequences WHERE list_id = ?)
      `).bind(args.list_id).run();
      
      // Delete sequences
      await db.prepare('DELETE FROM sequences WHERE list_id = ?').bind(args.list_id).run();
      
      // Delete subscriptions
      await db.prepare('DELETE FROM subscriptions WHERE list_id = ?').bind(args.list_id).run();
      
      // Unlink campaigns
      await db.prepare('UPDATE emails SET list_id = NULL WHERE list_id = ?').bind(args.list_id).run();
      
      // Unlink templates
      await db.prepare('UPDATE templates SET list_id = NULL WHERE list_id = ?').bind(args.list_id).run();
      
      // Delete list
      await db.prepare('DELETE FROM lists WHERE id = ?').bind(args.list_id).run();
      
      return `✅ List "${l.name}" deleted\n\n` +
        `**Cleaned up:**\n` +
        `• ${activeSubs?.count || 0} subscriptions removed\n` +
        `• ${sequences?.count || 0} sequences deleted\n` +
        `• ${campaigns?.count || 0} campaigns unlinked`;
    }
    
    // ==================== TEMPLATES ====================
    case "courier_list_templates": {
      let query = 'SELECT * FROM templates';
      const conditions = [];
      const params = [];
      
      if (args.category) { conditions.push('category = ?'); params.push(args.category); }
      if (args.list_id) { conditions.push('list_id = ?'); params.push(args.list_id); }
      
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY created_at DESC';
      
      const results = await db.prepare(query).bind(...params).all();
      if (!results.results?.length) return "📭 No templates found";
      
      let out = `📧 **Email Templates** (${results.results.length})\n\n`;
      for (const t of results.results) {
        out += `• **${t.name}**${t.category ? ` [${t.category}]` : ''}\n`;
        out += `  Subject: ${t.subject || '(none)'}\n`;
        out += `  ID: ${t.id}\n\n`;
      }
      return out;
    }
    
    case "courier_get_template": {
      const t = await db.prepare('SELECT * FROM templates WHERE id = ?').bind(args.template_id).first();
      if (!t) return "⛔ Template not found";
      
      let out = `📧 **${t.name}**\n\n`;
      out += `ID: ${t.id}\n`;
      out += `Category: ${t.category || '(none)'}\n`;
      out += `Subject: ${t.subject || '(none)'}\n`;
      out += `Description: ${t.description || '(none)'}\n`;
      out += `Created: ${t.created_at}\n\n`;
      out += `---\n\n**HTML Preview:**\n\`\`\`html\n${t.body_html?.slice(0, 500)}${t.body_html?.length > 500 ? '...' : ''}\n\`\`\``;
      return out;
    }
    
    case "courier_add_template": {
      const id = generateId();
      const now = new Date().toISOString();
      
      await db.prepare(`
        INSERT INTO templates (id, name, subject, body_html, description, category, list_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, args.name, args.subject, args.body_html, args.description || null, args.category || null, args.list_id || null, now, now).run();
      
      return `✅ Template created: **${args.name}**\nID: ${id}`;
    }
    
    case "courier_delete_template": {
      await db.prepare('DELETE FROM templates WHERE id = ?').bind(args.template_id).run();
      return "✅ Template deleted";
    }
    
    // ==================== CAMPAIGNS ====================
    case "courier_list_campaigns": {
      const limit = Math.min(Math.max(1, args.limit || 20), 100);
      const offset = Math.max(0, args.offset || 0);
      
      let query = 'SELECT e.*, l.name as list_name FROM emails e LEFT JOIN lists l ON e.list_id = l.id';
      const conditions = [];
      const params = [];
      
      if (args.status) { conditions.push('e.status = ?'); params.push(args.status); }
      if (args.list_id) { conditions.push('e.list_id = ?'); params.push(args.list_id); }
      
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ` ORDER BY e.updated_at DESC LIMIT ? OFFSET ?`;
      params.push(limit, offset);
      
      const results = await db.prepare(query).bind(...params).all();
      
      // Get total count for pagination
      let countQuery = 'SELECT COUNT(*) as total FROM emails e';
      if (conditions.length) {
        countQuery += ' WHERE ' + conditions.join(' AND ').replace(/\?/g, () => {
          const val = params.shift();
          params.push(val);
          return `'${val}'`;
        });
      }
      const total = await db.prepare('SELECT COUNT(*) as total FROM emails').first();
      
      if (!results.results?.length) return "📭 No campaigns found";
      
      let out = `📨 **Email Campaigns** (showing ${results.results.length} of ${total?.total || 0})\n\n`;
      
      for (const e of results.results) {
        const icon = e.status === 'sent' ? '✅' : e.status === 'scheduled' ? '⏰' : '📝';
        out += `${icon} **${e.subject}**\n`;
        out += `   Status: ${e.status}${e.sent_count ? ` (sent to ${e.sent_count})` : ''}`;
        if (e.scheduled_at) out += `\n   Scheduled: ${e.scheduled_at}`;
        out += `\n   List: ${e.list_name || '(all)'}\n`;
        out += `   ID: ${e.id}\n\n`;
      }
      
      if (total?.total > offset + results.results.length) {
        out += `\n📄 _More campaigns available. Use offset: ${offset + limit} to see next page._`;
      }
      
      return out;
    }
    
    case "courier_get_campaign": {
      const e = await db.prepare('SELECT e.*, l.name as list_name FROM emails e LEFT JOIN lists l ON e.list_id = l.id WHERE e.id = ?').bind(args.campaign_id).first();
      if (!e) return "⛔ Campaign not found";
      
      const icon = e.status === 'sent' ? '✅' : e.status === 'scheduled' ? '⏰' : '📝';
      
      let out = `${icon} **${e.subject}**\n\n`;
      out += `**ID:** ${e.id}\n`;
      out += `**Status:** ${e.status}\n`;
      out += `**List:** ${e.list_name || '(all)'}\n`;
      if (e.preview_text) out += `**Preview:** ${e.preview_text}\n`;
      if (e.scheduled_at) out += `**Scheduled:** ${e.scheduled_at}\n`;
      if (e.sent_at) out += `**Sent:** ${e.sent_at}\n`;
      if (e.sent_count) out += `**Sent to:** ${e.sent_count}\n`;
      out += `**Created:** ${e.created_at}\n\n`;
      out += `---\n\n**Content:**\n\`\`\`html\n${e.body_html?.slice(0, 1000)}${e.body_html?.length > 1000 ? '\n...(truncated)' : ''}\n\`\`\``;
      return out;
    }
    
    case "courier_create_campaign": {
      const id = generateId();
      const now = new Date().toISOString();
      
      await db.prepare(`
        INSERT INTO emails (id, subject, body_html, list_id, title, preview_text, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      `).bind(id, args.subject, args.body_html, args.list_id || null, args.title || null, args.preview_text || null, now, now).run();
      
      return `✅ Campaign created: **${args.subject}**\nID: ${id}\nStatus: draft`;
    }
    
    case "courier_update_campaign": {
      const updates = [];
      const values = [];
      
      if (args.subject !== undefined) { updates.push('subject = ?'); values.push(args.subject); }
      if (args.body_html !== undefined) { updates.push('body_html = ?'); values.push(args.body_html); }
      if (args.list_id !== undefined) { updates.push('list_id = ?'); values.push(args.list_id); }
      if (args.title !== undefined) { updates.push('title = ?'); values.push(args.title); }
      if (args.preview_text !== undefined) { updates.push('preview_text = ?'); values.push(args.preview_text); }
      
      if (updates.length === 0) return "⛔ No updates provided";
      
      updates.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(args.campaign_id);
      
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
      
      let out = `📬 **Campaign Preview**\n\n`;
      out += `**Subject:** ${e.subject}\n`;
      out += `**List:** ${e.list_name || '(all)'}\n`;
      out += `**Recipients:** ${recipientCount}\n`;
      
      if (recipientCount === 0) out += `\n⚠️ No subscribers will receive this!`;
      return out;
    }
    
    case "courier_campaign_stats": {
      const e = await db.prepare('SELECT * FROM emails WHERE id = ?').bind(args.campaign_id).first();
      if (!e) return "⛔ Campaign not found";
      
      const stats = await db.prepare(`
        SELECT 
          COUNT(*) as sent,
          SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
          SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicked,
          SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) as bounced
        FROM email_sends WHERE email_id = ?
      `).bind(args.campaign_id).first();
      
      const topLinks = await db.prepare(`
        SELECT ec.url, COUNT(*) as clicks 
        FROM email_clicks ec 
        JOIN email_sends es ON ec.send_id = es.id 
        WHERE es.email_id = ? 
        GROUP BY ec.url 
        ORDER BY clicks DESC 
        LIMIT 5
      `).bind(args.campaign_id).all();
      
      const sent = stats?.sent || 0;
      const opened = stats?.opened || 0;
      const clicked = stats?.clicked || 0;
      const bounced = stats?.bounced || 0;
      
      let out = `📊 **Campaign Stats: ${e.subject}**\n\n`;
      out += `**Status:** ${e.status}\n`;
      if (e.sent_at) out += `**Sent:** ${e.sent_at}\n`;
      out += `\n**Delivery:**\n`;
      out += `• Sent: ${sent}\n`;
      out += `• Bounced: ${bounced} (${sent ? Math.round(bounced/sent*100) : 0}%)\n`;
      out += `\n**Engagement:**\n`;
      out += `• Opened: ${opened} (${sent ? Math.round(opened/sent*100) : 0}%)\n`;
      out += `• Clicked: ${clicked} (${sent ? Math.round(clicked/sent*100) : 0}%)\n`;
      out += `• Click-to-Open: ${opened ? Math.round(clicked/opened*100) : 0}%\n`;
      
      if (topLinks.results?.length > 0) {
        out += `\n**Top Clicked Links:**\n`;
        for (const link of topLinks.results) {
          const shortUrl = link.url.length > 50 ? link.url.slice(0, 47) + '...' : link.url;
          out += `• ${shortUrl} (${link.clicks})\n`;
        }
      }
      
      return out;
    }
    
    case "courier_duplicate_campaign": {
      const orig = await db.prepare('SELECT * FROM emails WHERE id = ?').bind(args.campaign_id).first();
      if (!orig) return "⛔ Campaign not found";
      
      const id = generateId();
      const now = new Date().toISOString();
      
      await db.prepare(`
        INSERT INTO emails (id, subject, body_html, list_id, title, preview_text, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      `).bind(id, `Copy of ${orig.subject}`, orig.body_html, orig.list_id, orig.title ? `Copy of ${orig.title}` : null, orig.preview_text, now, now).run();
      
      return `✅ Campaign duplicated\nNew ID: ${id}`;
    }
    
    case "courier_schedule_campaign": {
      await db.prepare('UPDATE emails SET status = ?, scheduled_at = ?, updated_at = ? WHERE id = ?')
        .bind('scheduled', args.scheduled_at, new Date().toISOString(), args.campaign_id).run();
      
      const date = new Date(args.scheduled_at);
      return `⏰ Campaign scheduled for **${date.toLocaleString()}**`;
    }
    
    case "courier_cancel_schedule": {
      await db.prepare('UPDATE emails SET status = ?, scheduled_at = NULL, updated_at = ? WHERE id = ?')
        .bind('draft', new Date().toISOString(), args.campaign_id).run();
      return "✅ Schedule cancelled - campaign returned to draft";
    }
    
    case "courier_send_test": {
      // For now just return a message - actual sending requires SES integration
      return `✅ Test email would be sent to **${args.email}**\n\n(Note: Actual sending requires campaign send endpoint)`;
    }
    
    case "courier_send_now": {
      // This would trigger the actual send - for now mark as sent
      const now = new Date().toISOString();
      await db.prepare('UPDATE emails SET status = ?, sent_at = ?, updated_at = ? WHERE id = ?')
        .bind('sent', now, now, args.campaign_id).run();
      return `✅ Campaign marked as sent\n\n(Note: Actual sending processes via cron)`;
    }
    
    // ==================== SEQUENCES ====================
    case "courier_list_sequences": {
      let query = `SELECT s.*, l.name as list_name, 
        (SELECT COUNT(*) FROM sequence_steps WHERE sequence_id = s.id) as step_count,
        (SELECT COUNT(*) FROM sequence_enrollments WHERE sequence_id = s.id AND status = 'active') as active_enrollments
        FROM sequences s LEFT JOIN lists l ON s.list_id = l.id`;
      const conditions = [];
      const params = [];
      
      if (args.list_id) { conditions.push('s.list_id = ?'); params.push(args.list_id); }
      if (args.status) { conditions.push('s.status = ?'); params.push(args.status); }
      
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY s.created_at DESC';
      
      const results = await db.prepare(query).bind(...params).all();
      if (!results.results?.length) return "📭 No sequences found";
      
      let out = `🔄 **Email Sequences** (${results.results.length})\n\n`;
      for (const s of results.results) {
        const icon = s.status === 'active' ? '✅' : s.status === 'paused' ? '⏸️' : '📝';
        out += `${icon} **${s.name}**\n`;
        out += `   List: ${s.list_name || '(none)'}\n`;
        
        // Enhanced trigger display
        let triggerDisplay = s.trigger_type;
        if (s.trigger_type === 'tag' && s.trigger_value) {
          triggerDisplay = `tag: "${s.trigger_value}"`;
        } else if (s.trigger_value) {
          triggerDisplay = `${s.trigger_type} (${s.trigger_value})`;
        }
        out += `   Trigger: ${triggerDisplay}\n`;
        
        out += `   Steps: ${s.step_count || 0} | Active: ${s.active_enrollments || 0}\n`;
        out += `   ID: ${s.id}\n\n`;
      }
      return out;
    }
    
    case "courier_get_sequence": {
      const s = await db.prepare('SELECT s.*, l.name as list_name FROM sequences s LEFT JOIN lists l ON s.list_id = l.id WHERE s.id = ?').bind(args.sequence_id).first();
      if (!s) return "⛔ Sequence not found";
      
      const steps = await db.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position ASC').bind(args.sequence_id).all();
      const stats = await db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
        FROM sequence_enrollments WHERE sequence_id = ?
      `).bind(args.sequence_id).first();
      
      const icon = s.status === 'active' ? '✅' : s.status === 'paused' ? '⏸️' : '📝';
      
      let out = `${icon} **${s.name}**\n\n`;
      out += `**ID:** ${s.id}\n`;
      out += `**Status:** ${s.status}\n`;
      out += `**List:** ${s.list_name || '(none)'}\n`;
      
      // Enhanced trigger display
      let triggerDisplay = s.trigger_type;
      if (s.trigger_type === 'tag' && s.trigger_value) {
        triggerDisplay = `tag: "${s.trigger_value}"`;
      } else if (s.trigger_value) {
        triggerDisplay = `${s.trigger_type} (${s.trigger_value})`;
      }
      out += `**Trigger:** ${triggerDisplay}\n`;
      
      if (s.description) out += `**Description:** ${s.description}\n`;
      out += `\n**Enrollments:**\n`;
      out += `• Total: ${stats?.total || 0}\n`;
      out += `• Active: ${stats?.active || 0}\n`;
      out += `• Completed: ${stats?.completed || 0}\n`;
      out += `• Cancelled: ${stats?.cancelled || 0}\n`;
      
      if (steps.results?.length) {
        out += `\n**Steps:**\n`;
        for (const step of steps.results) {
          const delay = step.delay_minutes === 0 ? 'Immediately' :
            step.delay_minutes < 60 ? `${step.delay_minutes}m` :
            step.delay_minutes < 1440 ? `${Math.round(step.delay_minutes / 60)}h` :
            `${Math.round(step.delay_minutes / 1440)}d`;
          out += `${step.position}. [${delay}] ${step.subject}${step.status !== 'active' ? ` (${step.status})` : ''}\n`;
          out += `   ID: ${step.id}\n`;
        }
      } else {
        out += `\n⚠️ No steps configured yet.`;
      }
      return out;
    }
    
    case "courier_create_sequence": {
      const id = generateId();
      const now = new Date().toISOString();
      
      await db.prepare(`
        INSERT INTO sequences (id, name, list_id, description, trigger_type, trigger_value, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
      `).bind(id, args.name, args.list_id, args.description || null, args.trigger_type || 'subscribe', args.trigger_value || null, now, now).run();
      
      let msg = `✅ Sequence created: **${args.name}**\nID: ${id}\nStatus: draft`;
      if (args.trigger_type === 'tag' && args.trigger_value) {
        msg += `\nTrigger: tag "${args.trigger_value}"`;
      }
      msg += `\n\nNext: Add steps with courier_add_sequence_step`;
      return msg;
    }
    
    case "courier_update_sequence": {
      const updates = [];
      const values = [];
      
      if (args.name !== undefined) { updates.push('name = ?'); values.push(args.name); }
      if (args.description !== undefined) { updates.push('description = ?'); values.push(args.description); }
      if (args.status !== undefined) { updates.push('status = ?'); values.push(args.status); }
      if (args.trigger_type !== undefined) { updates.push('trigger_type = ?'); values.push(args.trigger_type); }
      if (args.trigger_value !== undefined) { updates.push('trigger_value = ?'); values.push(args.trigger_value); }
      
      if (updates.length === 0) return "⛔ No updates provided";
      
      updates.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(args.sequence_id);
      
      await db.prepare(`UPDATE sequences SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      
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
      const id = generateId();
      const now = new Date().toISOString();
      
      // Get next position
      const last = await db.prepare('SELECT MAX(position) as pos FROM sequence_steps WHERE sequence_id = ?').bind(args.sequence_id).first();
      const position = (last?.pos || 0) + 1;
      
      await db.prepare(`
        INSERT INTO sequence_steps (id, sequence_id, position, subject, body_html, delay_minutes, preview_text, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).bind(id, args.sequence_id, position, args.subject, args.body_html, args.delay_minutes || 0, args.preview_text || null, now, now).run();
      
      const delay = (args.delay_minutes || 0) === 0 ? 'immediately' :
        args.delay_minutes < 60 ? `after ${args.delay_minutes} minutes` :
        args.delay_minutes < 1440 ? `after ${Math.round(args.delay_minutes / 60)} hours` :
        `after ${Math.round(args.delay_minutes / 1440)} days`;
      
      return `✅ Step ${position} added: **${args.subject}**\nSends: ${delay}\nID: ${id}`;
    }
    
    case "courier_update_sequence_step": {
      const updates = [];
      const values = [];
      
      if (args.subject !== undefined) { updates.push('subject = ?'); values.push(args.subject); }
      if (args.body_html !== undefined) { updates.push('body_html = ?'); values.push(args.body_html); }
      if (args.delay_minutes !== undefined) { updates.push('delay_minutes = ?'); values.push(args.delay_minutes); }
      if (args.preview_text !== undefined) { updates.push('preview_text = ?'); values.push(args.preview_text); }
      if (args.status !== undefined) { updates.push('status = ?'); values.push(args.status); }
      
      if (updates.length === 0) return "⛔ No updates provided";
      
      updates.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(args.step_id);
      
      await db.prepare(`UPDATE sequence_steps SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      return "✅ Step updated";
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
      
      const id = generateId();
      const now = new Date().toISOString();
      
      await db.prepare(`
        INSERT INTO sequence_enrollments (id, sequence_id, lead_id, current_step, status, enrolled_at, created_at)
        VALUES (?, ?, ?, 1, 'active', ?, ?)
      `).bind(id, args.sequence_id, lead.id, now, now).run();
      
      return `✅ Enrolled **${args.email}** in sequence\nEnrollment ID: ${id}`;
    }
    
    case "courier_sequence_enrollments": {
      let query = `SELECT se.*, l.email, l.name FROM sequence_enrollments se JOIN leads l ON se.lead_id = l.id WHERE se.sequence_id = ?`;
      const params = [args.sequence_id];
      
      if (args.status) {
        query += ' AND se.status = ?';
        params.push(args.status);
      }
      query += ' ORDER BY se.enrolled_at DESC LIMIT ?';
      params.push(args.limit || 50);
      
      const results = await db.prepare(query).bind(...params).all();
      if (!results.results?.length) return "📭 No enrollments found";
      
      let out = `👥 **Sequence Enrollments** (${results.results.length})\n\n`;
      for (const e of results.results) {
        const icon = e.status === 'active' ? '🟢' : e.status === 'completed' ? '✅' : '❌';
        out += `${icon} ${e.name || '(no name)'} <${e.email}>\n`;
        out += `   Step: ${e.current_step} | Enrolled: ${e.enrolled_at?.split('T')[0]}\n`;
      }
      return out;
    }
    
    // ==================== SUBSCRIBERS ====================
    case "courier_list_subscribers": {
      let query, params;
      
      if (args.list_id) {
        query = `SELECT s.id as subscription_id, s.subscribed_at, l.email, l.name 
          FROM subscriptions s JOIN leads l ON s.lead_id = l.id 
          WHERE s.list_id = ? AND s.status = 'active' 
          ORDER BY s.subscribed_at DESC LIMIT ?`;
        params = [args.list_id, args.limit || 50];
      } else {
        query = `SELECT l.id, l.email, l.name, l.created_at 
          FROM leads l ORDER BY l.created_at DESC LIMIT ?`;
        params = [args.limit || 50];
      }
      
      const results = await db.prepare(query).bind(...params).all();
      if (!results.results?.length) return "📭 No subscribers found";
      
      let out = `👥 **Subscribers** (${results.results.length})\n\n`;
      for (const s of results.results.slice(0, 30)) {
        out += `• ${s.name || '(no name)'} <${s.email}>\n`;
        out += `  ID: ${s.subscription_id || s.id}\n`;
      }
      if (results.results.length > 30) out += `\n... and ${results.results.length - 30} more`;
      return out;
    }
    
    case "courier_delete_subscriber": {
      const ids = args.subscription_ids || (args.subscription_id ? [args.subscription_id] : []);
      if (!ids.length) return "⛔ Provide subscription_id or subscription_ids";
      
      if (args.permanent) {
        for (const id of ids) {
          await db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id).run();
        }
      } else {
        for (const id of ids) {
          await db.prepare("UPDATE subscriptions SET status = 'unsubscribed', unsubscribed_at = ? WHERE id = ?")
            .bind(new Date().toISOString(), id).run();
        }
      }
      
      const action = args.permanent ? 'permanently deleted' : 'unsubscribed';
      return `✅ ${ids.length} subscriber(s) ${action}`;
    }
    
    // ==================== STATS ====================
    case "courier_stats": {
      // Lead counts
      const totalLeads = await db.prepare('SELECT COUNT(*) as c FROM leads').first();
      const todayLeads = await db.prepare("SELECT COUNT(*) as c FROM leads WHERE date(created_at) = date('now')").first();
      const weekLeads = await db.prepare("SELECT COUNT(*) as c FROM leads WHERE created_at > datetime('now', '-7 days')").first();
      const monthLeads = await db.prepare("SELECT COUNT(*) as c FROM leads WHERE created_at > datetime('now', '-30 days')").first();
      
      // Subscription stats
      const activeSubs = await db.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active'").first();
      const unsubscribed = await db.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'unsubscribed'").first();
      
      // Email performance (last 30 days)
      const emailStats = await db.prepare(`
        SELECT 
          COUNT(*) as total_sends,
          SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opens,
          SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicks,
          SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) as bounces
        FROM email_sends 
        WHERE created_at > datetime('now', '-30 days')
      `).first();
      
      // Campaign counts
      const campaigns = await db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts,
          SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent
        FROM emails
      `).first();
      
      // Sequence stats
      const sequences = await db.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
          SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts
        FROM sequences
      `).first();
      
      const activeEnrollments = await db.prepare("SELECT COUNT(*) as c FROM sequence_enrollments WHERE status = 'active'").first();
      
      // List count
      const lists = await db.prepare("SELECT COUNT(*) as c FROM lists WHERE status != 'archived'").first();
      
      // Calculate rates
      const sent = emailStats?.total_sends || 0;
      const opens = emailStats?.opens || 0;
      const clicks = emailStats?.clicks || 0;
      const bounces = emailStats?.bounces || 0;
      
      let out = `📊 **Courier Platform Stats**\n\n`;
      
      out += `**📧 Lists & Subscribers**\n`;
      out += `• Lists: ${lists?.c || 0}\n`;
      out += `• Active Subscriptions: ${activeSubs?.c || 0}\n`;
      out += `• Unsubscribed: ${unsubscribed?.c || 0}\n`;
      out += `• Total Leads: ${totalLeads?.c || 0}\n`;
      
      out += `\n**📈 Lead Growth**\n`;
      out += `• Today: +${todayLeads?.c || 0}\n`;
      out += `• This Week: +${weekLeads?.c || 0}\n`;
      out += `• This Month: +${monthLeads?.c || 0}\n`;
      
      out += `\n**📨 Campaigns**\n`;
      out += `• Total: ${campaigns?.total || 0}\n`;
      out += `• Drafts: ${campaigns?.drafts || 0}\n`;
      out += `• Scheduled: ${campaigns?.scheduled || 0}\n`;
      out += `• Sent: ${campaigns?.sent || 0}\n`;
      
      out += `\n**🔄 Sequences**\n`;
      out += `• Total: ${sequences?.total || 0}\n`;
      out += `• Active: ${sequences?.active || 0}\n`;
      out += `• Drafts: ${sequences?.drafts || 0}\n`;
      out += `• Active Enrollments: ${activeEnrollments?.c || 0}\n`;
      
      out += `\n**📬 Email Performance (Last 30 Days)**\n`;
      out += `• Emails Sent: ${sent}\n`;
      out += `• Opens: ${opens} (${sent ? Math.round(opens/sent*100) : 0}%)\n`;
      out += `• Clicks: ${clicks} (${sent ? Math.round(clicks/sent*100) : 0}%)\n`;
      out += `• Bounces: ${bounces} (${sent ? Math.round(bounces/sent*100) : 0}%)\n`;
      if (opens > 0) {
        out += `• Click-to-Open Rate: ${Math.round(clicks/opens*100)}%\n`;
      }
      
      return out;
    }
    
    default:
      return `⛔ Unknown tool: ${name}`;
  }
}

// MCP Protocol Handler
export async function handleMCP(request, env) {
  const url = new URL(request.url);
  
  // SSE endpoint for MCP
  if (request.method === 'GET') {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    
    const sendEvent = async (data) => {
      await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    };
    
    // Send initial endpoint message
    const messageEndpoint = `${url.origin}/sse`;
    await sendEvent({ jsonrpc: '2.0', method: 'endpoint', params: { url: messageEndpoint } });
    
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      }
    });
  }
  
  // POST endpoint for JSON-RPC messages
  if (request.method === 'POST') {
    try {
      const message = await request.json();
      const { id, method, params } = message;
      
      let result;
      
      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'courier', version: '1.0.0' },
            capabilities: { tools: {} }
          };
          break;
          
        case 'tools/list':
          result = { tools: TOOLS };
          break;
          
        case 'tools/call':
          const toolName = params.name;
          const toolArgs = params.arguments || {};
          const toolResult = await executeTool(toolName, toolArgs, env);
          result = { content: [{ type: 'text', text: toolResult }] };
          break;
          
        default:
          return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` }
          }), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            }
          });
      }
      
      return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
      
    } catch (error) {
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: error.message }
      }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        }
      });
    }
  }
  
  return new Response('Method not allowed', { status: 405 });
}
