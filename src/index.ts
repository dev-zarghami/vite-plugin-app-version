import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type {Plugin, ResolvedConfig} from "vite";

/**
 * Full version info collected at build time.
 */
type FullInfo = {
    version: string;
    commitShort: string | null;
    pkgVersion: string | null;
    buildTime: string;
    mode: string;
};

type Options<Extra extends Record<string, any> = {}> = {
    filename?: string; // default "version.json"
    publicFields?: (keyof FullInfo)[];
    exposeVirtual?: boolean;
    extraFields?: Extra;
};

// Default fields exposed in version.json + virtual module
const defaultFields: (keyof FullInfo)[] = [
    "pkgVersion",
    "version",
    "commitShort",
    "buildTime",
];

const fieldTypes: Record<keyof FullInfo, string> = {
    version: "string",
    commitShort: "string | null",
    pkgVersion: "string | null",
    buildTime: "string",
    mode: "string",
};

// --------------------- helpers ---------------------

function runCommand(cmd: string): string | null {
    try {
        return require("child_process")
            .execSync(cmd, {stdio: ["ignore", "pipe", "ignore"]})
            .toString()
            .trim();
    } catch {
        return null;
    }
}

function readPkgVersion(): string | null {
    try {
        const pkg = JSON.parse(
            fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8")
        );
        return typeof pkg.version === "string" ? pkg.version : null;
    } catch {
        return null;
    }
}

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
        buildTime: new Date().toISOString(),
        mode,
    };
}

function pickFields<T extends Record<string, any>, K extends keyof T>(
    obj: T,
    keys: K[]
): Pick<T, K> {
    const out = {} as Pick<T, K>;
    for (const k of keys) out[k] = obj[k];
    return out;
}

function weakEtagFor(content: string) {
    const hash = crypto.createHash("sha1").update(content).digest("hex");
    return `W/"${hash}"`;
}

function generateInterface(
    fields: (keyof FullInfo)[],
    extraFields?: Record<string, any>
): string {
    const lines = fields.map((f) => `  ${f}: ${fieldTypes[f]};`);
    if (extraFields) {
        for (const [key, val] of Object.entries(extraFields)) {
            let tsType = typeof val;
            if (tsType === "object") {
                tsType = "Record<string, any>";
            }
            if (tsType === "number") tsType = "number";
            if (tsType === "boolean") tsType = "boolean";
            if (tsType === "string") tsType = "string";
            lines.push(`  ${key}: ${tsType};`);
        }
    }
    return `interface AppVersion {\n${lines.join("\n")}\n}`;
}

function writeDtsToDisk(
    virtualId: string,
    interfaceCode: string,
    dtsDir: string
) {
    if (!dtsDir) return;
    if (!fs.existsSync(dtsDir)) fs.mkdirSync(dtsDir, {recursive: true});

    const dtsContent =
        `declare module "${virtualId}" {
${interfaceCode}
  const version: AppVersion;
  export function checkVersion(): Promise<{ updated: boolean; latest: AppVersion | null }>;
  export function onCheck(cb: (result: { updated: boolean; latest: AppVersion | null }) => void): () => void;
  export default version;
}
` + "\n";

    const outDtsPath = path.resolve(dtsDir, "virtual-app-version.d.ts");
    fs.writeFileSync(outDtsPath, dtsContent, "utf-8");
}

// --------------------- plugin ---------------------

export function generateVersion(opts: Options = {}): Plugin {
    const filename = opts.filename ?? "version.json";
    const publicFields = opts.publicFields ?? defaultFields;
    const extraFields = opts.extraFields ?? {};

    const exposeVirtualEnabled = opts.exposeVirtual ?? true;
    const virtualId = "virtual:app-version";
    const dtsDir = path.resolve(process.cwd(), "src");

    let resolvedConfig: ResolvedConfig;
    let mode: string = "production";
    let command: "serve" | "build" = "build";
    let lastJson = "{}\n";
    let devJson: string = "{}\n";

    const buildJson = () => {
        const full = collectVersion(mode);
        const data = {
            ...pickFields(full, publicFields),
            ...extraFields,
        };
        const json = JSON.stringify(data, null, 2) + "\n";
        lastJson = json;
        return json;
    };

    return {
        name: "vite-plugin-app-version",
        apply: () => true,

        configResolved(config) {
            resolvedConfig = config;
            mode = config.mode;
            command = config.command as "serve" | "build";

            if (exposeVirtualEnabled) {
                try {
                    const iFace = generateInterface(publicFields, extraFields);
                    writeDtsToDisk(virtualId, iFace, dtsDir);
                } catch {
                    // ignore
                }
            }
        },

        buildStart() {
            const json = buildJson();
            if (command === "serve") {
                devJson = json;
            }
        },

        generateBundle() {
            const json = buildJson();

            this.emitFile({
                type: "asset",
                fileName: filename,
                source: json,
            });

            if (exposeVirtualEnabled) {
                try {
                    const iFace = generateInterface(publicFields, extraFields);
                    writeDtsToDisk(virtualId, iFace, dtsDir);
                } catch {
                    // ignore
                }
            }
        },

        configureServer(server) {
            const base = (resolvedConfig?.base ?? "/").replace(/\/+$/, "/");
            const route = path.posix.join(base, filename);

            server.middlewares.use(route, (req, res) => {
                try {
                    const json = command === "serve" ? devJson : buildJson();
                    const etag = weakEtagFor(json);

                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.setHeader(
                        "Cache-Control",
                        "no-store, no-cache, must-revalidate, max-age=0"
                    );
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
                    res.statusCode = 500;
                    res.end(JSON.stringify({error: e?.message || String(e)}, null, 2));
                }
            });
        },

        resolveId(id) {
            if (!exposeVirtualEnabled) return null;
            return id === virtualId ? virtualId : null;
        },

        load(id) {
            if (!exposeVirtualEnabled || id !== virtualId) return null;

            const json = command === "serve" ? devJson : lastJson;

            return {
                code: `
export default ${json};

let listeners = [];

/**
 * Subscribe to version checks
 * @param {(result: {updated: boolean, latest: any}) => void} cb
 * @returns {() => void} unsubscribe function
 */
export function onCheck(cb) {
  if (typeof cb === "function") {
    listeners.push(cb);
  }
  return () => {
    listeners = listeners.filter(fn => fn !== cb);
  };
}

export async function checkVersion() {
  try {
    const res = await fetch("${resolvedConfig?.base ?? "/"}${filename}", { cache: "no-store" });
    if (!res.ok) {
      const result = { updated: false, latest: null };
      listeners.forEach(fn => fn(result));
      return result;
    }
    const latest = await res.json();
    const result = {
      updated: JSON.stringify(latest) !== JSON.stringify(${json}),
      latest
    };
    listeners.forEach(fn => fn(result));
    return result;
  } catch {
    const result = { updated: false, latest: null };
    listeners.forEach(fn => fn(result));
    return result;
  }
}
        `,
                map: null,
            };
        },
    };
}

export default generateVersion;
