# vite-plugin-app-version

[![npm version](https://img.shields.io/npm/v/vite-plugin-app-version.svg)](https://www.npmjs.com/package/vite-plugin-app-version)  
[![license](https://img.shields.io/github/license/dev-zarghami/vite-plugin-app-version.svg)](LICENSE)

> Vite plugin to generate an **app version file (`version.json`)** and an optional **virtual module** with git/tag/build
> metadata.  
> Useful for displaying build info in your app, cache busting, or debugging.

---

## ✨ Features

- Generates a `version.json` file at build time
- Serves `version.json` in **dev mode** with `Cache-Control: no-store` + ETag
- Provides a virtual module (`virtual:app-version`) you can import in-app
- **Dynamic TypeScript interface** for virtual module, matching `publicFields`
- Includes `pkgVersion`, `git tag/commit`, `buildTime`, and current `mode`
- Customizable public fields
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
            exposeVirtual: true // enables import from 'virtual:app-version'
        })
    ]
});
```

### In your app (frontend code)

```ts
import version from "virtual:app-version";

console.log("App version info:", version);
// Example output based on publicFields:
// {
//   pkgVersion: "0.1.0",
//   version: "v1.2.3",
//   commitShort: "abc1234",
//   buildTime: "2025-09-09T14:00:00.000Z"
// }
```

- The **TypeScript interface** `AppVersion` automatically matches the fields you expose via `publicFields`.

### From `version.json`

- **Dev mode**: available at `http://localhost:5173/version.json`
- **Build mode**: emitted to your `dist/` (or configured `outDir`)

Example content:

```json
{
  "pkgVersion": "0.1.0",
  "version": "v1.2.3",
  "commitShort": "abc1234",
  "buildTime": "2025-09-09T14:00:00.000Z"
}
```

---

## ⚙️ Options

| Option             | Type                        | Default                                              | Description                                         |
|--------------------|-----------------------------|------------------------------------------------------|-----------------------------------------------------|
| `filename`         | `string`                    | `"version.json"`                                     | Output file name                                    |
| `outputDir`        | `string`                    | `"dist"`                                             | Directory to emit JSON / virtual module declaration |
| `publicFields`     | `(keyof FullInfo)[]`        | `["pkgVersion","version","commitShort","buildTime"]` | Fields to expose in JSON and virtual module         |
| `exposeVirtual`    | `boolean \| { id: string }` | `true`                                               | Export a virtual module                             |
| `exposeVirtual.id` | `string`                    | `"virtual:app-version"`                              | Custom virtual import ID                            |

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

> Only the fields listed in `publicFields` appear in the virtual module and JSON file. The **TypeScript interface**
> automatically matches these fields.

---

## 🛠️ Example: Custom Virtual ID & fields

```ts
generateVersion({
    publicFields: ["version", "buildTime"],
    exposeVirtual: {id: "virtual:my-build-info"}
});
```

```ts
import info from "virtual:my-build-info";

console.log(info.buildTime); // TS autocomplete works
```

- The generated `AppVersion` interface will only contain `version` and `buildTime`.

---

## 🤝 Contributing

PRs and issues welcome!  
👉 [Open an issue](https://github.com/dev-zarghami/vite-plugin-app-version/issues)

---

## 📄 License

[MIT](LICENSE) © dev.zarghami