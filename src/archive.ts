import { APIError } from "payload"
import type { Field, PayloadRequest } from "payload"
import { fieldAffectsData, fieldHasSubFields, fieldIsArrayType, fieldIsBlockType, fieldShouldBeLocalized, tabHasName } from "payload/shared"

import {
    DEFAULT_LOCALE_KEY,
    PORTABLE_FORMAT,
    PORTABLE_VERSION,
    type PortableArchive,
    type PortableDocument,
    type PortableImportError,
    type PortableImportReport,
    type PortableRuntimeOptions,
} from "./types.js"

type DynamicFindResult = {
    docs: PortableDocument[]
    hasNextPage: boolean
}

type DynamicPayload = {
    create: (args: {
        collection: string
        data: Record<string, unknown>
        depth: number
        locale?: string
        overrideAccess: false
        req: PayloadRequest
        user?: unknown
    }) => Promise<unknown>
    db: {
        allowIDOnCreate?: boolean
    }
    find: (args: {
        collection: string
        depth: number
        fallbackLocale: false
        limit: number
        locale?: string
        overrideAccess: false
        page?: number
        req: PayloadRequest
        sort?: string
        user?: unknown
        where?: Record<string, unknown>
    }) => Promise<DynamicFindResult>
    findGlobal: (args: {
        depth: number
        fallbackLocale: false
        locale?: string
        overrideAccess: false
        req: PayloadRequest
        slug: string
        user?: unknown
    }) => Promise<Record<string, unknown>>
    update: (args: {
        collection: string
        data: Record<string, unknown>
        depth: number
        id: number | string
        locale?: string
        overrideAccess: false
        req: PayloadRequest
        user?: unknown
    }) => Promise<unknown>
    updateGlobal: (args: {
        data: Record<string, unknown>
        depth: number
        locale?: string
        overrideAccess: false
        req: PayloadRequest
        slug: string
        user?: unknown
    }) => Promise<unknown>
}

const getDynamicPayload = (req: PayloadRequest): DynamicPayload => req.payload as unknown as DynamicPayload

const getLocaleKeys = (req: PayloadRequest): string[] => {
    const localization = req.payload.config.localization

    if (!localization) {
        return [DEFAULT_LOCALE_KEY]
    }

    return localization.locales.map((locale) => (typeof locale === "string" ? locale : locale.code))
}

const getLocale = (localeKey: string): string | undefined => (localeKey === DEFAULT_LOCALE_KEY ? undefined : localeKey)

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const hasValue = (value: unknown): boolean => {
    if (value === null || value === undefined || value === "") {
        return false
    }

    if (Array.isArray(value)) {
        return value.some(hasValue)
    }

    if (isObject(value)) {
        return Object.values(value).some(hasValue)
    }

    return true
}

const getDefaultLocaleKey = (req: PayloadRequest): string => {
    const localization = req.payload.config.localization
    return localization ? localization.defaultLocale : DEFAULT_LOCALE_KEY
}

const hasLocalizedContent = (fields: Field[], data: Record<string, unknown>): boolean => {
    for (const field of fields) {
        if (field.type === "tabs") {
            for (const tab of field.tabs) {
                let tabData = data

                if (tabHasName(tab)) {
                    const value = data[tab.name]

                    if (isObject(value)) {
                        tabData = value
                    }
                }

                if (fieldShouldBeLocalized({ field: tab, parentIsLocalized: false })) {
                    if (tabHasName(tab) && hasValue(data[tab.name])) {
                        return true
                    }
                } else if (hasLocalizedContent(tab.fields, tabData)) {
                    return true
                }
            }

            continue
        }

        if (fieldAffectsData(field)) {
            const value = data[field.name]

            if (fieldShouldBeLocalized({ field, parentIsLocalized: false })) {
                if (hasValue(value)) {
                    return true
                }

                continue
            }

            if (fieldIsBlockType(field) && Array.isArray(value)) {
                for (const row of value) {
                    if (!isObject(row) || typeof row.blockType !== "string") {
                        continue
                    }

                    const block = field.blocks.find(({ slug }) => slug === row.blockType)

                    if (block && hasLocalizedContent(block.fields, row)) {
                        return true
                    }
                }
            } else if (fieldHasSubFields(field)) {
                if (fieldIsArrayType(field) && Array.isArray(value)) {
                    if (value.some((row) => isObject(row) && hasLocalizedContent(field.fields, row))) {
                        return true
                    }
                } else if (isObject(value) && hasLocalizedContent(field.fields, value)) {
                    return true
                }
            }

            continue
        }

        if (fieldHasSubFields(field) && hasLocalizedContent(field.fields, data)) {
            return true
        }
    }

    return false
}

