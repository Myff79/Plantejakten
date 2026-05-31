const PLAYERS = [
  { id: "lena", name: "Lena", color: "#17633d", label: "Player 1" },
  { id: "thordur", name: "Thordur", color: "#2563eb", label: "Player 2" }
];
const COLORS = ["#17633d", "#2563eb", "#c2410c", "#7c3aed", "#be123c", "#0f766e"];
const state = {
  room: null,
  filter: "remaining",
  query: "",
  connected: false,
  ws: null,
  reconnectTimer: null,
  pending: loadJson("plantejakten-pending", []),
  wakeLock: null,
  identity: loadJson("plantejakten-identity", null) || makeIdentity()
};

const app = document.querySelector("#app");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

window.addEventListener("online", () => {
  if (state.room) connectWs();
});

window.addEventListener("beforeunload", () => {
  state.ws?.close();
});

render();
route();

function route() {
  const match = location.pathname.match(/^\/r\/([A-Z0-9]{4,10})$/i);
  if (match) {
    openRoom(match[1].toUpperCase());
  }
}

function makeIdentity() {
  const identity = {
    id: "",
    name: "",
    color: PLAYERS[0].color
  };
  saveJson("plantejakten-identity", identity);
  return identity;
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function createRoom() {
  const response = await fetch("/api/rooms", { method: "POST" });
  const data = await response.json();
  history.pushState(null, "", data.url);
  state.room = data.room;
  render();
  connectWs();
}

async function joinRoom(code) {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return;
  history.pushState(null, "", `/r/${normalized}`);
  await openRoom(normalized);
}

async function openRoom(code) {
  try {
    const response = await fetch(`/api/rooms/${code}`);
    if (!response.ok) throw new Error("Rommet finnes ikke");
    const data = await response.json();
    state.room = data.room;
    render();
    connectWs();
  } catch {
    app.innerHTML = homeTemplate("Fant ikke handleturen. Sjekk koden og prøv igjen.");
    bindHome();
  }
}

function connectWs() {
  if (!state.room) return;
  if (!state.identity.id || !state.identity.name) {
    showIdentity();
    return;
  }
  clearTimeout(state.reconnectTimer);
  if (state.ws && [WebSocket.OPEN, WebSocket.CONNECTING].includes(state.ws.readyState)) return;

  const params = new URLSearchParams({
    clientId: state.identity.id,
    name: state.identity.name || "Handler",
    color: state.identity.color
  });
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${protocol}://${location.host}/ws/${state.room.code}?${params}`);
  state.ws = ws;

  ws.addEventListener("open", () => {
    state.connected = true;
    ws.send(JSON.stringify({ type: "hello", client: { ...state.identity, online: true } }));
    flushPending();
    render();
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.room) {
      state.room = message.room;
      render();
    }
  });
  ws.addEventListener("close", () => {
    state.connected = false;
    render();
    state.reconnectTimer = setTimeout(connectWs, 900);
  });
  ws.addEventListener("error", () => {
    state.connected = false;
    ws.close();
  });
}

