import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    // Drizzle Kit accepts TLS options in its URL. Use a direct/session URL for schema tools.
    url: process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL || '',
  },
  verbose: true,
  strict: true,
});
