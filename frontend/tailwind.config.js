/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'var(--text-primary)',
        primary: 'var(--primary)',
        violet: 'var(--accent)',
      },
      boxShadow: {
        panel: '0 18px 50px rgba(39, 88, 201, 0.10)',
        soft: '0 10px 30px rgba(28, 63, 130, 0.08)',
      },
    },
  },
  plugins: [],
};
