# Payload Portable Plugin

Exportiert alle konfigurierten Payload-Collections und Globals über Aktionen in der Admin-Kopfzeile in eine einzige JSON-Datei und importiert sie später wieder.

## Verwendung

```ts
import { postgresAdapter } from "@payloadcms/db-postgres"
import { payloadPortablePlugin } from "@mvriu5/payload-portable-plugin"

export default buildConfig({
    db: postgresAdapter({
        allowIDOnCreate: true,
        pool: {
            connectionString: process.env.DATABASE_URL!,
        },
    }),
    plugins: [payloadPortablePlugin()],
})
```

In der Admin-Kopfzeile stehen anschließend **Import** und **Export** zur Verfügung. In der Listenansicht jeder eingebundenen Collection erscheinen dieselben Aktionen neben **Create New** und arbeiten dort ausschließlich mit dieser Collection. Der Import arbeitet als Upsert anhand der Dokument-ID: vorhandene Datensätze werden aktualisiert, fehlende angelegt. Es werden keine Datensätze gelöscht. Lokalisierte Inhalte werden für alle konfigurierten Sprachen übertragen.

Alle Endpunkte verlangen standardmäßig einen angemeldeten Benutzer. Zusätzlich erzwingt jede einzelne Lese- und Schreiboperation die Access-Control-Regeln der jeweiligen Collection bzw. des Globals.

`allowIDOnCreate: true` ist für den Datenbankadapter erforderlich, damit fehlende Dokumente mit ihrer ursprünglichen ID angelegt werden und Beziehungsreferenzen gültig bleiben. Ist die Option nicht aktiv, aktualisiert der Import vorhandene Dokumente, weist neue Dokumente jedoch mit einem klaren Fehler zurück.

## Optionen

```ts
payloadPortablePlugin({
    batchSize: 250,
    excludeCollections: ["payload-preferences"],
    excludeGlobals: ["internal-settings"],
    access: ({ req }) => req.user?.roles?.includes("admin") === true,
})
```

- `access`: zusätzliche Berechtigungsprüfung; standardmäßig ist jeder angemeldete Benutzer zugelassen
- `batchSize`: Größe der Exportseiten, standardmäßig `100`, maximal `1000`
- `excludeCollections` / `excludeGlobals`: Slugs, die in beiden Richtungen übersprungen werden
- `disabled`: deaktiviert die Kopfzeilenaktionen und Endpunkte

## Hinweise

Das Archiv enthält Collection-Dokumente und Global-Daten einschließlich Beziehungs- und Upload-Referenzen. Binärdateien aus Upload-Collections sowie geheime, von Payload ausgeblendete Authentifizierungsdaten werden nicht eingebettet. Hooks, Validierung und Access Control laufen beim Import regulär; Schemaunterschiede werden deshalb pro Datensatz im Importbericht ausgewiesen.
