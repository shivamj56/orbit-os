package com.gathin.tvhome;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * A QR code of the phone portal's address, for the TV to show beside the pairing code, so the phone's camera opens the
 * page without anyone typing an address. It is made here by hand because this launcher takes no libraries, and it has
 * only what an address needs: byte mode, versions 1 to 10, all eight masks tried and the one the standard scores best
 * kept, and the error correction raised as high as the smallest size that fits allows, so a code seen from the sofa at
 * an angle still reads.
 */
final class PortalQr {

    private static final int MAX_VERSION = 10;
    /** The error correction levels, weakest first, and the two bits each is written as in the format information. */
    private static final int MEDIUM = 1, QUARTILE = 2, HIGH = 3;
    private static final int[] LEVEL_BITS = {1, 0, 3, 2};
    /** The standard's block table for versions 1 to 10 (index 0 unused), per level: error correction codewords per block. */
    private static final int[][] ECC_PER_BLOCK = {
            {0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18},
            {0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26},
            {0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24},
            {0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28},
    };
    /** And how many blocks the codewords are split into. */
    private static final int[][] BLOCKS = {
            {0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4},
            {0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5},
            {0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8},
            {0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8},
    };

    private PortalQr() {
    }

    /**
     * Rows of modules, true for dark, with no quiet zone: whoever draws it leaves at least four modules of light margin
     * around it. Null when the text does not fit version 10.
     */
    static boolean[][] encode(String text) {
        byte[] data = text.getBytes(StandardCharsets.UTF_8);
        int version = 1;
        while (version <= MAX_VERSION && !fits(data.length, version, MEDIUM)) version++;
        if (version > MAX_VERSION) return null;
        int level = MEDIUM;
        for (int stronger = HIGH; stronger >= QUARTILE; stronger--) {
            if (fits(data.length, version, stronger)) {
                level = stronger;
                break;
            }
        }
        Symbol symbol = new Symbol(version);
        symbol.place(interleave(dataCodewords(data, version, level), version, level));
        symbol.chooseMask(level);
        return symbol.dark;
    }

    // ---- capacity ----

    private static int countBits(int version) {
        return version <= 9 ? 8 : 16;
    }

    private static boolean fits(int bytes, int version, int level) {
        int bits = countBits(version);
        return bytes < (1 << bits) && 4 + bits + 8L * bytes <= 8L * dataCodewordCount(version, level);
    }

    /** Modules left for codewords and remainder bits once every fixed pattern is drawn. */
    private static int rawModules(int version) {
        int modules = (16 * version + 128) * version + 64;
        if (version >= 2) {
            int align = version / 7 + 2;
            modules -= (25 * align - 10) * align - 55;
            if (version >= 7) modules -= 36;
        }
        return modules;
    }

    private static int dataCodewordCount(int version, int level) {
        return rawModules(version) / 8 - ECC_PER_BLOCK[level][version] * BLOCKS[level][version];
    }

    // ---- codewords ----

    /** Mode, length and the bytes, then the terminator and the standard's two pad bytes taking turns. */
    private static byte[] dataCodewords(byte[] data, int version, int level) {
        int capacity = dataCodewordCount(version, level) * 8;
        byte[] out = new byte[capacity / 8];
        int[] at = {0};
        put(out, at, 0b0100, 4);
        put(out, at, data.length, countBits(version));
        for (byte b : data) put(out, at, b & 0xFF, 8);
        put(out, at, 0, Math.min(4, capacity - at[0]));
        put(out, at, 0, (8 - at[0] % 8) % 8);
        for (int pad = 0xEC; at[0] < capacity; pad ^= 0xEC ^ 0x11) put(out, at, pad, 8);
        return out;
    }

    private static void put(byte[] out, int[] at, int value, int bits) {
        for (int i = bits - 1; i >= 0; i--, at[0]++) {
            if (((value >>> i) & 1) != 0) out[at[0] >>> 3] |= (byte) (0x80 >>> (at[0] & 7));
        }
    }

    /**
     * Splits the data into the version's blocks, adds each block's Reed-Solomon codewords, and interleaves them the way
     * the standard reads them back: the n-th data codeword of every block in turn, then the same for the error correction.
     */
    private static byte[] interleave(byte[] data, int version, int level) {
        int blocks = BLOCKS[level][version];
        int eccLength = ECC_PER_BLOCK[level][version];
        int total = rawModules(version) / 8;
        int shortBlocks = blocks - total % blocks;
        int shortData = total / blocks - eccLength;
        byte[] divisor = divisor(eccLength);
        byte[][] parts = new byte[blocks][];
        byte[][] ecc = new byte[blocks][];
        for (int i = 0, from = 0; i < blocks; i++) {
            int length = shortData + (i < shortBlocks ? 0 : 1);
            parts[i] = Arrays.copyOfRange(data, from, from + length);
            ecc[i] = remainder(parts[i], divisor);
            from += length;
        }
        byte[] out = new byte[total];
        int n = 0;
        for (int i = 0; i <= shortData; i++) {
            for (byte[] part : parts) {
                if (i < part.length) out[n++] = part[i];
            }
        }
        for (int i = 0; i < eccLength; i++) {
            for (byte[] part : ecc) out[n++] = part[i];
        }
        return out;
    }

