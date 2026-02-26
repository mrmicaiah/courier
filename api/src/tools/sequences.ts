/**
 * Sequence Management Tools
 */

import { z } from "zod";
import type { ToolContext } from '../types';
import { generateId } from '../lib';

export function registerSequenceTools(ctx: ToolContext) {
  const { server, env } = ctx;

  server.tool(
    "courier_list_sequences",
    "List email sequences",
    {
      list_id: z.string().optional(),
      status: z.enum(["draft", "active", "paused"]).optional()
    },
    async ({ list_id, status }) => {
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
        else if (s.trigger_value) triggerDisplay = `${s.trigger_type} (${s.trigger_value})`;
        out += `${icon} **${s.name}**\n   List: ${s.list_name || '(none)'}\n   Trigger: ${triggerDisplay}\n   Steps: ${s.step_count || 0} | Active: ${s.active_enrollments || 0}\n   ID: ${s.id}\n\n`;
      }
      
      return { content: [{ type: "text", text: out }] };
    }
  );

  server.tool(
    "courier_get_sequence",
    "Get sequence details with steps",
    {
      sequence_id: z.string()
    },
    async ({ sequence_id }) => {
      const s = await env.DB.prepare('SELECT s.*, l.name as list_name FROM sequences s LEFT JOIN lists l ON s.list_id = l.id WHERE s.id = ?').bind(sequence_id).first() as any;
      if (!s) {
        return { content: [{ type: "text", text: "⛔ Sequence not found" }] };
      }
      
      const steps = await env.DB.prepare('SELECT * FROM sequence_steps WHERE sequence_id = ? ORDER BY position ASC').bind(sequence_id).all();
      const stats = await env.DB.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'active\' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN status = \'completed\' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status = \'cancelled\' THEN 1 ELSE 0 END) as cancelled FROM sequence_enrollments WHERE sequence_id = ?').bind(sequence_id).first() as any;
      
      const icon = s.status === 'active' ? '✅' : s.status === 'paused' ? '⏸️' : '📝';
      let triggerDisplay = s.trigger_type;
      if (s.trigger_type === 'tag' && s.trigger_value) triggerDisplay = `tag: "${s.trigger_value}"`;
      else if (s.trigger_value) triggerDisplay = `${s.trigger_type} (${s.trigger_value})`;
      
      let out = `${icon} **${s.name}**\n\n**ID:** ${s.id}\n**Status:** ${s.status}\n**List:** ${s.list_name || '(none)'}\n**Trigger:** ${triggerDisplay}\n`;
      if (s.description) out += `**Description:** ${s.description}\n`;
      out += `\n**Enrollments:**\n• Total: ${stats?.total || 0}\n• Active: ${stats?.active || 0}\n• Completed: ${stats?.completed || 0}\n• Cancelled: ${stats?.cancelled || 0}\n`;
      
      if (steps.results?.length) {
        out += `\n**Steps:**\n`;
        for (const step of steps.results as any[]) {
          const delay = step.delay_minutes === 0 ? 'Immediately' : step.delay_minutes < 60 ? `${step.delay_minutes}m` : step.delay_minutes < 1440 ? `${Math.round(step.delay_minutes / 60)}h` : `${Math.round(step.delay_minutes / 1440)}d`;
          const sendTime = step.send_at_time ? ` @ ${step.send_at_time}` : '';
          out += `${step.position}. [${delay}${sendTime}] ${step.subject}${step.status !== 'active' ? ` (${step.status})` : ''}\n   ID: ${step.id}\n`;
        }
      } else {
        out += `\n⚠️ No steps configured yet.`;
      }
      
      return { content: [{ type: "text", text: out }] };
    }
  );

  server.tool(
    "courier_create_sequence",
    "Create a new email sequence",
    {
      name: z.string(),
      list_id: z.string(),
      description: z.string().optional(),
      trigger_type: z.enum(["subscribe", "manual", "tag"]).optional().default("subscribe"),
      trigger_value: z.string().optional().describe("For tag triggers, the tag name that triggers this sequence")
    },
    async ({ name, list_id, description, trigger_type, trigger_value }) => {
      const id = generateId();
      const now = new Date().toISOString();
      
      await env.DB.prepare('INSERT INTO sequences (id, name, list_id, description, trigger_type, trigger_value, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'draft\', ?, ?)')
        .bind(id, name, list_id, description || null, trigger_type || 'subscribe', trigger_value || null, now, now).run();
      
      let msg = `✅ Sequence created: **${name}**\nID: ${id}\nStatus: draft`;
      if (trigger_type === 'tag' && trigger_value) msg += `\nTrigger: tag "${trigger_value}"`;
      msg += `\n\nNext: Add steps with courier_add_sequence_step`;
      
      return { content: [{ type: "text", text: msg }] };
    }
  );

  server.tool(
    "courier_update_sequence",
    "Update a sequence",
    {
      sequence_id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["draft", "active", "paused"]).optional(),
      trigger_type: z.enum(["subscribe", "manual", "tag"]).optional(),
      trigger_value: z.string().optional()
    },
    async (args) => {
      const updates: string[] = [];
      const values: any[] = [];
      
      if (args.name !== undefined) { updates.push('name = ?'); values.push(args.name); }
      if (args.description !== undefined) { updates.push('description = ?'); values.push(args.description); }
      if (args.status !== undefined) { updates.push('status = ?'); values.push(args.status); }
      if (args.trigger_type !== undefined) { updates.push('trigger_type = ?'); values.push(args.trigger_type); }
      if (args.trigger_value !== undefined) { updates.push('trigger_value = ?'); values.push(args.trigger_value); }
      
      if (updates.length === 0) {
        return { content: [{ type: "text", text: "⛔ No updates provided" }] };
      }
      
      updates.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(args.sequence_id);
      
      await env.DB.prepare(`UPDATE sequences SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

      if (args.status === 'active') {
        try {
          const seq = await env.DB.prepare('SELECT id, trigger_type, list_id FROM sequences WHERE id = ?')
            .bind(args.sequence_id).first() as any;
          if (seq && seq.trigger_type === 'subscribe' && seq.list_id) {
            const linkNow = new Date().toISOString();
            await env.DB.prepare('UPDATE lists SET welcome_sequence_id = ?, updated_at = ? WHERE id = ? AND (welcome_sequence_id IS NULL OR welcome_sequence_id = ?)')
              .bind(seq.id, linkNow, seq.list_id, seq.id).run();
          }
        } catch (e) {
          console.error('Failed to link welcome_sequence_id:', e);
        }
      }

      let msg = '✅ Sequence updated';
      if (args.status === 'active') msg += '\n\n🟢 Sequence is now ACTIVE - new subscribers will be auto-enrolled';
      
      return { content: [{ type: "text", text: msg }] };
    }
  );

  server.tool(
    "courier_delete_sequence",
    "Delete a sequence",
    {
      sequence_id: z.string()
    },
    async ({ sequence_id }) => {
      await env.DB.prepare('DELETE FROM sequence_steps WHERE sequence_id = ?').bind(sequence_id).run();
      await env.DB.prepare('DELETE FROM sequence_enrollments WHERE sequence_id = ?').bind(sequence_id).run();
      await env.DB.prepare('DELETE FROM sequences WHERE id = ?').bind(sequence_id).run();
      
      return { content: [{ type: "text", text: "✅ Sequence deleted" }] };
    }
  );

  server.tool(
    "courier_add_sequence_step",
    "Add a step to a sequence",
    {
      sequence_id: z.string(),
      subject: z.string(),
      body_html: z.string(),
      delay_minutes: z.number().optional().default(0).describe("0=immediate, 1440=1 day, 10080=1 week"),
      preview_text: z.string().optional(),
      send_at_time: z.string().optional().describe("Specific time to send (HH:MM in 24h format, e.g. '09:00')")
    },
    async ({ sequence_id, subject, body_html, delay_minutes, preview_text, send_at_time }) => {
      const id = generateId();
      const now = new Date().toISOString();
      
      const last = await env.DB.prepare('SELECT MAX(position) as pos FROM sequence_steps WHERE sequence_id = ?').bind(sequence_id).first() as any;
      const position = (last?.pos || 0) + 1;
      const sendAtTime = send_at_time || null;
      
      await env.DB.prepare('INSERT INTO sequence_steps (id, sequence_id, position, subject, body_html, delay_minutes, preview_text, send_at_time, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'active\', ?, ?)')
        .bind(id, sequence_id, position, subject, body_html, delay_minutes || 0, preview_text || null, sendAtTime, now, now).run();
      
      const delay = (delay_minutes || 0) === 0 ? 'immediately' : (delay_minutes || 0) < 60 ? `after ${delay_minutes} minutes` : (delay_minutes || 0) < 1440 ? `after ${Math.round((delay_minutes || 0) / 60)} hours` : `after ${Math.round((delay_minutes || 0) / 1440)} days`;
      let msg = `✅ Step ${position} added: **${subject}**\nSends: ${delay}`;
      if (sendAtTime) msg += ` at ${sendAtTime}`;
      msg += `\nID: ${id}`;
      
      return { content: [{ type: "text", text: msg }] };
    }
  );

  server.tool(
    "courier_update_sequence_step",
    "Update a sequence step",
    {
      sequence_id: z.string(),
      step_id: z.string(),
      subject: z.string().optional(),
      body_html: z.string().optional(),
      delay_minutes: z.number().optional(),
      preview_text: z.string().optional(),
      status: z.enum(["active", "paused"]).optional(),
      send_at_time: z.string().optional().describe("Specific time to send (HH:MM). Use 'null' or empty string to clear.")
    },
    async (args) => {
      const updates: string[] = [];
      const values: any[] = [];
      
      if (args.subject !== undefined) { updates.push('subject = ?'); values.push(args.subject); }
      if (args.body_html !== undefined) { updates.push('body_html = ?'); values.push(args.body_html); }
      if (args.delay_minutes !== undefined) { updates.push('delay_minutes = ?'); values.push(args.delay_minutes); }
      if (args.preview_text !== undefined) { updates.push('preview_text = ?'); values.push(args.preview_text); }
      if (args.status !== undefined) { updates.push('status = ?'); values.push(args.status); }
      if (args.send_at_time !== undefined) {
        updates.push('send_at_time = ?');
        if (args.send_at_time === 'null' || args.send_at_time === '' || args.send_at_time === null) {
          values.push(null);
        } else {
          values.push(args.send_at_time);
        }
      }
      
      if (updates.length === 0) {
        return { content: [{ type: "text", text: "⛔ No updates provided" }] };
      }
      
      updates.push('updated_at = ?');
      values.push(new Date().toISOString());
      values.push(args.step_id);
      
      await env.DB.prepare(`UPDATE sequence_steps SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      
      let msg = "✅ Step updated";
      if (args.send_at_time === 'null' || args.send_at_time === '' || args.send_at_time === null) {
        msg += "\n⏰ Send time cleared - will now send based on delay only";
      } else if (args.send_at_time) {
        msg += `\n⏰ Send time set to ${args.send_at_time}`;
      }
      
      return { content: [{ type: "text", text: msg }] };
    }
  );

  server.tool(
    "courier_delete_sequence_step",
    "Delete a sequence step",
    {
      sequence_id: z.string(),
      step_id: z.string()
    },
    async ({ step_id }) => {
      await env.DB.prepare('DELETE FROM sequence_steps WHERE id = ?').bind(step_id).run();
      return { content: [{ type: "text", text: "✅ Step deleted" }] };
    }
  );

  server.tool(
    "courier_reorder_sequence_steps",
    "Reorder sequence steps",
    {
      sequence_id: z.string(),
      step_ids: z.array(z.string())
    },
    async ({ step_ids }) => {
      for (let i = 0; i < step_ids.length; i++) {
        await env.DB.prepare('UPDATE sequence_steps SET position = ? WHERE id = ?').bind(i + 1, step_ids[i]).run();
      }
      return { content: [{ type: "text", text: "✅ Steps reordered" }] };
    }
  );

  server.tool(
    "courier_enroll_in_sequence",
    "Enroll an email in a sequence",
    {
      sequence_id: z.string(),
      email: z.string()
    },
    async ({ sequence_id, email }) => {
      const lead = await env.DB.prepare('SELECT * FROM leads WHERE email = ?').bind(email).first() as any;
      if (!lead) {
        return { content: [{ type: "text", text: "⛔ Email not found in leads" }] };
      }
      
      const seq = await env.DB.prepare('SELECT list_id FROM sequences WHERE id = ?').bind(sequence_id).first() as any;
      if (!seq) {
        return { content: [{ type: "text", text: "⛔ Sequence not found" }] };
      }
      
      const sub = await env.DB.prepare('SELECT id FROM subscriptions WHERE lead_id = ? AND list_id = ?').bind(lead.id, seq.list_id).first() as any;
      if (!sub) {
        return { content: [{ type: "text", text: "⛔ Lead is not subscribed to this sequence's list" }] };
      }
      
      const id = generateId();
      const now = new Date().toISOString();
      
      await env.DB.prepare('INSERT INTO sequence_enrollments (id, subscription_id, sequence_id, current_step, status, enrolled_at, created_at) VALUES (?, ?, ?, 1, \'active\', ?, ?)')
        .bind(id, sub.id, sequence_id, now, now).run();
      
      return { content: [{ type: "text", text: `✅ Enrolled **${email}** in sequence\nEnrollment ID: ${id}` }] };
    }
  );

  server.tool(
    "courier_sequence_enrollments",
    "List sequence enrollments",
    {
      sequence_id: z.string(),
      status: z.enum(["active", "completed", "cancelled"]).optional(),
      limit: z.number().optional().default(50)
    },
    async ({ sequence_id, status, limit }) => {
      let query = 'SELECT se.*, l.email, l.name FROM sequence_enrollments se JOIN subscriptions s ON se.subscription_id = s.id JOIN leads l ON s.lead_id = l.id WHERE se.sequence_id = ?';
      const params: any[] = [sequence_id];
      
      if (status) {
        query += ' AND se.status = ?';
        params.push(status);
      }
      query += ' ORDER BY se.enrolled_at DESC LIMIT ?';
      params.push(limit || 50);
      
      const results = await env.DB.prepare(query).bind(...params).all();
      
      if (!results.results?.length) {
        return { content: [{ type: "text", text: "📭 No enrollments found" }] };
      }
      
      let out = `👥 **Sequence Enrollments** (${results.results.length})\n\n`;
      for (const e of results.results as any[]) {
        const icon = e.status === 'active' ? '🟢' : e.status === 'completed' ? '✅' : '❌';
        out += `${icon} ${e.name || '(no name)'} <${e.email}>\n   Step: ${e.current_step} | Enrolled: ${e.enrolled_at?.split('T')[0]}\n`;
      }
      
      return { content: [{ type: "text", text: out }] };
    }
  );
}
