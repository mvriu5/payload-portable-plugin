import type { PayloadRequest } from "payload"

export const PORTABLE_FORMAT = "payload-portable" as const
export const PORTABLE_VERSION = 1 as const
export const DEFAULT_LOCALE_KEY = "_default" as const

export type PortableDocument = Record<string, unknown> & {
    id: number | string
}

export type PortableArchive = {
    collections: Record<string, Record<string, PortableDocument[]>>
    exportedAt: string
    format: typeof PORTABLE_FORMAT
    globals: Record<string, Record<string, Record<string, unknown>>>
    version: typeof PORTABLE_VERSION
}

export type PortableImportError = {
    entity: string
    id?: number | string
    locale?: string
    message: string
    type: "collection" | "global"
}

export type PortableImportReport = {
    collections: {
        created: number
        updated: number
    }
    errors: PortableImportError[]
    globals: {
        updated: number
    }
}

export type PortableRuntimeOptions = {
    access?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
    batchSize: number
    collections: Set<string>
    excludeCollections: Set<string>
    excludeGlobals: Set<string>
    globals: Set<string>
}
