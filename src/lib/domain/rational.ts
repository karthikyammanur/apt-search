// Exact fractions for money math. Amounts stay exact (BigInt numerator over denominator) through
// every sum and division, and are rounded only once, at the end, half up to whole cents.

export type Rat = { readonly n: bigint; readonly d: bigint };

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);

function abs(x: bigint): bigint {
  return x < ZERO ? -x : x;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== ZERO) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === ZERO ? ONE : x;
}

function make(n: bigint, d: bigint): Rat {
  if (d === ZERO) throw new RangeError("Division by zero in money math");
  const sign = d < ZERO ? -ONE : ONE;
  const g = gcd(n, d);
  return { n: (sign * n) / g, d: (sign * d) / g };
}

function toBig(x: number): bigint {
  if (!Number.isSafeInteger(x)) {
    throw new RangeError(`Expected an integer (cents, minutes or days), got ${x}`);
  }
  return BigInt(x);
}

export const RAT_ZERO: Rat = { n: ZERO, d: ONE };

/** An integer amount, such as cents. Throws on a non-integer, because money must be cents. */
export function ratInt(x: number): Rat {
  return { n: toBig(x), d: ONE };
}

/** The exact fraction n / d of two integers. */
export function ratFrac(n: number, d: number): Rat {
  return make(toBig(n), toBig(d));
}

export function ratAdd(a: Rat, b: Rat): Rat {
  return make(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function ratSub(a: Rat, b: Rat): Rat {
  return make(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function ratMul(a: Rat, b: Rat): Rat {
  return make(a.n * b.n, a.d * b.d);
}

export function ratDiv(a: Rat, b: Rat): Rat {
  return make(a.n * b.d, a.d * b.n);
}

export function ratSum(values: readonly Rat[]): Rat {
  return values.reduce(ratAdd, RAT_ZERO);
}

export function ratCompare(a: Rat, b: Rat): -1 | 0 | 1 {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function ratIsZero(a: Rat): boolean {
  return a.n === ZERO;
}

function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d !== ZERO && n < ZERO !== d < ZERO ? q - ONE : q;
}

/** Round half up (toward positive infinity on a tie) to an integer: floor(x + 1/2). */
export function roundHalfUp(a: Rat): number {
  return Number(floorDiv(TWO * a.n + a.d, TWO * a.d));
}

/** For display only (weights, scores, months). Never used to decide a money result. */
export function ratToNumber(a: Rat): number {
  return Number(a.n) / Number(a.d);
}
