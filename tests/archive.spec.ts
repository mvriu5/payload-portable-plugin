import { describe, expect, it, vi } from "vitest"
import type { Config } from "payload"

import { createArchive, importArchive, parseArchive } from "../src/archive.js"
import { payloadPortablePlugin } from "../src/index.js"
import { DEFAULT_LOCALE_KEY, PORTABLE_FORMAT, PORTABLE_VERSION, type PortableArchive } from "../src/types.js"

const options = {
    batchSize: 1,
    excludeCollections: new Set<string>(),
    excludeGlobals: new Set<string>(),
}

describe("payloadPortablePlugin", () => {
    it("adds endpoints and the dashboard component without replacing existing config", () => {
        const existingEndpoint = { handler: vi.fn(), method: "get" as const, path: "/existing" }
        const incomingConfig = {
            admin: { components: { beforeDashboard: ["existing#Component"] } },
            collections: [],
            endpoints: [existingEndpoint],
        } as unknown as Config
        const config = payloadPortablePlugin({})(incomingConfig)

        expect(config.endpoints?.map(({ path }) => path)).toEqual(["/existing", "/portable/export", "/portable/import"])
        expect(config.admin?.components?.beforeDashboard).toEqual(["existing#Component", "@mvriu5/payload-portable-plugin/client#PortableDashboard"])
    })

    it("does not change the config when disabled", () => {
        const config = { collections: [] } as unknown as Config
        expect(payloadPortablePlugin({ disabled: true })(config)).toBe(config)
    })
})

describe("portable archives", () => {
    it("exports every collection page and global with depth zero", async () => {
        const find = vi
            .fn()
            .mockResolvedValueOnce({ docs: [{ id: "one", relation: "two" }], hasNextPage: true })
            .mockResolvedValueOnce({ docs: [{ id: "two", relation: "one" }], hasNextPage: false })
        const findGlobal = vi.fn().mockResolvedValue({ id: "settings", title: "Site" })
        const req = {
            payload: {
                config: {
                    collections: [{ slug: "posts" }],
                    globals: [{ slug: "settings" }],
                    localization: false,
                },
                find,
                findGlobal,
            },
            user: { id: "admin" },
        } as any

        const archive = await createArchive(req, options)

        expect(archive.collections.posts[DEFAULT_LOCALE_KEY]).toHaveLength(2)
        expect(archive.globals.settings[DEFAULT_LOCALE_KEY]).toMatchObject({ title: "Site" })
        expect(find).toHaveBeenNthCalledWith(1, expect.objectContaining({ collection: "posts", depth: 0, overrideAccess: false, page: 1 }))
        expect(find).toHaveBeenNthCalledWith(2, expect.objectContaining({ collection: "posts", depth: 0, overrideAccess: false, page: 2 }))
    })

    it("upserts documents, updates globals, and reports schema mismatches", async () => {
        const create = vi.fn().mockResolvedValue({})
        const update = vi.fn().mockResolvedValue({})
        const updateGlobal = vi.fn().mockResolvedValue({})
        const find = vi.fn(async ({ where }: any) => ({
            docs: where.id.equals === "existing" ? [{ id: "existing" }] : [],
        }))
        const req = {
            payload: {
                config: {
                    collections: [{ slug: "posts" }],
                    globals: [{ slug: "settings" }],
                    localization: false,
                },
                db: { allowIDOnCreate: true },
                create,
                find,
                update,
                updateGlobal,
            },
            user: { id: "admin" },
        } as any
        const archive: PortableArchive = {
            collections: {
                missing: { [DEFAULT_LOCALE_KEY]: [{ id: "unknown" }] },
                posts: {
                    [DEFAULT_LOCALE_KEY]: [
                        { createdAt: "old", id: "existing", title: "Updated" },
                        { id: "new", title: "Created", updatedAt: "old" },
                    ],
                },
            },
            exportedAt: new Date().toISOString(),
            format: PORTABLE_FORMAT,
            globals: {
                settings: { [DEFAULT_LOCALE_KEY]: { id: "settings", title: "Imported" } },
            },
            version: PORTABLE_VERSION,
        }

        const report = await importArchive(req, archive, options)

        expect(report.collections).toEqual({ created: 1, updated: 1 })
        expect(report.globals.updated).toBe(1)
        expect(report.errors).toHaveLength(1)
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { title: "Updated" }, id: "existing", overrideAccess: false }))
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: { id: "new", title: "Created" }, overrideAccess: false }))
        expect(updateGlobal).toHaveBeenCalledWith(expect.objectContaining({ data: { title: "Imported" }, slug: "settings" }))
    })

    it("rejects unsupported JSON before importing anything", () => {
        expect(() => parseArchive({ format: "something-else", version: 1 })).toThrow("not a supported Payload Portable export")
    })
})
