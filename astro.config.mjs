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
            { label: 'Introduction', slug: 'intro' },
            { label: 'Installation', slug: 'getting-started' },
            { label: 'Running Code', slug: 'running-code' },
            { label: 'First Program', slug: 'first-program' },
          ],
        },
        {
          label: 'Basics',
          items: [
            { label: 'Variables', slug: 'variables' },
            { label: 'Data Types', slug: 'data-types' },
            { label: 'Operators', slug: 'operators' },
            { label: 'Control Flow', slug: 'control-flow' },
            { label: 'Functions', slug: 'functions' },
            { label: 'Parameters', slug: 'parameters' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { label: 'Classes', slug: 'classes' },
            { label: 'Inheritance', slug: 'inheritance' },
            { label: 'Arrays', slug: 'arrays' },
            { label: 'Maps', slug: 'maps' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Standard Library', slug: 'stdlib' },
            { label: 'Language Reference', slug: 'language-reference' },
            { label: 'Examples', slug: 'examples' },
          ],
        },
        {
          label: 'Publishing',
          items: [
            { label: 'Webhooks', slug: 'webhooks' },
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
