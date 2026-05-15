const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, ".data");
const ROOMS_FILE = path.join(DATA_DIR, "rooms.json");
const HEARTBEAT_MS = 25000;
const ROOM_TTL_MS = 1000 * 60 * 60 * 8;
const MAX_PLAYERS = 8;

const rooms = new Map();
let roomsLoaded = false;

function ensureRoomsLoaded() {
  if (roomsLoaded) return;
  loadRooms();
  roomsLoaded = true;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function makeRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 5; i += 1) {
      code += letters[crypto.randomInt(letters.length)];
    }
  } while (rooms.has(code));
  return code;
}

function normalizeRoomCode(code) {
  return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function serializeRoom(room) {
  return {
    ...room,
    clients: undefined,
    players: room.players.map(player => ({
      ...player,
      connected: false
    }))
  };
}

function saveRooms() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ROOMS_FILE, JSON.stringify([...rooms.values()].map(serializeRoom), null, 2));
  } catch (error) {
    console.warn(`Unable to save rooms: ${error.message}`);
  }
}

function loadRooms() {
  try {
    if (!fs.existsSync(ROOMS_FILE)) return;
    const savedRooms = JSON.parse(fs.readFileSync(ROOMS_FILE, "utf8"));
    if (!Array.isArray(savedRooms)) return;

    for (const savedRoom of savedRooms) {
      if (!savedRoom || !savedRoom.code || !Array.isArray(savedRoom.players)) continue;
      rooms.set(savedRoom.code, {
        ...savedRoom,
        players: savedRoom.players.map(player => ({ ...player, connected: false })),
        clients: new Map()
      });
    }
  } catch (error) {
    console.warn(`Unable to load rooms: ${error.message}`);
  }
}

function makeDeck() {
  const suits = [
    { symbol: "♠", name: "spades", color: "black" },
    { symbol: "♥", name: "hearts", color: "red" },
    { symbol: "♦", name: "diamonds", color: "red" },
    { symbol: "♣", name: "clubs", color: "black" }
  ];
  const ranks = [
    ["2", "Two", 2],
    ["3", "Three", 3],
    ["4", "Four", 4],
    ["5", "Five", 5],
    ["6", "Six", 6],
    ["7", "Seven", 7],
    ["8", "Eight", 8],
    ["9", "Nine", 9],
    ["10", "Ten", 10],
    ["J", "Jack", 11],
    ["Q", "Queen", 12],
    ["K", "King", 13],
    ["A", "Ace", 14]
  ];

  const deck = [];
  for (const suit of suits) {
    for (const [rank, label, value] of ranks) {
      deck.push({
        id: `${rank}${suit.symbol}`,
        rank,
        value,
        suit: suit.symbol,
        suitName: suit.name,
        color: suit.color,
        label: `${label} of ${suit.name}`
      });
    }
  }
  return deck;
}

