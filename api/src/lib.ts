/**
 * Shared utility functions
 */

export const DEFAULT_FROM_EMAIL = 'no-reply@untitledpublishers.com';
export const DEFAULT_FROM_NAME = 'Untitled Publishers';

export function generateId(): string {
  return crypto.randomUUID();
}

export function isValidEmail(email: string): boolean {
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function getCorsHeaders(request?: Request): Record<string, string> {
  const origin = request?.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-MTC-Password',
    'Access-Control-Max-Age': '86400',
  };
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function jsonResponse(data: any, status = 200, request?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...getCorsHeaders(request),
    },
  });
}

export function checkAuth(request: Request, env: { ADMIN_API_KEY?: string }): { ok: boolean } {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false };
  }
  const token = authHeader.substring(7);
  return { ok: token === env.ADMIN_API_KEY };
}

// ==================== RESEND EMAIL ====================

export async function sendEmailViaSES(
  env: { RESEND_API_KEY: string },
  to: string,
  subject: string,
  htmlBody: string,
  textBody?: string,
  fromName?: string,
  fromEmail?: string
): Promise<string> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: (fromName || DEFAULT_FROM_NAME) + ' <' + (fromEmail || DEFAULT_FROM_EMAIL) + '>',
      to: [to],
      subject: subject,
      html: htmlBody,
      text: textBody || undefined
    })
  });
  
  const result = await response.json() as any;
  if (!response.ok) {
    console.error('Resend Error:', result);
    throw new Error('Resend Error: ' + response.status + ' - ' + (result.message || JSON.stringify(result)));
  }
  return result.id;
}

// ==================== EMAIL RENDERING ====================

function applyMergeTags(html: string, subscriber: { name?: string; email?: string }): string {
  if (!html) return html;
  const firstName = subscriber.name ? subscriber.name.split(' ')[0] : 'Friend';
  const fullName = subscriber.name || 'Friend';
  const email = subscriber.email || '';
  return html
    .replace(/\{first_name\}/g, firstName)
    .replace(/\{name\}/g, fullName)
    .replace(/\{email\}/g, email);
}

export function renderEmail(
  email: { subject?: string; body_html?: string },
  subscriber: { name?: string; email?: string },
  sendId: string,
  baseUrl: string,
  list?: { from_name?: string } | null,
  template?: { body_html?: string } | null
): string {
  let contentHtml = email.body_html || '';
  contentHtml = applyMergeTags(contentHtml, subscriber);
  
  const trackingPixel = '<img src="' + baseUrl + '/t/open?sid=' + sendId + '" width="1" height="1" style="display:none;" alt="">';
  const unsubscribeUrl = baseUrl + '/unsubscribe?sid=' + sendId;
  const fromName = (list && list.from_name) ? list.from_name : DEFAULT_FROM_NAME;
  
  let fullHtml: string;
  
  if (template && template.body_html) {
    fullHtml = template.body_html;
    fullHtml = fullHtml.replace(/\{content\}/g, contentHtml);
    fullHtml = applyMergeTags(fullHtml, subscriber);
    fullHtml = fullHtml.replace(/\{unsubscribe_url\}/g, unsubscribeUrl);
    fullHtml = fullHtml.replace(/\{from_name\}/g, fromName);
    fullHtml = fullHtml.replace(/\{subject\}/g, email.subject || '');
    if (fullHtml.indexOf('/t/open?sid=') === -1) {
      fullHtml = fullHtml.replace('</body>', trackingPixel + '</body>');
    }
  } else {
    fullHtml = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' + email.subject + '</title></head><body style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">' + contentHtml + '<hr style="margin-top: 40px; border: none; border-top: 1px solid #ddd;"><p style="font-size: 12px; color: #666; text-align: center;">You are receiving this because you signed up for ' + fromName + '.<br><a href="' + unsubscribeUrl + '" style="color: #666;">Unsubscribe</a></p>' + trackingPixel + '</body></html>';
  }
  
  return fullHtml;
}
