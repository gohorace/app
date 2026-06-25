import type { Metadata, Viewport } from 'next'
import { Playfair_Display, DM_Sans, DM_Mono } from 'next/font/google'
import Script from 'next/script'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { PushManager } from '@/components/push-manager'
import './globals.css'

const GTM_ID = 'GTM-NM2T3D35'

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['300', '400', '500', '600'],
  display: 'swap',
})

const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Horace',
  description: 'Helping real estate agents win their market',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    // 'default' (opaque) rather than 'black-translucent' — Horace's UI is a
    // light parchment, so the immersive translucent bar rendered the iOS
    // status-bar glyphs (clock/battery) in white over light page headers and
    // pulled page content up underneath the notch. 'default' reserves an
    // opaque system bar above the webview: legible glyphs, content sits below.
    statusBarStyle: 'default',
    title: 'Horace',
  },
}

export const viewport: Viewport = {
  themeColor: '#2E2823',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Required for env(safe-area-inset-*) to report real values on notched
  // iPhones. Without it the insets are 0 and the bottom tab bar's
  // safe-area-inset-bottom padding (mobile-nav.tsx) is inert — the nav would
  // sit under the home indicator.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${playfair.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <head>
        {/* apple-touch-icon comes from the metadata API (icons.apple) so the
            prospect-facing Doorstep pages can override it with neutral chrome
            per-page (HOR-294). A hardcoded <link> here would leak the Horace
            icon on those surfaces regardless of page metadata. */}
        {/* Google Tag Manager — guarded so it never fires on the neutral
            Doorstep host (*.onthedoorstep.app). gohorace behaviour unchanged. */}
        <Script id="gtm-init" strategy="afterInteractive">
          {`(function(w,d,s,l,i){if(/(^|\\.)onthedoorstep\\.app$/i.test(location.hostname))return;w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`}
        </Script>
        {/* End Google Tag Manager */}
      </head>
      <body>
        {/* Google Tag Manager (noscript) */}
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
            height="0"
            width="0"
            style={{ display: 'none', visibility: 'hidden' }}
          />
        </noscript>
        {/* End Google Tag Manager (noscript) */}
        <PushManager />
        {children}
        <SpeedInsights />
      </body>
    </html>
  )
}
