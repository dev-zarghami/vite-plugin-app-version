# vite-plugin-app-version

[![npm version](https://img.shields.io/npm/v/vite-plugin-app-version.svg)](https://www.npmjs.com/package/vite-plugin-app-version)  
[![license](https://img.shields.io/github/license/dev-zarghami/vite-plugin-app-version.svg)](LICENSE)

> Vite plugin to generate an **app version file (`version.json`)** and an optional **virtual module** with git/tag/build
> metadata.  
> Useful for displaying build info in your app, cache busting, or runtime version checking.

---

## ✨ Features

- Generates a `version.json` file at build time
- Serves `version.json` in **dev mode** with `Cache-Control: no-store` + ETag
- Provides a virtual module (`virtual:app-version`) you can import in-app
- **Dynamic TypeScript interface** for virtual module, matching `publicFields` and `extraFields`
- Exported async function `checkVersion()` to detect runtime version updates
- Exported subscription function `onCheck(cb)` to listen for results of `checkVersion()`
- Includes `pkgVersion`, `git tag/commit`, `buildTime`, and current `mode`
- Customizable public fields and **extra custom fields**
- No external runtime dependency

---

## 📦 Installation

```bash
npm install vite-plugin-app-version --save-dev
# or
yarn add -D vite-plugin-app-version
# or
pnpm add -D vite-plugin-app-version
```

---

## 🚀 Usage

Add the plugin in your `vite.config.ts`:

```ts
import {defineConfig} from "vite";
import {generateVersion} from "vite-plugin-app-version";

export default defineConfig({
    plugins: [
        generateVersion({
            filename: "version.json", // default
            publicFields: ["pkgVersion", "version", "commitShort", "buildTime"], // default fields
            exposeVirtual: true, // enables import from 'virtual:app-version'
            extraFields: {       // 👈 you can add custom fields too
                env: process.env.NODE_ENV,
                apiUrl: "https://api.example.com",
                release: 42
            }
        })
    ]
});
```

### In your app (frontend code)

```ts
import version, {checkVersion, onCheck} from "virtual:app-version";

console.log("App version info:", version);

// Subscribe to every check
onCheck(({updated, latest}) => {
    if (updated) {
        console.log("🔄 New version available:", latest?.version);
    } else {
        console.log("✅ Still up to date");
    }
});

// Run a check manually
setInterval(() => {
    checkVersion(); // triggers onCheck listeners
}, 30000);
```

- The **TypeScript interface** `AppVersion` automatically includes the fields from `publicFields` and `extraFields`.
- `onCheck` returns an unsubscribe function if you want to remove the listener.

### From `version.json`

- **Dev mode**: available at `http://localhost:5173/version.json`
- **Build mode**: emitted to your `/dist` or `/public`

Example content:

```json
{
  "pkgVersion": "0.1.0",
  "version": "v1.2.3",
  "commitShort": "abc1234",
  "buildTime": "2025-09-09T14:00:00.000Z",
  "env": "development",
  "apiUrl": "https://api.example.com",
  "release": 42
}
```

---

## ⚙️ Options

| Option          | Type                   | Default                                              | Description                                         |
|-----------------|------------------------|------------------------------------------------------|-----------------------------------------------------|
| `filename`      | `string`               | `"version.json"`                                     | Output file name                                    |
| `publicFields`  | `(keyof FullInfo)[]`   | `["pkgVersion","version","commitShort","buildTime"]` | Fields to expose in JSON and virtual module         |
| `exposeVirtual` | `boolean`              | `true`                                               | Enable the virtual module import (`virtual:app-version`) |
| `extraFields`   | `Record<string, any>`  | `{}`                                                 | Extra custom fields to merge into JSON and typings  |

### FullInfo fields

```ts
type FullInfo = {
    version: string;        // git tag / commit / fallback: timestamp
    commitShort: string;    // short git commit hash
    pkgVersion: string;     // package.json version
    buildTime: string;      // ISO timestamp
    mode: string;           // vite mode (development | production)
};
```

---

## 🛠️ Example: Only version + buildTime

```ts
generateVersion({
    publicFields: ["version", "buildTime"],
    exposeVirtual: true
});
```

```ts
import info, {checkVersion, onCheck} from "virtual:app-version";

console.log(info.buildTime); // TS autocomplete works

onCheck((res) => {
    if (res.updated) {
        console.log("New version available:", res.latest?.version);
    }
});

// Runtime version check
checkVersion();
```

---

## 🤝 Contributing

PRs and issues welcome!  
👉 [Open an issue](https://github.com/dev-zarghami/vite-plugin-app-version/issues)

---

## 📄 License

[MIT](LICENSE) © dev-zarghami