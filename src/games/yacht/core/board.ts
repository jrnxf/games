// Yacht rules with no DOM: five dice and a scorecard of 13 boxes each. A turn
// is up to three rolls, holding any dice between them, then one box scored.
// After 13 turns each, the higher total wins. A game is its first player plus
// a list of actions, and a roller that gives the fresh faces of each roll, so
// it saves and replays exactly (see dice.ts for where the faces come from).
//
// An action is one number:
//   0 to 12      scores that box with the dice as they are
//   ROLL + mask  rolls, keeping the dice whose bits are set in `mask`
// The first roll of a turn keeps nothing, and a roll that keeps all five dice
// is no roll, so both are refused.

export type Seat = 0 | 1;

export const DICE = 5;
export const ROLLS = 3;
export const TURNS = 13;
export const BOXES = 13;

/** The boxes, in card order. Ones to Sixes are the upper section. */
export const ONES = 0;
export const SIXES = 5;
export const THREE_KIND = 6;
export const FOUR_KIND = 7;
export const FULL_HOUSE = 8;
export const SMALL_STRAIGHT = 9;
export const LARGE_STRAIGHT = 10;
export const YACHT = 11;
export const CHANCE = 12;

export const BOX_NAMES = [
  "Ones",
  "Twos",
  "Threes",
  "Fours",
  "Fives",
  "Sixes",
  "3 of a kind",
  "4 of a kind",
  "Full house",
  "Small straight",
  "Large straight",
  "Yacht",
  "Chance",
] as const;

export const UPPER_BONUS = 35;
/** Ones to Sixes must reach this to earn the bonus: three of each face. */
export const BONUS_AT = 63;
export const FULL_HOUSE_SCORE = 25;
export const SMALL_STRAIGHT_SCORE = 30;
export const LARGE_STRAIGHT_SCORE = 40;
export const YACHT_SCORE = 50;
/** Each extra Yacht, once the Yacht box holds 50. */
export const EXTRA_YACHT = 100;

/** Actions at or above this are rolls. */
export const ROLL = 32;
/** The mask that keeps all five dice. */
export const ALL_HELD = (1 << DICE) - 1;

export const isUpper = (box: number) => box >= ONES && box <= SIXES;

export const rollAction = (held: number) => ROLL + held;
export const isRoll = (action: number) => action >= ROLL && action < ROLL + ALL_HELD;

export interface Card {
  /** Each box's score, or null while it is open. */
  boxes: (number | null)[];
  /** Extra Yachts that earned the 100 bonus. */
  extra: number;
}

/** What the last score was, for the screen to tell. */
export interface Scored {
  seat: Seat;
  box: number;
  points: number;
  /** The dice were an extra Yacht that earned the 100 bonus. */
  extra: boolean;
}

export interface Game {
  first: Seat;
  actions: number[];
  turn: Seat;
  /** Rolls made this turn: 0 before the first. */
  rolls: number;
  /** The dice as last rolled. Empty before the first roll of the game. */
  dice: number[];
  /** Rolls made in the whole game, both players: the index of the next roll. */
  rolled: number;
  cards: [Card, Card];
  last: Scored | null;
  over: boolean;
  /** The higher total once the game is over. Null during play and for a tie. */
  winner: Seat | null;
  draw: boolean;
}

/** Gives the fresh faces of roll number `k` of the game: five whole numbers from 1 to 6. */
export type Roller = (k: number) => readonly number[];

const other = (s: Seat) => (1 - s) as Seat;

export const newCard = (): Card => ({ boxes: Array<number | null>(BOXES).fill(null), extra: 0 });

export function newGame(first: Seat = 0): Game {
  return {
    first,
    actions: [],
    turn: first,
    rolls: 0,
    dice: [],
    rolled: 0,
    cards: [newCard(), newCard()],
    last: null,
    over: false,
    winner: null,
    draw: false,
  };
}

/** How many of each face, indexed 1 to 6 (index 0 is unused). */
export function counts(dice: readonly number[]): number[] {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]!++;
  return c;
}

const sum = (dice: readonly number[]) => dice.reduce((a, b) => a + b, 0);

export const isYacht = (dice: readonly number[]) => dice.length === DICE && dice.every((d) => d === dice[0]);

