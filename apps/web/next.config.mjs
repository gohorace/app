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
      // Temporary — removed in HOR-126 when /properties (list page) ships.
      { source: '/properties', destination: '/properties/new', permanent: false },
    ]
  },
}

export default nextConfig
