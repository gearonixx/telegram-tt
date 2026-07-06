/*
 * Freestanding AES-256 core (T-tables) with IGE and CTR layers for MTProto.
 *
 * Compiled to WASM with plain clang (no emscripten, no libc) — see BUILD.md.
 * All state lives in fixed linear memory (no growth). Data is exchanged
 * through static buffers whose addresses are exposed via get* exports:
 *
 *   IO        1 MiB   payload processed in place (callers slice larger data)
 *   KEYBUF    32 B    AES-256 key input for expandKey()
 *   IVBUF     32 B    IGE state: c_prev (16) || m_prev (16); updated after
 *                     every ige* call so multi-slice operations chain
 *   CTRSTATE  36 B    counter (16) || carry keystream (16) || carryUsed (u32 LE,
 *                     0 = no carry, 1..15 = bytes of carry already consumed)
 *
 * Byte order follows FIPS-197: blocks are handled as 4 big-endian 32-bit
 * words, which matches the @cryptography/aes JS implementation this core
 * replaces (verified bit-exact by perf/bench-aes.mjs).
 */

#include <stdint.h>

#define EXPORT(name) __attribute__((export_name(name), visibility("default")))

#define IO_CAPACITY (1u << 20)
#define ROUNDS 14 /* AES-256 */
#define RK_WORDS 60 /* 4 * (ROUNDS + 1) */

static uint8_t IO[IO_CAPACITY] __attribute__((aligned(16)));
static uint8_t KEYBUF[32];
static uint8_t IVBUF[32];
static uint8_t CTRSTATE[36];

static uint8_t SBOX[256];
static uint8_t ISBOX[256];
static uint32_t TE0[256], TE1[256], TE2[256], TE3[256];
static uint32_t TD0[256], TD1[256], TD2[256], TD3[256];
static uint32_t RK[RK_WORDS]; /* encryption round keys */
static uint32_t DK[RK_WORDS]; /* decryption round keys (equivalent inverse cipher) */
static int tablesReady;

static inline uint32_t rotr32(uint32_t x, int n) {
  return (x >> n) | (x << (32 - n));
}

static inline uint8_t rotl8(uint8_t x, int n) {
  return (uint8_t)((x << n) | (x >> (8 - n)));
}

static inline uint8_t xtime(uint8_t x) {
  return (uint8_t)((x << 1) ^ ((x >> 7) * 0x1B));
}

static uint8_t gmul(uint8_t x, uint8_t y) {
  uint8_t r = 0;
  while (y) {
    if (y & 1) r ^= x;
    x = xtime(x);
    y >>= 1;
  }
  return r;
}

/* Generate the S-box algorithmically (multiplicative inverse + affine map) */
static void initTables(void) {
  uint8_t p = 1, q = 1;
  do {
    p = (uint8_t)(p ^ (uint8_t)(p << 1) ^ ((p & 0x80) ? 0x1B : 0));
    q ^= (uint8_t)(q << 1);
    q ^= (uint8_t)(q << 2);
    q ^= (uint8_t)(q << 4);
    if (q & 0x80) q ^= 0x09;
    SBOX[p] = (uint8_t)(q ^ rotl8(q, 1) ^ rotl8(q, 2) ^ rotl8(q, 3) ^ rotl8(q, 4) ^ 0x63);
  } while (p != 1);
  SBOX[0] = 0x63;

  for (int i = 0; i < 256; i++) {
    ISBOX[SBOX[i]] = (uint8_t)i;
  }

  for (int i = 0; i < 256; i++) {
    uint8_t s = SBOX[i];
    /* (02·s, 01·s, 01·s, 03·s), MSB first */
    uint32_t te = ((uint32_t)xtime(s) << 24)
      | ((uint32_t)s << 16)
      | ((uint32_t)s << 8)
      | (uint32_t)(s ^ xtime(s));
    TE0[i] = te;
    TE1[i] = rotr32(te, 8);
    TE2[i] = rotr32(te, 16);
    TE3[i] = rotr32(te, 24);

    uint8_t t = ISBOX[i];
    /* (0e·t, 09·t, 0d·t, 0b·t), MSB first */
    uint32_t td = ((uint32_t)gmul(t, 14) << 24)
      | ((uint32_t)gmul(t, 9) << 16)
      | ((uint32_t)gmul(t, 13) << 8)
      | (uint32_t)gmul(t, 11);
    TD0[i] = td;
    TD1[i] = rotr32(td, 8);
    TD2[i] = rotr32(td, 16);
    TD3[i] = rotr32(td, 24);
  }

  tablesReady = 1;
}

