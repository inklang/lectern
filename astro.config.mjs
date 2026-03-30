// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'url';
import path from 'path';
import vercel from '@astrojs/vercel';
import starlight from '@astrojs/starlight';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  output: 'server',
  site: 'https://lectern.inklang.org',
  adapter: vercel({
    webAnalytics: { enabled: true }
  }),
  integrations: [
    starlight({
      title: 'Ink',
      logo: {
        src: './src/assets/logo.svg',
        replacesPageTitle: false,
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/inklang/ink' },
      ],
      expressiveCode: {
        themes: ['github-dark-default', 'github-light-default'],
      },
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
      },
      customCss: ['./src/styles/starlight.css'],
      editLink: {
        baseUrl: 'https://github.com/inklang/lectern/edit/master/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'docs/intro' },
            { label: 'Installation', slug: 'docs/getting-started' },
            { label: 'Running Code', slug: 'docs/running-code' },
            { label: 'First Program', slug: 'docs/first-program' },
          ],
        },
        {
          label: 'Basics',
          items: [
            { label: 'Variables', slug: 'docs/variables' },
            { label: 'Data Types', slug: 'docs/data-types' },
            { label: 'Operators', slug: 'docs/operators' },
            { label: 'Control Flow', slug: 'docs/control-flow' },
            { label: 'Functions', slug: 'docs/functions' },
            { label: 'Parameters', slug: 'docs/parameters' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { label: 'Classes', slug: 'docs/classes' },
            { label: 'Inheritance', slug: 'docs/inheritance' },
            { label: 'Arrays', slug: 'docs/arrays' },
            { label: 'Maps', slug: 'docs/maps' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Standard Library', slug: 'docs/stdlib' },
            { label: 'Language Reference', slug: 'docs/language-reference' },
            { label: 'Examples', slug: 'docs/examples' },
          ],
        },
        {
          label: 'Publishing',
          items: [
            { label: 'Webhooks', slug: 'docs/webhooks' },
          ],
        },
      ],
    }),
  ],
  vite: {
    resolve: {
      alias: {
        '~': path.resolve(__dirname, 'src'),
      },
    },
  },
});
