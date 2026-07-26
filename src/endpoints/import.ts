import { APIError } from "payload"
import type { PayloadRequest } from "payload"

import { assertPortableAccess, importArchive, parseArchive } from "../archive.js"
import type { PortableRuntimeOptions } from "../types.js"

const readArchive = async (req: PayloadRequest) => {
    if (!req.json) {
        throw new APIError("The request body could not be read.", 400)
    }

    try {
        return parseArchive(await req.json())
    } catch (error) {
        if (error instanceof APIError) {
            throw error
        }

        throw new APIError("The selected file does not contain valid JSON.", 400)
    }
}

export const createImportHandler =
    (options: PortableRuntimeOptions) =>
    async (req: PayloadRequest): Promise<Response> => {
        await assertPortableAccess(req, options)

        const report = await importArchive(req, await readArchive(req), options)

        return Response.json(report, {
            headers: {
                "Cache-Control": "no-store",
            },
        })
    }

export const createCollectionImportHandler =
    (options: PortableRuntimeOptions) =>
    async (req: PayloadRequest): Promise<Response> => {
        await assertPortableAccess(req, options)

        const collection = req.routeParams?.collection

        if (typeof collection !== "string" || !options.collections.has(collection) || options.excludeCollections.has(collection)) {
            throw new APIError("Collection not found.", 404)
        }

        const archive = await readArchive(req)

        if (!archive.collections[collection]) {
            throw new APIError(`The selected export does not contain collection "${collection}".`, 400)
        }

        const report = await importArchive(
            req,
            {
                ...archive,
                collections: archive.collections[collection] ? { [collection]: archive.collections[collection] } : {},
                globals: {},
            },
            options
        )

        return Response.json(report, {
            headers: {
                "Cache-Control": "no-store",
            },
        })
    }
