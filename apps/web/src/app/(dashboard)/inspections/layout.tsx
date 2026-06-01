/**
 * Scroll frame for every /inspections route (index, /new, /[id]).
 *
 * The dashboard shell's <main> is `overflow-hidden`, and each inspections
 * page renders a plain content div with no height/scroll of its own — so
 * without this wrapper their content is clipped (and unscrollable) once it
 * exceeds the viewport, and the last rows hide behind the fixed mobile tab
 * bar. This bounds the height and owns the scroll: `pb-20` clears the bottom
 * nav on mobile, reset on md+ where the nav is hidden.
 */
export default function InspectionsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className="h-full overflow-y-auto pb-20 md:pb-0">{children}</div>
}
