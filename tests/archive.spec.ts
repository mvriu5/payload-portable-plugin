import { describe, expect, it, vi } from "vitest"
import type { Config } from "payload"

import { createArchive, importArchive, parseArchive } from "../src/archive.js"
import { payloadPortablePlugin } from "../src/index.js"
import { DEFAULT_LOCALE_KEY, PORTABLE_FORMAT, PORTABLE_VERSION, type PortableArchive } from "../src/types.js"

const options = {
    batchSize: 1,
    collections: new Set(["posts"]),
    excludeCollections: new Set<string>(),
    excludeGlobals: new Set<string>(),
    globals: new Set(["settings"]),
    importMode: "merge" as const,
}

describe("payloadPortablePlugin", () => {
    it("adds endpoints and admin actions without replacing existing config", () => {
        const existingEndpoint = { handler: vi.fn(), method: "get" as const, path: "/existing" }
        const incomingConfig = {
            admin: { components: { actions: ["existing#Component"] } },
            collections: [
                {
                    admin: { components: { beforeList: ["existing#BeforeList"] } },
                    fields: [],
                    slug: "posts",
                },
            ],
            endpoints: [existingEndpoint],
        } as unknown as Config
        const config = payloadPortablePlugin({ importMode: "merge" })(incomingConfig)

        expect(config.endpoints?.map(({ path }) => path)).toEqual([
            "/existing",
            "/portable/export",
            "/portable/import",
            "/portable/export/:collection",
            "/portable/import/:collection",
        ])
        expect(config.admin?.components?.actions).toEqual(["existing#Component", "@mvriu5/payload-portable-plugin/client#PortableActions"])
        expect(config.collections?.[0]?.admin?.components?.beforeList).toEqual([
            "existing#BeforeList",
            "@mvriu5/payload-portable-plugin/client#CollectionPortableActions",
        ])
    })

    it("does not change the config when disabled", () => {
        const config = { collections: [] } as unknown as Config
        expect(payloadPortablePlugin({ disabled: true, importMode: "merge" })(config)).toBe(config)
    })

    it("requires a valid import mode", () => {
        const config = { collections: [] } as unknown as Config
        expect(() => payloadPortablePlugin({} as any)(config)).toThrow("requires importMode")
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
                    collections: [{ slug: "posts" }, { slug: "payload-preferences" }],
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
        expect(archive.collections["payload-preferences"]).toBeUndefined()
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

        expect(report.collections).toEqual({ created: 1, skipped: 0, updated: 1 })
        expect(report.globals).toEqual({ skipped: 0, updated: 1 })
        expect(report.errors).toHaveLength(1)
        expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { title: "Updated" }, id: "existing", overrideAccess: false }))
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: { id: "new", title: "Created" }, overrideAccess: false }))
        expect(updateGlobal).toHaveBeenCalledWith(expect.objectContaining({ data: { title: "Imported" }, slug: "settings" }))
    })

    it("supports add-only and replace-existing import modes", async () => {
        const create = vi.fn().mockResolvedValue({})
        const update = vi.fn().mockResolvedValue({})
        const find = vi.fn(async ({ where }: any) => ({
            docs: where.id.equals === "existing" ? [{ id: "existing" }] : [],
        }))
        const req = {
            payload: {
                config: { collections: [{ slug: "posts" }], globals: [], localization: false },
                db: { allowIDOnCreate: true },
                create,
                find,
                update,
            },
            user: { id: "admin" },
        } as any
        const archive: PortableArchive = {
            collections: {
                posts: {
                    [DEFAULT_LOCALE_KEY]: [
                        { id: "existing", title: "Updated" },
                        { id: "new", title: "Created" },
                    ],
                },
            },
            exportedAt: new Date().toISOString(),
            format: PORTABLE_FORMAT,
            globals: {},
            version: PORTABLE_VERSION,
        }

        const addReport = await importArchive(req, archive, { ...options, importMode: "add" })
        expect(addReport.collections).toEqual({ created: 1, skipped: 1, updated: 0 })
        expect(create).toHaveBeenCalledTimes(1)
        expect(update).not.toHaveBeenCalled()

        create.mockClear()
        const replaceReport = await importArchive(req, archive, { ...options, importMode: "replace" })
        expect(replaceReport.collections).toEqual({ created: 0, skipped: 1, updated: 1 })
        expect(create).not.toHaveBeenCalled()
        expect(update).toHaveBeenCalledTimes(1)
    })

    it("reports missing ID support once and skips affected documents", async () => {
        const req = {
            payload: {
                config: { collections: [{ slug: "posts" }], globals: [], localization: false },
                db: { allowIDOnCreate: false },
                create: vi.fn(),
                find: vi.fn().mockResolvedValue({ docs: [] }),
                update: vi.fn(),
            },
            user: { id: "admin" },
        } as any
        const archive: PortableArchive = {
            collections: { posts: { [DEFAULT_LOCALE_KEY]: [{ id: "one" }, { id: "two" }] } },
            exportedAt: new Date().toISOString(),
            format: PORTABLE_FORMAT,
            globals: {},
            version: PORTABLE_VERSION,
        }

        const report = await importArchive(req, archive, options)

        expect(report.collections).toEqual({ created: 0, skipped: 2, updated: 0 })
        expect(report.errors).toHaveLength(1)
        expect(req.payload.create).not.toHaveBeenCalled()
    })

    it("rejects unsupported JSON before importing anything", () => {
        expect(() => parseArchive({ format: "something-else", version: 1 })).toThrow("not a supported Payload Portable export")
    })
})
