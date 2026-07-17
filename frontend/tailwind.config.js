/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        aqua: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          500: "#0ea5e9",
          600: "#0369a1",
          700: "#075985",
          800: "#0c4a6e",
        },
        navy: {
          600: "#1e3d6b",
          700: "#162844",
          800: "#0f2038",
          900: "#0D1F3C",
        },
      },
    },
  },
  plugins: [],
};
