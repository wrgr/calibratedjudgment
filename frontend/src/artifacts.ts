export interface Artifact {
  href: string;
  label: string;
  primary?: boolean;
  external?: boolean;
}

export const REPO_URL = 'https://github.com/wrgr/calibratedjudgment';

// Static-file links served from the site root alongside index.html.
// Shared by the login hero and the site-wide footer so they never drift.
export const ARTIFACTS: Artifact[] = [
  { href: 'paper.html', label: 'Read the paper', primary: true },
  { href: 'paper.pdf', label: 'Paper (PDF)' },
  { href: 'poster.pdf', label: 'Poster (PDF)' },
  { href: REPO_URL, label: 'GitHub', external: true },
];
