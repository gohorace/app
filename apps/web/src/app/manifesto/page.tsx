'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { BookingModal } from '@/components/booking-modal'
import {
  chapters,
  closing,
  hero,
  pullquotes,
  share,
} from './content'
import styles from './manifesto.module.css'
import { Chapter } from './components/Chapter'
import { Closing } from './components/Closing'
import { Hero } from './components/Hero'
import { NowPlayingBar } from './components/NowPlayingBar'
import { PhonePopover } from './components/PhonePopover'
import { Pullquote } from './components/Pullquote'
import { ResumeBanner } from './components/ResumeBanner'
import { SharePopover } from './components/SharePopover'
import { TableOfContents, type TocEntry } from './components/TableOfContents'
import { Toast } from './components/Toast'
import { Topbar } from './components/Topbar'
import { useActiveChapter } from './hooks/useActiveChapter'
import { useReadAloud } from './hooks/useReadAloud'
import { useReadingProgress } from './hooks/useReadingProgress'
import { getResumeFraction, useSavedState } from './hooks/useSavedState'

const TOC_OFFSET = 84

function computeReadTime(): string {
  const parts: string[] = [
    hero.titleLead,
    hero.titleEm,
    hero.titleTail,
    hero.standfirst,
    closing.lede,
    closing.sub,
    closing.sigLine1,
  ]
  for (const c of chapters) {
    parts.push(c.heading, ...c.paras)
  }
  for (const q of pullquotes) parts.push(q.text)
  const words = parts
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  return `${Math.max(1, Math.round(words / 200))} min read`
}

