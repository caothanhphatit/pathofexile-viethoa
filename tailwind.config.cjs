module.exports = {
  darkMode: "class",
  content: [
    "./*.html",
    "./components/**/*.js"
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["system-ui", "-apple-system", "BlinkMacSystemFont", "\"Segoe UI\"", "sans-serif"],
        display: ["\"Segoe UI\"", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"]
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
