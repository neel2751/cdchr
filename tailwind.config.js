/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}", // if you use app dir
    "./pages/**/*.{js,ts,jsx,tsx}", // if you use pages dir
    "./components/**/*.{js,ts,jsx,tsx}",
    "./lib/**/*.{js,ts,jsx,tsx}", // visa urgency colour classes live here
  ],
  darkMode: "class", // or 'media' based on your needs
  theme: {
    extend: {},
  },
  plugins: [],
};
