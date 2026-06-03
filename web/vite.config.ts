import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Served same-origin by the v9 FastAPI service under /v9app.
// base MUST match the StaticFiles mount path or asset URLs 404.
export default defineConfig({
  base: "/v9app/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
})
