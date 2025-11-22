module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 主题色 - 翡翠绿（现代明亮）
        primary: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
        },
        // 次要主题色 - 珊瑚橙
        accent: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12',
        },
        // 浅色模式背景
        light: {
          bg: '#fafbfc',
          'bg-secondary': '#f8fafc',
          card: '#ffffff',
          border: '#e2e8f0',
          text: '#1e293b',
          'text-secondary': '#64748b',
        },
        // 深色模式背景
        dark: {
          bg: '#0f172a',
          'bg-secondary': '#1e293b',
          card: '#1e293b',
          border: '#334155',
          text: '#f1f5f9',
          'text-secondary': '#94a3b8',
        },
      },
      backgroundImage: {
        'gradient-light': 'linear-gradient(135deg, #fafbfc 0%, #f8fafc 100%)',
        'gradient-dark': 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
