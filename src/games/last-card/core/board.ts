// Last Card's rules, with no DOM: the deck, the deal, what may be played and
// what each card does. Two players take turns to shed their hands. Match the
// top card of the discard pile by colour, number or symbol, or play a Wild.
// The first to empty their hand wins.
//
// A game is a seed and a list of moves. The seed shuffles the deck, and a
// replay of the moves gives the same board every time, the reshuffles of the
// discard pile included. So a game saves small, and the deck order stays
// secret: it is in no view (`viewOf`), only in the seed.

import { rng } from "../../connect-four/core/ai.ts";

export type Seat = 0 | 1;

export const COLORS = ["sun", "leaf", "wave", "flame"] as const;
export type Color = (typeof COLORS)[number];

export type Face = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | "skip" | "reverse" | "draw2" | "wild" | "wild4";

/** One card. A Wild has no colour of its own. */
export interface Card {
  color: Color | null;
  face: Face;
}

/** Cards in each hand at the deal. */
export const HAND = 7;
/** Cards a player draws when caught with one card and no call. */
export const CAUGHT = 2;

/**
 * The 108 cards. A card is known by its index here, so a hand is a list of
 * numbers. Each colour has one 0, two of each of 1 to 9, and two each of
 * Skip, Reverse and Draw Two. Then four Wilds and four Wild Draw Fours.
 */
export const DECK: readonly Card[] = (() => {
  const deck: Card[] = [];
  for (const color of COLORS) {
    deck.push({ color, face: 0 });
    for (let twice = 0; twice < 2; twice++) {
      for (let n = 1; n <= 9; n++) deck.push({ color, face: n as Face });
      deck.push({ color, face: "skip" }, { color, face: "reverse" }, { color, face: "draw2" });
    }
  }
  for (let i = 0; i < 4; i++) deck.push({ color: null, face: "wild" });
  for (let i = 0; i < 4; i++) deck.push({ color: null, face: "wild4" });
  return deck;
})();

export const card = (id: number): Card => DECK[id]!;
export const isWild = (id: number) => card(id).color === null;
/** Skip, Reverse, Draw Two and Wild Draw Four: with two players each gives the player another turn. */
export const isAction = (id: number) => {
  const f = card(id).face;
  return f === "skip" || f === "reverse" || f === "draw2" || f === "wild4";
};
/** How many cards a card makes the other player draw. */
export const penalty = (id: number) => (card(id).face === "draw2" ? 2 : card(id).face === "wild4" ? 4 : 0);

/** A player's move. */
export type Action =
  /** Plays a card from the hand. A Wild needs `color`. `call` says "Last card!" as it goes down to one card. */
  | { t: "play"; card: number; color?: Color; call?: boolean }
  /** Draws one card. */
  | { t: "draw" }
  /** Keeps the card just drawn, and ends the turn. */
  | { t: "keep" }
  /** Catches the other player, who has one card and did not call. They draw two. */
  | { t: "catch" };

/** A move as the game keeps it: who made it, and what it was. */
export type Move = Action & { by: Seat };

/** What a move did. A draw holds the card drawn, which only its player may see: `viewOf` drops it for the other. */
export type Event =
  | { t: "play"; by: Seat; card: number; color: Color | null; call: boolean; drew: number }
  | { t: "draw"; by: Seat; card: number | null; fits: boolean }
  | { t: "keep"; by: Seat }
  | { t: "catch"; by: Seat; drew: number };

/** The card turned up to start the pile, and what it did to the first player. */
export interface Start {
  card: number;
  /** Cards the first player drew because of it: 2 for a Draw Two. */
  drew: number;
  /** A Skip, a Reverse or a Draw Two: the first player lost the turn. */
  skipped: boolean;
}

export interface Board {
  seed: number;
  first: Seat;
  hands: [number[], number[]];
  /** The draw pile. The next card is at the end. */
  pile: number[];
  /** The discard pile. The top card is at the end. */
  discard: number[];
  /** The colour to match, or null when any card goes (a Wild turned up to start). */
  want: Color | null;
  turn: Seat;
  /** The card the player on turn just drew and may still play, or null. */
  drawn: number | null;
  /** The player who went down to one card and did not call, while the other may still catch them. */
  open: Seat | null;
  /** Who called "Last card!" and still holds one card. */
  called: [boolean, boolean];
  moves: Move[];
  /** One event for each move. */
  log: Event[];
  start: Start;
  /** How many times the discard pile went back into the draw pile. */
  shuffles: number;
  over: boolean;
  winner: Seat | null;
}

export const other = (seat: Seat) => (1 - seat) as Seat;

/** Shuffles `cards` in place with `r`. */
function shuffle(cards: number[], r: () => number) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
}

