const assert = require("node:assert/strict");
const test = require("node:test");

const { playCard } = require("../server");

function card(id, suit) {
  return {
    id,
    rank: id.slice(0, -1),
    value: 2,
    suit,
    suitName: suit,
    color: suit === "♥" || suit === "♦" ? "red" : "black",
    label: id
  };
}

function roomWithFollowerHand(hand) {
  return {
    phase: "playing",
    currentTurn: 1,
    leadSuit: "♥",
    topCard: card("9♣", "♣"),
    currentTrick: [{
      ...card("A♥", "♥"),
      playerId: "leader",
      playerName: "Leader",
      playedAt: Date.now()
    }],
    completedTricks: [],
    players: [
      {
        id: "leader",
        name: "Leader",
        hand: [],
        tricksTaken: 0,
        bid: 0,
        roundScore: 0,
        totalScore: 0
      },
      {
        id: "follower",
        name: "Follower",
        hand,
        tricksTaken: 0,
        bid: 0,
        roundScore: 0,
        totalScore: 0
      }
    ],
    log: []
  };
}

test("player void in the lead suit may play any card", () => {
  const offSuit = card("2♠", "♠");
  const room = roomWithFollowerHand([offSuit, card("3♣", "♣")]);
  const follower = room.players[1];

  assert.doesNotThrow(() => playCard(room, follower, offSuit.id));
  assert.equal(room.completedTricks.at(-1).cards.at(-1).id, offSuit.id);
});

test("player with the lead suit must follow it", () => {
  const offSuit = card("2♠", "♠");
  const room = roomWithFollowerHand([offSuit, card("3♥", "♥")]);
  const follower = room.players[1];

  assert.throws(
    () => playCard(room, follower, offSuit.id),
    /You must follow ♥ if you can/
  );
});
