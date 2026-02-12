import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';

// Rate limit tiers (requests per window)
const RATE_LIMITS = {
  // AI-powered routes — expensive, lower limits
  ai: { limit: 10, windowMs: 60_000 },
  // Standard API routes
  api: { limit: 30, windowMs: 60_000 },
} as const;

const AI_ROUTES = new Set([
  '/api/tailor-resume',
  '/api/refine-document',
  '/api/sanitize-paste',
]);

function getClientIP(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'anonymous'
  );
}

function addSecurityHeaders(response: NextResponse): NextResponse {
  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Block MIME-type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Control referrer information
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Restrict permissions/features
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()'
  );

  // Force HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    );
  }

  // Content Security Policy
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://accounts.google.com https://www.googleapis.com",
      "frame-src 'self' https://accounts.google.com",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; ')
  );

  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only rate limit API routes
  if (pathname.startsWith('/api/')) {
    // Skip rate limiting for auth routes (NextAuth needs unrestricted access)
    if (!pathname.startsWith('/api/auth')) {
      const ip = getClientIP(request);
      const isAIRoute = AI_ROUTES.has(pathname);
      const tier = isAIRoute ? RATE_LIMITS.ai : RATE_LIMITS.api;
      const rateLimitKey = `${ip}:${isAIRoute ? 'ai' : 'api'}`;

      const result = rateLimit(rateLimitKey, tier.limit, tier.windowMs);

      if (!result.allowed) {
        const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
        const errorResponse = NextResponse.json(
          { error: 'Too many requests. Please try again later.' },
          { status: 429 }
        );
        errorResponse.headers.set('Retry-After', String(retryAfterSeconds));
        errorResponse.headers.set('X-RateLimit-Limit', String(result.limit));
        errorResponse.headers.set('X-RateLimit-Remaining', '0');
        return addSecurityHeaders(errorResponse);
      }

      const response = NextResponse.next();
      response.headers.set('X-RateLimit-Limit', String(result.limit));
      response.headers.set('X-RateLimit-Remaining', String(result.remaining));
      return addSecurityHeaders(response);
    }
  }

  // Apply security headers to all responses
  const response = NextResponse.next();
  return addSecurityHeaders(response);
}

export const config = {
  matcher: [
    // Match all paths except static files and _next internals
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
