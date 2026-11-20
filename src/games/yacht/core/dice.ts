// Where Yacht's dice come from, with no DOM. A game has a secret seed of eight
// 32-bit words, and the five faces of its roll number `k` are a pure function
// of the seed and `k`: the ChaCha20 block function, keyed by the seed, with
// `k` as its counter. So a game is its seed plus the list of actions, a
// reload rolls the same dice, and the dice of a roll not yet made can't be
// worked out from the rolls already seen. Online the seed stays on the host,
// and the phones get only the faces rolled (see host.ts).

/** Eight 32-bit words. */
export type Seed = readonly number[];

export const SEED_WORDS = 8;

/** A fresh seed from the platform's secure random source (browser, Worker and Node alike). */
export function newSeed(): number[] {
  return [...crypto.getRandomValues(new Uint32Array(SEED_WORDS))];
}

export const isSeed = (s: unknown): s is Seed =>
  Array.isArray(s) &&
  s.length === SEED_WORDS &&
  s.every((w) => Number.isInteger(w) && (w as number) >= 0 && (w as number) <= 0xffffffff);

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n));

/** "expand 32-byte k", ChaCha's constant words. */
const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

/** The ChaCha20 block for `key` and `counter`, as 16 unsigned words. */
export function chacha20(key: Seed, counter: number, nonce: readonly number[] = NONCE): Uint32Array {
  const input = new Uint32Array(16);
  input.set(SIGMA, 0);
  for (let i = 0; i < 8; i++) input[4 + i] = key[i]!;
  input[12] = counter >>> 0;
  input[13] = nonce[0]!;
  input[14] = nonce[1]!;
  input[15] = nonce[2]!;
  const x = new Uint32Array(input);
  const quarter = (a: number, b: number, c: number, d: number) => {
    x[a] = x[a]! + x[b]!;
    x[d] = rotl(x[d]! ^ x[a]!, 16);
    x[c] = x[c]! + x[d]!;
    x[b] = rotl(x[b]! ^ x[c]!, 12);
    x[a] = x[a]! + x[b]!;
    x[d] = rotl(x[d]! ^ x[a]!, 8);
    x[c] = x[c]! + x[d]!;
    x[b] = rotl(x[b]! ^ x[c]!, 7);
  };
  for (let i = 0; i < 10; i++) {
    quarter(0, 4, 8, 12);
    quarter(1, 5, 9, 13);
    quarter(2, 6, 10, 14);
    quarter(3, 7, 11, 15);
    quarter(0, 5, 10, 15);
    quarter(1, 6, 11, 12);
    quarter(2, 7, 8, 13);
    quarter(3, 4, 9, 14);
  }
  for (let i = 0; i < 16; i++) x[i] = x[i]! + input[i]!;
  return x;
}

/** The nonce words: a fixed tag ("yacht dice"), so the dice never share a stream with anything else. */
const NONCE = [0x79616368, 0x74206469, 0x63650000];

/** The largest multiple of 6 at or below 2^32: a word at or above it would favour the low faces, so it is skipped. */
const LIMIT = 4294967296 - (4294967296 % 6);

/** The five fresh faces of roll number `k`, counted from 0 over the whole game. A held die keeps its own face. */
export function faces(seed: Seed, k: number): number[] {
  const out: number[] = [];
  // 16 words a block, and a word is skipped about once in a billion: the first block nearly always does.
  for (let block = 0; out.length < 5; block++) {
    for (const w of chacha20(seed, k * 16 + block)) {
      if (w < LIMIT) out.push(1 + (w % 6));
      if (out.length === 5) break;
    }
  }
  return out;
}
