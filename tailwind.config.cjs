module.exports = {
  darkMode: "class",
  content: [
    // Only the guide articles in public/content still use Tailwind classes; the
    // React app has its own stylesheet.
    "./public/content/**/*.html"
  ],
  theme: {
    extend: {
      // The articles were written with Tailwind's blue-grey "slate"; remap it to the
      // neutral graphite scale of the site theme (950 = --bg, 900 = --surface in dark).
      colors: {
        slate: {
          50: "#fafaf8",
          100: "#f3f2ef",
          200: "#e5e3de",
          300: "#d0cec8",
          400: "#a5a39d",
          500: "#84827c",
          600: "#63605a",
          700: "#45433f",
          800: "#2b2b29",
          900: "#1a1a19",
          950: "#121211"
        }
      },
      fontFamily: {
        sans: ["\"Be Vietnam Pro\"", "system-ui", "-apple-system", "BlinkMacSystemFont", "\"Segoe UI\"", "sans-serif"],
        display: ["\"Be Vietnam Pro\"", "system-ui", "-apple-system", "BlinkMacSystemFont", "\"Segoe UI\"", "sans-serif"]
      },
      boxShadow: {
        md1: "0 1px 2px rgba(60,64,67,.24), 0 1px 3px rgba(60,64,67,.12)",
        md2: "0 4px 12px rgba(60,64,67,.16), 0 1px 4px rgba(60,64,67,.12)",
        glow: "0 0 20px rgba(245, 158, 11, 0.15)",
        gold: "0 0 15px rgba(217, 119, 6, 0.2)"
      }
    }
  }
};