/** The deck as `seed` shuffles it, before the deal. The next card is at the end. */
export function shuffled(seed: number): number[] {
  const pile = DECK.map((_, i) => i);
  shuffle(pile, rng(seed));
  return pile;
}

/** The discard pile, all but its top card, shuffled into a new draw pile. Each reshuffle has its own stream from the seed. */
function reshuffle(b: Board) {
  const top = b.discard.pop()!;
  const rest = b.discard;
  shuffle(rest, rng(b.seed ^ Math.imul(b.shuffles + 1, 0x85ebca6b)));
  b.pile = rest;
  b.discard = [top];
  b.shuffles += 1;
}

/** `seat` draws up to `n` cards. Fewer when every card is in a hand. Returns the cards drawn. */
function take(b: Board, seat: Seat, n: number): number[] {
  const got: number[] = [];
  for (let i = 0; i < n; i++) {
    if (b.pile.length === 0 && b.discard.length > 1) reshuffle(b);
    const id = b.pile.pop();
    if (id === undefined) break;
    b.hands[seat].push(id);
    got.push(id);
  }
  return got;
}

/** Whether card `id` may go on `top` when the colour to match is `want`. */
export function fits(id: number, top: number, want: Color | null): boolean {
  const c = card(id);
  if (c.color === null || want === null || c.color === want) return true;
  // A Wild on top asks for its colour only.
  return !isWild(top) && c.face === card(top).face;
}

export const topOf = (b: { discard: number[] }) => b.discard[b.discard.length - 1]!;

/** The cards `seat` may play now. Empty when it is not their turn. */
export function playable(b: Board, seat: Seat): number[] {
  if (b.over || b.turn !== seat) return [];
  if (b.drawn !== null) return fits(b.drawn, topOf(b), b.want) ? [b.drawn] : [];
  return b.hands[seat].filter((id) => fits(id, topOf(b), b.want));
}

/** Whether `seat` may catch the other player now. */
export const canCatch = (b: Board, seat: Seat) => !b.over && b.open === other(seat);

/**
 * A new game from `seed`. The deck is shuffled, each player gets seven cards,
 * and one card is turned up to start the discard pile. A Wild Draw Four goes
 * back to the bottom of the draw pile and the next card is turned up. A Skip,
 * Reverse or Draw Two acts on the first player: they lose the turn, and draw
 * two for a Draw Two. A Wild lets the first player play any card.
 */
export function newGame(seed: number, first: Seat): Board {
  const pile = shuffled(seed);
  const b: Board = {
    seed,
    first,
    hands: [[], []],
    pile,
    discard: [],
    want: null,
    turn: first,
    drawn: null,
    open: null,
    called: [false, false],
    moves: [],
    log: [],
    start: { card: 0, drew: 0, skipped: false },
    shuffles: 0,
    over: false,
    winner: null,
  };
  for (let i = 0; i < HAND; i++) {
    take(b, first, 1);
    take(b, other(first), 1);
  }
  let up = b.pile.pop()!;
  while (card(up).face === "wild4") {
    b.pile.unshift(up);
    up = b.pile.pop()!;
  }
  b.discard.push(up);
  b.want = card(up).color;
  const face = card(up).face;
  const skipped = face === "skip" || face === "reverse" || face === "draw2";
  const drew = face === "draw2" ? take(b, first, 2).length : 0;
  if (skipped) b.turn = other(first);
  b.start = { card: up, drew, skipped };
  return b;
}

function copy(b: Board): Board {
  return {
    ...b,
    hands: [[...b.hands[0]], [...b.hands[1]]],
    pile: [...b.pile],
    discard: [...b.discard],
    called: [...b.called],
    moves: [...b.moves],
    log: [...b.log],
  };
}

/** After a hand changes size, a call or a chance to catch no longer stands. */
function tidy(b: Board) {
  for (const seat of [0, 1] as const) if (b.hands[seat].length !== 1) b.called[seat] = false;
  if (b.open !== null && b.hands[b.open].length !== 1) b.open = null;
}

/**
 * The board after `move`, or null when the move is not allowed. A play, a
 * draw or a keep must be on turn. A catch may come at any time while the
 * other player has one card, did not call, and the catcher has not moved
 * since.
 */
