'use client'

import { RefObject, useEffect, useRef, useState } from 'react'

type Block = { el: HTMLElement; text: string }

const PREF = [/en-GB/i, /en-AU/i, /Daniel/i, /Arthur/i, /en-US/i, /English/i]

/**
 * Browser read-aloud over the article (Web Speech API), ported from the
 * prototype's `thesis.js`. Collects readable blocks tagged with `data-speak`
 * in document order, speaks them sequentially, highlights the current block
 * (by toggling `speakingClass` on its node) and auto-scrolls to keep it in
 * view. Drives the now-playing bar via the returned state.
 *
 * `containerRef` is the page root we query for `[data-speak]` nodes.
 */
export function useReadAloud(
  containerRef: RefObject<HTMLElement>,
  speakingClass: string,
  onToast: (msg: string) => void,
) {
  const [supported, setSupported] = useState(true)
  const [active, setActive] = useState(false) // player visible
  const [isPlaying, setIsPlaying] = useState(false)
  const [status, setStatus] = useState('Horace, reading aloud')
  const [progress, setProgress] = useState(0)

  const blocksRef = useRef<Block[]>([])
  const idxRef = useRef(0)
  const playingRef = useRef(false)
  const supportedRef = useRef(true)
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null)
  const onToastRef = useRef(onToast)
  onToastRef.current = onToast

  useEffect(() => {
    const ok =
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window
    supportedRef.current = ok
    setSupported(ok)
    if (!ok) return

    const synth = window.speechSynthesis
    const pick = (): SpeechSynthesisVoice | null => {
      const vs = synth.getVoices()
      if (!vs.length) return null
      for (const re of PREF) {
        const v = vs.find((x) => re.test(x.lang) || re.test(x.name))
        if (v) return v
      }
      return vs[0]
    }
    voiceRef.current = pick()
    const onVoices = () => {
      if (!voiceRef.current) voiceRef.current = pick()
    }
    synth.addEventListener('voiceschanged', onVoices)

    // Chrome cuts off long utterances; nudge the engine every 9s.
    const keepalive = window.setInterval(() => {
      if (playingRef.current && synth.speaking && !synth.paused) {
        synth.pause()
        synth.resume()
      }
    }, 9000)
    const onUnload = () => synth.cancel()
    window.addEventListener('beforeunload', onUnload)

    return () => {
      synth.removeEventListener('voiceschanged', onVoices)
      window.clearInterval(keepalive)
      window.removeEventListener('beforeunload', onUnload)
      synth.cancel()
    }
  }, [])

  // ── Inner helpers (read/write refs; recreated per render, which is fine
  // since they don't gate any effect). Function declarations are hoisted, so
  // mutual references resolve regardless of order. ──
  function collect(): Block[] {
    const root = containerRef.current
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>('[data-speak]'))
      .map((el) => {
        const kind = el.dataset.speak
        let text = ''
        if (kind === 'row') {
          const stage = el.querySelector('[data-stage]')?.textContent || ''
          const reads = el.querySelector('[data-reads]')?.textContent || ''
          text = stage + '. ' + reads
        } else if (kind === 'check') {
          const h = el.querySelector('h4')?.textContent || ''
          const p = el.querySelector('p')?.textContent || ''
          text = h + '. ' + p
        } else {
          text = el.textContent || ''
        }
        return { el, text: text.replace(/\s+/g, ' ').trim() }
      })
      .filter((b) => b.text.length > 1)
  }

  function ensureBlocks(): Block[] {
    if (!blocksRef.current.length) blocksRef.current = collect()
    return blocksRef.current
  }

  function setPlaying(v: boolean) {
    playingRef.current = v
    setIsPlaying(v)
  }

  function highlight(i: number) {
    const blocks = blocksRef.current
    blocks.forEach((b, j) => b.el.classList.toggle(speakingClass, j === i))
    const el = blocks[i]?.el
    if (el) {
      const r = el.getBoundingClientRect()
      const pad = 140
      if (r.top < pad || r.bottom > window.innerHeight - 120) {
        window.scrollTo({
          top: r.top + window.scrollY - window.innerHeight * 0.34,
          behavior: 'smooth',
        })
      }
    }
    setProgress(blocks.length > 1 ? (i / (blocks.length - 1)) * 100 : 0)
    setStatus('Horace · ' + (i + 1) + ' of ' + blocks.length)
  }

  function clearHighlight() {
    blocksRef.current.forEach((b) => b.el.classList.remove(speakingClass))
  }

  function speakCurrent() {
    const synth = window.speechSynthesis
    const blocks = blocksRef.current
    if (idxRef.current >= blocks.length) {
      stop(true)
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
      window.setTimeout(() => {
        if (playingRef.current) speakCurrent()
      }, 130)
    }
    u.onerror = () => {
      if (playingRef.current) {
        idxRef.current++
        window.setTimeout(speakCurrent, 80)
      }
    }
    synth.speak(u)
  }

  function speakFrom(i: number) {
    if (!supportedRef.current) return
    const synth = window.speechSynthesis
    synth.cancel()
    const blocks = ensureBlocks()
    idxRef.current = Math.max(0, Math.min(i, blocks.length - 1))
    setPlaying(true)
    setActive(true)
    speakCurrent()
  }

  function togglePlay() {
    if (!supportedRef.current) {
      onToastRef.current('Read-aloud isn’t supported in this browser')
      return
    }
    const synth = window.speechSynthesis
    if (!playingRef.current && !synth.speaking) {
      speakFrom(idxRef.current)
      return
    }
    if (synth.paused) {
      synth.resume()
      setPlaying(true)
    } else {
      synth.pause()
      setPlaying(false)
    }
  }

  function stop(finished = false) {
    setPlaying(false)
    window.speechSynthesis.cancel()
    setActive(false)
    clearHighlight()
    if (finished) {
      idxRef.current = 0
      onToastRef.current('That’s the handbook — seize the moment')
    }
  }

  function next() {
    const blocks = ensureBlocks()
    if (idxRef.current < blocks.length - 1) speakFrom(idxRef.current + 1)
  }

  function prev() {
    speakFrom(Math.max(0, idxRef.current - 1))
  }

  function startFromTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    speakFrom(0)
  }

  return {
    supported,
    active,
    isPlaying,
    status,
    progress,
    listenLabel: isPlaying ? 'Pause' : 'Listen',
    toggle: togglePlay,
    stop: () => stop(false),
    next,
    prev,
    startFromTop,
  }
}
