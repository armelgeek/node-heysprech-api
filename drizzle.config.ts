import { defineConfig } from 'drizzle-kit'
import 'dotenv/config'

export default defineConfig({
  out: './drizzle',
  schema: './src/infrastructure/database/schema/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    // eslint-disable-next-line node/prefer-global/process
    url: process.env.DATABASE_URL!
  }
})