export function apply(prev: Board, move: Move): Board | null {
  if (prev.over) return null;
  const { by } = move;
  if (move.t === "catch") {
    if (!canCatch(prev, by)) return null;
    const b = copy(prev);
    const drew = take(b, other(by), CAUGHT).length;
    b.open = null;
    b.moves.push({ t: "catch", by });
    b.log.push({ t: "catch", by, drew });
    tidy(b);
    return b;
  }
  if (prev.turn !== by) return null;
  const b = copy(prev);
  // The other player moved on: they can no longer catch this one.
  if (b.open === other(by)) b.open = null;
  switch (move.t) {
    case "play": {
      const id = move.card;
      const hand = b.hands[by];
      const at = hand.indexOf(id);
      if (!Number.isInteger(id) || at < 0) return null;
      if (b.drawn !== null && id !== b.drawn) return null;
      if (!fits(id, topOf(b), b.want)) return null;
      const wild = isWild(id);
      if (wild && (!move.color || !COLORS.includes(move.color))) return null;
      hand.splice(at, 1);
      b.discard.push(id);
      b.want = wild ? move.color! : card(id).color;
      b.drawn = null;
      const call = move.call === true;
      let drew = 0;
      if (hand.length === 0) {
        b.over = true;
        b.winner = by;
      } else {
        if (hand.length === 1) {
          b.called[by] = call;
          b.open = call ? null : by;
        }
        drew = penalty(id) ? take(b, other(by), penalty(id)).length : 0;
        // With two players a Skip, a Reverse or a Draw card means the same player goes again.
        b.turn = isAction(id) ? by : other(by);
      }
      b.moves.push({
        t: "play",
        by,
        card: id,
        ...(wild ? { color: move.color } : {}),
        ...(call ? { call } : {}),
      });
      b.log.push({ t: "play", by, card: id, color: wild ? move.color! : null, call, drew });
      break;
    }
    case "draw": {
      if (b.drawn !== null) return null;
      const [got] = take(b, by, 1);
      const fit = got !== undefined && fits(got, topOf(b), b.want);
      if (fit) b.drawn = got;
      else b.turn = other(by);
      b.moves.push({ t: "draw", by });
      b.log.push({ t: "draw", by, card: got ?? null, fits: fit });
      break;
    }
    case "keep": {
      if (b.drawn === null) return null;
      b.drawn = null;
      b.turn = other(by);
      b.moves.push({ t: "keep", by });
      b.log.push({ t: "keep", by });
      break;
    }
    default:
      return null;
  }
  tidy(b);
  return b;
}

/** The game `moves` lead to from `seed`, or null if a move is not allowed. */
export function replay(seed: number, first: Seat, moves: readonly Move[]): Board | null {
  let b: Board | null = newGame(seed, first);
  for (const m of moves) {
    b = apply(b, m);
    if (!b) return null;
  }
  return b;
}

/** An event as `seat` may know it: the other player's drawn cards are hidden. */
export function seenBy(e: Event, seat: Seat): Event {
  return e.t === "draw" && e.by !== seat ? { ...e, card: null } : e;
}

/**
 * All that `seat` may know of the game. It holds their own hand, the size of
 * the other hand, and the cards played. Never the draw pile's order, the seed
 * or the other hand, until the game is over. The computer decides from this
 * alone, so a leak would be a type error.
 */
export interface View {
  seat: Seat;
  first: Seat;
  hand: number[];
  /** How many cards the other player holds. */
  others: number;
  top: number;
  want: Color | null;
  /** How many cards the draw pile holds. */
  pile: number;
  turn: Seat;
  /** The card this player just drew and may still play. Only on their own view. */
  drawn: number | null;
  /** The player on turn drew a card they may still play. */
  drawing: boolean;
  open: Seat | null;
  called: [boolean, boolean];
  /** How many moves were made: the `at` of the next one. */
  moves: number;
  start: Start;
  /** Every move so far, as this player saw it. */
  log: Event[];
  over: boolean;
  winner: Seat | null;
  /** The other hand, once the game is over. */
  foe: number[] | null;
}

export function viewOf(b: Board, seat: Seat): View {
  return {
    seat,
    first: b.first,
    hand: [...b.hands[seat]],
    others: b.hands[other(seat)].length,
    top: topOf(b),
    want: b.want,
    pile: b.pile.length,
    turn: b.turn,
    drawn: b.turn === seat ? b.drawn : null,
    drawing: b.drawn !== null,
    open: b.open,
    called: [...b.called],
    moves: b.moves.length,
    start: { ...b.start },
    log: b.log.map((e) => seenBy(e, seat)),
    over: b.over,
    winner: b.winner,
    foe: b.over ? [...b.hands[other(seat)]] : null,
  };
}

/** The cards `view`'s player may play now. */
export function playableIn(v: View): number[] {
  if (v.over || v.turn !== v.seat) return [];
  if (v.drawing) return v.drawn !== null && fits(v.drawn, v.top, v.want) ? [v.drawn] : [];
  return v.hand.filter((id) => fits(id, v.top, v.want));
}

/** A card's name in words: "wave 4", "flame Skip", "Wild Draw Four". */
export function nameOf(id: number): string {
  const { color, face } = card(id);
  if (face === "wild") return "Wild";
  if (face === "wild4") return "Wild Draw Four";
  const f =
    face === "skip" ? "Skip" : face === "reverse" ? "Reverse" : face === "draw2" ? "Draw Two" : String(face);
  return `${color} ${f}`;
}
