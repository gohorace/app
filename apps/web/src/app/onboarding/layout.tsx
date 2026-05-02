export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <p className="text-center font-bold text-xl tracking-tight mb-8">Horace</p>
        {children}
      </div>
    </div>
  )
}
