import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "rooms.json");
const PORT = Number(process.env.PORT || 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const SEED_ITEMS = [
  ["gresk-levkoy", "Gresk levkøy", "Matthiola longipetala ssp. bicornis", "Sommerblomst", 5, 8],
  ["edderkoppblomst", "Edderkoppblomst", "Cleome hassleriana 'Cherry Queen'", "Sommerblomst", 5, 6],
  ["duftnattlys", "Duftnattlys", "Oenothera pallida 'Innocence'", "Sommerblomst", 5, 4],
  ["skogtobakk", "Skogtobakk", "Nicotiana sylvestris 'Only the Lonely'", "Sommerblomst", 5, 4],
  ["amaranthus-revehale", "Amaranthus Revehale", "Amaranthus caudatus 'Red Tails'", "Middels", 3, 2],
  ["asters-sommerasters", "Asters Sommerasters", "Callistephus chinensis", "Middels", 3, 3],
  ["atlasblomst", "Atlasblomst", "Clarkia amoena 'Orange Glory'", "Middels", 3, 3],
  ["duftklinte", "Duftklinte", "Amberboa moschata 'The Bride'", "Middels", 3, 2],
  ["mexicohatt", "Mexicohatt Præriekjegleblomst", "Ratiba columnifera f. pulcherrima", "Middels", 3, 3],
  ["pafuglblomst-big-kiss-white-flame", "Påfuglblomst 'Big Kiss white flame'", "Gazania hybrida 'Big Kiss white flame'", "Middels", 3, 3],
  ["praktsalvie", "Praktsalvie", "Salvia splendens 'Lighthouse Purple'", "Middels", 3, 3],
  ["spansk-flagg", "Spansk Flagg", "Ipomoea lobata 'Exotic love'", "Middels", 3, 2],
  ["trompetblomst", "Trompetblomst", "Salpiglossis sinuata 'Kew Blue'", "Middels", 3, 3],
  ["zinnia-zinderella-red", "Zinnia 'Zinderella Red'", "Zinnia elegans 'Zinderella Red'", "Middels", 3, 4],
  ["zinnia-zahara-starlight-rose", "Zinnia 'Zahara Starlight Rose'", "Zinnia marylandica 'Zahara Starlight Rose'", "Middels", 3, 4],
  ["zinnia-zinderella-lilac", "Zinnia 'Zinderella Lilac'", "Zinnia marylandica 'Zinderella Lilac'", "Middels", 3, 4],
  ["mamma-kjempeverbena", "Kjempeverbena", "Verbena bonariensis 'Vanity'", "Mamma", 1, 1],
  ["mamma-sommerlevkoy", "Sommerlevkøy", "Matthiola incana var. annua 'Hot Cakes Purple'", "Mamma", 1, 2],
  ["mamma-lovemunn-torbay-rock", "Løvemunn 'Torbay Rock'", "Antirrhinum majus 'Torbay Rock'", "Mamma", 1, 2]
].map(([id, name, latin, category, priority, target], index) => ({
  id,
  name,
  latin,
  category,
  priority,
  target,
  count: 0,
  boughtBy: {},
  claimedBy: null,
  note: "",
  order: index
}));

const rooms = new Map();
const socketsByRoom = new Map();
let saveTimer = null;

await loadRooms();

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(data)
  });
  res.end(data);
}

function notFound(res) {
  json(res, 404, { error: "Ikke funnet" });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    let code = "";
    const bytes = randomBytes(6);
    for (let i = 0; i < 6; i += 1) code += alphabet[bytes[i] % alphabet.length];
    if (!rooms.has(code)) return code;
  }
}

function publicRoom(room) {
  normalizeRoom(room);
  const clients = {};
  for (const [id, client] of Object.entries(room.clients || {})) {
    clients[id] = {
      id,
      name: client.name,
      color: client.color,
      online: client.online,
      lastSeen: client.lastSeen
    };
  }
  return {
    code: room.code,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    revision: room.revision,
    items: room.items,
    clients
  };
}

function makeRoom(code = createCode()) {
  const now = new Date().toISOString();
  return {
    code,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    items: structuredClone(SEED_ITEMS),
    clients: {},
    seenTx: []
  };
}

