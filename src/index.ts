import type { Config, PayloadRequest } from "payload"

import { createCollectionExportHandler, createExportHandler } from "./endpoints/export.js"
import { createCollectionImportHandler, createImportHandler } from "./endpoints/import.js"
import type { PortableImportMode } from "./types.js"

export type PayloadPortablePluginConfig = {
    /**
     * Controls whether imports add missing documents, replace matching documents,
     * or do both.
     */
    importMode: PortableImportMode
    /**
     * Optional additional authorization check. Payload access control is always
     * enforced for every read and write performed by the plugin.
     *
     * @default ({ req }) => Boolean(req.user)
     */
    access?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
    /**
     * Number of documents fetched per export query.
     *
     * @default 100
     */
    batchSize?: number
    /**
     * Disable the endpoints and dashboard component.
     */
    disabled?: boolean
    /**
     * Collections that must not be exported or imported.
     */
    excludeCollections?: string[]
    /**
     * Globals that must not be exported or imported.
     */
    excludeGlobals?: string[]
}

export const payloadPortablePlugin =
    (pluginOptions: PayloadPortablePluginConfig) =>
    (config: Config): Config => {
        if (!pluginOptions || !["add", "merge", "replace"].includes(pluginOptions.importMode)) {
            throw new Error('payloadPortablePlugin requires importMode to be "add", "merge", or "replace".')
        }

        if (pluginOptions.disabled) {
            return config
        }

        const batchSize = Math.max(1, Math.min(pluginOptions.batchSize ?? 100, 1000))
        const excludedCollections = new Set(pluginOptions.excludeCollections ?? [])

        for (const collection of config.collections ?? []) {
            if (collection.auth || collection.upload) {
                excludedCollections.add(collection.slug)
            }
        }

        const options = {
            access: pluginOptions.access,
            batchSize,
            collections: new Set((config.collections ?? []).map(({ slug }) => slug)),
            excludeCollections: excludedCollections,
            excludeGlobals: new Set(pluginOptions.excludeGlobals ?? []),
            globals: new Set((config.globals ?? []).map(({ slug }) => slug)),
            importMode: pluginOptions.importMode,
        }

        config.endpoints = [
            ...(config.endpoints ?? []),
            {
                handler: createExportHandler(options),
                method: "get",
                path: "/portable/export",
            },
            {
                handler: createImportHandler(options),
                method: "post",
                path: "/portable/import",
            },
            {
                handler: createCollectionExportHandler(options),
                method: "get",
                path: "/portable/export/:collection",
            },
            {
                handler: createCollectionImportHandler(options),
                method: "post",
                path: "/portable/import/:collection",
            },
        ]

        config.admin = {
            ...(config.admin ?? {}),
            components: {
                ...(config.admin?.components ?? {}),
                actions: [...(config.admin?.components?.actions ?? []), "@mvriu5/payload-portable-plugin/client#PortableActions"],
            },
        }

        for (const collection of config.collections ?? []) {
            if (options.excludeCollections.has(collection.slug)) {
                continue
            }

            collection.admin = {
                ...(collection.admin ?? {}),
                components: {
                    ...(collection.admin?.components ?? {}),
                    beforeList: [
                        ...(collection.admin?.components?.beforeList ?? []),
                        "@mvriu5/payload-portable-plugin/client#CollectionPortableActions",
                    ],
                },
            }
        }

        return config
    }

export type { PortableArchive, PortableImportError, PortableImportErrorCode, PortableImportMode, PortableImportReport } from "./types.js"
