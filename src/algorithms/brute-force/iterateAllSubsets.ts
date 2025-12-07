/**
 * Iterates over every possible non-empty subset of the available items (bits) efficiently.
 *
 * This function uses a bitwise trick `(submask - 1) & remainingMask` to iterate strictly
 * through valid submasks in descending numerical order without generating invalid
 * permutations.
 *
 * @param assignmentMask - The bitmask of items already assigned/used.
 * @param fullMask - The bitmask representing all items in the problem space.
 * @param cb - A callback function invoked for every valid submask found.
 *
 * @complexity O(2^k) where k is the number of unassigned bits.
 * @note This iterates `2^k - 1` times (it excludes the empty set/0 mask).
 */
export const iterateAllSubsets = (assignmentMask: number, fullMask: number, cb: (mask: number) => void) => {
    const remainingMask = fullMask ^ assignmentMask;

    let submask = remainingMask;

    while (submask > 0) {
        cb(submask);
        submask = (submask - 1) & remainingMask;
    }
};

if (import.meta.vitest) {
    const { test, expect } = import.meta.vitest;

    test('should iterate 3 unassigned orders (all subsets of {A,B,C})', () => {
        const fullMask = 0b111; // 7 (Orders 0, 1, 2)
        const assignedMask = 0; // Nothing assigned yet

        const results: number[] = [];
        iterateAllSubsets(assignedMask, fullMask, mask => results.push(mask));

        // Expect 2^3 - 1 = 7 subsets
        expect(results).toHaveLength(7);

        // Should contain specific combinations
        expect(results).toContain(0b111); // {0,1,2}
        expect(results).toContain(0b011); // {0,1}
        expect(results).toContain(0b001); // {0}
        expect(results).toContain(0b101); // {0,2}

        // Should NOT contain 0 (empty set)
        expect(results).not.toContain(0);
    });

    test('should handle partial assignments correctly', () => {
        // Setup: 4 Orders {0,1,2,3} (1111)
        // Order {0, 2} (0101) are already assigned to a previous vehicle
        // Remaining to iterate: {1, 3} (1010)
        const fullMask = 0b1111;
        const assignedMask = 0b0101;

        const results: number[] = [];
        iterateAllSubsets(assignedMask, fullMask, mask => results.push(mask));

        // Remaining bits are 1 and 3. Total 2 bits.
        // Expect 2^2 - 1 = 3 subsets ({1,3}, {3}, {1})
        expect(results).toHaveLength(3);

        expect(results).toContain(0b1010); // Both {1, 3}
        expect(results).toContain(0b1000); // Just {3}
        expect(results).toContain(0b0010); // Just {1}

        // Verify NO result contains the already assigned bits (0 or 2)
        results.forEach(mask => {
            expect(mask & assignedMask).toBe(0);
        });
    });

    test('should handle large input (10 orders)', () => {
        // 10 orders is usually the limit for brute force
        // 2^10 - 1 = 1023 subsets
        const fullMask = (1 << 10) - 1; // 1023
        const assignedMask = 0;

        let count = 0;
        iterateAllSubsets(assignedMask, fullMask, () => ++count);

        expect(count).toBe(1023);
    });

    test('should do nothing if all items are already assigned', () => {
        const fullMask = 0b111;
        const assignedMask = 0b111; // Everything taken

        const results: number[] = [];
        iterateAllSubsets(assignedMask, fullMask, m => results.push(m));

        expect(results).toHaveLength(0);
    });

    test('should strict verify subset logic', () => {
        // Logic check: ensure every generated mask is actually a subset of the remaining mask
        // and that no duplicates are generated
        const fullMask = 0b11110000;
        const assignedMask = 0b00000000;
        const remaining = 0b11110000;

        const results = new Set<number>();

        iterateAllSubsets(assignedMask, fullMask, mask => {
            // Assert: Is subset?
            expect(mask | remaining).toBe(remaining);
            // Assert: Not 0?
            expect(mask).not.toBe(0);

            results.add(mask);
        });

        expect(results.size).toBe(15);
    });
}
