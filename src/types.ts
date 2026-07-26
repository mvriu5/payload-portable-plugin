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

export type PortableImportErrorCode =
    | "ACCESS_DENIED"
    | "DUPLICATE_VALUE"
    | "MISSING_ID_SUPPORT"
    | "MISSING_RELATION"
    | "SCHEMA_MISMATCH"
    | "UNKNOWN_ERROR"
    | "VALIDATION_ERROR"

export type PortableImportError = {
    code: PortableImportErrorCode
    count: number
    entity: string
    fields?: string[]
    hint: string
    ids: Array<number | string>
    locales: string[]
    message: string
    type: "collection" | "global"
}

export type PortableImportReport = {
    collections: {
        created: number
        skipped: number
        updated: number
    }
    errors: PortableImportError[]
    globals: {
        skipped: number
        updated: number
    }
}

export type PortableImportMode = "add" | "merge" | "replace"

export type PortableRuntimeOptions = {
    access?: (args: { req: PayloadRequest }) => boolean | Promise<boolean>
    batchSize: number
    collections: Set<string>
    excludeCollections: Set<string>
    excludeGlobals: Set<string>
    globals: Set<string>
    importMode: PortableImportMode
}
