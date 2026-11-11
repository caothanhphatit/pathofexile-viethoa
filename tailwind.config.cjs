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
      // warm charcoal scale of the site theme (950 = --bg, 900 = --surface in dark).
      colors: {
        slate: {
          50: "#faf7f1",
          100: "#f3ede2",
          200: "#e6dcc9",
          300: "#d3c6af",
          400: "#a99f8f",
          500: "#857b6c",
          600: "#655c50",
          700: "#4a4237",
          800: "#2c261d",
          900: "#18150f",
          950: "#0f0d0b"
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