    /** The generator polynomial (x - 1)(x - 2)...(x - 2^(degree-1)) over GF(256), highest power first, leading 1 left out. */
    private static byte[] divisor(int degree) {
        byte[] poly = new byte[degree];
        poly[degree - 1] = 1;
        int root = 1;
        for (int i = 0; i < degree; i++) {
            for (int j = 0; j < degree; j++) {
                poly[j] = (byte) multiply(poly[j] & 0xFF, root);
                if (j + 1 < degree) poly[j] ^= poly[j + 1];
            }
            root = multiply(root, 2);
        }
        return poly;
    }

    private static byte[] remainder(byte[] data, byte[] divisor) {
        byte[] rest = new byte[divisor.length];
        for (byte b : data) {
            int factor = (b ^ rest[0]) & 0xFF;
            System.arraycopy(rest, 1, rest, 0, rest.length - 1);
            rest[rest.length - 1] = 0;
            for (int i = 0; i < rest.length; i++) rest[i] ^= (byte) multiply(divisor[i] & 0xFF, factor);
        }
        return rest;
    }

    /** Multiplication in GF(256) with the QR polynomial x^8 + x^4 + x^3 + x^2 + 1. */
    private static int multiply(int x, int y) {
        int z = 0;
        for (int i = 7; i >= 0; i--) {
            z = (z << 1) ^ ((z >>> 7) * 0x11D);
            z ^= ((y >>> i) & 1) * x;
        }
        return z;
    }

    // ---- the symbol ----

    private static final class Symbol {
        final int version, size;
        final boolean[][] dark;
        /** Finder, timing, alignment, format and version modules, which data and masks never touch. */
        final boolean[][] fixed;

        Symbol(int version) {
            this.version = version;
            size = version * 4 + 17;
            dark = new boolean[size][size];
            fixed = new boolean[size][size];
            for (int i = 0; i < size; i++) {
                set(6, i, i % 2 == 0);
                set(i, 6, i % 2 == 0);
            }
            finder(3, 3);
            finder(size - 4, 3);
            finder(3, size - 4);
            int[] at = alignmentCentres();
            int last = at.length - 1;
            for (int i = 0; i <= last; i++) {
                for (int j = 0; j <= last; j++) {
                    // The three corners already hold finders.
                    if ((i == 0 && j == 0) || (i == 0 && j == last) || (i == last && j == 0)) continue;
                    alignment(at[i], at[j]);
                }
            }
            // Reserved now so data goes around it; the real bits come with the mask.
            format(0, 0);
            versionBits();
        }

        private void set(int x, int y, boolean on) {
            dark[y][x] = on;
            fixed[y][x] = true;
        }

        private void finder(int cx, int cy) {
            for (int dy = -4; dy <= 4; dy++) {
                for (int dx = -4; dx <= 4; dx++) {
                    int x = cx + dx, y = cy + dy;
                    if (x < 0 || y < 0 || x >= size || y >= size) continue;
                    int ring = Math.max(Math.abs(dx), Math.abs(dy));
                    set(x, y, ring != 2 && ring != 4);
                }
            }
        }

        private void alignment(int cx, int cy) {
            for (int dy = -2; dy <= 2; dy++) {
                for (int dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1);
            }
        }

        private int[] alignmentCentres() {
            if (version == 1) return new int[0];
            int count = version / 7 + 2;
            int step = (version * 4 + count * 2 + 1) / (count * 2 - 2) * 2;
            int[] at = new int[count];
            at[0] = 6;
            for (int i = count - 1, position = size - 7; i >= 1; i--, position -= step) at[i] = position;
            return at;
        }

        /** Both copies of the 15 format bits: level and mask with their BCH code, then the standard's XOR pattern. */
        private void format(int level, int mask) {
            int data = LEVEL_BITS[level] << 3 | mask;
            int rest = data;
            for (int i = 0; i < 10; i++) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
            int bits = (data << 10 | rest) ^ 0x5412;
            for (int i = 0; i <= 5; i++) set(8, i, bit(bits, i));
            set(8, 7, bit(bits, 6));
            set(8, 8, bit(bits, 7));
            set(7, 8, bit(bits, 8));
            for (int i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
            for (int i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits, i));
            for (int i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits, i));
            set(8, size - 8, true);
        }

