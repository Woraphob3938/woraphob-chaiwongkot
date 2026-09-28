/**
 * FitConnect mark: two interlocked rings, member and trainer joined.
 *
 * Each ring leaves a gap where the other passes over it: the left ring runs
 * over the right at the top crossing and under it at the bottom, so the pair
 * reads as linked rather than stacked. The gaps are real breaks in the stroke,
 * so the mark works on any background in `currentColor`.
 *
 * Geometry: rings of radius 7 centred at (11,16) and (21,16) cross at
 * (16, 11.1) and (16, 20.9); each gap spans ±22° around its crossing.
 */
export function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.4"
      aria-hidden="true"
      focusable="false"
    >
      {/* Left ring, broken at the bottom crossing where the right ring passes over. */}
      <path d="M13.8 22.415A7 7 0 1 1 17.472 18.668" />
      {/* Right ring, broken at the top crossing where the left ring passes over. */}
      <path d="M18.153 9.605A7 7 0 1 1 14.51 13.378" />
    </svg>
  );
}
