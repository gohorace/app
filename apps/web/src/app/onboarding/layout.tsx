export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-parchment)] text-[var(--color-ink)]">
      {children}
    </div>
  )
}
