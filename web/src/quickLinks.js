// Personal profile/portfolio links shown on the public page's Quick Links
// section. Plain config, not user-generated content — edit directly.
//
// Icons are Builder Center's own asset SVGs (mirrored into public/icons/ and
// public/favicon.svg — see docs/PRD.md for provenance). The favicon has its
// own baked-in background and an internal prefers-color-scheme switch, so one
// file covers both themes; github/linkedin ship as separate light/dark SVGs,
// so those use `iconLight`/`iconDark` and PublicPage swaps between them with
// a prefers-color-scheme media query.
export const QUICK_LINKS = [
  { label: 'AWS Builder Center Profile', href: 'https://builder.aws.com/community/@minkim26?tab=badges', icon: '/favicon.svg' },
  { label: 'GitHub', href: 'https://github.com/minkim26', iconLight: '/icons/github-light.svg', iconDark: '/icons/github-dark.svg' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/minkim26/', iconLight: '/icons/linkedin-light.svg', iconDark: '/icons/linkedin-dark.svg' },
];
