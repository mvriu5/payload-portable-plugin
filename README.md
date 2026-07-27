# Payload Portable Plugin

Export all configured Payload collections and globals to a single JSON file and import them again through actions in the admin panel.

## Usage

```ts
import { postgresAdapter } from "@payloadcms/db-postgres"
import { payloadPortablePlugin } from "@mvriu5/payload-portable-plugin"

export default buildConfig({
    db: postgresAdapter({
        allowIDOnCreate: true,
        pool: {
            connectionString: process.env.DATABASE_URL!,
        },
    }),
    plugins: [payloadPortablePlugin({ importMode: "merge" })],
})
```

The admin header provides **Import** and **Export** actions. The same actions appear next to **Create New** in each included collection list and operate only on that collection.

Documents are matched by ID. No import mode deletes documents. Localized content is transferred for every configured locale.

Empty non-default locale variants are omitted. When localized required fields exist, at least one of them must contain a value; generated values such as a localized slug alone do not mark the locale as translated. The import therefore leaves untranslated locales untouched instead of triggering required-field validation.

Authentication and upload collections are always excluded from both import and export. This prevents incomplete authentication data and missing binary files from producing invalid restores.

By default, all endpoints require an authenticated user. Every individual read and write operation also enforces the access-control rules of its collection or global.

`allowIDOnCreate: true` is required on the database adapter to create missing documents with their original IDs and preserve relationship references. Without this option, existing documents can still be updated, while missing documents are skipped and reported.

### Import mode

The required `importMode` plugin option controls how documents are imported:

- `"merge"` creates missing documents and updates existing documents
- `"add"` creates only missing documents and leaves existing documents unchanged
- `"replace"` updates only existing documents and skips missing documents

Globals are updated in `"merge"` and `"replace"` modes. They are skipped in `"add"` mode because globals always exist.

## Options

```ts
payloadPortablePlugin({
    access: ({ req }) => req.user?.roles?.includes("admin") === true,
    batchSize: 250,
    excludeCollections: ["payload-preferences"],
    excludeGlobals: ["internal-settings"],
    importMode: "merge",
    placeholderData: {
        media: {
            alt: "Missing imported image",
        },
    },
})
```

- `importMode`: required import mode: `"merge"`, `"add"`, or `"replace"`
- `access`: additional authorization check; authenticated users are allowed by default
- `batchSize`: export page size; defaults to `100` and is limited to `1000`
- `excludeCollections` / `excludeGlobals`: additional slugs to skip during both import and export
- `placeholderData`: additional data keyed by upload collection slug for generated placeholder documents
- `disabled`: disables the admin actions and endpoints

## Notes

The archive contains collection documents and global data, including relationship and upload references. Binary files from upload collections and secret authentication data hidden by Payload are not embedded.

Hooks, validation, and access control run normally during imports. Schema mismatches are therefore included in the import report for each affected document.

If an import contains errors, the admin UI automatically downloads a sanitized JSON error report. Repeated errors are grouped by entity and error code, with affected IDs, locales, and a suggested resolution. Full technical errors remain available in the Payload server log; SQL queries, local file paths, and stack traces are not exposed in the downloaded report.

Relationship failures are retried automatically after the initial import pass. The plugin continues retrying while at least one queued item succeeds, allowing documents that were imported out of dependency order to resolve later. Unresolvable or circular relationships remain in the final error report.

Missing upload relations are resolved before documents are written. Required upload fields receive a shared 1×1 PNG named `payload-portable-placeholder.png`; optional missing upload relations are removed. The plugin reuses one placeholder per upload collection and automatically fills required text and textarea fields with `Import placeholder`. Use `placeholderData` when an upload collection has additional required fields or needs custom values. These replacements are reported as grouped warnings so editors can replace placeholders after the import.
