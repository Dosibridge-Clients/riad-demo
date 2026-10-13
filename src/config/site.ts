export const site = {
  name: 'Riad',
  title: 'Advanced .NET Core',
  tagline: 'Deep dives for engineers who ship',
  description:
    'Sixty in-depth articles on advanced .NET Core: ASP.NET Core internals, EF Core, async and concurrency, performance, security, messaging, testing and cloud deployment.',
  author: {
    name: 'Riad',
    role: '.NET Architect',
    initials: 'R',
  },
  nav: [
    { label: 'Home', to: '/' },
    { label: 'Articles', to: '/posts' },
    { label: 'About', to: '/about' },
  ],
  social: [
    { label: 'GitHub', href: 'https://github.com/Dosibridge-Clients' },
    { label: 'LinkedIn', href: 'https://www.linkedin.com' },
    { label: 'RSS', href: '/rss.xml' },
  ],
  postsPerPage: 9,
} as const

export type Site = typeof site
