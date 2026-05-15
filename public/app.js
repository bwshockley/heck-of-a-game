const state = {
  roomCode: localStorage.getItem("heck.roomCode") || "",
  playerId: localStorage.getItem("heck.playerId") || "",
  source: null,
  snapshot: null,
  lastTrickKey: "",
  lastRoundSummaryKey: "",
  modalTimer: null
};

const $ = selector => document.querySelector(selector);

const elements = {
  welcome: $("#welcome"),
  game: $("#game"),
  createForm: $("#createForm"),
  joinForm: $("#joinForm"),
  joinTitle: $("#joinTitle"),
  hostName: $("#hostName"),
  joinName: $("#joinName"),
  roomCode: $("#roomCode"),
  startOwn: $("#startOwn"),
  roomTitle: $("#roomTitle"),
  copyLink: $("#copyLink"),
  turnLabel: $("#turnLabel"),
  turnName: $("#turnName"),
  topSuit: $("#topSuit"),
  playerCount: $("#playerCount"),
  tableHint: $("#tableHint"),
  topCard: $("#topCard"),
  tableCards: $("#tableCards"),
  players: $("#players"),
  hand: $("#hand"),
  log: $("#log"),
  startGame: $("#startGame"),
  resetGame: $("#resetGame"),
  bidForm: $("#bidForm"),
  bidAmount: $("#bidAmount"),
  trickModal: $("#trickModal"),
  modalEyebrow: $("#modalEyebrow"),
  modalTitle: $("#modalTitle"),
  roundSummary: $("#roundSummary"),
  toast: $("#toast")
};

const params = new URLSearchParams(location.search);
const linkedRoomCode = normalizeRoomCode(params.get("room"));

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function hostNameFor(room) {
  return room.players.find(player => player.id === room.hostId)?.name || "the host";
}

function latestTrick(room) {
  return room.completedTricks[room.completedTricks.length - 1] || null;
}

function trickKey(trick) {
  if (!trick) return "";
  const firstCard = trick.cards[0];
  const lastCard = trick.cards[trick.cards.length - 1];
  return `${trick.winnerId}:${firstCard?.playedAt || ""}:${lastCard?.playedAt || ""}:${trick.cards.length}`;
}

function roundSummaryKey(room) {
  if (room.phase !== "roundOver" && room.phase !== "gameOver") return "";
  return `${room.round}:${room.phase}:${room.players.map(player => `${player.id}:${player.roundScore}:${player.totalScore}`).join("|")}`;
}

function showInviteJoin(roomCode, hostName) {
  elements.createForm.classList.add("hidden");
  elements.startOwn.classList.remove("hidden");
  elements.roomCode.value = roomCode;
  elements.joinTitle.textContent = `Join the table started by ${hostName}`;
}

function showDefaultWelcome() {
  elements.createForm.classList.remove("hidden");
  elements.startOwn.classList.add("hidden");
  elements.joinTitle.textContent = "Join a Table";
  if (linkedRoomCode) history.replaceState(null, "", location.pathname);
}

