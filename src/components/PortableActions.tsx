"use client"

import { Button, toast, useConfig, useListDrawerContext } from "@payloadcms/ui"
import { formatAdminURL } from "payload/shared"
import type { BeforeListClientProps } from "payload"
import { type ChangeEvent, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

import type { PortableImportReport } from "../types.js"
import styles from "./PortableActions.module.css"

type Action = "export" | "import"

const getErrorMessage = async (response: Response): Promise<string> => {
    try {
        const result = (await response.json()) as { errors?: Array<{ message?: string }>; message?: string }
        return result.message ?? result.errors?.[0]?.message ?? `Request failed (${response.status}).`
    } catch {
        return `Request failed (${response.status}).`
    }
}

type PortableButtonsProps = {
    collectionSlug?: string
    onImportSuccess?: () => Promise<void> | void
}

const PortableButtons = ({ collectionSlug, onImportSuccess }: PortableButtonsProps) => {
    const { config } = useConfig()
    const fileInput = useRef<HTMLInputElement>(null)
    const [activeAction, setActiveAction] = useState<Action>()

    const endpoint = (path: `/${string}`) =>
        formatAdminURL({
            apiRoute: config.routes.api,
            path,
        })
    const exportPath: `/${string}` = collectionSlug ? `/portable/export/${encodeURIComponent(collectionSlug)}` : "/portable/export"
    const importPath: `/${string}` = collectionSlug ? `/portable/import/${encodeURIComponent(collectionSlug)}` : "/portable/import"

    const handleExport = async () => {
        setActiveAction("export")

        try {
            const response = await fetch(endpoint(exportPath), {
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
            toast.success("Export completed.")
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Export failed.")
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

        try {
            const archive = JSON.parse(await file.text()) as unknown
            const response = await fetch(endpoint(importPath), {
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
            const message = `${changes} collection document(s) and ${report.globals.updated} global(s) imported.${errorSuffix}`

            await onImportSuccess?.()

            if (firstError) {
                toast.error(message)
            } else {
                toast.success(message)
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Import failed.")
        } finally {
            setActiveAction(undefined)
        }
    }

    return (
        <div className={styles.actions}>
            <Button buttonStyle="transparent" disabled={Boolean(activeAction)} margin={false} onClick={() => fileInput.current?.click()} size="small">
                Import
            </Button>
            <Button buttonStyle="transparent" disabled={Boolean(activeAction)} margin={false} onClick={() => void handleExport()} size="small">
                Export
            </Button>
            <input ref={fileInput} accept="application/json,.json" className={styles.fileInput} onChange={(event) => void handleImport(event)} type="file" />
        </div>
    )
}

export const PortableActions = () => <PortableButtons />

export const CollectionPortableActions = ({ collectionSlug }: BeforeListClientProps) => {
    const { isInDrawer, refresh } = useListDrawerContext()
    const marker = useRef<HTMLSpanElement>(null)
    const [target, setTarget] = useState<Element>()

    useEffect(() => {
        if (isInDrawer) {
            setTarget(undefined)
            return
        }

        const collectionList = marker.current?.closest(".collection-list")
        const titleActions = collectionList?.querySelector(".list-header__title-actions")
        const createButton = titleActions?.querySelector(".list-create-new-doc__create-new-button")

        setTarget(createButton ? (titleActions ?? undefined) : undefined)
    }, [isInDrawer])

    return (
        <>
            <span ref={marker} className={styles.portalMarker} />
            {target
                ? createPortal(<PortableButtons collectionSlug={collectionSlug} onImportSuccess={() => refresh(collectionSlug)} />, target)
                : null}
        </>
    )
}