function getRoom(code) {
  const room = rooms.get(String(code || "").toUpperCase());
  if (room) normalizeRoom(room);
  return room;
}

function normalizeRoom(room) {
  room.items ||= [];
  room.clients ||= {};
  room.seenTx ||= [];
  for (const item of room.items) {
    item.boughtBy ||= {};
    item.count = Math.max(0, Number(item.count || 0));
    item.target = Math.max(0, Number(item.target || 0));
    item.priority = Math.max(1, Number(item.priority || 1));
  }
}

function touch(room) {
  room.revision += 1;
  room.updatedAt = new Date().toISOString();
  scheduleSave();
}

function applyAction(room, action) {
  if (!action || typeof action !== "object") throw new Error("Ugyldig handling");
  if (!action.txId) action.txId = `${Date.now()}-${Math.random()}`;
  if (room.seenTx.includes(action.txId)) return false;

  const item = room.items.find((entry) => entry.id === action.itemId);
  if (!item) throw new Error("Planten finnes ikke");

  const actor = {
    id: String(action.actor?.id || "unknown"),
    name: String(action.actor?.name || "Ukjent"),
    color: String(action.actor?.color || "#2563eb")
  };

  if (action.type === "increment") {
    item.count = Math.min(99, item.count + 1);
    item.boughtBy[actor.id] = Math.min(99, Number(item.boughtBy[actor.id] || 0) + 1);
  } else if (action.type === "decrement") {
    if (item.boughtBy[actor.id] > 0) {
      item.boughtBy[actor.id] -= 1;
    } else {
      const fallbackId = Object.entries(item.boughtBy).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (fallbackId) item.boughtBy[fallbackId] = Math.max(0, item.boughtBy[fallbackId] - 1);
    }
    item.count = Math.max(0, Object.values(item.boughtBy).reduce((sum, count) => sum + Number(count || 0), 0));
  } else if (action.type === "claim") {
    item.claimedBy = actor;
  } else if (action.type === "release") {
    item.claimedBy = null;
  } else if (action.type === "setTarget") {
    item.target = Math.max(0, Math.min(99, Number(action.target || 0)));
  } else if (action.type === "setNote") {
    item.note = String(action.note || "").slice(0, 80);
  } else {
    throw new Error("Ukjent handling");
  }

  room.seenTx.push(action.txId);
  room.seenTx = room.seenTx.slice(-500);
  touch(room);
  return true;
}

async function loadRooms() {
  if (!existsSync(DATA_FILE)) return;
  const raw = await readFile(DATA_FILE, "utf8");
  const saved = JSON.parse(raw);
  for (const room of saved.rooms || []) {
    for (const client of Object.values(room.clients || {})) client.online = false;
    rooms.set(room.code, room);
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveRooms, 150);
}

async function saveRooms() {
  await mkdir(DATA_DIR, { recursive: true });
  const payload = { rooms: [...rooms.values()] };
  await writeFile(DATA_FILE, JSON.stringify(payload, null, 2));
}

function broadcast(room, payload) {
  const sockets = socketsByRoom.get(room.code);
  if (!sockets) return;
  const message = JSON.stringify(payload);
  for (const socket of sockets) {
    if (!socket.destroyed) sendWs(socket, message);
  }
}

function upsertClient(room, client) {
  const id = String(client.id || "");
  if (!id) return;
  room.clients[id] = {
    id,
    name: String(client.name || "Handler").slice(0, 24),
    color: String(client.color || "#2563eb").slice(0, 24),
    online: Boolean(client.online),
    lastSeen: new Date().toISOString()
  };
  touch(room);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, rooms: rooms.size });
    }

    if (req.method === "POST" && url.pathname === "/api/rooms") {
      const room = makeRoom();
      rooms.set(room.code, room);
      scheduleSave();
      return json(res, 201, { room: publicRoom(room), url: `/r/${room.code}` });
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{4,10})(?:\/actions)?$/i);
    if (roomMatch) {
      const room = getRoom(roomMatch[1]);
      if (!room) return notFound(res);
      if (req.method === "GET" && !url.pathname.endsWith("/actions")) {
        return json(res, 200, { room: publicRoom(room) });
      }
      if (req.method === "POST" && url.pathname.endsWith("/actions")) {
        const action = await readJson(req);
        applyAction(room, action);
        const snapshot = publicRoom(room);
        broadcast(room, { type: "snapshot", room: snapshot });
        return json(res, 200, { room: snapshot });
      }
    }

    if (req.method === "GET") return serveStatic(url.pathname, res);
    notFound(res);
  } catch (error) {
    json(res, 400, { error: error.message || "Ukjent feil" });
  }
});

