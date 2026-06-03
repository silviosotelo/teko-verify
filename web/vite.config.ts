import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// La SPA de captura se sirve como HTML en GET /verify/:token, pero los assets
// del build (JS/CSS) se sirven estáticamente desde el backend en /app
// (express.static(WEB_DIST) montado en "/app" en src/server.ts).
//
// Por eso base = "/app/": las URLs de los assets quedan ABSOLUTAS (/app/assets/…)
// y resuelven igual aunque el index.html se sirva en /verify/<token>.
// Una base relativa ("./") fallaría: resolvería a /verify/assets/… (404).
export default defineConfig({
  base: "/app/",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