function sendAction(action) {
  if (!state.room) return;
  const fullAction = {
    ...action,
    txId: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    actor: {
      id: state.identity.id,
      name: state.identity.name || "Handler",
      color: state.identity.color
    }
  };

  applyOptimistic(fullAction);

  if (state.ws?.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type: "action", action: fullAction }));
  } else {
    state.pending.push(fullAction);
    saveJson("plantejakten-pending", state.pending);
    fetch(`/api/rooms/${state.room.code}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fullAction)
    }).catch(() => {});
  }
}

function flushPending() {
  if (!state.pending.length || state.ws?.readyState !== WebSocket.OPEN) return;
  for (const action of state.pending) {
    state.ws.send(JSON.stringify({ type: "action", action }));
  }
  state.pending = [];
  saveJson("plantejakten-pending", state.pending);
}

function applyOptimistic(action) {
  const item = state.room?.items.find((entry) => entry.id === action.itemId);
  if (!item) return;
  item.boughtBy ||= {};
  if (action.type === "increment") {
    item.count = Math.min(99, item.count + 1);
    item.boughtBy[action.actor.id] = Math.min(99, Number(item.boughtBy[action.actor.id] || 0) + 1);
  }
  if (action.type === "decrement") {
    if (item.boughtBy[action.actor.id] > 0) {
      item.boughtBy[action.actor.id] -= 1;
    } else {
      const fallbackId = Object.entries(item.boughtBy).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (fallbackId) item.boughtBy[fallbackId] = Math.max(0, item.boughtBy[fallbackId] - 1);
    }
    item.count = Math.max(0, Object.values(item.boughtBy).reduce((sum, count) => sum + Number(count || 0), 0));
  }
  if (action.type === "claim") item.claimedBy = action.actor;
  if (action.type === "release") item.claimedBy = null;
  if (action.type === "setTarget") item.target = Math.max(0, Math.min(99, Number(action.target || 0)));
  render();
}

function render() {
  if (!state.room) {
    app.innerHTML = homeTemplate();
    bindHome();
    return;
  }

  const items = visibleItems();
  const totalTarget = state.room.items.reduce((sum, item) => sum + item.target, 0);
  const totalCount = state.room.items.reduce((sum, item) => sum + Math.min(item.count, item.target), 0);
  const doneItems = state.room.items.filter((item) => item.count >= item.target).length;
  const percent = totalTarget ? Math.round((totalCount / totalTarget) * 100) : 100;
  const clients = Object.values(state.room.clients || {}).sort((a, b) => Number(b.online) - Number(a.online));
  const playerTotals = totalsByPlayer();
  const hotItems = priorityItems();

  app.innerHTML = `
    <main class="shell">
      <section class="app-view">
        <header class="topbar">
          <div class="topline">
            <div class="title-block">
              <h1 class="app-title">Plantejakten</h1>
              <p class="status">${state.connected ? "Direkte" : "Kobler til igjen"} · Rom ${state.room.code}</p>
            </div>
            <button class="icon-button" data-action="identity" aria-label="Profil">●</button>
          </div>
          <div class="toolbar">
            <input class="search" data-action="search" value="${escapeHtml(state.query)}" placeholder="Søk plante">
            <button class="small-button" data-action="share">Del</button>
            <button class="icon-button" data-action="wake" aria-label="Hold skjermen våken">${state.wakeLock ? "☀" : "◐"}</button>
          </div>
        </header>

        <section class="progress-card">
          <div class="progress-line">
            <span>${totalCount}/${totalTarget} sikret</span>
            <span>${doneItems}/${state.room.items.length} ferdige</span>
          </div>
          <div class="bar"><span style="width:${percent}%"></span></div>
          <div class="avatars">
            ${PLAYERS.map((player) => {
              const client = clients.find((entry) => entry.id === player.id);
              return `
              <span class="avatar" title="${client?.online ? "Pålogget" : "Frakoblet"}">
                <span class="dot" style="background:${escapeHtml(player.color)}; opacity:${client?.online ? 1 : .35}"></span>
                ${player.name}: ${playerTotals[player.id] || 0}
              </span>
            `}).join("")}
          </div>
        </section>

        ${hotItems.length ? `
          <section class="priority-strip" aria-label="Viktigst nå">
            <div class="strip-title">Viktigst nå</div>
            <div class="priority-grid">
              ${hotItems.map((item) => `
                <button class="priority-chip" data-jump="${item.id}">
                  <span>${escapeHtml(item.name)}</span>
                  <strong>${item.count}/${item.target}</strong>
                </button>
              `).join("")}
            </div>
          </section>
        ` : ""}

        <nav class="filters" aria-label="Filter">
          <button class="${state.filter === "remaining" ? "active" : ""}" data-filter="remaining">Gjenstår</button>
          <button class="${state.filter === "done" ? "active" : ""}" data-filter="done">Ferdig</button>
          <button class="${state.filter === "all" ? "active" : ""}" data-filter="all">Alle</button>
        </nav>

        <section class="list">
          ${items.length ? items.map(itemTemplate).join("") : `<div class="empty">Ingen planter her akkurat nå.</div>`}
        </section>
      </section>
    </main>
  `;
  bindApp();
  if (!state.identity.name) showIdentity();
}

function totalsByPlayer() {
  const totals = Object.fromEntries(PLAYERS.map((player) => [player.id, 0]));
  for (const item of state.room.items) {
    for (const [id, count] of Object.entries(item.boughtBy || {})) {
      totals[id] = (totals[id] || 0) + Number(count || 0);
    }
  }
  return totals;
}

function priorityItems() {
  return [...state.room.items]
    .filter((item) => item.count < item.target)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return (b.target - b.count) - (a.target - a.count);
    })
    .slice(0, 3);
}

function visibleItems() {
  const query = state.query.trim().toLowerCase();
  return [...state.room.items]
    .filter((item) => {
      const done = item.count >= item.target;
      if (state.filter === "remaining" && done) return false;
      if (state.filter === "done" && !done) return false;
      if (!query) return true;
      return `${item.name} ${item.latin} ${item.category}`.toLowerCase().includes(query);
    })
    .sort((a, b) => {
      const aDone = a.count >= a.target;
      const bDone = b.count >= b.target;
      if (aDone !== bDone) return Number(aDone) - Number(bDone);
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.order - b.order;
    });
}

function itemTemplate(item) {
  const done = item.count >= item.target;
  const mine = item.claimedBy?.id === state.identity.id;
  const claimed = Boolean(item.claimedBy);
  const buyers = buyerChips(item);
  const claimText = claimed
    ? `<span class="claim-name">${escapeHtml(item.claimedBy.name)}</span> er på vei`
    : "Ingen er på vei";
  return `
    <article class="item ${done ? "done" : ""} ${claimed ? "claimed" : ""}" data-card="${item.id}" style="--claim:${escapeHtml(item.claimedBy?.color || state.identity.color)}">
      <div class="item-head">
        <div>
          <div class="plant-name">${escapeHtml(item.name)}</div>
          <div class="latin">${escapeHtml(item.latin)}</div>
          <div class="meta">
            <span class="pill">${escapeHtml(item.category)}</span>
            <span class="pill ${item.priority >= 4 ? "hot" : ""}">Prioritet ${item.priority}</span>
          </div>
        </div>
        <div>
          <div class="counter">${item.count}/${item.target}</div>
          <div class="target-row">
            <button data-action="target-down" data-id="${item.id}" aria-label="Senk mål">−</button>
            <button data-action="target-up" data-id="${item.id}" aria-label="Øk mål">+</button>
          </div>
        </div>
      </div>
      <div class="claim-line">${claimText}</div>
      ${buyers ? `<div class="buyer-line">${buyers}</div>` : ""}
      <div class="item-actions">
        <button class="claim-btn ${mine ? "active" : ""}" data-action="${mine ? "release" : "claim"}" data-id="${item.id}">
          ${mine ? "Slipp" : "Jeg tar denne"}
        </button>
        <button class="plus-btn" data-action="increment" data-id="${item.id}" aria-label="Legg til én">+1</button>
        <button class="minus-btn" data-action="decrement" data-id="${item.id}" aria-label="Trekk fra én">−</button>
      </div>
    </article>
  `;
}

function buyerChips(item) {
  return PLAYERS
    .map((player) => {
      const count = Number(item.boughtBy?.[player.id] || 0);
      if (!count) return "";
      return `<span class="buyer-chip" style="--buyer:${player.color}">${player.name} +${count}</span>`;
    })
    .join("");
}

function bindHome() {
  app.querySelector("[data-action='create']")?.addEventListener("click", createRoom);
  app.querySelector("[data-action='join']")?.addEventListener("click", () => {
    joinRoom(app.querySelector("[data-code]").value);
  });
  app.querySelector("[data-code]")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") joinRoom(event.currentTarget.value);
  });
}

function bindApp() {
  app.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      render();
    });
  });
  app.querySelector("[data-action='search']").addEventListener("input", (event) => {
    state.query = event.currentTarget.value;
    render();
  });
  app.querySelector("[data-action='share']").addEventListener("click", showShare);
  app.querySelector("[data-action='identity']").addEventListener("click", showIdentity);
  app.querySelector("[data-action='wake']").addEventListener("click", toggleWakeLock);
  app.querySelectorAll("[data-jump]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelector(`[data-card="${button.dataset.jump}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
  app.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = state.room.items.find((entry) => entry.id === button.dataset.id);
      const type = button.dataset.action;
      if (type === "target-up") return sendAction({ type: "setTarget", itemId: item.id, target: item.target + 1 });
      if (type === "target-down") return sendAction({ type: "setTarget", itemId: item.id, target: item.target - 1 });
      sendAction({ type, itemId: item.id });
    });
  });
}

