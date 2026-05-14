# Heck of a Game

A no-login multiplayer trick-taking card game for phones and browsers.

## Run

```sh
npm start
```

Open the printed local URL, create a room, and share the room code or invite link with the other players.
The host can remove players from the table at any time. Removing a player during bidding or play restarts the current round for the remaining players.

## Current Rules

- Uses one standard 52-card deck.
- The host is the first dealer.
- With 6 or fewer players, round 1 deals 7 cards to each player.
- Each following round deals one fewer card per player until the final 1-card round.
- After the deal, one card is turned up to establish trump.
- The player to the left of the dealer bids first, then play also starts left of the dealer.
- Players bid how many tricks they expect to take.
- The first card in a trick establishes the lead suit.
- Players must follow the lead suit if they can.
- The highest lead-suit card wins unless trump is played.
- Any trump beats any non-trump, and the highest trump wins.
- Exact bid score: `10 + bid`.
- Missed bid score: `-(10 + bid)`.
- After the 1-card final round, the highest total score wins.
