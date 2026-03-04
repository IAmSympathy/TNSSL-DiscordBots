import { defineConfig } from "drizzle-kit";

import { env } from "./src/env";

if (!env.DATABASE_URL) env.DATABASE_URL = "file:./lavamusic.db";

export default defineConfig({
	out: "./drizzle/sqlite",
	schema: "./src/database/schemas.sqlite.ts",
	dialect: "sqlite",
	dbCredentials: { url: env.DATABASE_URL },
});
