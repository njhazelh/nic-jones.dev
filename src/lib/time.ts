import { profile, type Role } from '../data/profile';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n: number) => WORDS[n] ?? String(n);

function months(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function nowMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "nearly nine years", "six years", "over four years". Computed at build. */
export function roleLength(role: Role): string {
  const m = months(role.start, role.end ?? nowMonth());
  const years = Math.floor(m / 12);
  const rem = m % 12;
  if (rem >= 9) return `nearly ${word(years + 1)} years`;
  if (rem >= 3) return `over ${word(years)} year${years === 1 ? '' : 's'}`;
  return `${word(years)} year${years === 1 ? '' : 's'}`;
}

/** Replace `{org}` tokens (lower-cased org name) with that role's length. */
export function fillDurations(text: string): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const role = profile.roles.find((r) => r.org.toLowerCase() === key);
    if (!role) throw new Error(`Unknown duration token ${match} in profile copy`);
    return roleLength(role);
  });
}

/** "Jan 2018" */
export function monthLabel(ym: string | null): string {
  if (!ym) return 'present';
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