static inline uint32_t loadBe32(const uint8_t* p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

static inline void storeBe32(uint8_t* p, uint32_t w) {
  p[0] = (uint8_t)(w >> 24);
  p[1] = (uint8_t)(w >> 16);
  p[2] = (uint8_t)(w >> 8);
  p[3] = (uint8_t)w;
}

static uint32_t subWord(uint32_t w) {
  return ((uint32_t)SBOX[(w >> 24) & 0xFF] << 24)
    | ((uint32_t)SBOX[(w >> 16) & 0xFF] << 16)
    | ((uint32_t)SBOX[(w >> 8) & 0xFF] << 8)
    | (uint32_t)SBOX[w & 0xFF];
}

static uint32_t invMixColumnWord(uint32_t w) {
  uint8_t a = (uint8_t)(w >> 24);
  uint8_t b = (uint8_t)(w >> 16);
  uint8_t c = (uint8_t)(w >> 8);
  uint8_t d = (uint8_t)w;
  return ((uint32_t)(gmul(a, 14) ^ gmul(b, 11) ^ gmul(c, 13) ^ gmul(d, 9)) << 24)
    | ((uint32_t)(gmul(a, 9) ^ gmul(b, 14) ^ gmul(c, 11) ^ gmul(d, 13)) << 16)
    | ((uint32_t)(gmul(a, 13) ^ gmul(b, 9) ^ gmul(c, 14) ^ gmul(d, 11)) << 8)
    | (uint32_t)(gmul(a, 11) ^ gmul(b, 13) ^ gmul(c, 9) ^ gmul(d, 14));
}

/*
 * Expand the AES-256 key currently in KEYBUF into encryption round keys;
 * withDec != 0 also derives decryption round keys (needed for IGE decrypt).
 */
EXPORT("expandKey") void expandKey(int withDec) {
  if (!tablesReady) initTables();

  for (int i = 0; i < 8; i++) {
    RK[i] = loadBe32(KEYBUF + 4 * i);
  }
  uint8_t rc = 1;
  for (int i = 8; i < RK_WORDS; i++) {
    uint32_t t = RK[i - 1];
    if ((i & 7) == 0) {
      t = subWord((t << 8) | (t >> 24)) ^ ((uint32_t)rc << 24);
      rc = xtime(rc);
    } else if ((i & 7) == 4) {
      t = subWord(t);
    }
    RK[i] = RK[i - 8] ^ t;
  }

  if (!withDec) return;

  for (int i = 0; i < 4; i++) {
    DK[i] = RK[ROUNDS * 4 + i];
    DK[ROUNDS * 4 + i] = RK[i];
  }
  for (int r = 1; r < ROUNDS; r++) {
    for (int i = 0; i < 4; i++) {
      DK[r * 4 + i] = invMixColumnWord(RK[(ROUNDS - r) * 4 + i]);
    }
  }
}

static inline void encryptBlockW(const uint32_t in[4], uint32_t out[4]) {
  uint32_t s0 = in[0] ^ RK[0];
  uint32_t s1 = in[1] ^ RK[1];
  uint32_t s2 = in[2] ^ RK[2];
  uint32_t s3 = in[3] ^ RK[3];
  uint32_t t0, t1, t2, t3;
  int k = 4;

  for (int r = 1; r < ROUNDS; r++) {
    t0 = TE0[s0 >> 24] ^ TE1[(s1 >> 16) & 0xFF] ^ TE2[(s2 >> 8) & 0xFF] ^ TE3[s3 & 0xFF] ^ RK[k];
    t1 = TE0[s1 >> 24] ^ TE1[(s2 >> 16) & 0xFF] ^ TE2[(s3 >> 8) & 0xFF] ^ TE3[s0 & 0xFF] ^ RK[k + 1];
    t2 = TE0[s2 >> 24] ^ TE1[(s3 >> 16) & 0xFF] ^ TE2[(s0 >> 8) & 0xFF] ^ TE3[s1 & 0xFF] ^ RK[k + 2];
    t3 = TE0[s3 >> 24] ^ TE1[(s0 >> 16) & 0xFF] ^ TE2[(s1 >> 8) & 0xFF] ^ TE3[s2 & 0xFF] ^ RK[k + 3];
    s0 = t0; s1 = t1; s2 = t2; s3 = t3;
    k += 4;
  }

  out[0] = (((uint32_t)SBOX[s0 >> 24] << 24) | ((uint32_t)SBOX[(s1 >> 16) & 0xFF] << 16)
    | ((uint32_t)SBOX[(s2 >> 8) & 0xFF] << 8) | (uint32_t)SBOX[s3 & 0xFF]) ^ RK[k];
  out[1] = (((uint32_t)SBOX[s1 >> 24] << 24) | ((uint32_t)SBOX[(s2 >> 16) & 0xFF] << 16)
    | ((uint32_t)SBOX[(s3 >> 8) & 0xFF] << 8) | (uint32_t)SBOX[s0 & 0xFF]) ^ RK[k + 1];
  out[2] = (((uint32_t)SBOX[s2 >> 24] << 24) | ((uint32_t)SBOX[(s3 >> 16) & 0xFF] << 16)
    | ((uint32_t)SBOX[(s0 >> 8) & 0xFF] << 8) | (uint32_t)SBOX[s1 & 0xFF]) ^ RK[k + 2];
  out[3] = (((uint32_t)SBOX[s3 >> 24] << 24) | ((uint32_t)SBOX[(s0 >> 16) & 0xFF] << 16)
    | ((uint32_t)SBOX[(s1 >> 8) & 0xFF] << 8) | (uint32_t)SBOX[s2 & 0xFF]) ^ RK[k + 3];
}

static inline void decryptBlockW(const uint32_t in[4], uint32_t out[4]) {
  uint32_t s0 = in[0] ^ DK[0];
  uint32_t s1 = in[1] ^ DK[1];
  uint32_t s2 = in[2] ^ DK[2];
  uint32_t s3 = in[3] ^ DK[3];
  uint32_t t0, t1, t2, t3;
  int k = 4;

  for (int r = 1; r < ROUNDS; r++) {
    t0 = TD0[s0 >> 24] ^ TD1[(s3 >> 16) & 0xFF] ^ TD2[(s2 >> 8) & 0xFF] ^ TD3[s1 & 0xFF] ^ DK[k];
    t1 = TD0[s1 >> 24] ^ TD1[(s0 >> 16) & 0xFF] ^ TD2[(s3 >> 8) & 0xFF] ^ TD3[s2 & 0xFF] ^ DK[k + 1];
    t2 = TD0[s2 >> 24] ^ TD1[(s1 >> 16) & 0xFF] ^ TD2[(s0 >> 8) & 0xFF] ^ TD3[s3 & 0xFF] ^ DK[k + 2];
    t3 = TD0[s3 >> 24] ^ TD1[(s2 >> 16) & 0xFF] ^ TD2[(s1 >> 8) & 0xFF] ^ TD3[s0 & 0xFF] ^ DK[k + 3];
    s0 = t0; s1 = t1; s2 = t2; s3 = t3;
    k += 4;
  }

  out[0] = (((uint32_t)ISBOX[s0 >> 24] << 24) | ((uint32_t)ISBOX[(s3 >> 16) & 0xFF] << 16)
    | ((uint32_t)ISBOX[(s2 >> 8) & 0xFF] << 8) | (uint32_t)ISBOX[s1 & 0xFF]) ^ DK[k];
  out[1] = (((uint32_t)ISBOX[s1 >> 24] << 24) | ((uint32_t)ISBOX[(s0 >> 16) & 0xFF] << 16)
    | ((uint32_t)ISBOX[(s3 >> 8) & 0xFF] << 8) | (uint32_t)ISBOX[s2 & 0xFF]) ^ DK[k + 1];
  out[2] = (((uint32_t)ISBOX[s2 >> 24] << 24) | ((uint32_t)ISBOX[(s1 >> 16) & 0xFF] << 16)
    | ((uint32_t)ISBOX[(s0 >> 8) & 0xFF] << 8) | (uint32_t)ISBOX[s3 & 0xFF]) ^ DK[k + 2];
  out[3] = (((uint32_t)ISBOX[s3 >> 24] << 24) | ((uint32_t)ISBOX[(s2 >> 16) & 0xFF] << 16)
    | ((uint32_t)ISBOX[(s1 >> 8) & 0xFF] << 8) | (uint32_t)ISBOX[s0 & 0xFF]) ^ DK[k + 3];
}

/*
 * AES-256-IGE over IO[0..len), in place. len must be a multiple of 16.
 * IVBUF holds (c_prev || m_prev) and is updated, so consecutive calls
 * continue the same IGE stream (used to slice payloads > IO_CAPACITY).
 * c_i = E(m_i ^ c_prev) ^ m_prev
 */
EXPORT("igeEncrypt") void igeEncrypt(uint32_t len) {
  uint32_t c0 = loadBe32(IVBUF);
  uint32_t c1 = loadBe32(IVBUF + 4);
  uint32_t c2 = loadBe32(IVBUF + 8);
  uint32_t c3 = loadBe32(IVBUF + 12);
  uint32_t m0 = loadBe32(IVBUF + 16);
  uint32_t m1 = loadBe32(IVBUF + 20);
  uint32_t m2 = loadBe32(IVBUF + 24);
  uint32_t m3 = loadBe32(IVBUF + 28);
  uint32_t x[4], y[4];

  for (uint32_t off = 0; off + 16 <= len; off += 16) {
    uint8_t* p = IO + off;
    uint32_t p0 = loadBe32(p);
    uint32_t p1 = loadBe32(p + 4);
    uint32_t p2 = loadBe32(p + 8);
    uint32_t p3 = loadBe32(p + 12);

    x[0] = p0 ^ c0; x[1] = p1 ^ c1; x[2] = p2 ^ c2; x[3] = p3 ^ c3;
    encryptBlockW(x, y);
    c0 = y[0] ^ m0; c1 = y[1] ^ m1; c2 = y[2] ^ m2; c3 = y[3] ^ m3;
    m0 = p0; m1 = p1; m2 = p2; m3 = p3;

    storeBe32(p, c0);
    storeBe32(p + 4, c1);
    storeBe32(p + 8, c2);
    storeBe32(p + 12, c3);
  }

  storeBe32(IVBUF, c0);
  storeBe32(IVBUF + 4, c1);
  storeBe32(IVBUF + 8, c2);
  storeBe32(IVBUF + 12, c3);
  storeBe32(IVBUF + 16, m0);
  storeBe32(IVBUF + 20, m1);
  storeBe32(IVBUF + 24, m2);
  storeBe32(IVBUF + 28, m3);
}

/* m_i = D(c_i ^ m_prev) ^ c_prev; requires expandKey(1) */
EXPORT("igeDecrypt") void igeDecrypt(uint32_t len) {
  uint32_t c0 = loadBe32(IVBUF);
  uint32_t c1 = loadBe32(IVBUF + 4);
  uint32_t c2 = loadBe32(IVBUF + 8);
  uint32_t c3 = loadBe32(IVBUF + 12);
  uint32_t m0 = loadBe32(IVBUF + 16);
  uint32_t m1 = loadBe32(IVBUF + 20);
  uint32_t m2 = loadBe32(IVBUF + 24);
  uint32_t m3 = loadBe32(IVBUF + 28);
  uint32_t x[4], y[4];

  for (uint32_t off = 0; off + 16 <= len; off += 16) {
    uint8_t* p = IO + off;
    uint32_t q0 = loadBe32(p);
    uint32_t q1 = loadBe32(p + 4);
    uint32_t q2 = loadBe32(p + 8);
    uint32_t q3 = loadBe32(p + 12);

    x[0] = q0 ^ m0; x[1] = q1 ^ m1; x[2] = q2 ^ m2; x[3] = q3 ^ m3;
    decryptBlockW(x, y);
    m0 = y[0] ^ c0; m1 = y[1] ^ c1; m2 = y[2] ^ c2; m3 = y[3] ^ c3;
    c0 = q0; c1 = q1; c2 = q2; c3 = q3;

    storeBe32(p, m0);
    storeBe32(p + 4, m1);
    storeBe32(p + 8, m2);
    storeBe32(p + 12, m3);
  }

  storeBe32(IVBUF, c0);
  storeBe32(IVBUF + 4, c1);
  storeBe32(IVBUF + 8, c2);
  storeBe32(IVBUF + 12, c3);
  storeBe32(IVBUF + 16, m0);
  storeBe32(IVBUF + 20, m1);
  storeBe32(IVBUF + 24, m2);
  storeBe32(IVBUF + 28, m3);
}

/*
 * AES-256-CTR over IO[0..len), in place. CTRSTATE persists the big-endian
 * counter and the partially consumed keystream block across calls, matching
 * the JS implementation in crypto.ts (arbitrary chunk sizes are supported).
 */
EXPORT("ctrRun") void ctrRun(uint32_t len) {
  uint8_t* counter = CTRSTATE;
  uint8_t* carry = CTRSTATE + 16;
  uint32_t used = (uint32_t)CTRSTATE[32]
    | ((uint32_t)CTRSTATE[33] << 8)
    | ((uint32_t)CTRSTATE[34] << 16)
    | ((uint32_t)CTRSTATE[35] << 24);
  uint32_t pos = 0;
  uint32_t ctrW[4], ksW[4];
  uint8_t ks[16];

  /* 1) Consume keystream carried over from the previous call */
  if (used > 0 && used < 16) {
    while (used < 16 && pos < len) {
      IO[pos] ^= carry[used];
      pos++;
      used++;
    }
  }
  if (used >= 16) used = 0;

  /* 2) Full blocks */
  while (pos + 16 <= len) {
    ctrW[0] = loadBe32(counter);
    ctrW[1] = loadBe32(counter + 4);
    ctrW[2] = loadBe32(counter + 8);
    ctrW[3] = loadBe32(counter + 12);
    encryptBlockW(ctrW, ksW);
    for (int j = 15; j >= 0; j--) {
      if (++counter[j] != 0) break;
    }

    uint8_t* p = IO + pos;
    storeBe32(ks, ksW[0]);
    storeBe32(ks + 4, ksW[1]);
    storeBe32(ks + 8, ksW[2]);
    storeBe32(ks + 12, ksW[3]);
    for (int j = 0; j < 16; j++) {
      p[j] ^= ks[j];
    }
    pos += 16;
  }

  /* 3) Tail (< 16 bytes): generate one block, keep the rest as carry */
  if (pos < len) {
    ctrW[0] = loadBe32(counter);
    ctrW[1] = loadBe32(counter + 4);
    ctrW[2] = loadBe32(counter + 8);
    ctrW[3] = loadBe32(counter + 12);
    encryptBlockW(ctrW, ksW);
    for (int j = 15; j >= 0; j--) {
      if (++counter[j] != 0) break;
    }

    storeBe32(carry, ksW[0]);
    storeBe32(carry + 4, ksW[1]);
    storeBe32(carry + 8, ksW[2]);
    storeBe32(carry + 12, ksW[3]);
    used = 0;
    while (pos < len) {
      IO[pos] ^= carry[used];
      pos++;
      used++;
    }
  }

  CTRSTATE[32] = (uint8_t)used;
  CTRSTATE[33] = (uint8_t)(used >> 8);
  CTRSTATE[34] = (uint8_t)(used >> 16);
  CTRSTATE[35] = (uint8_t)(used >> 24);
}

EXPORT("getIo") uint8_t* getIo(void) { return IO; }
EXPORT("getKey") uint8_t* getKey(void) { return KEYBUF; }
EXPORT("getIv") uint8_t* getIv(void) { return IVBUF; }
EXPORT("getCtrState") uint8_t* getCtrState(void) { return CTRSTATE; }
EXPORT("getIoCapacity") uint32_t getIoCapacity(void) { return IO_CAPACITY; }
