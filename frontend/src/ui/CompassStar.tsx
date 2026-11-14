// The team mark: the four-point compass star of the Red Compass logo, in a navy badge with
// a white ring. Drawn as SVG so it stays sharp at any size.
// Colours come from the logo: navy #0c1a3d, red #e8231f, white.

export const LOGO_NAVY = '#0c1a3d'
export const LOGO_RED = '#e8231f'

export function CompassStar({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Red Compass">
      <circle cx="24" cy="24" r="22.5" fill={LOGO_NAVY} stroke="#fff" strokeWidth="2" />
      {/* Compass dial: a thin red arc with ticks, like the logo. */}
      <circle cx="24" cy="24" r="13" fill="none" stroke={LOGO_RED} strokeWidth="1.2" strokeDasharray="1.2 3.9" opacity="0.9" />
      {/* Four-point star. Each point has a light and a dark half, which gives it depth. */}
      <path d="M24 5 L27.2 20.8 L24 24 Z" fill={LOGO_RED} />
      <path d="M24 5 L20.8 20.8 L24 24 Z" fill="#b5150f" />
      <path d="M43 24 L27.2 27.2 L24 24 Z" fill="#b5150f" />
      <path d="M43 24 L27.2 20.8 L24 24 Z" fill="#fff" />
      <path d="M24 43 L20.8 27.2 L24 24 Z" fill={LOGO_RED} />
      <path d="M24 43 L27.2 27.2 L24 24 Z" fill="#b5150f" />
      <path d="M5 24 L20.8 20.8 L24 24 Z" fill="#b5150f" />
      <path d="M5 24 L20.8 27.2 L24 24 Z" fill={LOGO_RED} />
    </svg>
  )
}
