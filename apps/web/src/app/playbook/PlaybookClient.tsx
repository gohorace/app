'use client'

/*
 * The Horace playbook — long-form editorial marketing page.
 * Ported from the design handoff prototype (Horace Playbook.html /
 * playbook.css / playbook.js). The prototype's vanilla-JS reading aids
 * (scroll progress, sticky TOC, Web-Speech read-aloud, QR/share popovers,
 * resume banner, toast) are reproduced here with React refs + effects.
 *
 * CTA wiring (the prototype shipped these as placeholders):
 *   - "Start your free trial"  → /signup
 *   - "Book a walk-through"    → cal.com (NEXT_PUBLIC_CAL_* with fallback)
 *   - Site-audit callouts (×3) → /audit (the site-audit tool).
 */

/* eslint-disable @next/next/no-img-element -- decorative brand avatars served
   directly from /public; the Next image optimizer adds a dev-compile round-trip
   that flickers a broken state, and these are fixed-size circles, so a plain
   <img> (matching the design prototype) is both simpler and more robust. */
import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './playbook.module.css'

// ── CTA destinations ────────────────────────────────
const SIGNUP_HREF = '/signup'
const SITE_AUDIT_HREF = '/audit' // the site-audit tool (built in the horace-site-audit worktree)
const CAL_USER = process.env.NEXT_PUBLIC_CAL_USERNAME
const CAL_SLUG = process.env.NEXT_PUBLIC_CAL_EVENT_SLUG
const WALKTHROUGH_HREF =
  CAL_USER && CAL_SLUG ? `https://cal.com/${CAL_USER}/${CAL_SLUG}` : 'https://cal.com/andytwomey/support-session'

const STORE = { progress: 'horace-playbook:progress', saved: 'horace-playbook:saved' }

// Table of contents — every chapter that carries a data-toc label, in order.
const TOC: { id: string; label: string }[] = [
  { id: 's-note', label: 'A note before you read' },
  { id: 's-journey', label: "The vendor's journey" },
  { id: 's1', label: 'Considered, not flashy' },
  { id: 's2', label: 'Structure for signal' },
  { id: 's3', label: 'Brand on display' },
  { id: 's4', label: 'Speed converts' },
  { id: 's5', label: 'Mobile first' },
  { id: 's6', label: 'Convert with care' },
  { id: 's7', label: 'Found by search & AI' },
  { id: 's8', label: 'Connect the tools' },
  { id: 's-fix', label: 'Fix this month' },
  { id: 's-last', label: 'One last thing' },
]

const ARROW = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
)

type ReadableBlock = { el: HTMLElement; text: string }

