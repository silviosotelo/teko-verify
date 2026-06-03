/* eslint-disable no-undef */
/** @type {import('tailwindcss').Config} */
// Tema Teko: verde (#16a34a / #22c55e) en modo claro. Sin indirección de CSS-vars:
// se usa la paleta nativa de Tailwind (emerald/green) directamente.
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class', // se mantiene pero nunca se aplica la clase `dark` → light por defecto.
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        // Verde Teko como primary.
        primary: {
          DEFAULT: '#16a34a', // green-600
          deep: '#15803d', // green-700
          mild: '#22c55e', // green-500
          subtle: '#dcfce7', // green-100
          50: '#f0fdf4',
          100: '#dcfce7',
          200: '#bbf7d0',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgba(16,24,40,0.04), 0 1px 3px 0 rgba(16,24,40,0.06)',
        soft: '0 4px 16px -4px rgba(16,24,40,0.08)',
      },
    },
  },
  plugins: [],
}
