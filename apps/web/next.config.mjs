/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['twilio', 'web-push'],
  },
}

export default nextConfig