async function request(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function clearSession() {
  state.snapshot = null;
  state.roomCode = "";
  state.playerId = "";
  state.lastTrickKey = "";
  state.lastRoundSummaryKey = "";
  hideModal();
  localStorage.removeItem("heck.roomCode");
  localStorage.removeItem("heck.playerId");
}

function saveSession(snapshot) {
  state.snapshot = snapshot;
  state.roomCode = snapshot.room.code;
  state.playerId = snapshot.me.id;
  localStorage.setItem("heck.roomCode", state.roomCode);
  localStorage.setItem("heck.playerId", state.playerId);
}

function connectEvents() {
  if (state.source) state.source.close();
  state.source = new EventSource(`/events?room=${state.roomCode}&player=${state.playerId}`);
  state.source.addEventListener("state", event => {
    state.snapshot = JSON.parse(event.data);
    render();
  });
  state.source.addEventListener("removed", event => {
    const data = JSON.parse(event.data);
    state.source.close();
    clearSession();
    elements.game.classList.add("hidden");
    elements.welcome.classList.remove("hidden");
    toast(data.message || "You were removed from the table.");
  });
  state.source.onerror = () => {
    toast("Connection paused. Reconnecting...");
  };
}

function enterGame(snapshot) {
  saveSession(snapshot);
  state.lastTrickKey = trickKey(latestTrick(snapshot.room));
  state.lastRoundSummaryKey = roundSummaryKey(snapshot.room);
  elements.welcome.classList.add("hidden");
  elements.game.classList.remove("hidden");
  connectEvents();
  render();
}

function showTrickModal(trick) {
  if (!trick) return;
  elements.modalEyebrow.textContent = "Trick won by";
  elements.modalTitle.textContent = trick.winnerName;
  elements.roundSummary.classList.add("hidden");
  elements.roundSummary.innerHTML = "";
  elements.trickModal.classList.remove("hidden");
  clearTimeout(state.modalTimer);
  state.modalTimer = setTimeout(hideModal, 3000);
}

function hideModal() {
  clearTimeout(state.modalTimer);
  state.modalTimer = null;
  elements.trickModal.classList.add("hidden");
}

function maybeShowTrickWinner(room) {
  const trick = latestTrick(room);
  const key = trickKey(trick);
  if (!key || key === state.lastTrickKey) return;
  state.lastTrickKey = key;
  showTrickModal(trick);
}

function showRoundSummary(room) {
  elements.modalEyebrow.textContent = room.phase === "gameOver" ? "Final scores" : `Round ${room.round} complete`;
  elements.modalTitle.textContent = room.phase === "gameOver" ? "Game Over" : "Round Summary";
  elements.roundSummary.classList.remove("hidden");
  elements.roundSummary.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Player</th>
          <th>Bid</th>
          <th>Tricks</th>
          <th>Round</th>
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${room.players.map(player => `
          <tr>
            <td>${escapeHtml(player.name)}</td>
            <td>${player.bid ?? "--"}</td>
            <td>${player.tricksTaken}</td>
            <td>${player.roundScore > 0 ? "+" : ""}${player.roundScore}</td>
            <td>${player.totalScore}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  elements.trickModal.classList.remove("hidden");
  clearTimeout(state.modalTimer);
  state.modalTimer = setTimeout(hideModal, 8000);
}

function maybeShowRoundSummary(room) {
  const key = roundSummaryKey(room);
  if (!key || key === state.lastRoundSummaryKey) return;
  state.lastRoundSummaryKey = key;
  showRoundSummary(room);
}

async function resumeSession() {
  const savedRoomCode = normalizeRoomCode(state.roomCode);
  const savedPlayerId = state.playerId;
  if (!savedRoomCode || !savedPlayerId) return;
  if (linkedRoomCode && linkedRoomCode !== savedRoomCode) return;

  try {
    const snapshot = await getJson(`/api/rooms/${savedRoomCode}?player=${encodeURIComponent(savedPlayerId)}`);
    history.replaceState(null, "", `?room=${snapshot.room.code}`);
    enterGame(snapshot);
    toast("Reconnected to your table.");
  } catch {
    clearSession();
  }
}

async function loadInviteRoom() {
  if (!linkedRoomCode) return;
  showInviteJoin(linkedRoomCode, "the host");

  try {
    const snapshot = await getJson(`/api/rooms/${linkedRoomCode}`);
    showInviteJoin(snapshot.room.code, hostNameFor(snapshot.room));
  } catch (error) {
    showDefaultWelcome();
    elements.roomCode.value = linkedRoomCode;
    toast(error.message);
  }
}

function currentPlayer(room) {
  return room.players[room.currentTurn] || null;
}

function isMyTurn() {
  const snapshot = state.snapshot;
  if (!snapshot || ["lobby", "roundOver", "gameOver"].includes(snapshot.room.phase)) return false;
  const current = currentPlayer(snapshot.room);
  return current && current.id === snapshot.me.id;
}

function isHost() {
  const snapshot = state.snapshot;
  return snapshot && snapshot.me.id === snapshot.room.hostId;
}

function canPlay(card) {
  const snapshot = state.snapshot;
  if (!snapshot || snapshot.room.phase !== "playing" || !isMyTurn()) return false;
  const leadSuit = snapshot.room.leadSuit;
  if (!leadSuit || card.suit === leadSuit) return true;
  return !snapshot.me.hand.some(candidate => candidate.suit === leadSuit);
}

function phaseLabel(phase) {
  return {
    lobby: "Waiting",
    bidding: "Bidding",
    playing: "Playing",
    roundOver: "Round over",
    gameOver: "Game over"
  }[phase] || "Game";
}

function cardNode(card, options = {}) {
  const node = document.createElement(options.asButton ? "button" : "div");
  node.className = `card ${card.color === "red" ? "red" : ""} ${options.playable ? "playable" : ""}`;
  node.setAttribute("aria-label", card.label);
  node.innerHTML = `
    <span class="rank">${escapeHtml(card.rank)}</span>
    <span class="suit">${escapeHtml(card.suit)}</span>
    ${card.playerName ? `<span class="played-by">${escapeHtml(card.playerName)}</span>` : `<span class="rank">${escapeHtml(card.rank)}</span>`}
  `;
  if (options.asButton) {
    node.type = "button";
    node.disabled = !options.enabled;
    node.addEventListener("click", () => act("play", { cardId: card.id }));
  }
  return node;
}

function renderCards(container, cards, emptyMessage, options = {}) {
  container.innerHTML = "";
  if (!cards.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = emptyMessage;
    container.append(empty);
    return;
  }
  for (const card of cards) {
    const enabled = Boolean(options.playable);
    const playable = enabled ? canPlay(card) : false;
    container.append(cardNode(card, { ...options, enabled, playable }));
  }
}

function renderTop(room) {
  elements.topCard.innerHTML = "";
  if (!room.topCard) {
    elements.topCard.classList.add("hidden");
    elements.topSuit.textContent = "--";
    return;
  }
  elements.topCard.classList.remove("hidden");
  elements.topSuit.textContent = room.topCard.suit;
  const label = document.createElement("span");
  label.textContent = `Top Card - Top Suit ${room.topCard.suit}`;
  elements.topCard.append(label, cardNode(room.topCard));
}

function renderPlayers(room) {
  elements.players.innerHTML = "";
  const current = currentPlayer(room);
  const hostCanRemove = isHost();
  const removalRestartsRound = room.phase === "bidding" || room.phase === "playing";
  for (const player of room.players) {
    const node = document.createElement("div");
    const winner = room.winnerIds && room.winnerIds.includes(player.id);
    node.className = `player-chip ${current && current.id === player.id ? "current" : ""} ${winner ? "winner" : ""}`;
    const dealer = player.id === room.dealerId ? " · Dealer" : "";
    const host = player.id === room.hostId ? " · Host" : "";
    const bid = player.bid === null ? "Bid --" : `Bid ${player.bid}`;
    const crown = winner ? " · Winner" : "";
    node.innerHTML = `
      <strong>${escapeHtml(player.name)}${dealer}${host}${crown}</strong>
      <span class="${player.connected ? "connected" : "offline"}">${player.connected ? "Connected" : "Away"} · ${player.cardCount} cards</span>
      <span>${bid} · Tricks ${player.tricksTaken} · Round ${player.roundScore} · Total ${player.totalScore}</span>
    `;
    if (hostCanRemove && player.id !== state.playerId) {
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "danger small";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        const message = removalRestartsRound
          ? `Remove ${player.name} from this table? The current round will restart for the remaining players.`
          : `Remove ${player.name} from this table?`;
        if (confirm(message)) {
          act("removePlayer", { targetPlayerId: player.id });
        }
      });
      node.append(removeButton);
    }
    elements.players.append(node);
  }
}

function renderLog(room) {
  elements.log.innerHTML = "";
  for (const entry of [...room.log].reverse()) {
    const item = document.createElement("li");
    item.textContent = entry;
    elements.log.append(item);
  }
}

function renderBidForm(room) {
  const show = room.phase === "bidding" && isMyTurn();
  elements.bidForm.classList.toggle("hidden", !show);
  elements.bidAmount.max = room.handSize || 7;
  if (show) {
    const currentValue = Number(elements.bidAmount.value);
    if (!Number.isInteger(currentValue) || currentValue > room.handSize) {
      elements.bidAmount.value = "0";
    }
  }
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const { room, me } = snapshot;
  const current = currentPlayer(room);
  const myTurn = isMyTurn();
  const host = isHost();

  elements.roomTitle.textContent = room.code;
  elements.turnLabel.textContent = myTurn ? "Your turn" : phaseLabel(room.phase);
  elements.turnName.textContent = current ? current.name : "for players";
  elements.playerCount.textContent = room.players.length;

  if (room.phase === "lobby") {
    elements.tableHint.textContent = "Share the room code or link, then the host deals.";
  } else if (room.phase === "bidding") {
    elements.tableHint.textContent = `Round ${room.round}: bid how many tricks you will take.`;
  } else if (room.phase === "playing") {
    elements.tableHint.textContent = room.leadSuit
      ? `Lead suit is ${room.leadSuit}. Follow suit if you can.`
      : "Lead any card to start the trick.";
  } else if (room.phase === "roundOver") {
    elements.tableHint.textContent = "Round complete. The host can deal again.";
  } else {
    const winners = room.players.filter(player => room.winnerIds.includes(player.id)).map(player => player.name).join(", ");
    elements.tableHint.textContent = `${winners || "The highest score"} wins Heck of a Game.`;
  }

  renderTop(room);
  renderCards(elements.tableCards, room.currentTrick, "No cards in this trick yet.");
  renderCards(elements.hand, me.hand, room.phase === "lobby" ? "Cards appear when the host deals." : "No cards in hand.", {
    asButton: true,
    playable: room.phase === "playing" && myTurn
  });
  renderPlayers(room);
  renderLog(room);
  renderBidForm(room);
  maybeShowTrickWinner(room);
  maybeShowRoundSummary(room);

  elements.startGame.textContent = room.phase === "roundOver" ? "Next Round" : room.phase === "gameOver" ? "New Game" : "Deal";
  elements.startGame.classList.toggle("hidden", !host);
  elements.resetGame.classList.toggle("hidden", !host);
  elements.startGame.disabled = !host || !["lobby", "roundOver", "gameOver"].includes(room.phase) || room.players.length < 2;
  elements.resetGame.disabled = !host;
}

async function act(action, extra = {}) {
  try {
    const snapshot = await request(`/api/rooms/${state.roomCode}/actions`, {
      action,
      playerId: state.playerId,
      ...extra
    });
    state.snapshot = snapshot;
    render();
  } catch (error) {
    toast(error.message);
  }
}

elements.createForm.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const snapshot = await request("/api/rooms", { name: elements.hostName.value });
    history.replaceState(null, "", `?room=${snapshot.room.code}`);
    enterGame(snapshot);
  } catch (error) {
    toast(error.message);
  }
});

elements.joinForm.addEventListener("submit", async event => {
  event.preventDefault();
  try {
    elements.roomCode.value = normalizeRoomCode(elements.roomCode.value);
    const snapshot = await request("/api/join", {
      name: elements.joinName.value,
      code: elements.roomCode.value
    });
    history.replaceState(null, "", `?room=${snapshot.room.code}`);
    enterGame(snapshot);
  } catch (error) {
    toast(error.message);
  }
});

elements.bidForm.addEventListener("submit", event => {
  event.preventDefault();
  act("bid", { bid: Number(elements.bidAmount.value) });
});

elements.copyLink.addEventListener("click", async () => {
  const url = `${location.origin}${location.pathname}?room=${state.roomCode}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Invite link copied");
  } catch {
    toast(url);
  }
});

elements.startGame.addEventListener("click", () => act("start"));
elements.resetGame.addEventListener("click", () => act("reset"));

elements.startOwn.addEventListener("click", () => {
  showDefaultWelcome();
  elements.roomCode.value = "";
  elements.hostName.focus();
});

elements.roomCode.addEventListener("input", () => {
  elements.roomCode.value = normalizeRoomCode(elements.roomCode.value);
});

loadInviteRoom();
resumeSession();