        /** From version 7 on, the version number with its Golay code, by the top-right and bottom-left finders. */
        private void versionBits() {
            if (version < 7) return;
            int rest = version;
            for (int i = 0; i < 12; i++) rest = (rest << 1) ^ ((rest >>> 11) * 0x1F25);
            int bits = version << 12 | rest;
            for (int i = 0; i < 18; i++) {
                boolean on = bit(bits, i);
                int a = size - 11 + i % 3, b = i / 3;
                set(a, b, on);
                set(b, a, on);
            }
        }

        /** The codewords in the standard's zigzag: two columns at a time from the right, up then down, around fixed modules. */
        void place(byte[] codewords) {
            int i = 0, bits = codewords.length * 8;
            for (int right = size - 1; right >= 1; right -= 2) {
                if (right == 6) right = 5;
                boolean upward = ((right + 1) & 2) == 0;
                for (int step = 0; step < size; step++) {
                    int y = upward ? size - 1 - step : step;
                    for (int j = 0; j < 2; j++) {
                        int x = right - j;
                        if (fixed[y][x] || i >= bits) continue;
                        dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) != 0;
                        i++;
                    }
                }
            }
        }

        void chooseMask(int level) {
            int best = 0, lowest = Integer.MAX_VALUE;
            for (int mask = 0; mask < 8; mask++) {
                flip(mask);
                format(level, mask);
                int score = penalty();
                if (score < lowest) {
                    lowest = score;
                    best = mask;
                }
                flip(mask);
            }
            flip(best);
            format(level, best);
        }

        private void flip(int mask) {
            for (int y = 0; y < size; y++) {
                for (int x = 0; x < size; x++) {
                    if (fixed[y][x]) continue;
                    boolean invert;
                    switch (mask) {
                        case 0: invert = (x + y) % 2 == 0; break;
                        case 1: invert = y % 2 == 0; break;
                        case 2: invert = x % 3 == 0; break;
                        case 3: invert = (x + y) % 3 == 0; break;
                        case 4: invert = (x / 3 + y / 2) % 2 == 0; break;
                        case 5: invert = x * y % 2 + x * y % 3 == 0; break;
                        case 6: invert = (x * y % 2 + x * y % 3) % 2 == 0; break;
                        default: invert = ((x + y) % 2 + x * y % 3) % 2 == 0; break;
                    }
                    if (invert) dark[y][x] = !dark[y][x];
                }
            }
        }

        /** The standard's four penalty rules: long runs, 2 x 2 blocks, finder look-alikes, and dark far from half. */
        private int penalty() {
            int score = 0;
            for (int line = 0; line < size; line++) score += runs(line, true) + runs(line, false);
            for (int y = 0; y + 1 < size; y++) {
                for (int x = 0; x + 1 < size; x++) {
                    boolean c = dark[y][x];
                    if (c == dark[y][x + 1] && c == dark[y + 1][x] && c == dark[y + 1][x + 1]) score += 3;
                }
            }
            for (int line = 0; line < size; line++) {
                for (int k = 0; k + 6 < size; k++) {
                    if (finderLike(line, k, true)) score += 40;
                    if (finderLike(line, k, false)) score += 40;
                }
            }
            int darkCount = 0;
            for (boolean[] row : dark) {
                for (boolean on : row) if (on) darkCount++;
            }
            int total = size * size;
            return score + Math.abs(darkCount * 20 - total * 10) / total * 10;
        }

        private boolean at(int line, int k, boolean across) {
            return across ? dark[line][k] : dark[k][line];
        }

        private int runs(int line, boolean across) {
            int score = 0, run = 0;
            boolean colour = false;
            for (int k = 0; k < size; k++) {
                boolean c = at(line, k, across);
                if (k > 0 && c == colour) {
                    run++;
                } else {
                    if (run >= 5) score += run - 2;
                    colour = c;
                    run = 1;
                }
            }
            if (run >= 5) score += run - 2;
            return score;
        }

        /** Dark, light, three dark, light, dark from k, with four light modules (or the edge) before or after it. */
        private boolean finderLike(int line, int k, boolean across) {
            if (!at(line, k, across) || at(line, k + 1, across) || !at(line, k + 2, across) || !at(line, k + 3, across)
                    || !at(line, k + 4, across) || at(line, k + 5, across) || !at(line, k + 6, across)) {
                return false;
            }
            return light(line, k - 4, k, across) || light(line, k + 7, k + 11, across);
        }

        private boolean light(int line, int from, int to, boolean across) {
            for (int k = Math.max(0, from); k < Math.min(size, to); k++) {
                if (at(line, k, across)) return false;
            }
            return true;
        }

        private static boolean bit(int value, int i) {
            return ((value >>> i) & 1) != 0;
        }
    }
}
