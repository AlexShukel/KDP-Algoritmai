import { Algorithm } from './types/algorithm';

/** Algorithm factory for creating configured algorithm instances */
export class AlgorithmFactory {
    private static algorithms = new Map<string, () => Algorithm>();

    static register(name: string, factory: () => Algorithm): void {
        this.algorithms.set(name, factory);
    }

    static create(name: string): Algorithm {
        const factory = this.algorithms.get(name);
        if (!factory) {
            throw new Error(`Unknown algorithm: ${name}`);
        }
        return factory();
    }

    static getAvailable(): ReadonlyArray<string> {
        return Array.from(this.algorithms.keys());
    }
}
