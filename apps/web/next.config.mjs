/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['twilio', 'web-push'],
  },
  async redirects() {
    return [
      { source: '/leads', destination: '/contacts', permanent: true },
      { source: '/leads/:id', destination: '/contacts/:id', permanent: true },
      // V1 nav IA (HOR-122): /dashboard retired — Today's digest is the new landing.
      { source: '/dashboard', destination: '/digest', permanent: true },
      // /handbook renamed to /manifesto — keep old shared links + QR codes alive.
      { source: '/handbook', destination: '/manifesto', permanent: true },
      // HOR-126: /properties is now a real list page; the temporary
      // /properties → /properties/new redirect from HOR-123 has been removed.
      // /properties/new itself now redirects to /properties?add=1 (handled
      // by the page component, not here).
    ]
  },
}

export default nextConfig
