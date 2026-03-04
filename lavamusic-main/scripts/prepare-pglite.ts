import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const SOURCE_DIR = join(process.cwd(), "node_modules/@electric-sql/pglite/dist");
const TARGET_DIR = join(process.cwd(), "dist");

/**
 * PGLite bundle workaround
 * @see https://github.com/electric-sql/pglite/issues/478#issuecomment-3393442616
 * @see https://github.com/oven-sh/bun/issues/15032
 */
async function prepare() {
	if (!existsSync(TARGET_DIR)) await mkdir(TARGET_DIR, { recursive: true });

	console.log("📦 Copying PGlite assets for bundling...");

	try {
		await cp(join(SOURCE_DIR, "pglite.wasm"), join(TARGET_DIR, "pglite.wasm"));
		await cp(join(SOURCE_DIR, "pglite.data"), join(TARGET_DIR, "pglite.data"));
		console.log("✅ PGlite assets ready");
	} catch (err) {
		console.error(`❌ Failed to copy PGlite assets: ${err}`);
		process.exit(1);
	}
}

prepare();
