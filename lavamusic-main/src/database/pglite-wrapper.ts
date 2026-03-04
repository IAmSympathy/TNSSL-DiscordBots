import { join } from "node:path";
import { PGlite, type PGliteOptions } from "@electric-sql/pglite";

export async function createPGlite(dataDir: string, options?: PGliteOptions): Promise<PGlite> {
	const distPath = join(process.cwd(), "dist");
	const wasmPath = join(distPath, "pglite.wasm");
	const dataPath = join(distPath, "pglite.data");

	const [wasmBuffer, dataBuffer] = await Promise.all([
		Bun.file(wasmPath).arrayBuffer(),
		Bun.file(dataPath).arrayBuffer(),
	]);

	const wasmModule = await WebAssembly.compile(wasmBuffer);
	const fsBundle = new Blob([dataBuffer]);

	return PGlite.create(dataDir, { ...options, wasmModule, fsBundle });
}