export default function ManifestoPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const fillRef = useRef<HTMLDivElement>(null)

  const { scrolled } = useReadingProgress(fillRef)

  const tocEntries = useMemo<TocEntry[]>(
    () => chapters.filter((c) => c.toc).map((c) => ({ id: c.id, label: c.toc as string })),
    [],
  )
  const tocIds = useMemo(() => tocEntries.map((e) => e.id), [tocEntries])
  const activeId = useActiveChapter(tocIds)

  const numbers = useMemo(() => {
    const m: Record<string, string> = {}
    let n = 0
    for (const c of chapters) {
      if (c.tagLabel) m[c.id] = String(++n).padStart(2, '0')
    }
    return m
  }, [])

  const readTime = useMemo(computeReadTime, [])

  // ── Toast ──
  const [toast, setToast] = useState({ message: '', show: false })
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()
  const showToast = useCallback((message: string) => {
    setToast({ message, show: true })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), 2600)
  }, [])

  // ── Save / read-later ──
  const { saved, toggle: toggleSaved } = useSavedState()
  const onSave = useCallback(() => {
    const next = toggleSaved()
    showToast(next ? 'Saved — we’ll keep your place' : 'Removed from your saved reads')
  }, [toggleSaved, showToast])

  // ── Listen ──
  const listen = useReadAloud(pageRef, styles.speaking, showToast)

  // ── Popovers ──
  const [popover, setPopover] = useState<'phone' | 'share' | null>(null)
  const closePops = useCallback(() => setPopover(null), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── Share / phone URLs (client-resolved to avoid hydration drift) ──
  const [urls, setUrls] = useState({
    page: 'https://gohorace.com/manifesto',
    display: 'gohorace.com/manifesto',
  })
  const [showNative, setShowNative] = useState(false)
  useEffect(() => {
    setUrls({
      page: window.location.href,
      display: (window.location.host || 'gohorace.com') + (window.location.pathname || '/manifesto'),
    })
    setShowNative(typeof navigator !== 'undefined' && !!navigator.share)
  }, [])

  const emailHref = useMemo(
    () =>
      'mailto:?subject=' +
      encodeURIComponent(share.title) +
      '&body=' +
      encodeURIComponent(share.text + '\n\n' + urls.page),
    [urls.page],
  )

  // ── QR ──
  const [qrSvg, setQrSvg] = useState<string | null>(null)
  const openPhone = useCallback(() => {
    setPopover('phone')
    if (!qrSvg) {
      QRCode.toString(urls.page, { type: 'svg', margin: 0 })
        .then(setQrSvg)
        .catch(() => setQrSvg(null))
    }
  }, [qrSvg, urls.page])

  const onCopy = useCallback(() => {
    const done = () => {
      closePops()
      showToast('Link copied to clipboard')
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(urls.page).then(done).catch(() => {
        closePops()
        showToast('Copy this link: ' + urls.display)
      })
    } else {
      closePops()
      showToast('Copy this link: ' + urls.display)
    }
  }, [urls, closePops, showToast])

  const onNative = useCallback(() => {
    if (navigator.share) {
      navigator
        .share({ title: share.title, text: share.text, url: urls.page })
        .then(closePops)
        .catch(() => {})
    }
  }, [urls.page, closePops])

  // ── Smooth scroll helpers ──
  const scrollToId = useCallback((id: string) => {
    const t = document.getElementById(id)
    if (t) {
      window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - TOC_OFFSET, behavior: 'smooth' })
    }
  }, [])
  const scrollToTop = useCallback(() => window.scrollTo({ top: 0, behavior: 'smooth' }), [])

  // ── Book-a-walk-through modal (cal.com embed) ──
  const [bookingOpen, setBookingOpen] = useState(false)

  // ── Resume banner ──
  const [resumeShow, setResumeShow] = useState(false)
  const resumeFrac = useRef<number | null>(null)
  useEffect(() => {
    const frac = getResumeFraction()
    if (frac != null) {
      resumeFrac.current = frac
      const t = setTimeout(() => setResumeShow(true), 1200)
      return () => clearTimeout(t)
    }
  }, [])
  const onResume = useCallback(() => {
    const frac = resumeFrac.current
    if (frac != null) {
      const h = document.documentElement
      window.scrollTo({ top: frac * (h.scrollHeight - h.clientHeight), behavior: 'smooth' })
    }
    setResumeShow(false)
  }, [])

  return (
    <div className={styles.page} ref={pageRef}>
      <div className={styles.progressTrack}>
        <div className={styles.progressFill} ref={fillRef} />
      </div>

      <Topbar
        scrolled={scrolled}
        saved={saved}
        onSave={onSave}
        onPhone={openPhone}
        onShare={() => setPopover('share')}
        isPlaying={listen.isPlaying}
        listenLabel={listen.listenLabel}
        listenSupported={listen.supported}
        onListen={listen.toggle}
        onBrand={scrollToTop}
      />

      <div className={styles.shell} id="top">
        <TableOfContents entries={tocEntries} activeId={activeId} onJump={scrollToId} />

        <Hero readTime={readTime} onListen={listen.startFromTop} />

        <main className={styles.article} id="article">
          {chapters.map((ch) => (
            <Fragment key={ch.id}>
              <Chapter chapter={ch} num={numbers[ch.id] ?? null} />
              {pullquotes
                .filter((pq) => pq.after === ch.id)
                .map((pq) => (
                  <Pullquote key={pq.text} text={pq.text} />
                ))}
            </Fragment>
          ))}
          <div className={styles.dividerMark}>
            <span />
            <span />
            <span />
          </div>
        </main>

        <Closing onBookCall={() => setBookingOpen(true)} />
      </div>

      <NowPlayingBar
        show={listen.active}
        isPlaying={listen.isPlaying}
        status={listen.status}
        progress={listen.progress}
        onToggle={listen.toggle}
        onStop={listen.stop}
        onNext={listen.next}
        onPrev={listen.prev}
      />

      <div
        className={`${styles.popOverlay} ${popover ? styles.open : ''}`}
        onClick={closePops}
        aria-hidden="true"
      />
      <PhonePopover
        open={popover === 'phone'}
        onClose={closePops}
        qrSvg={qrSvg}
        fallbackUrl={urls.display}
      />
      <SharePopover
        open={popover === 'share'}
        onClose={closePops}
        displayUrl={urls.display}
        emailHref={emailHref}
        onCopy={onCopy}
        onEmail={() => setTimeout(closePops, 100)}
        onNative={onNative}
        showNative={showNative}
      />

      {bookingOpen && (
        <BookingModal
          href={closing.ctaGhost.href}
          label="Book a walk-through"
          onClose={() => setBookingOpen(false)}
        />
      )}

      <Toast message={toast.message} show={toast.show} />
      <ResumeBanner show={resumeShow} onResume={onResume} onDismiss={() => setResumeShow(false)} />
    </div>
  )
}
