import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getCustomDomain } from '@/lib/domains/lookup'

// 8-char base62 token format minted by lib/inspections/tokens.ts.
const INSPECTION_TOKEN_RE = /^[A-Za-z0-9]{8}$/

// Force Node runtime — getCustomDomain uses createAdminClient which
// reads SUPABASE_SERVICE_ROLE_KEY. The edge runtime exposes env vars
// fine but the supabase-js client is happier on Node.
export const runtime = 'nodejs'

export async function middleware(request: NextRequest) {
  // HOR-204: requests on a verified custom Doorstep domain get rewritten
  // to the internal `/i/<token>` route so the URL bar stays branded.
  // All other paths on that host 404 — we don't want marketing or the
  // dashboard bleeding onto the agent's domain.
  const host = request.headers.get('host')?.toLowerCase() ?? null
  const appHost = (() => {
    try {
      return new URL(process.env.NEXT_PUBLIC_APP_URL ?? '').host.toLowerCase()
    } catch {
      return ''
    }
  })()
  const previewHost = (process.env.VERCEL_URL ?? '').toLowerCase()
  // HOR-225: r.<appHost> serves the email-tracking pixel + click routes
  // (/t/o and /t/c). Recognise it as a system host so it bypasses the
  // Doorstep custom-domain branch below and falls through to the normal
  // Next.js route tree.
  const trackingHost = appHost ? `r.${appHost}` : ''

  if (host && host !== appHost && host !== previewHost && host !== trackingHost && !host.endsWith('.vercel.app')) {
    const lookup = await getCustomDomain(host)
    if (lookup && lookup.status === 'verified') {
      const pathname = request.nextUrl.pathname
      // Allowed paths on the custom host:
      //   /                → 404 (we don't render a landing page yet)
      //   /<8-char-token>  → rewrite to /i/<token>
      //   /api/inspections/capture (POST) → serve as-is
      //   /_next/* /favicon.ico → serve as-is (Vercel project assets)
      if (
        pathname.startsWith('/_next/') ||
        pathname === '/favicon.ico' ||
        pathname === '/apple-touch-icon.png'
      ) {
        return NextResponse.next()
      }
      if (pathname.startsWith('/api/inspections/capture')) {
        return NextResponse.next()
      }
      const stripped = pathname.replace(/^\//, '')
      if (INSPECTION_TOKEN_RE.test(stripped)) {
        const url = request.nextUrl.clone()
        url.pathname = `/i/${stripped}`
        return NextResponse.rewrite(url)
      }
      return new NextResponse('Not found', { status: 404 })
    }
    // Unverified custom host or unknown host that isn't the app — let
    // the request fall through to the standard middleware. Edge cases
    // (e.g. a hostname that was just removed) get a normal 404 from the
    // app's route tree, which is the right behaviour.
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Refresh session — required for Server Components to stay in sync
  // Wrapped in try/catch so a misconfigured Supabase URL doesn't crash every route.
  let user = null
  try {
    const { data } = await supabase.auth.getUser()
    user = data.user
  } catch {
    // Auth unavailable — treat as unauthenticated; public routes still render.
  }

  const { pathname } = request.nextUrl

  // Public routes that don't need auth.
  // /oauth/authorize is "public" here so the page itself can render an
  // error or redirect to /login with the full query string preserved
  // (middleware-level redirect strips search params).
  const isPublicRoute =
    pathname === '/' ||
    pathname.startsWith('/pricing') ||
    pathname.startsWith('/data') ||
    pathname.startsWith('/privacy') ||
    pathname.startsWith('/contact') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/signup') ||
    pathname.startsWith('/check-email') ||
    // HOR-201: /invite/accept/[token] must be reachable pre-auth — the common
    // case is a brand-new invitee who doesn't have an account yet. Without
    // this, the magic-link send CTA is gated behind /login and the flow stalls.
    pathname.startsWith('/invite/') ||
    pathname.startsWith('/auth/callback') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/t') ||
    pathname.startsWith('/api/identity') ||
    pathname.startsWith('/api/cron') ||
    pathname.startsWith('/api/webhooks') ||
    pathname.startsWith('/api/mcp') ||
    pathname.startsWith('/r/') ||
    pathname.startsWith('/u/') ||
    pathname.startsWith('/i/') ||
    // HOR-225: tracked-email pixel + click handlers. Public because the
    // recipient's mail client has no Horace session, and any auth gate
    // would break image-proxy prefetches outright.
    pathname.startsWith('/t/') ||
    pathname.startsWith('/api/inspections/capture') ||
    pathname.startsWith('/install/') ||
    pathname.startsWith('/oauth/') ||
    pathname.startsWith('/.well-known/') ||
    // HOR-56 mobile pairing: the token-exchange route `/m/<token>` is public
    // (phone has no session yet — it's about to redeem a magic link). The
    // post-redemption page `/m/<token>/install` stays auth-protected so it
    // requires the magic-link session.
    /^\/m\/[^/]+\/?$/.test(pathname)

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  // Redirect logged-in users away from login to the dashboard
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|js|css|ico|txt|xml)$).*)',
  ],
}
