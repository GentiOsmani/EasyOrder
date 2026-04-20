/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/renderer/index.html',
    './src/renderer/src/**/*.{js,jsx,ts,tsx}'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '"Manrope"', '"Segoe UI"', 'sans-serif'],
        display: ['"Fraunces"', '"Times New Roman"', 'serif']
      },
      colors: {
        brand: { DEFAULT: '#B8834A', dark: '#9E7240', light: '#D4A76A' }
      }
    }
  },
  plugins: []
}