const serializeError = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message
    }

    return String(error)
}

const stripManagedFields = (document: Record<string, unknown>, keepID: boolean): Record<string, unknown> => {
    const data = { ...document }

    if (!keepID) {
        delete data.id
    }

    delete data.createdAt
    delete data.updatedAt
    delete data._isLocked
    delete data._userEditing

    return data
}

export const assertPortableAccess = async (req: PayloadRequest, options: PortableRuntimeOptions): Promise<void> => {
    const allowed = options.access ? await options.access({ req }) : Boolean(req.user)

    if (!allowed) {
        throw new APIError("You are not allowed to export or import Payload data.", 403)
    }
}

export const createArchive = async (req: PayloadRequest, options: PortableRuntimeOptions): Promise<PortableArchive> => {
    const archive: PortableArchive = {
        collections: {},
        exportedAt: new Date().toISOString(),
        format: PORTABLE_FORMAT,
        globals: {},
        version: PORTABLE_VERSION,
    }
    const locales = getLocaleKeys(req)
    const defaultLocaleKey = getDefaultLocaleKey(req)
    const payload = getDynamicPayload(req)

    for (const collectionConfig of req.payload.config.collections) {
        const slug = collectionConfig.slug

        if (!options.collections.has(slug) || options.excludeCollections.has(slug)) {
            continue
        }

        archive.collections[slug] = {}

        for (const localeKey of locales) {
            const documents: PortableDocument[] = []
            let page = 1
            let hasNextPage = true

            while (hasNextPage) {
                const result = await payload.find({
                    collection: slug,
                    depth: 0,
                    fallbackLocale: false,
                    limit: options.batchSize,
                    locale: getLocale(localeKey),
                    overrideAccess: false,
                    page,
                    req,
                    sort: "id",
                    user: req.user ?? undefined,
                })

                documents.push(
                    ...result.docs.filter(
                        (document) =>
                            localeKey === defaultLocaleKey || hasLocalizedContent(collectionConfig.fields, document)
                    )
                )
                hasNextPage = result.hasNextPage
                page += 1
            }

            archive.collections[slug][localeKey] = documents
        }
    }

    for (const globalConfig of req.payload.config.globals) {
        const slug = globalConfig.slug

        if (!options.globals.has(slug) || options.excludeGlobals.has(slug)) {
            continue
        }

        archive.globals[slug] = {}

        for (const localeKey of locales) {
            const data = await payload.findGlobal({
                depth: 0,
                fallbackLocale: false,
                locale: getLocale(localeKey),
                overrideAccess: false,
                req,
                slug,
                user: req.user ?? undefined,
            })

            if (localeKey === defaultLocaleKey || hasLocalizedContent(globalConfig.fields, data)) {
                archive.globals[slug][localeKey] = data
            }
        }
    }

    return archive
}

export const parseArchive = (value: unknown): PortableArchive => {
    if (
        !isObject(value) ||
        value.format !== PORTABLE_FORMAT ||
        value.version !== PORTABLE_VERSION ||
        typeof value.exportedAt !== "string" ||
        !isObject(value.collections) ||
        !isObject(value.globals)
    ) {
        throw new APIError("The selected file is not a supported Payload Portable export.", 400)
    }

    for (const [slug, locales] of Object.entries(value.collections)) {
        if (!slug || !isObject(locales)) {
            throw new APIError("The export contains an invalid collection.", 400)
        }

        for (const documents of Object.values(locales)) {
            if (!Array.isArray(documents) || documents.some((document) => !isObject(document) || !("id" in document))) {
                throw new APIError(`Collection "${slug}" contains invalid documents.`, 400)
            }
        }
    }

    for (const [slug, locales] of Object.entries(value.globals)) {
        if (!slug || !isObject(locales) || Object.values(locales).some((global) => !isObject(global))) {
            throw new APIError(`Global "${slug}" contains invalid data.`, 400)
        }
    }

    return value as PortableArchive
}

