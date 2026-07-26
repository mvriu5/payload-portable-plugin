import { APIError } from "payload"
import type { PayloadRequest } from "payload"

import { assertPortableAccess, createArchive } from "../archive.js"
import type { PortableRuntimeOptions } from "../types.js"

const createExportResponse = async (req: PayloadRequest, options: PortableRuntimeOptions, filenamePrefix: string): Promise<Response> => {
    const archive = await createArchive(req, options)
    const date = archive.exportedAt.slice(0, 10)

    return new Response(JSON.stringify(archive, null, 2), {
        headers: {
            "Cache-Control": "no-store",
            "Content-Disposition": `attachment; filename="${filenamePrefix}-${date}.json"`,
            "Content-Type": "application/json; charset=utf-8",
        },
    })
}

const getCollectionSlug = (req: PayloadRequest, options: PortableRuntimeOptions): string => {
    const slug = req.routeParams?.collection

    if (typeof slug !== "string" || !options.collections.has(slug) || options.excludeCollections.has(slug)) {
        throw new APIError("Collection not found.", 404)
    }

    return slug
}

export const createExportHandler =
    (options: PortableRuntimeOptions) =>
    async (req: PayloadRequest): Promise<Response> => {
        await assertPortableAccess(req, options)

        return createExportResponse(req, options, "payload-export")
    }

export const createCollectionExportHandler =
    (options: PortableRuntimeOptions) =>
    async (req: PayloadRequest): Promise<Response> => {
        await assertPortableAccess(req, options)

        const collection = getCollectionSlug(req, options)

        return createExportResponse(
            req,
            {
                ...options,
                collections: new Set([collection]),
                globals: new Set(),
            },
            `payload-${collection}-export`
        )
    }