function serveStatic(urlPath, res) {
  let pathname = decodeURIComponent(urlPath);
  if (pathname === "/" || pathname.startsWith("/r/")) pathname = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR) || !existsSync(filePath)) {
    return notFound(res);
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=86400"
  });
  createReadStream(filePath).pipe(res);
}

server.on("upgrade", (req, socket) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = url.pathname.match(/^\/ws\/([A-Z0-9]{4,10})$/i);
    const room = match && getRoom(match[1]);
    if (!room) return socket.destroy();

    const key = req.headers["sec-websocket-key"];
    if (!key) return socket.destroy();
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      ""
    ].join("\r\n"));

    const client = {
      id: url.searchParams.get("clientId"),
      name: url.searchParams.get("name"),
      color: url.searchParams.get("color"),
      online: true
    };
    socket.roomCode = room.code;
    socket.clientId = client.id;
    upsertClient(room, client);
    if (!socketsByRoom.has(room.code)) socketsByRoom.set(room.code, new Set());
    socketsByRoom.get(room.code).add(socket);

    sendWs(socket, JSON.stringify({ type: "snapshot", room: publicRoom(room) }));
    broadcast(room, { type: "presence", room: publicRoom(room) });

    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const frame = readWsFrame(buffer);
        if (!frame) break;
        buffer = buffer.subarray(frame.bytes);
        if (frame.opcode === 8) return socket.end();
        if (frame.opcode === 9) return sendWs(socket, frame.payload, 10);
        if (frame.opcode !== 1) continue;
        const message = JSON.parse(frame.payload.toString("utf8"));
        if (message.type === "ping") {
          sendWs(socket, JSON.stringify({ type: "pong", at: Date.now() }));
          continue;
        }
        if (message.type === "hello") {
          upsertClient(room, { ...message.client, online: true });
          broadcast(room, { type: "presence", room: publicRoom(room) });
          continue;
        }
        if (message.type === "action") {
          applyAction(room, message.action);
          broadcast(room, { type: "snapshot", room: publicRoom(room) });
        }
      }
    });

    socket.on("close", () => markOffline(socket));
    socket.on("end", () => markOffline(socket));
    socket.on("error", () => markOffline(socket));
  } catch {
    socket.destroy();
  }
});

function markOffline(socket) {
  const room = getRoom(socket.roomCode);
  if (!room) return;
  socketsByRoom.get(room.code)?.delete(socket);
  const client = room.clients?.[socket.clientId];
  if (client) {
    client.online = false;
    client.lastSeen = new Date().toISOString();
    touch(room);
    broadcast(room, { type: "presence", room: publicRoom(room) });
  }
}

function readWsFrame(buffer) {
  if (buffer.length < 2) return null;
  const first = buffer[0];
  const second = buffer[1];
  const opcode = first & 0x0f;
  const masked = Boolean(second & 0x80);
  let length = second & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const high = buffer.readUInt32BE(2);
    if (high !== 0) throw new Error("For stor websocket-melding");
    length = buffer.readUInt32BE(6);
    offset = 10;
  }
  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload, bytes: offset + length };
}

function sendWs(socket, payload, opcode = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(data.length, 6);
  }
  socket.write(Buffer.concat([header, data]));
}

server.listen(PORT, "0.0.0.0", () => {
  const urls = [`http://localhost:${PORT}`];
  for (const details of Object.values(os.networkInterfaces())) {
    for (const net of details || []) {
      if (net.family === "IPv4" && !net.internal) urls.push(`http://${net.address}:${PORT}`);
    }
  }
  console.log(`Plantejakten kjører på:\n${urls.map((url) => `  ${url}`).join("\n")}`);
});

process.on("SIGINT", async () => {
  await saveRooms();
  process.exit(0);
});
