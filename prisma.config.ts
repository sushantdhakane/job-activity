import path from "path"
import { defineConfig } from "prisma/config"
import { PrismaNeon } from "@prisma/adapter-neon"

export default defineConfig({
  earlyAccess: true,
  schema: path.join("prisma", "schema.prisma"),
  migrate: {
    async adapter(env) {
      const { neon } = await import("@neondatabase/serverless")
      const sql = neon(env.DIRECT_URL)
      return new PrismaNeon({ connectionString: env.DIRECT_URL })
    },
  },
})