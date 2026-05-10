export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-parchment)] text-[var(--color-ink)]">
      <a href="#onboarding-main" className="skip-link">Skip to main content</a>
      {children}
    </div>
  )
}