const documentExists = async (req: PayloadRequest, collection: string, id: number | string, locale: string | undefined): Promise<boolean> => {
    const result = await getDynamicPayload(req).find({
        collection,
        depth: 0,
        fallbackLocale: false,
        limit: 1,
        locale,
        overrideAccess: false,
        req,
        user: req.user ?? undefined,
        where: {
            id: {
                equals: id,
            },
        },
    })

    return result.docs.length > 0
}

export const importArchive = async (
    req: PayloadRequest,
    archive: PortableArchive,
    options: PortableRuntimeOptions
): Promise<PortableImportReport> => {
    const report: PortableImportReport = {
        collections: { created: 0, skipped: 0, updated: 0 },
        errors: [],
        globals: { skipped: 0, updated: 0 },
    }
    const collectionSlugs = new Set<string>(req.payload.config.collections.map(({ slug }) => slug))
    const globalSlugs = new Set<string>(req.payload.config.globals.map(({ slug }) => slug))
    const payload = getDynamicPayload(req)
    const collectionsMissingIDSupport = new Set<string>()

    const addError = (error: Omit<PortableImportError, "message">, cause: unknown): void => {
        report.errors.push({ ...error, message: serializeError(cause) })
    }

    for (const [collection, locales] of Object.entries(archive.collections)) {
        if (!collectionSlugs.has(collection)) {
            addError({ entity: collection, type: "collection" }, new Error("Collection does not exist in the target config."))
            continue
        }

        if (!options.collections.has(collection) || options.excludeCollections.has(collection)) {
            continue
        }

        for (const [localeKey, documents] of Object.entries(locales)) {
            const locale = getLocale(localeKey)

            for (const document of documents) {
                try {
                    const exists = await documentExists(req, collection, document.id, locale)

                    if (exists) {
                        if (options.importMode === "add") {
                            report.collections.skipped += 1
                            continue
                        }

                        await payload.update({
                            collection,
                            data: stripManagedFields(document, false),
                            depth: 0,
                            id: document.id,
                            locale,
                            overrideAccess: false,
                            req,
                            user: req.user ?? undefined,
                        })
                        report.collections.updated += 1
                    } else {
                        if (options.importMode === "replace") {
                            report.collections.skipped += 1
                            continue
                        }

                        if (payload.db.allowIDOnCreate !== true) {
                            report.collections.skipped += 1

                            if (!collectionsMissingIDSupport.has(collection)) {
                                collectionsMissingIDSupport.add(collection)
                                addError(
                                    { entity: collection, type: "collection" },
                                    new Error(
                                        'Missing documents were skipped because the database adapter is not configured with "allowIDOnCreate: true". Enable it to preserve IDs and relationship references, or use "Replace existing only".'
                                    )
                                )
                            }

                            continue
                        }

                        await payload.create({
                            collection,
                            data: stripManagedFields(document, true),
                            depth: 0,
                            locale,
                            overrideAccess: false,
                            req,
                            user: req.user ?? undefined,
                        })
                        report.collections.created += 1
                    }
                } catch (error) {
                    addError({ entity: collection, id: document.id, locale: localeKey, type: "collection" }, error)
                }
            }
        }
    }

    for (const [global, locales] of Object.entries(archive.globals)) {
        if (!globalSlugs.has(global)) {
            addError({ entity: global, type: "global" }, new Error("Global does not exist in the target config."))
            continue
        }

        if (!options.globals.has(global) || options.excludeGlobals.has(global)) {
            continue
        }

        for (const [localeKey, data] of Object.entries(locales)) {
            if (options.importMode === "add") {
                report.globals.skipped += 1
                continue
            }

            try {
                await payload.updateGlobal({
                    data: stripManagedFields(data, false),
                    depth: 0,
                    locale: getLocale(localeKey),
                    overrideAccess: false,
                    req,
                    slug: global,
                    user: req.user ?? undefined,
                })
                report.globals.updated += 1
            } catch (error) {
                addError({ entity: global, locale: localeKey, type: "global" }, error)
            }
        }
    }

    return report
}