function homeTemplate(error = "") {
  return `
    <main class="shell">
      <section class="home">
        <div class="brand">
          <div class="brand-mark">P</div>
          <h1>Plantejakten</h1>
          <p class="lead">Delt handleliste for plantemarkedet. Én trykker +1, alle ser det med en gang.</p>
        </div>
        ${error ? `<p class="lead" role="alert">${escapeHtml(error)}</p>` : ""}
        <div class="home-actions">
          <button class="primary" data-action="create">Ny handletur</button>
          <div class="join-row">
            <input class="input" data-code placeholder="Romkode" autocomplete="off" autocapitalize="characters">
            <button class="secondary" data-action="join">Bli med</button>
          </div>
        </div>
      </section>
    </main>
  `;
}

function showShare() {
  const url = `${location.origin}/r/${state.room.code}`;
  showModal(`
    <h2>Del handleturen</h2>
    <div class="code-box">${state.room.code}</div>
    <div class="share-link">${escapeHtml(url)}</div>
    <div class="share-actions">
      <button class="primary" data-modal-action="native-share">Del lenke</button>
      <button class="secondary" data-modal-action="copy">Kopier lenke</button>
      <button class="ghost" data-modal-action="close">Lukk</button>
    </div>
  `);
  document.querySelector("[data-modal-action='native-share']").addEventListener("click", async () => {
    if (navigator.share) await navigator.share({ title: "Plantejakten", text: "Bli med på handleturen", url });
    else await navigator.clipboard.writeText(url);
  });
  document.querySelector("[data-modal-action='copy']").addEventListener("click", async () => {
    await navigator.clipboard.writeText(url);
    closeModal();
  });
}

