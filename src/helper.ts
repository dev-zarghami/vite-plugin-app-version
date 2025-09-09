import fs from "fs";
import path from "path";
import crypto from "crypto";
import child_process from "node:child_process";

export type LogLevel = "info" | "warn" | "error" | "debug";
export type LogMeta = Record<string, unknown> | undefined;

export const NOW_ISO = () => new Date().toISOString();

export function sha256(input: string | Buffer) {
    return crypto.createHash("sha256").update(input).digest("hex");
}

export function formatBytes(n: number) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function createLogger(scope: string) {
    const pick = (lvl: LogLevel) => (lvl === "error" ? console.error : lvl === "warn" ? console.warn : console.log);
    const icon = (lvl: LogLevel) => (lvl === "info" ? "🧩" : lvl === "warn" ? "⚠️" : lvl === "error" ? "🛑" : "🔎");

    const log = (level: LogLevel) => (msg: string, meta?: LogMeta) => {
        const fn = pick(level);
        const head = `${icon(level)} [${scope}] ${msg}`;
        meta ? fn(head, meta) : fn(head);
    };

    return {
        info: log("info"),
        warn: log("warn"),
        error: log("error"),
        debug: log("debug"),
    };
}

export function ensureDir(dir: string) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
}

export function writeFileIfChanged(filePath: string, content: string, log = createLogger("write")) {
    ensureDir(path.dirname(filePath));

    const existed = fs.existsSync(filePath);
    const oldHash = existed ? sha256(fs.readFileSync(filePath)) : null;
    const newHash = sha256(content);

    if (!existed || oldHash !== newHash) {
        fs.writeFileSync(filePath, content, "utf-8");
        const size = fs.statSync(filePath).size;
        log.info("File written", {
            path: filePath,
            size: formatBytes(size),
            hash: newHash.slice(0, 12),
            replaced: existed && oldHash !== null,
        });
        return {changed: true, size, hash: newHash};
    }

    log.debug("No changes; kept existing file", {
        path: filePath,
        hash: newHash.slice(0, 12),
    });
    return {changed: false, size: fs.statSync(filePath).size, hash: newHash};
}

export function resolveOutputPath(outputDir: string, filename: string) {
    const abs = path.resolve(outputDir);
    ensureDir(abs);
    return path.join(abs, filename);
}

export function runCommand(cmd: string) {
    try {
        return child_process
            .execSync(cmd, {stdio: ["ignore", "pipe", "ignore"]})
            .toString()
            .trim();
    } catch {
        return null;
    }
}
