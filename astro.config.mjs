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
  adapter: vercel(),
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
      editLink: {
        baseUrl: 'https://github.com/inklang/lectern/edit/master/',
      },
      sidebar: [
        {
          label: 'Start',
          link: '/docs/start',
        },
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'guides/overview' },
            { label: 'Installation', slug: 'guides/installation' },
            { label: 'Quick Start', slug: 'guides/quickstart' },
          ],
        },
        {
          label: 'Core Concepts',
          items: [
            { label: 'Project Structure', slug: 'guides/project-structure' },
            { label: 'Configuration', slug: 'guides/configuration' },
            { label: 'Routing', slug: 'guides/routing' },
            { label: 'Components', slug: 'guides/components' },
          ],
        },
        {
          label: 'Features',
          items: [
            { label: 'Content Management', slug: 'guides/content' },
            { label: 'Styling', slug: 'guides/styling' },
            { label: 'API Integration', slug: 'guides/api' },
            { label: 'Deployment', slug: 'guides/deployment' },
          ],
        },
        {
          label: 'Reference',
          link: '/docs/reference',
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
