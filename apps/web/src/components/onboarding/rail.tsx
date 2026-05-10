'use client'

import { Code2, Users, Bell, Sparkles, Check } from 'lucide-react'
import type { OnboardingStep } from '@/lib/onboarding/state'
import styles from './onboarding.module.css'

interface RailStep {
  id: Exclude<OnboardingStep, 'profile'>
  short: string
  title: string
}

const RAIL_STEPS: RailStep[] = [
  { id: 'script',   short: 'Tracking script', title: 'Install tracking' },
  { id: 'contacts', short: 'Your contacts',   title: 'Bring your people' },
  { id: 'notify',   short: 'Browser alerts',  title: 'Turn on alerts' },
  { id: 'done',     short: 'First signal',    title: 'See your dashboard' },
]

const ICONS: Record<RailStep['id'], React.ComponentType<{ className?: string }>> = {
  script:   Code2,
  contacts: Users,
  notify:   Bell,
  done:     Sparkles,
}

interface RailProps {
  current: RailStep['id']
  completed: Set<RailStep['id']>
  stage: { title: string; body: string }
}

export function Rail({ current, completed, stage }: RailProps) {
  const idx = RAIL_STEPS.findIndex((s) => s.id === current)

  return (
    <aside className={styles.rail}>
      <div className={styles.railBrand}>
        <span className={styles.railBrandDot} />
        <span className={styles.railBrandText}>Horace</span>
      </div>

      <div>
        <div className={styles.railStageLabel}>
          Step {idx + 1} of {RAIL_STEPS.length}
        </div>
        <div className={styles.railStageTitle}>{stage.title}</div>
        <div className={styles.railStageBody}>{stage.body}</div>
      </div>

      <ol className={styles.railMilestones}>
        {RAIL_STEPS.map((s, i) => {
          const isDone = completed.has(s.id)
          const isActive = s.id === current
          const Icon = ICONS[s.id]
          const cls = [
            styles.railMilestone,
            isActive ? styles.isActive : '',
            isDone ? styles.isDone : '',
          ].filter(Boolean).join(' ')
          return (
            <li key={s.id} className={cls}>
              <div className={styles.railMilestoneBullet}>
                <div className={styles.railMilestoneIcon}>
                  {isDone ? <Check /> : <Icon />}
                </div>
                {i < RAIL_STEPS.length - 1 && <div className={styles.railMilestoneLine} />}
              </div>
              <div className={styles.railMilestoneText}>
                <div className={styles.railMilestoneTitle}>{s.short}</div>
                <div className={styles.railMilestoneSub}>
                  {isDone ? 'Done' : isActive ? 'In progress' : ''}
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <div className={styles.railSig}>Seize the moment — Horace</div>
    </aside>
  )
}