function showIdentity() {
  const name = state.identity.name || "";
  showModal(`
    <h2>Hvem handler?</h2>
    <div class="player-grid">
      ${PLAYERS.map((player) => `
        <button class="player-choice ${state.identity.id === player.id ? "active" : ""}" data-player="${player.id}">
          <span class="dot" style="background:${player.color}"></span>
          <strong>${player.name}</strong>
          <small>${player.label}</small>
        </button>
      `).join("")}
    </div>
    <input class="input" data-name value="${escapeHtml(name)}" placeholder="Navn">
    <div class="color-grid">
      ${COLORS.map((color) => `
        <button class="swatch ${state.identity.color === color ? "active" : ""}" style="--swatch:${color}" data-color="${color}" aria-label="Velg farge"></button>
      `).join("")}
    </div>
    <div class="identity-actions">
      <button class="primary" data-modal-action="save-identity">Klar</button>
    </div>
  `);
  document.querySelectorAll("[data-player]").forEach((button) => {
    button.addEventListener("click", () => {
      const player = PLAYERS.find((entry) => entry.id === button.dataset.player);
      state.identity = { id: player.id, name: player.name, color: player.color };
      saveJson("plantejakten-identity", state.identity);
      showIdentity();
    });
  });
  document.querySelectorAll("[data-color]").forEach((button) => {
    button.addEventListener("click", () => {
      state.identity.color = button.dataset.color;
      saveJson("plantejakten-identity", state.identity);
      showIdentity();
    });
  });
  document.querySelector("[data-modal-action='save-identity']").addEventListener("click", () => {
    const input = document.querySelector("[data-name]");
    const selected = PLAYERS.find((player) => player.name.toLowerCase() === input.value.trim().toLowerCase());
    if (selected) {
      state.identity.id = selected.id;
      state.identity.color = selected.color;
    }
    if (!state.identity.id) state.identity.id = input.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "handler";
    state.identity.name = input.value.trim() || "Handler";
    saveJson("plantejakten-identity", state.identity);
    if (state.ws?.readyState === WebSocket.OPEN) {
      state.ws.send(JSON.stringify({ type: "hello", client: { ...state.identity, online: true } }));
    } else if (state.room) {
      connectWs();
    }
    closeModal();
    render();
  });
}

function showModal(html) {
  closeModal();
  const wrapper = document.createElement("div");
  wrapper.className = "modal-backdrop";
  wrapper.innerHTML = `<section class="modal">${html}</section>`;
  wrapper.addEventListener("click", (event) => {
    if (event.target === wrapper || event.target.dataset.modalAction === "close") closeModal();
  });
  document.body.append(wrapper);
  wrapper.querySelector("input")?.focus();
}

function closeModal() {
  document.querySelector(".modal-backdrop")?.remove();
}

async function toggleWakeLock() {
  try {
    if (state.wakeLock) {
      await state.wakeLock.release();
      state.wakeLock = null;
    } else if ("wakeLock" in navigator) {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
        render();
      });
    }
  } finally {
    render();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
