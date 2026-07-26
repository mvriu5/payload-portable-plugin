import type { Config, PayloadRequest } from "payload"

import { createExportHandler } from "./endpoints/export.js"
import { createImportHandler } from "./endpoints/import.js"

export type PayloadPortablePluginConfig = {
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
    (pluginOptions: PayloadPortablePluginConfig = {}) =>
    (config: Config): Config => {
        if (pluginOptions.disabled) {
            return config
        }

        const batchSize = Math.max(1, Math.min(pluginOptions.batchSize ?? 100, 1000))
        const options = {
            access: pluginOptions.access,
            batchSize,
            collections: new Set((config.collections ?? []).map(({ slug }) => slug)),
            excludeCollections: new Set(pluginOptions.excludeCollections ?? []),
            excludeGlobals: new Set(pluginOptions.excludeGlobals ?? []),
            globals: new Set((config.globals ?? []).map(({ slug }) => slug)),
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
        ]

        config.admin = {
            ...(config.admin ?? {}),
            components: {
                ...(config.admin?.components ?? {}),
                beforeDashboard: [...(config.admin?.components?.beforeDashboard ?? []), "@mvriu5/payload-portable-plugin/client#PortableDashboard"],
            },
        }

        return config
    }

export type { PortableArchive, PortableImportReport } from "./types.js"
