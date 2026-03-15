import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        cream: "#FDF8F0",
        blush: "#E8A0A0",
        gold: "#C9963A",
        charcoal: "#2C2C2C"
      },
      boxShadow: {
        romantic: "0 20px 45px rgba(44,44,44,0.14)"
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        pulseSoft: {
          "0%,100%": { opacity: "0.85" },
          "50%": { opacity: "0.45" }
        }
      },
      animation: {
        "fade-up": "fadeUp 650ms ease-out forwards",
        "pulse-soft": "pulseSoft 1500ms ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
