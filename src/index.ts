// /vite/plugins/generate-version.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {Plugin, ResolvedConfig} from "vite";
import {NOW_ISO, createLogger, resolveOutputPath, writeFileIfChanged, runCommand} from "./helper";

/**
 * Full information about the app version
 */
type FullInfo = {
    version: string;         // Git tag, commit hash or timestamp
    commitShort: string | null;
    pkgVersion: string | null; // package.json version
    buildTime: string;       // ISO timestamp
    mode: string;            // development | production
};

/**
 * Plugin options
 */
type Options = {
    outputDir?: string;      // Where to write version.json
    filename?: string;       // Default: "version.json"
    publicFields?: (keyof FullInfo)[];
    exposeVirtual?: boolean | { id?: string; dtsDir?: string }; // virtual module + TS declaration path
};

// Default fields to expose in JSON & virtual module
const defaultFields: (keyof FullInfo)[] = ["pkgVersion", "version", "commitShort", "buildTime"];

/**
 * Read package.json version
 */
function readPkgVersion(): string | null {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"));
        return typeof pkg.version === "string" ? pkg.version : null;
    } catch {
        return null;
    }
}

/**
 * Collect version info from Git / package.json / timestamp
 */
function collectVersion(mode: string): FullInfo {
    const version =
        runCommand("git describe --tags --exact-match") ||
        runCommand("git describe --tags --always") ||
        runCommand("git rev-parse --short HEAD") ||
        String(Date.now());

    const commitShort = runCommand("git rev-parse --short HEAD");

    return {
        version,
        commitShort,
        pkgVersion: readPkgVersion(),
        buildTime: NOW_ISO(),
        mode,
    };
}

/**
 * Pick only selected keys from object
 */
function pickFields<T extends Record<string, any>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
    const out = {} as Pick<T, K>;
    for (const k of keys) out[k] = obj[k];
    return out;
}

/**
 * Generate weak ETag for caching
 */
function weakEtagFor(content: string) {
    const hash = crypto.createHash("sha1").update(content).digest("hex");
    return `W/"${hash}"`;
}

/**
 * Type mapping for generating TypeScript interface
 */
const fieldTypes: Record<keyof FullInfo, string> = {
    version: "string",
    commitShort: "string | null",
    pkgVersion: "string | null",
    buildTime: "string",
    mode: "string",
};

/**
 * Generate TypeScript interface code for selected fields
 */
function generateAppVersionInterface(fields: (keyof FullInfo)[]): string {
    const lines = fields.map(f => `  ${f}: ${fieldTypes[f]};`);
    return `interface AppVersion {\n${lines.join("\n")}\n}`;
}

/**
 * Vite plugin: generate app version info
 */
export function generateVersion(opts: Options = {}): Plugin {
    const log = createLogger("version");

    const filename = opts.filename ?? "version.json";
    const publicFields = opts.publicFields ?? defaultFields;

    const exposeVirtualEnabled = opts.exposeVirtual ?? true;
    const virtualId =
        typeof exposeVirtualEnabled === "object" && exposeVirtualEnabled?.id
            ? exposeVirtualEnabled.id
            : "virtual:app-version";

    const dtsDir =
        typeof exposeVirtualEnabled === "object" && exposeVirtualEnabled?.dtsDir
            ? exposeVirtualEnabled.dtsDir
            : path.resolve(process.cwd(), "src/types"); // default TS declaration path

    let outDir = opts.outputDir || "static";
    let mode: "development" | "production" = "production";
    let command: "serve" | "build" = "build";
    let resolvedConfig: ResolvedConfig;

    let lastJson = "{}\n";

    /**
     * Build JSON string for version info
     */
    const buildJson = () => {
        const full = collectVersion(mode);
        const data = pickFields(full, publicFields);
        const json = JSON.stringify(data, null, 2) + "\n";
        lastJson = json;
        return json;
    };

    return {
        name: "vite-plugin-app-version",
        apply: () => true,

        configResolved(config) {
            resolvedConfig = config;
            outDir = config.build?.outDir ?? outDir;
            mode = (config.mode as "development" | "production") ?? "production";
            command = (config.command as "serve" | "build") ?? "build";
        },

        buildStart() {
            buildJson();
        },

        buildEnd() {
            try {
                const json = buildJson();
                const filePath = resolveOutputPath(outDir, filename);
                writeFileIfChanged(filePath, json, log);
                log.info("version file written", {file: filePath});

                // Generate TS declaration file for virtual module
                if (exposeVirtualEnabled) {
                    const interfaceCode = generateAppVersionInterface(publicFields);

                    if (!fs.existsSync(dtsDir)) fs.mkdirSync(dtsDir, {recursive: true});

                    const dtsContent = `
declare module "${virtualId}" {
${interfaceCode}
  const version: AppVersion;
  export function checkVersion(): Promise<{ updated: boolean; latest: AppVersion | null }>;
  export default version;
}
`;
                    const outDtsPath = path.resolve(dtsDir, "virtual-app-version.d.ts");
                    fs.writeFileSync(outDtsPath, dtsContent, "utf-8");
                    log.info("TypeScript declaration for virtual module written", {file: outDtsPath});
                }
            } catch (e: any) {
                log.warn("failed to write version file or d.ts", {err: e?.message || String(e)});
            }
        },

        /**
         * Serve version.json in dev server with proper caching headers
         */
        configureServer(server) {
            const base = (resolvedConfig?.base ?? "/").replace(/\/+$/, "/");
            const route = path.posix.join(base, filename);

            server.middlewares.use(route, (req, res) => {
                try {
                    const json = buildJson();
                    const etag = weakEtagFor(json);

                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
                    res.setHeader("Pragma", "no-cache");
                    res.setHeader("Expires", "0");
                    res.setHeader("Vary", "If-None-Match");
                    res.setHeader("ETag", etag);

                    if (req.headers["if-none-match"] === etag) {
                        res.statusCode = 304;
                        res.end();
                        return;
                    }

                    res.end(json);
                } catch (e: any) {
                    const msg = e?.message || String(e);
                    res.statusCode = 500;
                    res.end(JSON.stringify({error: msg}, null, 2));
                }
            });

            log.info(`dev route mounted → ${route} (no-store)`);
        },

        resolveId(id) {
            if (!exposeVirtualEnabled) return null;
            return id === virtualId ? virtualId : null;
        },

        /**
         * Load virtual module: export version + checkVersion()
         */
        load(id) {
            if (!exposeVirtualEnabled || id !== virtualId) return null;

            const json = command === "serve" ? buildJson() : lastJson;
            const interfaceCode = generateAppVersionInterface(publicFields);

            // Note: checkVersion() fetches /version.json and compares with current version
            return {
                code: `
export default ${json};

export async function checkVersion() {
  try {
    const res = await fetch("/${filename}", { cache: "no-store" });
    if (!res.ok) return { updated: false, latest: null };
    const latest = await res.json();
    return {
      updated: JSON.stringify(latest) !== JSON.stringify(${json}),
      latest
    };
  } catch {
    return { updated: false, latest: null };
  }
}
        `,
                map: null,
            };
        },
    };
}
