/** Scrimshaw mark: an etched whale tooth on the kit's logo tile. Flat vector, one style with the suite. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span className="logo" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.72} height={size * 0.72} viewBox="0 0 32 32" fill="none">
        <path d="M9 4c6 1 13 6 15 14 1.4 5.5-1 9.6-5 10-3.7.4-6-2.6-6.6-6.8C11.6 15.7 10.6 9.6 9 4Z" fill="currentColor" />
        <path d="M14.6 13.5c2.2 1.6 3.9 4 4.6 7M13.2 18.6c1.6.9 2.9 2.4 3.5 4.3" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M21.5 9.5 25 6" stroke="var(--brand)" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}
