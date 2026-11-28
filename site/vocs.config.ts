import { defineConfig } from 'vocs/config';

const repo = 'https://github.com/marcalexiei/parla';

export default defineConfig({
  title: 'Parla',
  logoUrl: '/logo.svg',
  iconUrl: '/icon.svg',
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
    { text: 'Core', link: '/core/namespaces', match: '/core' },
    { text: 'Formats', link: '/formats/icu', match: '/formats' },
    { text: 'Adapters', link: '/adapters/react', match: '/adapters' },
    { text: 'Tooling', link: '/tooling/x18n', match: '/tooling' },
    { text: 'Blog', link: '/blog/introducing-parla', match: '/blog' },
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
      text: 'Core',
      items: [
        { text: 'Namespaces', link: '/core/namespaces' },
        { text: 'Loading', link: '/core/loading' },
        { text: 'Switching locale', link: '/core/switching-locale' },
        { text: 'Plurals and selects', link: '/core/plurals-and-selects' },
        { text: 'Formatting', link: '/core/formatting' },
        { text: 'Rich text', link: '/core/rich-text' },
        { text: 'Fallbacks', link: '/core/fallbacks' },
        { text: 'Monorepos', link: '/core/monorepos' },
        { text: 'Runtimes and React Native', link: '/core/runtimes' },
        { text: 'Server', link: '/core/server' },
        {
          text: 'Reference',
          items: [
            { text: '@parlajs/core', link: '/core/api' },
            { text: 'CLI and Vite plugin', link: '/core/cli' },
            { text: 'parla.config.ts', link: '/core/config' },
          ],
        },
      ],
    },
    {
      text: 'Format adapters',
      items: [
        { text: 'ICU', link: '/formats/icu' },
        { text: 'MessageFormat 2', link: '/formats/mf2' },
        { text: 'Writing a format adapter', link: '/formats/writing-an-adapter' },
      ],
    },
    {
      text: 'Framework adapters',
      items: [
        { text: 'React', link: '/adapters/react' },
        { text: 'React: components and routes', link: '/adapters/react-components' },
        { text: 'Writing an adapter', link: '/adapters/writing-an-adapter' },
      ],
    },
    {
      text: 'Tooling',
      items: [
        { text: '@parlajs/x18n-plugin', link: '/tooling/x18n' },
        { text: 'knip', link: '/tooling/knip' },
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