function shuffle(cards) {
  const next = [...cards];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function normalizeName(name) {
  const trimmed = String(name || "").trim();
  return trimmed.slice(0, 24) || "Player";
}

function handSizeFor(playerCount) {
  if (playerCount <= 6) return 7;
  return Math.max(1, Math.floor(51 / playerCount));
}

function openingHandSizeFor(playerCount) {
  return handSizeFor(playerCount);
}

function roundHandSize(room) {
  return Math.max(1, openingHandSizeFor(room.players.length) - room.round + 1);
}

function leftOf(room, index) {
  return (index + 1) % room.players.length;
}

function clampTurn(room) {
  if (!room.players.length) {
    room.currentTurn = 0;
    return;
  }
  room.currentTurn = Math.min(Math.max(room.currentTurn, 0), room.players.length - 1);
}

function createPlayer(name) {
  return {
    id: crypto.randomUUID(),
    name: normalizeName(name),
    connected: false,
    hand: [],
    bid: null,
    tricksTaken: 0,
    roundScore: 0,
    totalScore: 0
  };
}

function createRoom(name) {
  const code = makeRoomCode();
  const host = createPlayer(name || "Dealer");
  const now = Date.now();
  const room = {
    code,
    hostId: host.id,
    createdAt: now,
    updatedAt: now,
    phase: "lobby",
    round: 0,
    openingHandSize: 0,
    winnerIds: [],
    dealerIndex: 0,
    currentTurn: 0,
    leadSuit: null,
    handSize: 0,
    trumpCard: null,
    deck: shuffle(makeDeck()),
    currentTrick: [],
    completedTricks: [],
    players: [host],
    clients: new Map(),
    log: [`${host.name} created Heck of a Game room ${code}.`]
  };
  rooms.set(code, room);
  saveRooms();
  return { room, player: host };
}

function touch(room) {
  room.updatedAt = Date.now();
  saveRooms();
}

function publicRoom(room) {
  const players = room.players.map(player => ({
    id: player.id,
    name: player.name,
    connected: player.connected,
    cardCount: player.hand.length,
    bid: player.bid,
    tricksTaken: player.tricksTaken,
    roundScore: player.roundScore,
    totalScore: player.totalScore
  }));

  return {
    code: room.code,
    hostId: room.hostId,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    phase: room.phase,
    round: room.round,
    dealerIndex: room.dealerIndex,
    dealerId: room.players[room.dealerIndex]?.id || null,
    currentTurn: room.currentTurn,
    leadSuit: room.leadSuit,
    handSize: room.handSize,
    openingHandSize: room.openingHandSize,
    winnerIds: room.winnerIds,
    trumpCard: room.trumpCard,
    deckCount: room.deck.length,
    currentTrick: room.currentTrick,
    completedTricks: room.completedTricks.slice(-5),
    log: room.log.slice(-14),
    players
  };
}

function playerView(room, playerId) {
  const player = room.players.find(candidate => candidate.id === playerId);
  return {
    room: publicRoom(room),
    me: player
      ? {
          id: player.id,
          name: player.name,
          hand: player.hand
        }
      : null
  };
}

function findRoom(code) {
  return rooms.get(normalizeRoomCode(code));
}

function findPlayer(room, playerId) {
  return room.players.find(player => player.id === playerId);
}

function playerIndex(room, playerId) {
  return room.players.findIndex(player => player.id === playerId);
}

function getCurrentPlayer(room) {
  if (!room.players.length) return null;
  return room.players[room.currentTurn] || room.players[0];
}

function removeExpiredRooms() {
  const now = Date.now();
  let changed = false;
  for (const [code, room] of rooms) {
    if (now - room.updatedAt > ROOM_TTL_MS && room.clients.size === 0) {
      rooms.delete(code);
      changed = true;
    }
  }
  if (changed) saveRooms();
}

function broadcast(room) {
  for (const [clientId, client] of room.clients) {
    if (client.res.destroyed) {
      room.clients.delete(clientId);
      continue;
    }
    client.res.write(`event: state\ndata: ${JSON.stringify(playerView(room, client.playerId))}\n\n`);
  }
}

function resetRoundState(room) {
  room.leadSuit = null;
  room.trumpCard = null;
  room.deck = shuffle(makeDeck());
  room.currentTrick = [];
  room.completedTricks = [];
  room.handSize = roundHandSize(room);
  for (const player of room.players) {
    player.hand = [];
    player.bid = null;
    player.tricksTaken = 0;
    player.roundScore = 0;
  }
}

function dealRound(room) {
  resetRoundState(room);
  for (let cardNumber = 0; cardNumber < room.handSize; cardNumber += 1) {
    for (let offset = 1; offset <= room.players.length; offset += 1) {
      const player = room.players[(room.dealerIndex + offset) % room.players.length];
      player.hand.push(room.deck.pop());
    }
  }
  room.trumpCard = room.deck.pop();
}

function startRound(room) {
  room.round += 1;
  room.phase = "bidding";
  room.winnerIds = [];
  if (!room.openingHandSize) room.openingHandSize = openingHandSizeFor(room.players.length);
  dealRound(room);
  room.currentTurn = leftOf(room, room.dealerIndex);
  const dealer = room.players[room.dealerIndex];
  const bidder = getCurrentPlayer(room);
  room.log.push(
    `Round ${room.round}: ${dealer.name} dealt ${room.handSize} cards each. ${room.trumpCard.suitName} is trump. ${bidder.name} bids first.`
  );
}

function advanceBidding(room) {
  const nextUnbid = room.players.findIndex(player => player.bid === null);
  if (nextUnbid === -1) {
    room.phase = "playing";
    room.currentTurn = leftOf(room, room.dealerIndex);
    room.leadSuit = null;
    room.log.push("All bids are in. The first trick begins.");
    return;
  }

  let index = room.currentTurn;
  do {
    index = leftOf(room, index);
    if (room.players[index].bid === null) {
      room.currentTurn = index;
      return;
    }
  } while (index !== room.currentTurn);
}

function placeBid(room, player, amount) {
  if (room.phase !== "bidding") throw new Error("Bidding is not open");
  if (getCurrentPlayer(room)?.id !== player.id) throw new Error("It is not your bid");

  const bid = Number(amount);
  if (!Number.isInteger(bid) || bid < 0 || bid > room.handSize) {
    throw new Error(`Bid must be between 0 and ${room.handSize}`);
  }

  player.bid = bid;
  room.log.push(`${player.name} bid ${bid}.`);
  advanceBidding(room);
}

function canPlayCard(room, player, card) {
  if (room.phase !== "playing") return false;
  if (getCurrentPlayer(room)?.id !== player.id) return false;
  if (!room.leadSuit) return true;
  if (card.suit === room.leadSuit) return true;
  return !player.hand.some(candidate => candidate.suit === room.leadSuit);
}

function winningPlay(room, trick) {
  const trumpSuit = room.trumpCard.suit;
  const trumpCards = trick.filter(play => play.suit === trumpSuit);
  const candidates = trumpCards.length ? trumpCards : trick.filter(play => play.suit === trick[0].suit);
  return candidates.reduce((best, play) => (play.value > best.value ? play : best), candidates[0]);
}

function scoreRound(room) {
  for (const player of room.players) {
    player.roundScore = player.tricksTaken === player.bid ? 10 + player.bid : -1 * (10 + player.bid);
    player.totalScore += player.roundScore;
  }
}

function setGameWinners(room) {
  const highScore = Math.max(...room.players.map(player => player.totalScore));
  room.winnerIds = room.players.filter(player => player.totalScore === highScore).map(player => player.id);
}

function completeTrick(room) {
  const winner = winningPlay(room, room.currentTrick);
  const winnerIndex = playerIndex(room, winner.playerId);
  room.players[winnerIndex].tricksTaken += 1;
  room.completedTricks.push({
    winnerId: winner.playerId,
    winnerName: winner.playerName,
    leadSuit: room.currentTrick[0].suit,
    cards: room.currentTrick
  });
  room.log.push(`${winner.playerName} took the trick.`);
  room.currentTrick = [];
  room.leadSuit = null;

  const roundDone = room.players.every(player => player.hand.length === 0);
  if (roundDone) {
    room.currentTurn = winnerIndex;
    scoreRound(room);
    if (room.handSize === 1) {
      room.phase = "gameOver";
      setGameWinners(room);
      const winners = room.players.filter(player => room.winnerIds.includes(player.id)).map(player => player.name).join(", ");
      room.log.push(`Final round complete. Winner: ${winners}.`);
    } else {
      room.phase = "roundOver";
      room.log.push(`Round complete. Next round deals ${room.handSize - 1} cards each.`);
    }
    return;
  }

  room.currentTurn = winnerIndex;
}

function playCard(room, player, cardId) {
  if (room.phase !== "playing") throw new Error("Cards cannot be played right now");
  if (getCurrentPlayer(room)?.id !== player.id) throw new Error("It is not your turn");

  const index = player.hand.findIndex(card => card.id === cardId);
  if (index === -1) throw new Error("Card not in hand");
  const card = player.hand[index];
  if (!canPlayCard(room, player, card)) {
    throw new Error(`You must follow ${room.leadSuit} if you can`);
  }

  player.hand.splice(index, 1);
  const play = {
    ...card,
    playerId: player.id,
    playerName: player.name,
    playedAt: Date.now()
  };
  if (!room.leadSuit) room.leadSuit = card.suit;
  room.currentTrick.push(play);
  room.log.push(`${player.name} played ${card.label}.`);

  if (room.currentTrick.length === room.players.length) {
    completeTrick(room);
  } else {
    room.currentTurn = leftOf(room, room.currentTurn);
  }
}

function resetGame(room) {
  room.phase = "lobby";
  room.round = 0;
  room.openingHandSize = 0;
  room.winnerIds = [];
  room.dealerIndex = 0;
  room.currentTurn = 0;
  resetRoundState(room);
  room.deck = shuffle(makeDeck());
  room.handSize = 0;
  room.log.push("The game was reset.");
}

function restartRoundAfterRemoval(room, removedName) {
  if (room.players.length < 2) {
    resetGame(room);
    room.log.push(`Round canceled because ${removedName} was removed.`);
    return;
  }

  clampTurn(room);
  room.dealerIndex = Math.min(room.dealerIndex, room.players.length - 1);
  room.phase = "bidding";
  room.winnerIds = [];
  dealRound(room);
  room.currentTurn = leftOf(room, room.dealerIndex);
  const dealer = room.players[room.dealerIndex];
  const bidder = getCurrentPlayer(room);
  room.log.push(
    `Round ${room.round} restarted after ${removedName} was removed. ${dealer.name} dealt ${room.handSize} cards each. ${room.trumpCard.suitName} is trump. ${bidder.name} bids first.`
  );
}

function adjustGameAfterRemoval(room, removed, removedIndex) {
  const betweenRounds = room.phase === "roundOver" || room.phase === "gameOver";
  if (betweenRounds && room.dealerIndex === removedIndex && room.players.length) {
    room.dealerIndex = (removedIndex - 1 + room.players.length) % room.players.length;
  } else if (room.dealerIndex > removedIndex) {
    room.dealerIndex -= 1;
  }
  if (room.currentTurn > removedIndex) room.currentTurn -= 1;
  clampTurn(room);

  if (room.phase === "bidding" || room.phase === "playing") {
    restartRoundAfterRemoval(room, removed.name);
    return;
  }

  if (room.phase === "roundOver" || room.phase === "gameOver") {
    room.winnerIds = room.winnerIds.filter(id => id !== removed.id);
    if (room.players.length < 2) {
      resetGame(room);
      room.log.push(`Game returned to the lobby because ${removed.name} was removed.`);
    }
  }
}

function disconnectPlayerClients(room, targetPlayerId, eventName, payload) {
  for (const [clientId, client] of room.clients) {
    if (client.playerId !== targetPlayerId) continue;
    client.res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
    client.res.end();
    room.clients.delete(clientId);
  }
}

function removePlayer(room, host, targetPlayerId) {
  if (host.id !== room.hostId) throw new Error("Only the host can remove players");
  if (targetPlayerId === room.hostId) throw new Error("The host cannot be removed");

  const index = playerIndex(room, targetPlayerId);
  if (index === -1) throw new Error("Player not found");

  const [removed] = room.players.splice(index, 1);
  adjustGameAfterRemoval(room, removed, index);
  room.log.push(`${removed.name} was removed from the table.`);
  disconnectPlayerClients(room, targetPlayerId, "removed", {
    message: "The host removed you from the table."
  });
}

async function handleApi(req, res) {
  try {
    const roomViewMatch = req.url.match(/^\/api\/rooms\/([^/?]+)(?:\?.*)?$/);
    if (req.method === "GET" && roomViewMatch) {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const room = findRoom(roomViewMatch[1]);
      if (!room) return sendJson(res, 404, { error: "Room not found" });
      const playerId = url.searchParams.get("player");
      if (!playerId) {
        sendJson(res, 200, { room: publicRoom(room), me: null });
        return;
      }
      if (!findPlayer(room, playerId)) return sendJson(res, 403, { error: "Player not found" });
      sendJson(res, 200, playerView(room, playerId));
      return;
    }

    if (req.method === "POST" && req.url === "/api/rooms") {
      const body = await readBody(req);
      const { room, player } = createRoom(body.name);
      sendJson(res, 201, playerView(room, player.id));
      return;
    }

    if (req.method === "POST" && req.url === "/api/join") {
      const body = await readBody(req);
      const room = findRoom(body.code);
      if (!room) return sendJson(res, 404, { error: "Room not found" });
      if (room.phase !== "lobby") return sendJson(res, 409, { error: "This game has already started" });
      if (room.players.length >= MAX_PLAYERS) return sendJson(res, 409, { error: "Room is full" });
      const player = createPlayer(body.name);
      room.players.push(player);
      room.log.push(`${player.name} joined the table.`);
      touch(room);
      broadcast(room);
      sendJson(res, 200, playerView(room, player.id));
      return;
    }

    const match = req.url.match(/^\/api\/rooms\/([^/]+)\/actions$/);
    if (req.method === "POST" && match) {
      const body = await readBody(req);
      const room = findRoom(match[1]);
      if (!room) return sendJson(res, 404, { error: "Room not found" });
      const player = findPlayer(room, body.playerId);
      if (!player) return sendJson(res, 403, { error: "Player not found" });

      const isHost = player.id === room.hostId;
      if (body.action === "start") {
        if (!isHost) return sendJson(res, 403, { error: "Only the host can deal" });
        if (room.phase !== "lobby" && room.phase !== "roundOver" && room.phase !== "gameOver") {
          return sendJson(res, 409, { error: "A round is already in progress" });
        }
        if (room.phase === "roundOver") room.dealerIndex = leftOf(room, room.dealerIndex);
        if (room.phase === "gameOver") {
          room.round = 0;
          room.openingHandSize = 0;
          room.winnerIds = [];
          room.dealerIndex = leftOf(room, room.dealerIndex);
          for (const participant of room.players) {
            participant.totalScore = 0;
          }
        }
        startRound(room);
      } else if (body.action === "bid") {
        placeBid(room, player, body.bid);
      } else if (body.action === "play") {
        playCard(room, player, body.cardId);
      } else if (body.action === "reset") {
        if (!isHost) return sendJson(res, 403, { error: "Only the host can reset" });
        resetGame(room);
      } else if (body.action === "removePlayer") {
        removePlayer(room, player, body.targetPlayerId);
      } else {
        return sendJson(res, 400, { error: "Unknown action" });
      }

      touch(room);
      broadcast(room);
      sendJson(res, 200, playerView(room, player.id));
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Bad request" });
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const contentType = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(contents);
  });
}

function handleEvents(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const room = findRoom(url.searchParams.get("room"));
  const playerId = url.searchParams.get("player");
  if (!room || !findPlayer(room, playerId)) {
    res.writeHead(404);
    res.end();
    return;
  }

  const clientId = crypto.randomUUID();
  const player = findPlayer(room, playerId);
  player.connected = true;
  touch(room);

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  res.write(`event: state\ndata: ${JSON.stringify(playerView(room, playerId))}\n\n`);
  room.clients.set(clientId, { res, playerId });
  broadcast(room);

  req.on("close", () => {
    room.clients.delete(clientId);
    const stillConnected = [...room.clients.values()].some(client => client.playerId === playerId);
    const participant = findPlayer(room, playerId);
    if (participant) participant.connected = stillConnected;
    touch(room);
    broadcast(room);
  });
}

function startServer() {
  ensureRoomsLoaded();

  const server = http.createServer(handleRequest);

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Heck of a Game running at http://localhost:${PORT}`);
  });

  setInterval(() => {
    for (const room of rooms.values()) {
      for (const client of room.clients.values()) {
        client.res.write(": heartbeat\n\n");
      }
    }
  }, HEARTBEAT_MS);

  return server;
}

function handleRequest(req, res) {
  ensureRoomsLoaded();
  removeExpiredRooms();
  if (req.url.startsWith("/events")) return handleEvents(req, res);
  if (req.url.startsWith("/api/")) return handleApi(req, res);
  return serveStatic(req, res);
}

if (require.main === module) {
  startServer();
}

module.exports = {
  canPlayCard,
  createRoom,
  handleRequest,
  playCard,
  startRound
};
