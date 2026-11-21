// The five nav items from the spec. Work, Positions and Writing appear on
// their own once they hold a published entry (see src/lib/content.ts), so
// nothing in the nav leads to an empty page.
export const nav = [
  { href: '/work/', label: 'Work' },
  { href: '/positions/', label: 'Positions' },
  { href: '/writing/', label: 'Writing' },
  { href: '/about/', label: 'About' },
  { href: '/contact/', label: 'Contact' },
] as const;
