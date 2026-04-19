import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Steps Foundation brand palette (aligned with main website).
        // The `steps-blue-*` ramp is anchored on #1D49A7 (600) and #000E2F (900),
        // with #2C6FFF as the bright 500 accent. Bulk-swap of purple-*/indigo-*
        // → steps-blue-* relies on all shades existing here.
        steps: {
          blue: {
            50: '#eef3fd',
            100: '#dbe5fb',
            200: '#b6c7f6',
            300: '#8da6ee',
            400: '#5d7fdf',
            500: '#2C6FFF',
            600: '#1D49A7',
            700: '#173a85',
            800: '#10275a',
            900: '#000E2F',
            DEFAULT: '#1D49A7',
          },
          warm: '#2C6FFF',
          dark: '#000E2F',
          mist: '#B0BFE0',
          sunrise: '#DD873C',
          berry: '#DA2F76',
        },
      },
      fontFamily: {
        display: ['"League Spartan"', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        sans: ['"Helvetica Neue"', 'Helvetica', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        'press-blue': '0 4px 0 rgb(29,73,167)',
        'press-blue-hover': '0 6px 0 rgb(29,73,167)',
        'press-dark': '0 4px 0 rgb(0,14,47)',
        'press-dark-hover': '0 6px 0 rgb(0,14,47)',
        'press-white': '0 4px 0 rgb(203,213,225)',
        'press-white-hover': '0 6px 0 rgb(203,213,225)',
      },
    },
  },
  plugins: [],
}
export default config
