import { APIError } from "payload"
import type { PayloadRequest } from "payload"

import { assertPortableAccess, importArchive, parseArchive } from "../archive.js"
import type { PortableRuntimeOptions } from "../types.js"

export const createImportHandler =
    (options: PortableRuntimeOptions) =>
    async (req: PayloadRequest): Promise<Response> => {
        await assertPortableAccess(req, options)

        if (!req.json) {
            throw new APIError("The request body could not be read.", 400)
        }

        let body: unknown

        try {
            body = await req.json()
        } catch {
            throw new APIError("The selected file does not contain valid JSON.", 400)
        }

        const report = await importArchive(req, parseArchive(body), options)

        return Response.json(report, {
            headers: {
                "Cache-Control": "no-store",
            },
        })
    }
