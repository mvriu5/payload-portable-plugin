import type { PayloadRequest } from "payload"

import { assertPortableAccess, createArchive } from "../archive.js"
import type { PortableRuntimeOptions } from "../types.js"

export const createExportHandler =
    (options: PortableRuntimeOptions) =>
    async (req: PayloadRequest): Promise<Response> => {
        await assertPortableAccess(req, options)

        const archive = await createArchive(req, options)
        const date = archive.exportedAt.slice(0, 10)

        return new Response(JSON.stringify(archive, null, 2), {
            headers: {
                "Cache-Control": "no-store",
                "Content-Disposition": `attachment; filename="payload-export-${date}.json"`,
                "Content-Type": "application/json; charset=utf-8",
            },
        })
    }
