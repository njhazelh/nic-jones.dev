// Every time-sensitive fact on the site lives here. A job change edits this
// file and nothing else.
//
// Meta work is described at resume level only: role, scope and the kind of
// work. No internal metrics, tool or programme names, incidents or people.
// `npm run check` fails on a percentage, multiplier or "halved" next to
// Meta, Instagram or Facebook unless the line links a public source. Values marked "TODO" are unconfirmed; the check
// script lists them as warnings until they are replaced.

export interface Role {
  org: string;
  title: string;
  /** YYYY-MM */
  start: string;
  /** YYYY-MM, or null if current */
  end: string | null;
  summary: string;
  highlights: string[];
}

export interface ProofPoint {
  /** One word from the positioning table: Fast, Stable, Operable, Automated */
  claim: string;
  /**
   * The number, shown large, or null. Meta work stays at resume level: no
   * internal metrics, programme names or headcounts. Use a number only if it
   * is yours to publish or Meta has already published it.
   */
  figure: string | null;
  /** One sentence of context */
  detail: string;
}

export const profile = {
  name: 'Nic Jones',
  /** Used for <title>, JSON-LD and the resume heading */
  fullName: 'Nicholas Jones', // TODO: confirm professional name (open question in spec)
  role: 'Staff Software Engineer',
  site: 'https://nick-jones.me',

  /**
   * The pitch. `{meta}` is replaced at build time with the computed length of
   * the Meta role, so the sentence never goes stale.
   */
  pitch:
    'I find what is slow or broken in large production systems, fix it, and build the processes that keep it fixed.',
  pitchDetail:
    'For seven of my {meta} at Meta, I owned Instagram Android performance and reliability: incident response, crash and memory work, and agents that debug regressions.',

  proofPoints: [
    {
      claim: 'Stable',
      figure: null,
      detail: 'Led crash and memory reliability work across the Instagram Android app.',
    },
    {
      claim: 'Operable',
      figure: null,
      detail: 'Founded an incident-response programme and trained engineers across teams to lead incidents.',
    },
    {
      claim: 'Automated',
      figure: null,
      detail: 'Built AI agents that investigate regressions and help engineers fix them.',
    },
  ] satisfies ProofPoint[],

  roles: [
    {
      org: 'Meta',
      title: 'Staff Software Engineer, Instagram',
      start: '2017-08',
      end: '2026-07',
      summary: 'Owned Instagram Android performance and reliability for seven years.',
      highlights: [
        'Led crash and memory reliability work across the Android app.',
        'Founded an incident-response programme and trained engineers across teams to lead incidents.',
        'Built performance logging and fixed UI freezes and judder across the app.',
        'Built AI agents that investigate regressions and help engineers fix them.',
      ],
    },
  ] satisfies Role[],

  links: {
    /** Forwarding address on the site's own domain. null hides it. */
    email: null as string | null, // TODO: set up forwarding, e.g. hello@<domain>
    github: 'https://github.com/njhazelh',
    linkedin: null as string | null, // TODO: LinkedIn URL
  },

  /** The build warns once any of these dates has passed. */
  reviewBy: {
    home: '2027-02-19',
    about: '2027-02-19',
    resume: '2027-02-19',
  },
};

export type Profile = typeof profile;
