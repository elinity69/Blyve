/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    // HTML files
    './index.html',
    './public/**/*.html',
    
    // Root app directory (Expo Router)
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    
    // Main source directory - explicit paths for production build safety
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    
    // Explicit paths (redundant but ensures production build includes them)
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/lib/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/hooks/**/*.{js,ts,jsx,tsx,mdx}',
    
    // Additional paths that might exist (safe to include)
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/screens/**/*.{js,ts,jsx,tsx,mdx}',
    
    // Main entry points
    './src/main.tsx',
    './src/main.ts',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
