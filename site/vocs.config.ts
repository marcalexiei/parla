import { defineConfig } from 'vocs/config';

const repo = 'https://github.com/marcalexiei/parla';

export default defineConfig({
  title: 'Parla',
  description: 'Type-safe i18n: one API, per-locale lazy loading, ICU and MessageFormat 2.',
  basePath: '/parla',
  baseUrl: 'https://marcalexiei.github.io',
  // `<base>` would send every chunk import to Pages, breaking previews and local builds
  head: { base: false },
  // Vocs leaves `basePath` out of the sitemap's URLs
  sitemap: false,
  // GitHub Pages serves files: every page is prerendered.
  renderStrategy: 'full-static',
  editLink: { link: `${repo}/edit/main/site/src/pages/:path`, text: 'Edit on GitHub' },
  socials: [{ icon: 'github', link: repo }],
  topNav: [
    { text: 'Guides', link: '/guides/namespaces', match: '/guides' },
    { text: 'Reference', link: '/reference/cli', match: '/reference' },
    { text: 'Playground', link: 'https://github.com/marcalexiei/parla-playground' },
  ],
  sidebar: [
    {
      text: 'Introduction',
      items: [
        { text: 'Overview', link: '/' },
        { text: 'Why Parla', link: '/why' },
        { text: 'Getting started', link: '/getting-started' },
        { text: 'Benchmarks', link: '/benchmarks' },
      ],
    },
    {
      text: 'Guides',
      items: [
        { text: 'Namespaces', link: '/guides/namespaces' },
        { text: 'Loading', link: '/guides/loading' },
        { text: 'Components and routes', link: '/guides/components' },
        { text: 'Switching locale', link: '/guides/switching-locale' },
        { text: 'Rich text', link: '/guides/rich-text' },
        { text: 'Plurals and selects', link: '/guides/plurals-and-selects' },
        { text: 'Formatting', link: '/guides/formatting' },
        { text: 'Fallbacks', link: '/guides/fallbacks' },
        { text: 'Monorepos', link: '/guides/monorepos' },
        { text: 'Runtimes and React Native', link: '/guides/runtimes' },
      ],
    },
    {
      text: 'Reference',
      items: [
        { text: 'CLI and Vite plugin', link: '/reference/cli' },
        { text: 'parla.config.ts', link: '/reference/config' },
        { text: '@parlajs/core', link: '/reference/core' },
        { text: '@parlajs/react', link: '/reference/react' },
      ],
    },
    {
      text: 'Links',
      items: [
        { text: 'GitHub', link: repo },
        { text: 'Playground', link: 'https://github.com/marcalexiei/parla-playground' },
        { text: 'Benchmarks', link: 'https://github.com/marcalexiei/parla-benchmark' },
      ],
    },
  ],
});
