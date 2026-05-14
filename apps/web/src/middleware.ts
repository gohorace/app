import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
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
