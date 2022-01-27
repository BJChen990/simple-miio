export function remove<T>(array: T[], index: number): T[] {
    if (index < 0 || index >= array.length) {
        throw new Error(`Try to remove an array item out of bound. Length: ${array.length}, index: ${index}`)
    }
    return [...array.slice(0, index), ...array.slice(index + 1)];
}