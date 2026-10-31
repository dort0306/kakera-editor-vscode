import React from 'react';

/** Small inline icon set. Icons stay monochrome and inherit the button text color. */
export type IconName =
  | 'book' | 'film' | 'layout' | 'settings' | 'image' | 'play' | 'stop' | 'bug' | 'package'
  | 'refresh' | 'check' | 'plus' | 'copy' | 'trash' | 'flag' | 'search' | 'code' | 'save'
  | 'undo' | 'alert' | 'lock' | 'sparkles' | 'grid' | 'zoom-in' | 'zoom-out' | 'fit'
  | 'chevron' | 'chevron-left' | 'layers' | 'cloud' | 'wrench'
  | 'board' | 'route' | 'text' | 'type' | 'hash' | 'user' | 'globe' | 'bulb';

const paths: Record<IconName, React.ReactNode> = {
  book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8M8 11h6"/></>,
  film: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></>,
  layout: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/></>,
  settings: <><path d="M4 6h7M15 6h5M4 12h3M11 12h9M4 18h9M17 18h3"/><circle cx="13" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.7"/><path d="m4 17 5-5 4 4 2-2 5 5"/></>,
  play: <path d="M8 5.5v13l10-6.5z"/>,
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5"/>,
  bug: <><rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8V6a3 3 0 0 1 6 0v2M4 11h3M17 11h3M4 16h3M17 16h3M8 20l-2 2M16 20l2 2"/></>,
  package: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></>,
  check: <><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.6 2.6L16.5 9"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></>,
  trash: <><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5"/></>,
  flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></>,
  search: <><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></>,
  code: <path d="m9 7-5 5 5 5M15 7l5 5-5 5"/>,
  save: <><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>,
  undo: <><path d="M9 7 4 12l5 5"/><path d="M4 12h9a6 6 0 0 1 6 6v1"/></>,
  alert: <><path d="M12 3 2.8 19h18.4z"/><path d="M12 9v5"/><circle cx="12" cy="17" r=".8" fill="currentColor"/></>,
  lock: <><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  sparkles: <><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6z"/><path d="M19 15.5 20 18l2.5 1-2.5 1-1 2.5-1-2.5L15.5 19l2.5-1z"/></>,
  grid: <><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></>,
  'zoom-in': <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5M10.5 7.5v6M7.5 10.5h6"/></>,
  'zoom-out': <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5M7.5 10.5h6"/></>,
  fit: <><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/><path d="M8 8h8v8H8z"/></>,
  chevron: <path d="m9 6 6 6-6 6"/>,
  'chevron-left': <path d="m15 6-6 6 6 6"/>,
  layers: <><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/></>,
  cloud: <path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.3 4.4 4.4 0 0 0 7 18z"/>,
  wrench: <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2-2z"/>,
  board: <><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="6.5" y="8" width="5" height="4" rx="1"/><rect x="13.5" y="8" width="4" height="4" rx="1"/><path d="M6.5 15.5h11"/></>,
  route: <><circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="18" r="2.2"/><path d="M6 8.2v5a3 3 0 0 0 3 3h7"/></>,
  text: <><path d="M4 6h16M12 6v13"/><path d="M8.5 19h7"/><path d="M4 15h6"/></>,
  type: <><path d="M5 6V4h14v2M12 4v16"/><path d="M9 20h6"/></>,
  hash: <path d="M9 4 7 20M17 4l-2 16M4.5 9.5h15M3.5 15h15"/>,
  user: <><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.4 2.4 3.6 5.4 3.6 9s-1.2 6.6-3.6 9c-2.4-2.4-3.6-5.4-3.6-9S9.6 5.4 12 3z"/></>,
  bulb: <><path d="M9.5 17h5M10 20h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4.9 1 .9 1.7V17h5.2v-1.4c0-.7.3-1.3.9-1.7A6 6 0 0 0 12 3z"/></>,
};

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

/**
 * Project mark, taken from the repository artwork `kakera.svg` (four shards inside a rounded
 * square, separated by the white "K" cracks). Rendered inline so it stays crisp at every size
 * and needs no extra webview request. Brand colors are fixed: they identify the project in both
 * light and dark themes. The white base keeps the crack shape of the artwork instead of letting
 * the surrounding surface show through, so the mark matches `resources/kakera.png`.
 */
export function KakeraMark({ size = 30, className = '', label = 'Kakera' }: { size?: number; className?: string; label?: string }) {
  const clip = `kakera-mark-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return <svg className={`kakera-mark ${className}`} width={size} height={size} viewBox="0 0 135.46664 135.46664" role="img" aria-label={label} focusable="false">
    <defs><clipPath id={clip}><rect width="135.46664" height="135.46664" rx="16.933331" ry="16.933331" /></clipPath></defs>
    <g clipPath={`url(#${clip})`}>
      <rect width="135.46664" height="135.46664" fill="#ffffff" />
      <path fill="var(--k-mark-deep, #0058e0)" d="M -9.2676502,-6.6729769 L -10.565245,143.46719 L 56.729347,144.25113 L 10.816909,-6.3034904 Z" />
      <path fill="var(--k-mark-azure, #008aff)" d="M 95.444292,-10.083104 L 30.577975,-7.1788891 L 48.613564,51.962713 Z" />
      <path fill="var(--k-mark-pink, #ff6fe3)" d="M 121.46957,-12.764077 L 72.49014,52.127561 L 152.1664,102.04699 L 142.72564,-10.194725 Z" />
      <path fill="var(--k-mark-steel, #0060a8)" d="M 60.905319,67.476493 L 55.520118,74.610941 L 77.572516,146.92331 L 70.800321,148.99657 L 74.884826,162.00301 L 147.9155,154.21796 L 148.7723,122.52739 Z" />
    </g>
  </svg>;
}
