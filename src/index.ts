// /vite/plugins/generate-version.ts
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Plugin, ResolvedConfig } from "vite";
import { NOW_ISO, createLogger, resolveOutputPath, writeFileIfChanged, runCommand } from "./helper";

type FullInfo = {
    version: string;
    commitShort: string | null;
    pkgVersion: string | null;
    buildTime: string;
    mode: string;
};

type Options = {
    /** Output filename served at BASE/<publicFilename>. Default: "version.json" */
    publicFilename?: string;
    /** Which fields to expose publicly (JSON + virtual module) */
    publicFields?: (keyof FullInfo)[];
    /** Expose a virtual module you can import in-app. Default: true → 'virtual:app-version' */
    exposeVirtual?: boolean | { id?: string };
};

function readPkgVersion(): string | null {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"));
        return typeof pkg.version === "string" ? pkg.version : null;
    } catch {
        return null;
    }
}

function collect(mode: string): FullInfo {
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

function pick<T extends Record<string, any>, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
    const out = {} as Pick<T, K>;
    for (const k of keys) out[k] = obj[k];
    return out;
}

function weakEtagFor(s: string) {
    const h = crypto.createHash("sha1").update(s).digest("hex");
    return `W/"${h}"`;
}

export function generateVersion(opts: Options = {}): Plugin {
    const log = createLogger("version");
    const publicFilename = opts.publicFilename ?? "version.json";
    const defaultFields: (keyof FullInfo)[] = ["pkgVersion", "version", "commitShort", "buildTime"];
    const publicFields = opts.publicFields ?? defaultFields;

    const exposeVirtualEnabled = opts.exposeVirtual ?? true;
    const virtualId = typeof exposeVirtualEnabled === "object" && exposeVirtualEnabled?.id
        ? exposeVirtualEnabled.id
        : "virtual:app-version";

    let outDir = "dist";
    let mode: "development" | "production" = "production";
    let command: "serve" | "build" = "build";
    let resolvedConfig: ResolvedConfig;

    // cache last built JSON for dev serve & virtual module
    let lastJson = "{}\n";

    const buildJson = () => {
        const full = collect(mode);
        const data = pick(full, publicFields);
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
            // generate once so virtual module is available early, and so buildEnd has content
            buildJson();
        },

        buildEnd() {
            // emit file into build outDir
            try {
                const json = buildJson();
                const filePath = resolveOutputPath(outDir, publicFilename);
                writeFileIfChanged(filePath, json, log);
                log.info("version file written", { file: filePath });
            } catch (e: any) {
                log.warn("failed to write version file", { err: e?.message || String(e) });
            }
        },

        // Dev: serve JSON at base-aware route with ETag/no-store
        configureServer(server) {
            const base = (resolvedConfig?.base ?? "/").replace(/\/+$/, "/");
            const route = path.posix.join(base, publicFilename);

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
                    res.end(JSON.stringify({ error: msg }, null, 2));
                }
            });

            log.info(`dev route mounted → ${route} (no-store)`);
        },

        // Optional: expose a virtual module you can import in your app code.
        resolveId(id) {
            if (!exposeVirtualEnabled) return null;
            if (id === virtualId) return virtualId;
            return null;
        },

        load(id) {
            if (!exposeVirtualEnabled) return null;
            if (id !== virtualId) return null;

            // Always (re)build to reflect current time/mode in dev
            const json = command === "serve" ? buildJson() : lastJson;

            // export default <object>
            return `// generated by vite-plugin-app-version export default ${json};`;
        },
    };
}
