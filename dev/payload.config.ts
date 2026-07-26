import { postgresAdapter } from "@payloadcms/db-postgres"
import path from "path"
import { buildConfig } from "payload"
import { fileURLToPath } from "url"
import { payloadPortablePlugin } from "../src/index.js"

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
    admin: {
        importMap: {
            baseDir: path.resolve(dirname),
        },
        user: "users",
    },
    collections: [
        {
            slug: "users",
            auth: true,
            fields: [],
        },
        {
            slug: "posts",
            fields: [
                {
                    name: "title",
                    type: "text",
                    required: true,
                },
            ],
        },
    ],
    db: postgresAdapter({
        allowIDOnCreate: true,
        pool: {
            connectionString: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/payload",
        },
    }),
    globals: [
        {
            slug: "settings",
            fields: [
                {
                    name: "siteName",
                    type: "text",
                },
            ],
        },
    ],
    plugins: [payloadPortablePlugin({ access: () => true })],
    secret: process.env.PAYLOAD_SECRET ?? "dev-secret",
    typescript: {
        outputFile: path.resolve(dirname, "payload-types.ts"),
    },
})
