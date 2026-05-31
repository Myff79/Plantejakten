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

Direkte Render-lenke:

https://render.com/deploy?repo=https://github.com/Myff79/Plantejakten

Hvis begge mobilene er på samme Wi-Fi eller samme hotspot, kan dere også bruke lokal server:

1. Kjør `npm start` på Macen.
2. Åpne LAN-adressen som terminalen skriver ut, for eksempel `http://172.x.x.x:8787`, på begge mobiler.
3. Lena velger `Lena`, Thordur velger `Thordur`.

## Funksjoner

- Romkode i URL uten innlogging.
- Sanntidssynk via WebSocket.
- REST-fallback for handlinger.
- Persistens i `data/rooms.json`.
- PWA-manifest og service worker for rask oppstart.
- Wake Lock-knapp på støttede mobiler.
