"use client"

import { Button, useConfig } from "@payloadcms/ui"
import { formatAdminURL } from "payload/shared"
import { type ChangeEvent, useRef, useState } from "react"

import type { PortableImportReport } from "../types.js"
import styles from "./PortableDashboard.module.css"

type Action = "export" | "import"

const getErrorMessage = async (response: Response): Promise<string> => {
    try {
        const result = (await response.json()) as { errors?: Array<{ message?: string }>; message?: string }
        return result.message ?? result.errors?.[0]?.message ?? `Request failed (${response.status}).`
    } catch {
        return `Request failed (${response.status}).`
    }
}

export const PortableDashboard = () => {
    const { config } = useConfig()
    const fileInput = useRef<HTMLInputElement>(null)
    const [activeAction, setActiveAction] = useState<Action>()
    const [status, setStatus] = useState<string>()

    const endpoint = (path: `/${string}`) =>
        formatAdminURL({
            apiRoute: config.routes.api,
            path,
        })

    const handleExport = async () => {
        setActiveAction("export")
        setStatus(undefined)

        try {
            const response = await fetch(endpoint("/portable/export"), {
                credentials: "same-origin",
            })

            if (!response.ok) {
                throw new Error(await getErrorMessage(response))
            }

            const blob = await response.blob()
            const disposition = response.headers.get("Content-Disposition")
            const filename = disposition?.match(/filename="([^"]+)"/)?.[1] ?? "payload-export.json"
            const url = URL.createObjectURL(blob)
            const link = document.createElement("a")
            link.href = url
            link.download = filename
            link.click()
            URL.revokeObjectURL(url)
            setStatus("Export completed.")
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Export failed.")
        } finally {
            setActiveAction(undefined)
        }
    }

    const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        event.target.value = ""

        if (!file) {
            return
        }

        setActiveAction("import")
        setStatus(undefined)

        try {
            const archive = JSON.parse(await file.text()) as unknown
            const response = await fetch(endpoint("/portable/import"), {
                body: JSON.stringify(archive),
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                },
                method: "POST",
            })

            if (!response.ok) {
                throw new Error(await getErrorMessage(response))
            }

            const report = (await response.json()) as PortableImportReport
            const changes = report.collections.created + report.collections.updated
            const firstError = report.errors[0]
            const errorSuffix = firstError ? ` ${report.errors.length} item(s) failed. First error (${firstError.entity}): ${firstError.message}` : ""
            setStatus(`${changes} collection document(s) and ${report.globals.updated} global(s) imported.${errorSuffix}`)
        } catch (error) {
            setStatus(error instanceof Error ? error.message : "Import failed.")
        } finally {
            setActiveAction(undefined)
        }
    }

    return (
        <section className={styles.card}>
            <div>
                <h2 className={styles.heading}>Portable content</h2>
                <p className={styles.description}>Export or restore all configured collections and globals as one JSON file.</p>
            </div>
            <div className={styles.actions}>
                <Button buttonStyle="primary" disabled={Boolean(activeAction)} margin={false} onClick={() => void handleExport()} size="medium">
                    {activeAction === "export" ? "Exporting…" : "Export everything"}
                </Button>
                <Button buttonStyle="secondary" disabled={Boolean(activeAction)} margin={false} onClick={() => fileInput.current?.click()} size="medium">
                    {activeAction === "import" ? "Importing…" : "Import everything"}
                </Button>
                <input
                    ref={fileInput}
                    accept="application/json,.json"
                    className={styles.fileInput}
                    onChange={(event) => void handleImport(event)}
                    type="file"
                />
            </div>
            {status ? (
                <p aria-live="polite" className={styles.status}>
                    {status}
                </p>
            ) : null}
        </section>
    )
}
