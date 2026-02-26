/**
 * Statistics Tools
 */

import type { ToolContext } from '../types';

export function registerStatsTools(ctx: ToolContext) {
  const { server, env } = ctx;

  server.tool(
    "courier_stats",
    "Get overall platform statistics including opens, clicks, unsubscribes, and performance metrics",
    {},
    async () => {
      let totalLeads = 0, todayLeads = 0, weekLeads = 0, monthLeads = 0;
      let activeSubs = 0, unsubscribed = 0;
      let emailStats = { total_sends: 0, opens: 0, clicks: 0, bounces: 0 };
      let campaigns = { total: 0, drafts: 0, scheduled: 0, sent: 0 };
      let sequences = { total: 0, active: 0, drafts: 0 };
      let activeEnrollments = 0, lists = 0;
      
      try { const r = await env.DB.prepare('SELECT COUNT(*) as c FROM leads').first() as any; totalLeads = r?.c || 0; } catch (e) {}
      try { const r = await env.DB.prepare("SELECT COUNT(*) as c FROM leads WHERE date(created_at) = date('now')").first() as any; todayLeads = r?.c || 0; } catch (e) {}
      try { const r = await env.DB.prepare("SELECT COUNT(*) as c FROM leads WHERE created_at > datetime('now', '-7 days')").first() as any; weekLeads = r?.c || 0; } catch (e) {}
      try { const r = await env.DB.prepare("SELECT COUNT(*) as c FROM leads WHERE created_at > datetime('now', '-30 days')").first() as any; monthLeads = r?.c || 0; } catch (e) {}
      try { const r = await env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active'").first() as any; activeSubs = r?.c || 0; } catch (e) {}
      try { const r = await env.DB.prepare("SELECT COUNT(*) as c FROM subscriptions WHERE status = 'unsubscribed'").first() as any; unsubscribed = r?.c || 0; } catch (e) {}
      try { const r = await env.DB.prepare("SELECT COUNT(*) as total_sends, SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opens, SUM(CASE WHEN clicked_at IS NOT NULL THEN 1 ELSE 0 END) as clicks, SUM(CASE WHEN bounced_at IS NOT NULL THEN 1 ELSE 0 END) as bounces FROM email_sends WHERE created_at > datetime('now', '-30 days')").first() as any; if (r) emailStats = r; } catch (e) {}
      try { const r = await env.DB.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts, SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled, SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent FROM emails").first() as any; if (r) campaigns = r; } catch (e) {}
      try { const r = await env.DB.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts FROM sequences").first() as any; if (r) sequences = r; } catch (e) {}
      try { const r = await env.DB.prepare("SELECT COUNT(*) as c FROM sequence_enrollments WHERE status = 'active'").first() as any; activeEnrollments = r?.c || 0; } catch (e) {}
      try { const r = await env.DB.prepare("SELECT COUNT(*) as c FROM lists WHERE status != 'archived'").first() as any; lists = r?.c || 0; } catch (e) {}
      
      const sent = emailStats?.total_sends || 0;
      const opens = emailStats?.opens || 0;
      const clicks = emailStats?.clicks || 0;
      const bounces = emailStats?.bounces || 0;
      
      let out = `📊 **Courier Platform Stats**\n\n`;
      out += `**📧 Lists & Subscribers**\n• Lists: ${lists}\n• Active Subscriptions: ${activeSubs}\n• Unsubscribed: ${unsubscribed}\n• Total Leads: ${totalLeads}\n`;
      out += `\n**📈 Lead Growth**\n• Today: +${todayLeads}\n• This Week: +${weekLeads}\n• This Month: +${monthLeads}\n`;
      out += `\n**📨 Campaigns**\n• Total: ${campaigns?.total || 0}\n• Drafts: ${campaigns?.drafts || 0}\n• Scheduled: ${campaigns?.scheduled || 0}\n• Sent: ${campaigns?.sent || 0}\n`;
      out += `\n**🔄 Sequences**\n• Total: ${sequences?.total || 0}\n• Active: ${sequences?.active || 0}\n• Drafts: ${sequences?.drafts || 0}\n• Active Enrollments: ${activeEnrollments}\n`;
      out += `\n**📬 Email Performance (Last 30 Days)**\n• Emails Sent: ${sent}\n• Opens: ${opens} (${sent ? Math.round(opens/sent*100) : 0}%)\n• Clicks: ${clicks} (${sent ? Math.round(clicks/sent*100) : 0}%)\n• Bounces: ${bounces} (${sent ? Math.round(bounces/sent*100) : 0}%)\n`;
      if (opens > 0) out += `• Click-to-Open Rate: ${Math.round(clicks/opens*100)}%\n`;
      
      return { content: [{ type: "text", text: out }] };
    }
  );
}