export default function PlaybookClient() {
  const rootRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const heroRef = useRef<HTMLElement>(null)

  // ── UI state ──────────────────────────────────────
  const [scrolled, setScrolled] = useState(false)
  const [progress, setProgress] = useState(0)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [readTime, setReadTime] = useState('12 min read')
  const [resumeVisible, setResumeVisible] = useState(false)
  const [popover, setPopover] = useState<'phone' | 'share' | null>(null)
  const [toastMsg, setToastMsg] = useState('')
  const [toastVisible, setToastVisible] = useState(false)
  const [qrSrc, setQrSrc] = useState<string | null>(null)
  const [qrFallback, setQrFallback] = useState<string | null>(null)
  const [displayUrl, setDisplayUrl] = useState('gohorace.com/playbook')
  const [canNativeShare, setCanNativeShare] = useState(false)

  // ── Listen (read-aloud) engine state ──────────────
  const [playing, setPlaying] = useState(false)
  const [playerVisible, setPlayerVisible] = useState(false)
  const [playerStatus, setPlayerStatus] = useState('Horace, reading aloud')
  const [playerProg, setPlayerProg] = useState(0)

  const blocksRef = useRef<ReadableBlock[]>([])
  const idxRef = useRef(0)
  const playingRef = useRef(false)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const savedFracRef = useRef(0)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    setToastVisible(true)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastVisible(false), 2600)
  }, [])

  // ── Build readable blocks + reading time (after mount) ──
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const sel = [
      `#hero h1`,
      `#hero .${styles.standfirst}`,
      `#article > .${styles.chapter} > h2`,
      `#article > .${styles.chapter} > p`,
      `#article > .${styles.chapter} > ul.${styles.plain} > li`,
      `#article .${styles.figure}`,
      `#article .${styles.audit} .${styles['audit-body']} p`,
      `#article > .${styles.pullquote} blockquote`,
      `#article .${styles['matrix-wrap']} table.${styles.matrix} tbody tr`,
      `#article .${styles.fixlist} > li .${styles['fx-text']}`,
      `#close .${styles.lede}`,
      `#close .${styles.sub}`,
      `#close .${styles.sig}`,
    ].join(', ')

    blocksRef.current = Array.from(root.querySelectorAll<HTMLElement>(sel))
      .map((el) => {
        let text: string
        if (el.matches('tr')) {
          const stage = el.querySelector(`.${styles.stage} strong`)?.textContent ?? ''
          const reads = el.querySelector(`.${styles.reads}`)?.textContent ?? ''
          text = `${stage}. ${reads}`
        } else if (el.matches(`.${styles.figure}`)) {
          const n = el.querySelector(`.${styles['fig-num']}`)?.textContent ?? ''
          const c = el.querySelector(`.${styles['fig-cap']}`)?.textContent ?? ''
          text = `${n}. ${c}`
        } else {
          text = el.textContent ?? ''
        }
        return { el, text: text.replace(/\s+/g, ' ').trim() }
      })
      .filter((b) => b.text.length > 1)

    // Reading time — hero + article words ÷ ~200 wpm.
    const words = (
      (articleRef.current?.textContent ?? '') +
      ' ' +
      (heroRef.current?.textContent ?? '')
    )
      .trim()
      .split(/\s+/)
      .filter(Boolean).length
    setReadTime(`${Math.max(1, Math.round(words / 200))} min read`)
  }, [])

  // ── Scroll: progress bar + sticky bar + persist position ──
  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const h = document.documentElement
        const max = h.scrollHeight - h.clientHeight
        const frac = max > 0 ? h.scrollTop / max : 0
        setProgress(frac)
        setScrolled(h.scrollTop > 24)
        try {
          localStorage.setItem(STORE.progress, String(frac))
        } catch {
          /* private mode */
        }
        ticking = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // ── Active ToC via IntersectionObserver ───────────
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const els = TOC.map((t) => root.querySelector<HTMLElement>(`#${CSS.escape(t.id)}`)).filter(
      (e): e is HTMLElement => !!e,
    )
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) setActiveId(en.target.id)
        })
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  // ── Init: saved state, native-share, display URL, resume banner ──
  useEffect(() => {
    try {
      setSaved(localStorage.getItem(STORE.saved) === '1')
    } catch {
      /* ignore */
    }
    setCanNativeShare(typeof navigator !== 'undefined' && !!navigator.share)
    setDisplayUrl((window.location.host || 'gohorace.com') + (window.location.pathname || '/playbook'))

    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const frac = parseFloat(localStorage.getItem(STORE.progress) || '0')
      if (frac > 0.06 && frac < 0.92) {
        savedFracRef.current = frac
        timer = setTimeout(() => setResumeVisible(true), 1200)
      }
    } catch {
      /* ignore */
    }
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [])

  // ── Escape closes popovers ────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // ── TOC click → smooth scroll with -84px offset ───
  const scrollToId = useCallback((id: string) => {
    const t = document.getElementById(id)
    if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 84, behavior: 'smooth' })
  }, [])

  // ── Save / read later ─────────────────────────────
  const toggleSave = useCallback(() => {
    let on = false
    try {
      on = localStorage.getItem(STORE.saved) === '1'
      localStorage.setItem(STORE.saved, on ? '0' : '1')
    } catch {
      /* ignore */
    }
    setSaved(!on)
    toast(on ? 'Removed from your saved reads' : 'Saved — we’ll keep your place')
  }, [toast])

  // ── Resume ────────────────────────────────────────
  const resumeGo = useCallback(() => {
    const h = document.documentElement
    window.scrollTo({ top: savedFracRef.current * (h.scrollHeight - h.clientHeight), behavior: 'smooth' })
    setResumeVisible(false)
  }, [])

  // ── To phone (QR) ─────────────────────────────────
  const openPhone = useCallback(async () => {
    setPopover('phone')
    if (qrSrc || qrFallback) return
    try {
      const mod = await import('qrcode')
      const QR = (mod as unknown as { default?: typeof mod }).default ?? mod
      const url = await QR.toDataURL(window.location.href, { margin: 0, width: 196 })
      setQrSrc(url)
    } catch {
      setQrFallback((window.location.host || 'gohorace.com') + (window.location.pathname || '/playbook'))
    }
  }, [qrSrc, qrFallback])

  // ── Share ─────────────────────────────────────────
  const shareTitle = 'The Horace playbook — Your website, working harder'
  const shareText = 'How to build a real estate website that actually wins listings. Worth a read.'
  const emailHref = `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(
    shareText + '\n\n' + (typeof window !== 'undefined' ? window.location.href : ''),
  )}`

  const copyLink = useCallback(() => {
    const url = window.location.href
    ;(navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
      .then(() => {
        setPopover(null)
        toast('Link copied to clipboard')
      })
      .catch(() => {
        setPopover(null)
        toast('Copy this link: ' + displayUrl)
      })
  }, [displayUrl, toast])

  const nativeShare = useCallback(() => {
    if (navigator.share) {
      navigator
        .share({ title: shareTitle, text: shareText, url: window.location.href })
        .then(() => setPopover(null))
        .catch(() => {})
    }
  }, [])

  // ════════════════════════════════════════════════
  //  LISTEN — Web Speech read-aloud
  // ════════════════════════════════════════════════
  const supported =
    typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window

  // Pick a preferred voice once voices are available.
  useEffect(() => {
    if (!supported) return
    const synth = window.speechSynthesis
    const pick = () => {
      const vs = synth.getVoices()
      if (!vs.length) return null
      const pref = [/en-GB/i, /en-AU/i, /Daniel/i, /Arthur/i, /en-US/i, /English/i]
      for (const re of pref) {
        const v = vs.find((x) => re.test(x.lang) || re.test(x.name))
        if (v) return v
      }
      return vs[0]
    }
    voiceRef.current = pick()
    synth.onvoiceschanged = () => {
      if (!voiceRef.current) voiceRef.current = pick()
    }
    return () => {
      synth.onvoiceschanged = null
    }
  }, [supported])

  const highlight = useCallback((i: number) => {
    const blocks = blocksRef.current
    blocks.forEach((b, j) => b.el.classList.toggle(styles.speaking, j === i))
    const el = blocks[i]?.el
    if (el) {
      const r = el.getBoundingClientRect()
      const pad = 140
      if (r.top < pad || r.bottom > window.innerHeight - 120) {
        window.scrollTo({ top: r.top + window.scrollY - window.innerHeight * 0.34, behavior: 'smooth' })
      }
    }
    setPlayerProg((i / Math.max(1, blocks.length - 1)) * 100)
    setPlayerStatus(`Horace · ${i + 1} of ${blocks.length}`)
  }, [])

  const stopListen = useCallback(
    (finished: boolean) => {
      playingRef.current = false
      setPlaying(false)
      if (supported) window.speechSynthesis.cancel()
      setPlayerVisible(false)
      blocksRef.current.forEach((b) => b.el.classList.remove(styles.speaking))
      if (finished) {
        idxRef.current = 0
        toast('That’s the playbook — seize the moment')
      }
    },
    [supported, toast],
  )

  const speakCurrent = useCallback(() => {
    if (!supported) return
    const synth = window.speechSynthesis
    const blocks = blocksRef.current
    if (idxRef.current >= blocks.length) {
      stopListen(true)
      return
    }
    highlight(idxRef.current)
    const u = new SpeechSynthesisUtterance(blocks[idxRef.current].text)
    if (voiceRef.current) u.voice = voiceRef.current
    u.lang = voiceRef.current?.lang || 'en-GB'
    u.rate = 0.97
    u.pitch = 1.0
    u.volume = 1.0
    u.onend = () => {
      if (!playingRef.current) return
      idxRef.current++
      setTimeout(() => {
        if (playingRef.current) speakCurrent()
      }, 130)
    }
    u.onerror = () => {
      if (playingRef.current) {
        idxRef.current++
        setTimeout(speakCurrent, 80)
      }
    }
    synth.speak(u)
  }, [supported, highlight, stopListen])

  const speakFrom = useCallback(
    (i: number) => {
      if (!supported) return
      const synth = window.speechSynthesis
      synth.cancel()
      idxRef.current = Math.max(0, Math.min(i, blocksRef.current.length - 1))
      playingRef.current = true
      setPlaying(true)
      setPlayerVisible(true)
      speakCurrent()
    },
    [supported, speakCurrent],
  )

  const togglePlay = useCallback(() => {
    if (!supported) {
      toast('Read-aloud isn’t supported in this browser')
      return
    }
    const synth = window.speechSynthesis
    if (!playingRef.current && !synth.speaking) {
      speakFrom(idxRef.current)
      return
    }
    if (synth.paused) {
      synth.resume()
      playingRef.current = true
      setPlaying(true)
    } else {
      synth.pause()
      playingRef.current = false
      setPlaying(false)
    }
  }, [supported, speakFrom, toast])

  const listenFromTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    speakFrom(0)
  }, [speakFrom])

  // Keep the speech engine alive (Chrome pauses long speech) + cleanup on unmount.
  useEffect(() => {
    if (!supported) return
    const synth = window.speechSynthesis
    const keepAlive = setInterval(() => {
      if (playingRef.current && synth.speaking && !synth.paused) {
        synth.pause()
        synth.resume()
      }
    }, 9000)
    const onUnload = () => synth.cancel()
    window.addEventListener('beforeunload', onUnload)
    return () => {
      clearInterval(keepAlive)
      window.removeEventListener('beforeunload', onUnload)
      synth.cancel()
    }
  }, [supported])

  // Toolbar Listen button: resume if paused, else play/pause toggle.
  const onListenClick = useCallback(() => {
    if (!supported) {
      toast('Read-aloud isn’t supported in this browser')
      return
    }
    togglePlay()
  }, [supported, togglePlay, toast])

  const cx = (...names: (string | false | null | undefined)[]) =>
    names.filter(Boolean).map((n) => styles[n as string] ?? '').join(' ')

  return (
    <div className={styles.page} ref={rootRef} id="top">
      {/* reading progress */}
      <div className={styles['progress-track']}>
        <div className={styles['progress-fill']} style={{ width: `${(progress * 100).toFixed(2)}%` }} />
      </div>

      {/* top bar */}
      <header className={cx('topbar', scrolled && 'scrolled')}>
        <a className={styles.brand} href="#top">
          <span className={styles['brand-dot']} />
          <span className={styles['brand-name']}>Horace</span>
          <span className={styles['brand-sep']} />
          <span className={styles['brand-tag']}>The playbook</span>
        </a>
        <nav className={styles.tools}>
          <button className={cx('tool-btn', saved && 'active')} title="Save to read later" onClick={toggleSave}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path
                d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"
                fill={saved ? 'currentColor' : 'none'}
              />
            </svg>
            <span className={styles.lbl}>Save</span>
          </button>
          <button className={styles['tool-btn']} title="Send to your phone" onClick={openPhone}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="5" y="2" width="14" height="20" rx="2" />
              <line x1="12" y1="18" x2="12" y2="18" />
            </svg>
            <span className={styles.lbl}>To phone</span>
          </button>
          <button className={styles['tool-btn']} title="Share with a colleague" onClick={() => setPopover('share')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="18" cy="5" r="3" />
              <circle cx="6" cy="12" r="3" />
              <circle cx="18" cy="19" r="3" />
              <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
              <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
            </svg>
            <span className={styles.lbl}>Share</span>
          </button>
          <button
            className={cx('tool-btn', 'primary-listen')}
            title="Listen to this"
            onClick={onListenClick}
            style={{ opacity: supported ? 1 : 0.5 }}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none" />
                <rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
              </svg>
            )}
            <span className={styles.lbl}>{playing ? 'Pause' : 'Listen'}</span>
          </button>
        </nav>
      </header>

      <div className={styles.shell}>
        {/* Table of contents */}
        <aside className={styles.toc} aria-label="Contents">
          <div className={styles['toc-label']}>The playbook</div>
          <ul className={styles['toc-list']}>
            {TOC.map((t, i) => (
              <li key={t.id}>
                <button
                  className={cx('toc-link', activeId === t.id && 'active')}
                  onClick={() => scrollToId(t.id)}
                >
                  <span className={styles.num}>{String(i + 1).padStart(2, '0')}</span>
                  <span>{t.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Hero */}
        <section className={styles.hero} id="hero" ref={heroRef}>
          <div className={styles.eyebrow}>The Horace playbook</div>
          <h1>
            Your website,
            <br />
            <em>working</em> harder.
          </h1>
          <p className={styles.standfirst}>
            The manifesto made the case for why your website matters more than ever. This is the how — eight
            principles for building a site a vendor wants to move through, and one I can read for you. Use what&apos;s
            useful. Ignore what isn&apos;t.
          </p>
          <div className={styles.byline}>
            <div className={styles['byline-av']}>
              <img src="/horace-ink.png" alt="Horace" width={54} height={54} />
            </div>
            <div className={styles['byline-meta']}>
              <div className={styles['byline-by']}>
                From Horace <span>· to the agent building their site</span>
              </div>
              <div className={styles['byline-sub']}>
                <span>{readTime}</span>
                <span className={styles.dot} />
                <span>A playbook</span>
              </div>
            </div>
            <button className={styles['byline-listen']} onClick={listenFromTop}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none" />
              </svg>
              Listen to this
            </button>
          </div>
        </section>

        {/* Article */}
        <main className={styles.article} id="article" ref={articleRef}>
          {/* A note before you read */}
          <article className={styles.chapter} id="s-note">
            <div className={styles['chapter-tag']}>
              Before we start <span className={styles.rule} />
            </div>
            <h2>A note before you read</h2>
            <p className={cx('lead', 'dropcap')}>
              I&apos;m Horace. I&apos;m the face of a team that&apos;s spent fifteen years building performance-based
              websites — the kind designed to do a job, not just sit there looking nice. We&apos;ve worked deep inside
              real estate, and we&apos;ve built go-to-market campaigns for some of the highest-velocity businesses
              around.
            </p>
            <p>
              This playbook is the companion piece to the manifesto. The manifesto makes the case for <em>why</em> your
              website matters more than ever. This playbook tells you <em>how</em> to build one that earns that claim.
            </p>
            <p>Read it like a checklist. Use what&apos;s useful. Ignore what isn&apos;t.</p>
          </article>

          {/* The vendor's journey */}
          <article className={styles.chapter} id="s-journey">
            <div className={styles['chapter-tag']}>
              The frame <span className={styles.rule} />
            </div>
            <h2>The vendor&apos;s journey — and what your site needs to do</h2>
            <p>Before we get to the principles, the frame.</p>
            <p>
              A vendor doesn&apos;t arrive at your site ready to list. They arrive somewhere on a journey — sometimes
              just wondering, sometimes weeks from a decision. A site that does its job meets them where they are, and
              quietly tells you they were there.
            </p>
          </article>

          <div className={styles['matrix-wrap']}>
            <div className={styles['matrix-cap']}>The vendor&apos;s journey — and what your site reveals</div>
            <table className={styles.matrix}>
              <colgroup>
                <col className={styles['c-stage']} />
                <col className={styles['c-gives']} />
                <col className={styles['c-reads']} />
              </colgroup>
              <thead>
                <tr>
                  <th>Where they&apos;re at</th>
                  <th>What a great site gives them</th>
                  <th>What it tells you</th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    s: 'Just wondering',
                    ss: "What's my place worth?",
                    g: "A value estimate, your suburb's recent sold prices",
                    r: 'Someone’s checking what homes like theirs are fetching',
                  },
                  {
                    s: 'Keeping an eye',
                    ss: 'Watching, not committed',
                    g: 'Suburb reports to download, market updates, sold galleries',
                    r: 'They pulled a report — and they keep coming back to the sold results',
                  },
                  {
                    s: 'Getting serious',
                    ss: 'Should I sell?',
                    g: 'An appraisal page, a selling guide, straight talk on fees and the process',
                    r: 'They’re on your appraisal page but haven’t booked — a warm call, not a cold one',
                  },
                  {
                    s: 'Sizing you up',
                    ss: 'Who do I trust with this?',
                    g: 'Your track record, recent sales, real reviews, your profile',
                    r: 'They’re reading your sold listings and reviews — you’re on the shortlist, up against two or three others',
                  },
                  {
                    s: 'On the edge',
                    ss: 'Ready to reach out',
                    g: 'An easy way to contact you, a simple booking',
                    r: 'They hit your contact page and left. They were close — follow up',
                  },
                  {
                    s: 'After the first chat',
                    ss: 'Deciding to list',
                    g: 'Comparable sales, clear next steps',
                    r: 'They’re back on your sold results after the appraisal — still weighing it',
                  },
                ].map((row) => (
                  <tr key={row.s}>
                    <td className={styles.stage} data-h="Where they're at">
                      <strong>{row.s}</strong>
                      <span>{row.ss}</span>
                    </td>
                    <td className={styles.gives} data-h="What a great site gives them">
                      {row.g}
                    </td>
                    <td className={cx('reads', 'reads-cell')} data-h="What it tells you">
                      {row.r}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <article className={styles.chapter} id="s-journey2">
            <p>
              Every principle that follows is in service of this table. A site that handles the journey cleanly is a
              site I can read for you.
            </p>
          </article>

          <div className={styles.pullquote}>
            <div className={styles['pq-dot']} />
            <blockquote>A site that handles the journey cleanly is a site I can read for you.</blockquote>
          </div>

          {/* 01 */}
          <article className={styles.chapter} id="s1">
            <div className={styles['chapter-tag']}>
              <span className={styles.num}>01</span> Considered design <span className={styles.rule} />
            </div>
            <h2>Great design isn&apos;t flashy — it&apos;s considered</h2>
            <p className={styles.lead}>The best sites don&apos;t shout. They feel calm. They feel like someone cared.</p>
            <p>
              When a vendor lands on a site that&apos;s been thought through — clear hierarchy, generous space, the
              right thing said at the right moment — they read it as a signal about you. <em>These people are sharp.
              These people pay attention to detail. These people will probably sell my house the same way.</em>
            </p>
            <p>
              The opposite is also true. A cluttered site, a homepage that bombards you with seven competing messages, a
              layout that fights for attention — that tells a vendor everything they need to know, and it isn&apos;t
              flattering.
            </p>
            <p>
              Good design is about prioritisation. Knowing what to say first, what to say second, and what not to say at
              all. Most sites fail not because they&apos;re ugly, but because they try to say everything at once and end
              up saying nothing.
            </p>
            <p>
              <strong>The test:</strong> if a visitor lands on your homepage and can&apos;t tell, in three seconds, who
              you are and what you do, you&apos;ve buried the lede.
            </p>
          </article>

          {/* 02 */}
          <article className={styles.chapter} id="s2">
            <div className={styles['chapter-tag']}>
              <span className={styles.num}>02</span> Architecture <span className={styles.rule} />
            </div>
            <h2>Structure pages to drive signal, not just traffic</h2>
            <p>
              Your information architecture — the way pages connect, what lives where, what a visitor sees next — is one
              of the highest-leverage decisions you&apos;ll make.
            </p>
            <p>
              Most agents think about it as a navigation problem. It isn&apos;t. It&apos;s a behavioural problem. Every
              page is a chance to learn something about the visitor, and every link is a chance to move them closer to a
              conversation.
            </p>
            <p>
              Build the site so it does two jobs at once: deliver value to the visitor <strong>and</strong> surface
              intent to you. A few patterns worth using:
            </p>
            <ul className={styles.plain}>
              <li>
                <strong>A suburb hub.</strong> One page per suburb you work, with recent sales, current listings, and a
                market snapshot. Vendors researching the area land here — and three visits to the same suburb hub is one
                of the strongest signals you&apos;ll see.
              </li>
              <li>
                <strong>A clear appraisal path.</strong> Not buried in a form, but built as a journey. A vendor who walks
                the path without submitting is still telling you something.
              </li>
              <li>
                <strong>A sold portfolio with depth.</strong> Not just price, but story. Vendors benchmark against your
                sold results before they pick up the phone.
              </li>
              <li>
                <strong>Each listing on its own page.</strong> Not a modal, not a slide-in, not a tab. A repeat visit to
                one property is one of the cleanest signals there is — but only if that property has somewhere of its
                own to live.
              </li>
              <li>
                <strong>Agent profiles that earn trust.</strong> Not LinkedIn bios. Real ones. The agent who shows up as
                a person, not a logo, wins.
              </li>
            </ul>
            <p>Every page should answer a vendor&apos;s question and quietly raise their hand.</p>
          </article>

          {/* Site audit callout 1 */}
          <aside className={styles.audit}>
            <div className={styles['audit-av']}>
              <img src="/horace-ink.png" alt="Horace" width={60} height={60} />
            </div>
            <div className={styles['audit-body']}>
              <div className={styles['audit-eyebrow']}>Site audit</div>
              <p>
                Is every listing on its own page? Are your suburb hubs doing both jobs at once?{' '}
                <span>Let me show you exactly what I&apos;d be able to read on your site as it stands.</span>
              </p>
            </div>
            <a className={styles['audit-cta']} href={SITE_AUDIT_HREF}>
              Run the site audit {ARROW}
            </a>
          </aside>

          {/* 03 */}
          <article className={styles.chapter} id="s3">
            <div className={styles['chapter-tag']}>
              <span className={styles.num}>03</span> Brand <span className={styles.rule} />
            </div>
            <h2>Brand is your marketing prowess, on display</h2>
            <p>
              Your brand is the closest thing to a free signal a vendor gets about how you&apos;ll handle their listing.
            </p>
            <p>
              If your brand feels cohesive — consistent type, considered colour, photography that looks like it belongs
              together — vendors infer the same about your marketing. <em>If they care this much about how their own
              brand looks, they&apos;ll care this much about how my home is presented.</em>
            </p>
            <p>
              The reverse is brutal. Inconsistent fonts, stretched logos, photography that doesn&apos;t match across
              pages — these things telegraph carelessness, and vendors are very good at reading them. A few
              non-negotiables:
            </p>
            <ul className={styles.plain}>
              <li>
                <strong>One logo, used properly.</strong> Not five variations depending on the page.
              </li>
              <li>
                <strong>A type system, not a font collection.</strong> Pick a headline face and a body face. Use them
                everywhere.
              </li>
              <li>
                <strong>A colour palette with discipline.</strong> Three to five colours, used consistently. Not a
                rainbow.
              </li>
              <li>
                <strong>Photography with a point of view.</strong> If your listing photos, your team photos and your
                suburb photos all look like they came from different planets, the brand isn&apos;t doing its job.
              </li>
            </ul>
            <p>
              <strong>Brand consistency drives recall. Recall is what gets you the call.</strong>
            </p>
          </article>

          {/* 04 */}
          <article className={styles.chapter} id="s4">
            <div className={styles['chapter-tag']}>
              <span className={styles.num}>04</span> Speed <span className={styles.rule} />
            </div>
            <h2>Speed is a conversion lever</h2>
            <p className={styles.lead}>Slow sites lose money. The data on this is no longer ambiguous.</p>
            <div className={styles.figures}>
              <div className={styles.figure}>
                <div className={styles['fig-num']}>7%</div>
                <div className={styles['fig-cap']}>
                  drop in conversions from just a <strong>one-second delay</strong> in load time
                </div>
              </div>
              <div className={styles.figure}>
                <div className={styles['fig-num']}>53%</div>
                <div className={styles['fig-cap']}>
                  of mobile visitors <strong>leave</strong> if a page takes longer than three seconds
                </div>
              </div>
              <div className={styles.figure}>
                <div className={styles['fig-num']}>30%</div>
                <div className={styles['fig-cap']}>
                  <strong>higher conversion</strong> on fast-loading real estate sites
                </div>
              </div>
            </div>
            <p>
              For agents, this matters in a specific way: the vendor doing late-night research on their phone is the
              most valuable visitor you&apos;ve got. They&apos;re high-intent, they&apos;re alone, and they&apos;re
              impatient. If your site doesn&apos;t load fast, they&apos;ll close the tab and never come back. You
              won&apos;t even know they were there.
            </p>
            <p>What to actually do:</p>
            <ul className={styles.plain}>
              <li>
                <strong>Compress every image.</strong> Listing photos are the biggest culprit. Use modern formats —
                WebP, AVIF — and lazy-load anything below the fold.
              </li>
              <li>
                <strong>Audit your third-party scripts.</strong> Every chat widget, every tracking pixel, every embedded
                video adds weight. Keep what earns its place. Cut the rest.
              </li>
              <li>
                <strong>Test on a real phone, on real 4G.</strong> Not your wifi. Not your desktop. The phone your
                vendor is actually holding.
              </li>
              <li>
                <strong>Watch for jank.</strong> Layout shifts, buttons that move as the page loads, animations that
                stutter — these feel cheap, and they cost you trust.
              </li>
            </ul>
            <p>
              <strong>Speed isn&apos;t a technical concern. It&apos;s a brand concern.</strong>
            </p>
          </article>

          {/* 05 */}
          <article className={styles.chapter} id="s5">
            <div className={styles['chapter-tag']}>
              <span className={styles.num}>05</span> Mobile <span className={styles.rule} />
            </div>
            <h2>Mobile first, always</h2>
            <div className={cx('figures', 'two')}>
              <div className={styles.figure}>
                <div className={styles['fig-num']}>70%+</div>
                <div className={styles['fig-cap']}>
                  of real estate website traffic comes from <strong>mobile</strong>
                </div>
              </div>
              <div className={styles.figure}>
                <div className={styles['fig-num']}>74%</div>
                <div className={styles['fig-cap']}>
                  of home buyers use <strong>mobile devices</strong> in their search
                </div>
              </div>
            </div>
            <p>
              That&apos;s not the future. That&apos;s now. And yet most agent sites are still designed desktop-first and
              squeezed onto a phone as an afterthought.
            </p>
            <p>
              Design for the phone first, then expand to the desktop — not the other way around. If your homepage looks
              great on a 27-inch monitor but the hero image crops to nothing on a phone, you&apos;ve optimised for the
              wrong visitor. A few things to watch for:
            </p>
            <ul className={styles.plain}>
              <li>
                <strong>Tap targets</strong> that are easy to hit without zooming. Buttons should be at least 44 pixels
                tall.
              </li>
              <li>
                <strong>Forms that work with thumbs,</strong> not styluses. Big fields, sensible keyboards — a number
                pad for phone numbers, an email keyboard for emails.
              </li>
              <li>
                <strong>Navigation that doesn&apos;t hide the important stuff</strong> behind a hamburger menu. The
                appraisal CTA should be visible without tapping anything.
              </li>
              <li>
                <strong>Listings that load progressively,</strong> not all at once. A vendor scrolling through twenty
                homes shouldn&apos;t wait for the whole page before they can start.
              </li>
            </ul>
            <p>
              <strong>The mobile experience is the real experience. Design it that way.</strong>
            </p>
          </article>

          {/* Site audit callout 2 */}
          <aside className={styles.audit}>
            <div className={styles['audit-av']}>
              <img src="/horace-ink.png" alt="Horace" width={60} height={60} />
            </div>
            <div className={styles['audit-body']}>
              <div className={styles['audit-eyebrow']}>Site audit</div>
              <p>
                How fast does your site really load on a phone, on real 4G?{' '}
                <span>Let me run the numbers and show you where you&apos;re bleeding visitors.</span>
              </p>
            </div>
            <a className={styles['audit-cta']} href={SITE_AUDIT_HREF}>
              Check your site {ARROW}
            </a>
          </aside>

          {/* 06 */}
          <article className={styles.chapter} id="s6">
            <div className={styles['chapter-tag']}>
              <span className={styles.num}>06</span> Conversion <span className={styles.rule} />
            </div>
            <h2>Convert with care, not pressure</h2>
            <p>
              Every site needs a primary conversion and a secondary conversion. For most agents, that&apos;s <em>request
              an appraisal</em> and <em>contact the agent</em>. Everything else is supporting cast.
            </p>
            <p>But here&apos;s where most sites get it wrong: they ask too much, too fast.</p>
            <div className={styles.figures}>
              <div className={styles.figure}>
                <div className={styles['fig-num']}>18.2%</div>
                <div className={styles['fig-cap']}>
                  conversion on a <strong>one-field</strong> form
                </div>
              </div>
              <div className={styles.figure}>
                <div className={styles['fig-num']}>11.5%</div>
                <div className={styles['fig-cap']}>
                  at <strong>three fields</strong> — and dropping with each one
                </div>
              </div>
              <div className={styles.figure}>
                <div className={styles['fig-num']}>9.9%</div>
                <div className={styles['fig-cap']}>
                  <strong>four fields</strong> falls below double digits
                </div>
              </div>
            </div>
            <p>
              Two fields still convert at 13.0%. Every field you add costs you. Most appraisal forms ask for ten. The
              trick is to match the ask to the trust. A first-time visitor shouldn&apos;t face the same questions as a
              repeat one. Build forms that start small and grow over time — what marketers call progressive profiling,
              but you can just call <em>not asking the same question twice.</em>
            </p>
            <ul className={styles.plain}>
              <li>
                <strong>Start with one field.</strong> Email. Or postcode. That&apos;s it. You can earn the rest.
              </li>
              <li>
                <strong>Match the ask to the moment.</strong> A &quot;request an appraisal&quot; form can ask more than a
                &quot;send me suburb updates&quot; form, because the intent is higher.
              </li>
              <li>
                <strong>Never ask for what you already know.</strong> If someone gave you their name last visit,
                don&apos;t ask again. It signals you&apos;re not paying attention.
              </li>
              <li>
                <strong>Register starts, not just submits.</strong> The vendor who begins a form and stops is often your
                warmest call. Something pulled them back. Make sure your site catches it.
              </li>
              <li>
                <strong>Make forms feel safe.</strong> A short note on how the data is handled goes further than
                you&apos;d think. Vendors are wary, and rightly so.
              </li>
              <li>
                <strong>Offer multiple ways in.</strong> A vendor who won&apos;t fill in a form might happily download a
                suburb report. Let them.
              </li>
            </ul>
            <p>
              <strong>
                The best conversion strategy isn&apos;t the one that captures the most data. It&apos;s the one that
                respects the visitor&apos;s pace.
              </strong>
            </p>
          </article>

          {/* 07 */}
          <article className={styles.chapter} id="s7">
            <div className={styles['chapter-tag']}>
              <span className={styles.num}>07</span> Discovery <span className={styles.rule} />
            </div>
            <h2>Build for discovery — search engines and AI</h2>
            <p>
              Your site doesn&apos;t just get found by Google anymore. It gets read by AI models that summarise the web,
              by voice assistants answering spoken questions, by search engines that increasingly favour structured,
              well-written content over keyword-stuffed pages. That changes how you write.
            </p>
            <ul className={styles.plain}>
              <li>
                <strong>Write like a person, not a robot.</strong> &quot;Homes for sale in [suburb]&quot; stuffed into
                every paragraph reads as desperate. A genuine suburb guide, written by someone who knows the place,
                reads as authoritative — and both Google and AI models reward it.
              </li>
              <li>
                <strong>Structure content with proper headings.</strong> H1 for the page title, H2 for sections, H3 for
                sub-points. This isn&apos;t decoration — it&apos;s how machines understand what your page is about.
              </li>
              <li>
                <strong>Add structured data.</strong> Schema markup for listings, agents and reviews helps your content
                show up as rich results — with prices, beds and ratings shown right on the results page.
              </li>
              <li>
                <strong>Answer real questions.</strong> &quot;What&apos;s the median price in [suburb]?&quot; &quot;How
                long do homes take to sell here?&quot; &quot;What&apos;s the school catchment?&quot; Answer these
                clearly and AI models will quote you. If you don&apos;t, they&apos;ll quote someone else.
              </li>
              <li>
                <strong>Publish consistently.</strong> A suburb report published every month beats one published once a
                year, by a long way. Freshness is a signal.
              </li>
            </ul>
            <p>
              <strong>
                The agents who win the next five years of organic discovery will be the ones who treat their site like a
                publication, not a pamphlet.
              </strong>
            </p>
          </article>

          {/* 08 */}
          <article className={styles.chapter} id="s8">
            <div className={styles['chapter-tag']}>
              <span className={styles.num}>08</span> Measurement <span className={styles.rule} />
            </div>
            <h2>Connect the right tools</h2>
            <p>A site you can&apos;t measure is a site you can&apos;t improve. The basics are non-negotiable:</p>
            <ul className={styles.plain}>
              <li>
                <strong>Google Analytics 4</strong> — to understand who&apos;s visiting and what they do.
              </li>
              <li>
                <strong>Google Search Console</strong> — to understand what people search for before they land.
              </li>
              <li>
                <strong>A web vitals monitor</strong> — to catch performance regressions before they cost you.
              </li>
              <li>
                <strong>A heatmap tool</strong> — Hotjar, Microsoft Clarity — to see where attention actually goes on
                the page.
              </li>
            </ul>
            <p>Two things to get right when you set them up:</p>
            <ul className={styles.plain}>
              <li>
                <strong>Track every page, not just the homepage.</strong> The sold results, the suburb reports, the
                individual listings, the appraisal path. Untracked pages are blind spots — and the blind spots are
                usually where the signal is.
              </li>
              <li>
                <strong>Make sure contact recognition works.</strong> A returning vendor should show up as <em>Sarah&apos;s
                back</em>, not <em>someone&apos;s back</em>. If your tools can&apos;t tell the difference, you&apos;re
                missing the most valuable signal there is.
              </li>
            </ul>
            <p>And then there&apos;s me.</p>
            <p>
              The tools above tell you <em>what</em> is happening on your site. I tell you <em>who</em> — and what to do
              about it. Which vendor is back for the third time this week. Which suburb is heating up. Which contact
              viewed your appraisal page and slipped away without a word. The intelligence sits as its own layer,
              separate from your CRM, so it travels with you wherever you go.
            </p>
          </article>

          <div className={styles.pullquote}>
            <div className={styles['pq-dot']} />
            <blockquote>The site that gets better is the site that gets watched.</blockquote>
          </div>

          {/* A short list to fix */}
          <article className={styles.chapter} id="s-fix">
            <div className={styles['chapter-tag']}>
              Start here <span className={styles.rule} />
            </div>
            <h2>A short list of things to fix this month</h2>
            <p>If this playbook has felt like a lot, start here.</p>
            <ol className={styles.fixlist}>
              <li>
                <span className={styles['fx-text']}>
                  <strong>Test your homepage load time on a phone, on 4G.</strong> If it&apos;s over three seconds, fix
                  that first.
                </span>
              </li>
              <li>
                <span className={styles['fx-text']}>
                  <strong>Cut your appraisal form to three fields or fewer.</strong> You can ask more later.
                </span>
              </li>
              <li>
                <span className={styles['fx-text']}>
                  <strong>Audit your suburb pages.</strong> If they read like a template, rewrite one this month.
                </span>
              </li>
              <li>
                <span className={styles['fx-text']}>
                  <strong>Check your mobile navigation.</strong> Make sure the most important CTA is visible without
                  tapping.
                </span>
              </li>
              <li>
                <span className={styles['fx-text']}>
                  <strong>Make sure every page is tracked, and contact recognition is on.</strong> No blind spots.
                </span>
              </li>
              <li>
                <span className={styles['fx-text']}>
                  <strong>Connect me.</strong> So the work your site is already doing actually reaches you.
                </span>
              </li>
            </ol>
            <p>
              <strong>Small moves. Compound returns.</strong>
            </p>
          </article>

          {/* Site audit callout 3 */}
          <aside className={styles.audit}>
            <div className={styles['audit-av']}>
              <img src="/horace-ink.png" alt="Horace" width={60} height={60} />
            </div>
            <div className={styles['audit-body']}>
              <div className={styles['audit-eyebrow']}>Site audit</div>
              <p>
                Not sure where your site stands against this list?{' '}
                <span>Run the audit — I&apos;ll score your site and hand you the shortlist, specific to you.</span>
              </p>
            </div>
            <a className={styles['audit-cta']} href={SITE_AUDIT_HREF}>
              Run the site audit {ARROW}
            </a>
          </aside>

          {/* One last thing */}
          <article className={styles.chapter} id="s-last">
            <div className={styles['chapter-tag']}>
              One last thing <span className={styles.rule} />
            </div>
            <h2>A great site is a habit, not a project</h2>
            <p>
              A great website isn&apos;t a one-time build. It&apos;s a habit. The agents whose sites quietly outperform
              are the ones who treat the site like a member of the team — reviewed, tuned, improved, every month.
            </p>
            <p>You don&apos;t need to do everything in this playbook at once. You just need to start.</p>
            <p>
              Build the site a vendor wants to move through, and you&apos;ve built the thing that tells you when
              they&apos;re ready.
            </p>
          </article>

          <div className={styles['divider-mark']}>
            <span />
            <span />
            <span />
          </div>
        </main>

        {/* Closing / CTA */}
        <section className={styles.closing} id="close">
          <div className={styles['closing-inner']}>
            <div className={styles['closing-char']}>
              <img src="/horace-charcoal.png" alt="Horace" width={84} height={84} />
            </div>
            <div className={styles.eyebrow}>Seize the moment</div>
            <p className={styles.lede}>
              Build the site a vendor wants to move through, and you&apos;ve built the thing that tells you when
              they&apos;re ready.
            </p>
            <p className={styles.sub}>
              Win more. Lose fewer. Be first. Start with the work that&apos;s already in front of you — and let me read
              it back to you the whole way down.
            </p>
            <p className={styles.sig}>
              I&apos;m here when you&apos;re ready.
              <br />— Horace
            </p>
            <div className={styles['cta-row']}>
              <a className={cx('cta', 'cta-primary')} href={SIGNUP_HREF} data-cta="signup">
                Start your free trial {ARROW}
              </a>
              <a
                className={cx('cta', 'cta-ghost')}
                href={WALKTHROUGH_HREF}
                data-cta="calcom"
                target="_blank"
                rel="noopener noreferrer"
              >
                Book a walk-through
              </a>
            </div>
            <p className={styles['closing-trial']}>
              14-day free trial · no card required · or book a 20-minute walk-through
            </p>
          </div>
        </section>
      </div>

      {/* Now-playing audio bar */}
      <div className={cx('player', playerVisible && 'show')}>
        <div className={styles['player-av']}>
          <img src="/horace-ink.png" alt="Horace" width={38} height={38} />
        </div>
        <div className={styles['player-info']}>
          <div className={styles.pt}>Listening to the playbook</div>
          <div className={styles.ps}>{playerStatus}</div>
          <div className={styles['player-prog']}>
            <i style={{ width: `${playerProg.toFixed(1)}%` }} />
          </div>
        </div>
        <div className={styles['player-ctrl']}>
          <button
            className={styles.pbtn}
            title="Back"
            onClick={() => speakFrom(Math.max(0, idxRef.current - 1))}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" stroke="none" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </button>
          <button className={cx('pbtn', 'main')} title={playing ? 'Pause' : 'Play'} onClick={togglePlay}>
            {playing ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none" />
                <rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
              </svg>
            )}
          </button>
          <button
            className={styles.pbtn}
            title="Skip"
            onClick={() => {
              if (idxRef.current < blocksRef.current.length - 1) speakFrom(idxRef.current + 1)
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>
          <button className={styles.pbtn} title="Stop" onClick={() => stopListen(false)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </div>
      </div>

      {/* Popover overlay */}
      <div className={cx('pop-overlay', popover && 'open')} onClick={() => setPopover(null)} />

      {/* QR popover */}
      <div className={cx('pop', popover === 'phone' && 'open')}>
        <button className={styles['pop-close']} onClick={() => setPopover(null)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <h3>Read it on your phone</h3>
        <p className={styles['pop-sub']}>
          Point your camera at the code — the playbook opens on your phone, so you can finish it later or on the train.
        </p>
        <div className={styles['qr-box']}>
          {qrSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrSrc} alt="QR code linking to this page" width={196} height={196} />
          ) : qrFallback ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--color-stone)', textAlign: 'center', padding: 24 }}>
              {qrFallback}
            </div>
          ) : null}
        </div>
        <p className={styles['qr-hint']}>Scan with your camera</p>
      </div>

      {/* Share popover */}
      <div className={cx('pop', popover === 'share' && 'open')}>
        <button className={styles['pop-close']} onClick={() => setPopover(null)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <h3>Pass it to a colleague</h3>
        <p className={styles['pop-sub']}>
          Know an agent whose website could be working harder? Send it their way.
        </p>
        <div className={styles['share-row']}>
          <button className={styles['share-act']} onClick={copyLink}>
            <span className={styles.ico}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </span>
            <span className={styles['sa-body']}>
              Copy link<small>{displayUrl}</small>
            </span>
          </button>
          <a className={styles['share-act']} href={emailHref} onClick={() => setTimeout(() => setPopover(null), 100)}>
            <span className={styles.ico}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <polyline points="2 6 12 13 22 6" />
              </svg>
            </span>
            <span className={styles['sa-body']}>
              Email it<small>Opens your mail with a note ready to go</small>
            </span>
          </a>
          {canNativeShare && (
            <button className={styles['share-act']} onClick={nativeShare}>
              <span className={styles.ico}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="18" cy="5" r="3" />
                  <circle cx="6" cy="12" r="3" />
                  <circle cx="18" cy="19" r="3" />
                  <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
                  <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
                </svg>
              </span>
              <span className={styles['sa-body']}>
                Share…<small>Messages, WhatsApp, wherever you like</small>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Toast */}
      <div className={cx('toast', toastVisible && 'show')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span>{toastMsg}</span>
      </div>

      {/* Resume banner */}
      <div className={cx('resume', resumeVisible && 'show')}>
        <span>Pick up where you left off?</span>
        <button className={styles['r-go']} onClick={resumeGo}>
          Resume reading
        </button>
        <button className={styles['r-x']} onClick={() => setResumeVisible(false)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
