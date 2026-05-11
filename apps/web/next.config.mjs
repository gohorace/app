/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['twilio', 'web-push'],
  },
  async redirects() {
    return [
      { source: '/leads', destination: '/contacts', permanent: true },
      { source: '/leads/:id', destination: '/contacts/:id', permanent: true },
    ]
  },
}

export default nextConfig
