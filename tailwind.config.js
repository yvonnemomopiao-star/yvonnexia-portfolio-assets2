// Tailwind 配置：从 index.html 里原来的内联 tailwind.config 搬过来的。
// 改了 index.html 里的 class 之后，要重新生成 tailwind.css，见 scripts/build-css.sh。
module.exports = {
  content: ['./index.html', './*.js'],
  theme: {
    extend: {
      fontFamily: {
        inter: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Microsoft YaHei', 'sans-serif'],
      },
      colors: {
        purple: {
          50: '#f0f0fd', 100: '#e4e2fb', 200: '#cfc9f7', 300: '#b1a4f1',
          400: '#8f77e9', 500: '#724ee0', 600: '#6733ea', 700: '#5824cd',
          800: '#481fa7', 900: '#3d1a88', 950: '#250e5e',
        },
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-15px)' },
        },
      },
    },
  },
};
