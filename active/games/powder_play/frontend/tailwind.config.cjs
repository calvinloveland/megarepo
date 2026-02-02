module.exports = {
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx,html}'
  ],
  theme: {
    extend: {
      colors: {
        obsidian: '#0b0b12',
        midnight: '#12121a',
        ember: '#d9a441'
      },
      fontFamily: {
        serif: ['Cinzel', 'ui-serif', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        ember: '0 0 16px rgba(217, 164, 65, 0.25)'
      }
    }
  },
  plugins: []
};