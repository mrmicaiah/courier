/**
 * Shared utility functions
 */

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
