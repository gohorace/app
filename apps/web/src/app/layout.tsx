import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { PushManager } from '@/components/push-manager'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Horace',
  description: 'Lead tracking and scoring for real estate agents',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Horace',
  },
}

export const viewport: Viewport = {
  themeColor: '#111827',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className={inter.className}>
        <PushManager />
        {children}
      </body>
    </html>
  )
}
