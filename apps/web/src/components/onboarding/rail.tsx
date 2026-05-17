'use client'

import { User, Code2, MapPin, Users, Bell, Smartphone, Check } from 'lucide-react'
import styles from './onboarding.module.css'

// 'core_markets' added in HOR-194 between 'script' and 'contacts'.
export type RailStepId = 'profile' | 'script' | 'core_markets' | 'contacts' | 'notify' | 'pair'

interface RailStep {
  id: RailStepId
  short: string
}

const RAIL_STEPS: RailStep[] = [
  { id: 'profile',      short: 'Your details' },
  { id: 'script',       short: 'Tracking script' },
  { id: 'core_markets', short: 'Your patch' },
  { id: 'contacts',     short: 'Your contacts' },
  { id: 'notify',       short: 'Browser alerts' },
  { id: 'pair',         short: 'Mobile push' },
]

const ICONS: Record<RailStepId, React.ComponentType<{ className?: string }>> = {
  profile:      User,
  script:       Code2,
  core_markets: MapPin,
  contacts:     Users,
  notify:       Bell,
  pair:         Smartphone,
}

interface RailProps {
  current: RailStepId
  completed: Set<RailStepId>
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
