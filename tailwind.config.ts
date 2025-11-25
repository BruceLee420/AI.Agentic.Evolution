import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        gold: '#d4af37',
        teal: '#1DE9B6',
      },
    },
  },
  plugins: [],
} satisfies Config;
