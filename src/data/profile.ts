// Every time-sensitive fact on the site lives here. A job change edits this
// file and nothing else. Values marked "TODO" are unconfirmed; the check
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
  /** The number, shown large. null until a publishable number is confirmed. */
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
      figure: '½',
      detail:
        'Led the Instagram-wide crash workstream that halved the crash rate; null-pointer exceptions fell about 3×.',
    },
    {
      claim: 'Operable',
      figure: '12',
      detail:
        'Founded the Reliability Captain programme and trained 12 engineers to run incidents. It still runs.',
    },
    {
      claim: 'Automated',
      figure: null, // TODO: a publishable number for the agent work
      detail:
        'Built AI agents that investigate and resolve regressions at scale, cutting the supervision load on my team.',
    },
  ] satisfies ProofPoint[],

  roles: [
    {
      org: 'Meta',
      title: 'Staff Software Engineer, Instagram',
      start: '2018-01', // TODO: confirm start month
      end: '2026-11', // TODO: confirm end month, or null if current
      summary: 'Owned Instagram Android performance and reliability for seven years.',
      highlights: [
        'Led the Instagram-wide crash workstream: crash rate halved, null-pointer exceptions down about 3×.',
        'Founded the Reliability Captain programme; trained 12 engineers in incident response.',
        'Built performance logging and fixed UI freezes and judder across the app.',
        'Built AI agents that debug and resolve bugs at scale.',
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
