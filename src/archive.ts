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
    type PortableImportErrorCode,
    type PortableImportReport,
    type PortableImportWarning,
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
        file?: {
            data: Buffer
            mimetype: string
            name: string
            size: number
        }
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

const cloneData = (data: Record<string, unknown>): Record<string, unknown> =>
    JSON.parse(JSON.stringify(data)) as Record<string, unknown>

const removeOptionalRelationships = (fields: Field[], data: Record<string, unknown>): boolean => {
    let removed = false

    for (const field of fields) {
        if (field.type === "tabs") {
            for (const tab of field.tabs) {
                if (tabHasName(tab)) {
                    const value = data[tab.name]

                    if (isObject(value)) {
                        removed = removeOptionalRelationships(tab.fields, value) || removed
                    }
                } else {
                    removed = removeOptionalRelationships(tab.fields, data) || removed
                }
            }

            continue
        }

        if (fieldAffectsData(field)) {
            const value = data[field.name]

            if (field.type === "relationship" && !field.required && value !== undefined) {
                delete data[field.name]
                removed = true
                continue
            }

            if (fieldIsBlockType(field) && Array.isArray(value)) {
                for (const row of value) {
                    if (!isObject(row) || typeof row.blockType !== "string") {
                        continue
                    }

                    const block = field.blocks.find(({ slug }) => slug === row.blockType)

                    if (block) {
                        removed = removeOptionalRelationships(block.fields, row) || removed
                    }
                }
            } else if (fieldHasSubFields(field)) {
                if (fieldIsArrayType(field) && Array.isArray(value)) {
                    for (const row of value) {
                        if (isObject(row)) {
                            removed = removeOptionalRelationships(field.fields, row) || removed
                        }
                    }
                } else if (isObject(value)) {
                    removed = removeOptionalRelationships(field.fields, value) || removed
                }
            }

            continue
        }

        if (fieldHasSubFields(field)) {
            removed = removeOptionalRelationships(field.fields, data) || removed
        }
    }

    return removed
}

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

const hasRequiredLocalizedField = (fields: Field[]): boolean => {
    for (const field of fields) {
        if (field.type === "tabs") {
            if (
                field.tabs.some(
                    (tab) =>
                        !fieldShouldBeLocalized({ field: tab, parentIsLocalized: false }) &&
                        hasRequiredLocalizedField(tab.fields)
                )
            ) {
                return true
            }

            continue
        }

        if (fieldAffectsData(field) && fieldShouldBeLocalized({ field, parentIsLocalized: false })) {
            if (field.required) {
                return true
            }

            continue
        }

        if (fieldIsBlockType(field)) {
            if (field.blocks.some((block) => hasRequiredLocalizedField(block.fields))) {
                return true
            }
        } else if (fieldHasSubFields(field) && hasRequiredLocalizedField(field.fields)) {
            return true
        }
    }

    return false
}

const hasLocalizedContent = (fields: Field[], data: Record<string, unknown>, requiredOnly = false): boolean => {
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
                } else if (hasLocalizedContent(tab.fields, tabData, requiredOnly)) {
                    return true
                }
            }

            continue
        }

        if (fieldAffectsData(field)) {
            const value = data[field.name]

            if (fieldShouldBeLocalized({ field, parentIsLocalized: false })) {
                if ((!requiredOnly || field.required) && hasValue(value)) {
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

                    if (block && hasLocalizedContent(block.fields, row, requiredOnly)) {
                        return true
                    }
                }
            } else if (fieldHasSubFields(field)) {
                if (fieldIsArrayType(field) && Array.isArray(value)) {
                    if (value.some((row) => isObject(row) && hasLocalizedContent(field.fields, row, requiredOnly))) {
                        return true
                    }
                } else if (isObject(value) && hasLocalizedContent(field.fields, value, requiredOnly)) {
                    return true
                }
            }

            continue
        }

        if (fieldHasSubFields(field) && hasLocalizedContent(field.fields, data, requiredOnly)) {
            return true
        }
    }

    return false
}

const shouldIncludeLocale = (fields: Field[], data: Record<string, unknown>): boolean =>
    hasRequiredLocalizedField(fields) ? hasLocalizedContent(fields, data, true) : hasLocalizedContent(fields, data)

const serializeError = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message
    }

    return String(error)
}

type ClassifiedImportError = {
    code: PortableImportErrorCode
    fields?: string[]
    hint: string
    message: string
}

