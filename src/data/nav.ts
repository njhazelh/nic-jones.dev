// The nav. Projects and Writing appear on their own once they hold a
// published entry (see src/lib/content.ts), so nothing leads to an empty page.
export const nav = [
  { href: '/projects/', label: 'Projects' },
  { href: '/writing/', label: 'Writing' },
  { href: '/resume/', label: 'Resume' },
  { href: '/about/', label: 'About' },
  { href: '/contact/', label: 'Contact' },
] as const;