/** The longest run of faces in a row in `dice`. */
function longestRun(dice: readonly number[]): number {
  const c = counts(dice);
  let best = 0;
  let run = 0;
  for (let f = 1; f <= 6; f++) {
    run = c[f]! > 0 ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** What `dice` score in `box` by the box's own rule, with no joker. */
export function boxScore(box: number, dice: readonly number[]): number {
  if (isUpper(box)) return dice.filter((d) => d === box + 1).length * (box + 1);
  const c = counts(dice);
  const most = Math.max(...c);
  switch (box) {
    case THREE_KIND:
      return most >= 3 ? sum(dice) : 0;
    case FOUR_KIND:
      return most >= 4 ? sum(dice) : 0;
    case FULL_HOUSE:
      return c.includes(3) && c.includes(2) ? FULL_HOUSE_SCORE : 0;
    case SMALL_STRAIGHT:
      return longestRun(dice) >= 4 ? SMALL_STRAIGHT_SCORE : 0;
    case LARGE_STRAIGHT:
      return longestRun(dice) === 5 ? LARGE_STRAIGHT_SCORE : 0;
    case YACHT:
      return most === 5 ? YACHT_SCORE : 0;
    case CHANCE:
      return sum(dice);
    default:
      return 0;
  }
}

/**
 * The extra Yacht is a joker when the Yacht box is already filled, with 50
 * or with 0. It must go in its own upper box if that is open. Else it may go
 * in any open lower box, where Full House and both straights score full.
 * Else it scores 0 in an open upper box. This is the "forced joker" of the
 * common modern rules.
 */
function joker(card: Card, dice: readonly number[]): boolean {
  return isYacht(dice) && card.boxes[YACHT] !== null;
}

/** Whether `box` may take `dice` on `card`. */
export function canScore(card: Card, box: number, dice: readonly number[]): boolean {
  if (!Number.isInteger(box) || box < 0 || box >= BOXES) return false;
  if (dice.length !== DICE || card.boxes[box] !== null) return false;
  if (!joker(card, dice)) return true;
  const own = dice[0]! - 1;
  if (card.boxes[own] === null) return box === own;
  const lowerOpen = card.boxes.some((b, i) => !isUpper(i) && b === null);
  return lowerOpen ? !isUpper(box) : true;
}

/** The points `box` would get for `dice` on `card`, the extra Yacht bonus left out. Null when it may not take them. */
export function scoreFor(card: Card, box: number, dice: readonly number[]): number | null {
  if (!canScore(card, box, dice)) return null;
  if (joker(card, dice) && !isUpper(box)) {
    if (box === FULL_HOUSE) return FULL_HOUSE_SCORE;
    if (box === SMALL_STRAIGHT) return SMALL_STRAIGHT_SCORE;
    if (box === LARGE_STRAIGHT) return LARGE_STRAIGHT_SCORE;
  }
  return boxScore(box, dice);
}

/** The dice earn the extra Yacht bonus: a Yacht with 50 already in the Yacht box. */
export const earnsExtra = (card: Card, dice: readonly number[]) =>
  isYacht(dice) && card.boxes[YACHT] === YACHT_SCORE;

/** Ones to Sixes added up, the bonus left out. */
export const upperSum = (card: Card) =>
  card.boxes.slice(ONES, SIXES + 1).reduce<number>((a, b) => a + (b ?? 0), 0);

export const bonus = (card: Card) => (upperSum(card) >= BONUS_AT ? UPPER_BONUS : 0);

/** Every box, the upper bonus and the extra Yachts. */
export function total(card: Card): number {
  const boxes = card.boxes.reduce<number>((a, b) => a + (b ?? 0), 0);
  return boxes + bonus(card) + EXTRA_YACHT * card.extra;
}

/** Boxes filled on `card`. */
export const filled = (card: Card) => card.boxes.filter((b) => b !== null).length;

/** The player on turn may score now: they have rolled this turn and the game is on. */
export const canPick = (g: Game) => !g.over && g.rolls > 0;

/** The player on turn may roll again, keeping the dice in `held`. */
export function canRoll(g: Game, held = 0): boolean {
  if (g.over || g.rolls >= ROLLS) return false;
  if (!Number.isInteger(held) || held < 0 || held >= ALL_HELD) return false;
  return g.rolls > 0 || held === 0;
}

/** Plays one action for the player on turn. Returns the new game, or null for an illegal action. */
export function act(g: Game, action: number, roller: Roller): Game | null {
  if (!Number.isInteger(action) || g.over) return null;
  if (action >= ROLL) {
    const held = action - ROLL;
    if (!canRoll(g, held)) return null;
    const fresh = roller(g.rolled);
    if (fresh.length !== DICE || !fresh.every((f) => Number.isInteger(f) && f >= 1 && f <= 6)) return null;
    const dice = fresh.map((f, i) => (held & (1 << i) ? g.dice[i]! : f));
    return { ...g, actions: [...g.actions, action], rolls: g.rolls + 1, dice, rolled: g.rolled + 1 };
  }
  const card = g.cards[g.turn];
  if (!canPick(g)) return null;
  const points = scoreFor(card, action, g.dice);
  if (points === null) return null;
  const extra = earnsExtra(card, g.dice);
  const boxes = card.boxes.slice();
  boxes[action] = points;
  const cards = g.cards.slice() as [Card, Card];
  cards[g.turn] = { boxes, extra: card.extra + (extra ? 1 : 0) };
  const over = filled(cards[0]) === BOXES && filled(cards[1]) === BOXES;
  const t0 = total(cards[0]);
  const t1 = total(cards[1]);
  return {
    ...g,
    actions: [...g.actions, action],
    turn: over ? g.turn : other(g.turn),
    rolls: 0,
    cards,
    last: { seat: g.turn, box: action, points, extra },
    over,
    winner: !over || t0 === t1 ? null : t0 > t1 ? 0 : 1,
    draw: over && t0 === t1,
  };
}

/** Rebuilds a game from its first player and actions. Returns null if any action is illegal. */
export function replay(first: Seat, actions: readonly number[], roller: Roller): Game | null {
  let g: Game | null = newGame(first);
  for (const a of actions) {
    g = act(g, a, roller);
    if (!g) return null;
  }
  return g;
}

/** The held dice of a roll action, as a mask. 0 for a box. */
export const heldOf = (action: number) => (action >= ROLL ? action - ROLL : 0);