const classifyImportError = (cause: unknown): ClassifiedImportError => {
    const technicalMessage = serializeError(cause)
    const normalized = technicalMessage.toLowerCase()
    const invalidFields = technicalMessage.match(/invalid:\s*(.+)$/i)?.[1]
        ?.split(",")
        .map((field) => field.trim())
        .filter(Boolean)

    if (normalized.includes("allowidoncreate")) {
        return {
            code: "MISSING_ID_SUPPORT",
            hint: 'Configure the database adapter with "allowIDOnCreate: true", or use the "replace" import mode.',
            message: "Missing documents could not be restored with their original IDs.",
        }
    }

    if (normalized.includes("does not exist in the target config") || normalized.includes("schema")) {
        return {
            code: "SCHEMA_MISMATCH",
            hint: "Ensure that the source and target Payload configurations contain the same collections, globals, and fields.",
            message: "The exported entity does not match the target Payload configuration.",
        }
    }

    if (normalized.includes("not allowed") || normalized.includes("access denied") || normalized.includes("forbidden")) {
        return {
            code: "ACCESS_DENIED",
            hint: "Check the plugin access option and the access-control rules of the affected entity.",
            message: "The current user is not allowed to import this item.",
        }
    }

    if (normalized.includes("duplicate key") || normalized.includes("already exists") || normalized.includes("unique")) {
        return {
            code: "DUPLICATE_VALUE",
            hint: "Check unique fields in the target collection and resolve conflicting values before importing again.",
            message: "A unique value already exists in the target collection.",
        }
    }

    if (
        normalized.includes("failed query") ||
        normalized.includes("foreign key") ||
        normalized.includes("relationship") ||
        normalized.includes("referenced document")
    ) {
        return {
            code: "MISSING_RELATION",
            hint: "Ensure referenced documents already exist, or import their collections before importing this entity.",
            message: "One or more referenced documents are missing or could not be linked.",
        }
    }

    if (invalidFields?.length || normalized.includes("validation") || normalized.includes("required")) {
        return {
            code: "VALIDATION_ERROR",
            fields: invalidFields,
            hint: "Check required fields and field validation rules in the target Payload configuration.",
            message: "One or more fields failed validation.",
        }
    }

    return {
        code: "UNKNOWN_ERROR",
        hint: "Check the Payload server log for the full technical error.",
        message: "The item could not be imported.",
    }
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

const fillRequiredPlaceholderText = (fields: Field[], data: Record<string, unknown>): void => {
    for (const field of fields) {
        if (field.type === "tabs") {
            for (const tab of field.tabs) {
                if (tabHasName(tab)) {
                    const currentValue = data[tab.name]
                    const value: Record<string, unknown> = isObject(currentValue) ? currentValue : {}
                    data[tab.name] = value
                    fillRequiredPlaceholderText(tab.fields, value)
                } else {
                    fillRequiredPlaceholderText(tab.fields, data)
                }
            }

            continue
        }

        if (fieldAffectsData(field)) {
            if (data[field.name] === undefined && field.required && (field.type === "text" || field.type === "textarea")) {
                data[field.name] = "Import placeholder"
            }

            if (field.type === "group") {
                const currentValue = data[field.name]
                const value: Record<string, unknown> = isObject(currentValue) ? currentValue : {}
                data[field.name] = value
                fillRequiredPlaceholderText(field.fields, value)
            }

            continue
        }

        if (fieldHasSubFields(field)) {
            fillRequiredPlaceholderText(field.fields, data)
        }
    }
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
                            localeKey === defaultLocaleKey || shouldIncludeLocale(collectionConfig.fields, document)
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

            if (localeKey === defaultLocaleKey || shouldIncludeLocale(globalConfig.fields, data)) {
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
        warnings: [],
    }
    const collectionSlugs = new Set<string>(req.payload.config.collections.map(({ slug }) => slug))
    const globalSlugs = new Set<string>(req.payload.config.globals.map(({ slug }) => slug))
    const payload = getDynamicPayload(req)
    type ImportErrorContext = { entity: string; id?: number | string; locale?: string; type: "collection" | "global" }
    type ImportWarningContext = ImportErrorContext & { field: string }
    type PendingRelation = {
        context: ImportErrorContext
        error: unknown
        run: () => Promise<void>
    }
    type DeferredRelation = Omit<PendingRelation, "error">
    let pendingRelations: PendingRelation[] = []
    const deferredRelations: DeferredRelation[] = []
    const placeholderIDs = new Map<string, Promise<number | string>>()

    const addError = (
        error: ImportErrorContext,
        cause: unknown
    ): void => {
        const classified = classifyImportError(cause)
        const existing = report.errors.find(
            (item) =>
                item.code === classified.code &&
                item.entity === error.entity &&
                item.message === classified.message &&
                item.type === error.type &&
                JSON.stringify(item.fields) === JSON.stringify(classified.fields)
        )

        req.payload.logger?.error({
            entity: error.entity,
            err: cause instanceof Error ? cause : new Error(String(cause)),
            id: error.id,
            locale: error.locale,
            msg: "Payload Portable import failed",
            type: error.type,
        })

        if (existing) {
            existing.count += 1

            if (error.id !== undefined && !existing.ids.includes(error.id)) {
                existing.ids.push(error.id)
            }

            if (error.locale && !existing.locales.includes(error.locale)) {
                existing.locales.push(error.locale)
            }

            return
        }

        report.errors.push({
            ...classified,
            count: 1,
            entity: error.entity,
            ids: error.id === undefined ? [] : [error.id],
            locales: error.locale ? [error.locale] : [],
            type: error.type,
        })
    }

    const queueRelationOrAddError = (context: ImportErrorContext, cause: unknown, run: () => Promise<void>): void => {
        if (classifyImportError(cause).code === "MISSING_RELATION") {
            pendingRelations.push({ context, error: cause, run })
            return
        }

        addError(context, cause)
    }

    const addWarning = (context: ImportWarningContext, required: boolean): void => {
        const code = required ? "MISSING_MEDIA_REPLACED" : "MISSING_MEDIA_REMOVED"
        const existing = report.warnings.find(
            (warning) => warning.code === code && warning.entity === context.entity && warning.type === context.type
        )

        if (existing) {
            existing.count += 1

            if (!existing.fields.includes(context.field)) {
                existing.fields.push(context.field)
            }

            if (context.id !== undefined && !existing.ids.includes(context.id)) {
                existing.ids.push(context.id)
            }

            if (context.locale && !existing.locales.includes(context.locale)) {
                existing.locales.push(context.locale)
            }

            return
        }

        const warning: PortableImportWarning = {
            code,
            count: 1,
            entity: context.entity,
            fields: [context.field],
            hint: required
                ? "Replace the generated placeholder with the intended media document after the import."
                : "Assign the intended media document after the import if this optional field should not remain empty.",
            ids: context.id === undefined ? [] : [context.id],
            locales: context.locale ? [context.locale] : [],
            message: required
                ? "A missing required media relation was replaced with an import placeholder."
                : "A missing optional media relation was removed.",
            type: context.type,
        }
        report.warnings.push(warning)
    }

    const getPlaceholderID = (collection: string, mediaType: "image" | "video"): Promise<number | string> => {
        const cacheKey = `${collection}:${mediaType}`
        const filename =
            mediaType === "video" ? "payload-portable-video-placeholder-v2.mp4" : "payload-portable-placeholder.png"
        const cached = placeholderIDs.get(cacheKey)

        if (cached) {
            return cached
        }

        const pending = (async (): Promise<number | string> => {
            const existing = await payload.find({
                collection,
                depth: 0,
                fallbackLocale: false,
                limit: 1,
                overrideAccess: false,
                req,
                user: req.user ?? undefined,
                where: {
                    filename: {
                        equals: filename,
                    },
                },
            })

            if (existing.docs[0]?.id !== undefined) {
                return existing.docs[0].id
            }

            const collectionConfig = req.payload.config.collections.find(({ slug }) => slug === collection)

            if (!collectionConfig?.upload) {
                throw new Error(`Upload collection "${collection}" does not exist in the target config.`)
            }

            const data = { ...(options.placeholderData[collection] ?? {}) }
            fillRequiredPlaceholderText(collectionConfig.fields, data)
            // The video fallback contains a real, tiny H.264 stream so validators which
            // inspect video metadata accept it as media instead of merely an MP4 container.
            const buffer =
                mediaType === "video"
                    ? Buffer.from(
                          "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAr9tZGF0AAACoAYF//+c3EXpvebZSLeWLNgg2SPu73gyNjQgLSBjb3JlIDEyNSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMTIgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz02IGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0yNCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAAAA9liIQAV/0TAAYdeBTXzg8AAALvbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAACoAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAhl0cmFrAAAAXHRraGQAAAAPAAAAAAAAAAAAAAABAAAAAAAAACoAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAgAAAAIAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAAqAAAAAAABAAAAAAGRbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAwAAAAAgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABPG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAPxzdGJsAAAAmHN0c2QAAAAAAAAAAQAAAIhhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAgACABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAMmF2Y0MBZAAK/+EAGWdkAAqs2V+WXAWyAAADAAIAAAMAYB4kSywBAAZo6+PLIsAAAAAYc3R0cwAAAAAAAAABAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAACtwAAAAEAAAAUc3RjbwAAAAAAAAABAAAAMAAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNTQuNjMuMTA0",
                          "base64"
                      )
                    : Buffer.from(
                          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
                          "base64"
                      )
            const created = await payload.create({
                collection,
                data,
                depth: 0,
                file: {
                    data: buffer,
                    mimetype: mediaType === "video" ? "video/mp4" : "image/png",
                    name: filename,
                    size: buffer.length,
                },
                overrideAccess: false,
                req,
                user: req.user ?? undefined,
            })

            if (!isObject(created) || (typeof created.id !== "string" && typeof created.id !== "number")) {
                throw new Error(`Placeholder creation for upload collection "${collection}" did not return an ID.`)
            }

            return created.id
        })()

        placeholderIDs.set(cacheKey, pending)
        return pending
    }

    const resolveMissingUploads = async (
        fields: Field[],
        data: Record<string, unknown>,
        context: ImportErrorContext,
        path: string[] = []
    ): Promise<void> => {
        for (const field of fields) {
            if (field.type === "tabs") {
                for (const tab of field.tabs) {
                    if (tabHasName(tab)) {
                        const value = data[tab.name]

                        if (isObject(value)) {
                            await resolveMissingUploads(tab.fields, value, context, [...path, tab.name])
                        }
                    } else {
                        await resolveMissingUploads(tab.fields, data, context, path)
                    }
                }

                continue
            }

            if (fieldAffectsData(field)) {
                const fieldPath = [...path, field.name]
                const value = data[field.name]
                const relationTo = field.type === "upload" && typeof field.relationTo === "string" ? field.relationTo : undefined

                if (field.type === "upload" && relationTo && options.uploadCollections.has(relationTo)) {
                    const mediaType =
                        field.name.toLowerCase().includes("video") ||
                        (typeof field.filterOptions === "object" &&
                            JSON.stringify(field.filterOptions).toLowerCase().includes("video"))
                            ? "video"
                            : "image"
                    const getID = (item: unknown): number | string | undefined => {
                        if (typeof item === "number" || typeof item === "string") {
                            return item
                        }

                        return isObject(item) && (typeof item.id === "number" || typeof item.id === "string") ? item.id : undefined
                    }
                    const warningContext = { ...context, field: fieldPath.join(".") }

                    if (field.hasMany) {
                        const valid: Array<number | string> = []
                        let removed = 0

                        for (const item of Array.isArray(value) ? value : []) {
                            const id = getID(item)

                            if (id !== undefined && (await documentExists(req, relationTo, id, undefined))) {
                                valid.push(id)
                            } else {
                                removed += 1
                            }
                        }

                        for (let index = 0; index < removed; index += 1) {
                            addWarning(warningContext, false)
                        }

                        if (field.required && valid.length === 0) {
                            valid.push(await getPlaceholderID(relationTo, mediaType))
                            addWarning(warningContext, true)
                        }

                        data[field.name] = valid
                    } else {
                        const id = getID(value)
                        const exists = id !== undefined && (await documentExists(req, relationTo, id, undefined))

                        if (!exists && field.required) {
                            data[field.name] = await getPlaceholderID(relationTo, mediaType)
                            addWarning(warningContext, true)
                        } else if (!exists && id !== undefined) {
                            delete data[field.name]
                            addWarning(warningContext, false)
                        }
                    }

                    continue
                }

                if (fieldIsBlockType(field) && Array.isArray(value)) {
                    for (const [index, row] of value.entries()) {
                        if (!isObject(row) || typeof row.blockType !== "string") {
                            continue
                        }

                        const block = field.blocks.find(({ slug }) => slug === row.blockType)

                        if (block) {
                            await resolveMissingUploads(block.fields, row, context, [...fieldPath, String(index)])
                        }
                    }
                } else if (fieldHasSubFields(field)) {
                    if (fieldIsArrayType(field) && Array.isArray(value)) {
                        for (const [index, row] of value.entries()) {
                            if (isObject(row)) {
                                await resolveMissingUploads(field.fields, row, context, [...fieldPath, String(index)])
                            }
                        }
                    } else if (isObject(value)) {
                        await resolveMissingUploads(field.fields, value, context, fieldPath)
                    }
                }

                continue
            }

            if (fieldHasSubFields(field)) {
                await resolveMissingUploads(field.fields, data, context, path)
            }
        }
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
                const context: ImportErrorContext = {
                    entity: collection,
                    id: document.id,
                    locale: localeKey,
                    type: "collection",
                }
                const run = async (): Promise<void> => {
                    const exists = await documentExists(req, collection, document.id, locale)

                    if (exists) {
                        if (options.importMode === "add") {
                            report.collections.skipped += 1
                            return
                        }

                        const data = stripManagedFields(document, false)
                        const collectionConfig = req.payload.config.collections.find(({ slug }) => slug === collection)

                        if (collectionConfig) {
                            await resolveMissingUploads(collectionConfig.fields ?? [], data, context)
                        }

                        await payload.update({
                            collection,
                            data,
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
                            return
                        }

                        if (payload.db.allowIDOnCreate !== true) {
                            report.collections.skipped += 1
                            addError(
                                context,
                                new Error(
                                    'Missing documents were skipped because the database adapter is not configured with "allowIDOnCreate: true".'
                                )
                            )

                            return
                        }

                        const data = stripManagedFields(document, true)
                        const collectionConfig = req.payload.config.collections.find(({ slug }) => slug === collection)

                        if (collectionConfig) {
                            await resolveMissingUploads(collectionConfig.fields ?? [], data, context)
                        }

                        const initialData = cloneData(data)
                        const hasDeferredRelations = collectionConfig
                            ? removeOptionalRelationships(collectionConfig.fields ?? [], initialData)
                            : false

                        await payload.create({
                            collection,
                            data: initialData,
                            depth: 0,
                            locale,
                            overrideAccess: false,
                            req,
                            user: req.user ?? undefined,
                        })
                        report.collections.created += 1

                        if (hasDeferredRelations) {
                            deferredRelations.push({
                                context,
                                run: async (): Promise<void> => {
                                    await payload.update({
                                        collection,
                                        data,
                                        depth: 0,
                                        id: document.id,
                                        locale,
                                        overrideAccess: false,
                                        req,
                                        user: req.user ?? undefined,
                                    })
                                },
                            })
                        }
                    }
                }

                try {
                    await run()
                } catch (error) {
                    queueRelationOrAddError(context, error, run)
                }
            }
        }
    }

    for (const deferred of deferredRelations) {
        try {
            await deferred.run()
        } catch (error) {
            queueRelationOrAddError(deferred.context, error, deferred.run)
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

            const context: ImportErrorContext = { entity: global, locale: localeKey, type: "global" }
            const run = async (): Promise<void> => {
                const dataWithResolvedUploads = stripManagedFields(data, false)
                const globalConfig = req.payload.config.globals.find(({ slug }) => slug === global)

                if (globalConfig) {
                    await resolveMissingUploads(globalConfig.fields ?? [], dataWithResolvedUploads, context)
                }

                await payload.updateGlobal({
                    data: dataWithResolvedUploads,
                    depth: 0,
                    locale: getLocale(localeKey),
                    overrideAccess: false,
                    req,
                    slug: global,
                    user: req.user ?? undefined,
                })
                report.globals.updated += 1
            }

            try {
                await run()
            } catch (error) {
                queueRelationOrAddError(context, error, run)
            }
        }
    }

    while (pendingRelations.length) {
        const nextRound: PendingRelation[] = []
        let resolved = 0

        for (const pending of pendingRelations) {
            try {
                await pending.run()
                resolved += 1
            } catch (error) {
                if (classifyImportError(error).code === "MISSING_RELATION") {
                    nextRound.push({ ...pending, error })
                } else {
                    addError(pending.context, error)
                }
            }
        }

        if (resolved === 0) {
            for (const pending of nextRound) {
                addError(pending.context, pending.error)
            }

            break
        }

        pendingRelations = nextRound
    }

    return report
}
