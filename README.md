# Plantejakten

Mobil webapp for en delt plantemarked-handleliste. Én Node-prosess server statiske filer, REST og WebSocket fra samme origin.

## Kjør lokalt

```sh
npm start
```

Åpne `http://localhost:8787` på maskinen, eller LAN-adressen som skrives ut i terminalen på mobilene.

## Rask publisering med sanntid

GitHub Pages kan ikke kjøre WebSocket-serveren. For at Lena og Thordur skal se kjøp i sanntid, publiser repoet som en Node web service på Render eller Railway.

Anbefalt rask vei:

1. Push dette repoet til GitHub.
2. Opprett en Web Service på Render fra repoet.
3. Bruk `npm install` som build command og `npm start` som start command.
4. Åpne Render-URL-en på begge mobiler.

## Funksjoner

- Romkode i URL uten innlogging.
- Sanntidssynk via WebSocket.
- REST-fallback for handlinger.
- Persistens i `data/rooms.json`.
- PWA-manifest og service worker for rask oppstart.
- Wake Lock-knapp på støttede mobiler.
