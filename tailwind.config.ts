import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        red: {
          assemblage: '#E30513',
          dark: '#B8040F',
          light: '#FFF0F0',
        },
      },
    },
  },
}

export default config
