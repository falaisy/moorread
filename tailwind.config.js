/** @type {import('tailwindcss').Config} */
// 字体缩放隔离：html { font-size } 只做 DPI 自適應（不乘 scale），
// font-scale-ratio 只乘在 fontSize 和有單位的 lineHeight 上，
// spacing/gap/margin/min-h 等 layout rem 值保持穩定 → 滑桿拖動時版面不跳。
const SCALE = 'var(--font-scale-ratio, 1)'
const fs = rem => `calc(${rem} * ${SCALE})`
const pair = (remSize, remLineH) => [fs(remSize), { lineHeight: fs(remLineH) }]

module.exports = {
  mode: "jit",
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        brand: "hsl(var(--brand))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      spacing: {
        "sidebar": "14.5rem",
        "sidebar-lg": "18rem",
        "brand-h": "4.5rem",
        "card-grid-min-h": "4.75rem",
        "card-compact-min-h": "4.25rem",
      },
      height: {
        "brand-h": "4.5rem",
      },
      minHeight: {
        "brand-h": "4.5rem",
        "card-grid": "4.75rem",
        "card-compact": "4.25rem",
      },
      // 全部 text-* 乘 --font-scale-ratio；spacing 等 rem layout 保持不變
      fontSize: {
        // 默认 Tailwind fontSize（含 lineHeight object）
        xs: pair('0.75rem', '1rem'),
        sm: pair('0.875rem', '1.25rem'),
        base: pair('1rem', '1.5rem'),
        lg: pair('1.125rem', '1.75rem'),
        xl: pair('1.25rem', '1.75rem'),
        '2xl': pair('1.5rem', '2rem'),
        '3xl': pair('1.875rem', '2.25rem'),
        '4xl': pair('2.25rem', '2.5rem'),
        // 5xl+ lineHeight 用無單位 1，自動跟隨字體大小
        '5xl': [fs('3rem'), { lineHeight: '1' }],
        '6xl': [fs('3.75rem'), { lineHeight: '1' }],
        '7xl': [fs('4.5rem'), { lineHeight: '1' }],
        '8xl': [fs('6rem'), { lineHeight: '1' }],
        '9xl': [fs('8rem'), { lineHeight: '1' }],
        // 项目自定义（全部乘 scale）
        '3xs': pair('0.625rem', '0.75rem'),
        '2xs': pair('0.6875rem', '0.875rem'),
        'tiny-5': pair('0.65625rem', '0.875rem'),
        'brand': pair('0.9375rem', '1.375rem'),
        'card-title': pair('0.90625rem', '1.25rem'),
        'xs-md': pair('0.8125rem', '1.125rem'),
        // hero-clock 視口相關大字號，不乘 scale
        'hero-clock': ['clamp(3.5rem, 6.5vw, 4.75rem)', { lineHeight: '1' }],
      },
      // 有單位 rem 值的 leading-{N} 也乘 scale；無單位相對倍數（tight/snug/normal 等）自動跟 font-size
      lineHeight: {
        3: fs('.75rem'),
        4: fs('1rem'),
        5: fs('1.25rem'),
        6: fs('1.5rem'),
        7: fs('1.75rem'),
        8: fs('2rem'),
        9: fs('2.25rem'),
        10: fs('2.5rem'),
      },
      boxShadow: {
        // Tailwind v3 沒有 xs 層級（v4 才有），補回程式碼既有的 shadow-xs 最輕陰影。
        // 用中性黑而非 foreground Token，避免深色主題出現白色光暈。
        "xs": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        // Surface 层級遞增：card < panel < popover < modal
        "card-soft": "0 1px 2px hsl(var(--foreground) / 0.04)",
        "card-hover": "0 4px 12px -4px hsl(var(--foreground) / 0.10), 0 2px 3px hsl(var(--foreground) / 0.04)",
        "panel": "0 1px 3px hsl(var(--foreground) / 0.06), 0 8px 24px -10px hsl(var(--foreground) / 0.10)",
        "popover": "0 2px 4px hsl(var(--foreground) / 0.06), 0 10px 24px -8px hsl(var(--foreground) / 0.12)",
        "modal": "0 4px 8px hsl(var(--foreground) / 0.08), 0 16px 40px -8px hsl(var(--foreground) / 0.22)",
      },
      // 同上：v3 只有 drop-shadow-sm（較重），補回 xs 最輕投影
      dropShadow: {
        "xs": "0 1px 1px rgb(0 0 0 / 0.05)",
      },
      // v3 的 backdrop-blur-sm 才是 4px；補回 xs 這層
      backdropBlur: {
        "xs": "4px",
      },
      zIndex: {
        "sidebar": "20",
        "dropdown": "40",
        "popover": "45",
        "tooltip": "45",
        "dialog": "50",
        "toast": "55",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
