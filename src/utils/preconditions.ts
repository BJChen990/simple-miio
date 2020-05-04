export class Preconditions {
  static checkExists<T>(value: T | null | undefined, message?: string) {
    if (value == null) {
      throw new Error(message ?? 'missing required value');
    }
    return value;
  }

  static checkArgument(arg: boolean, message?: string) {
    if (!arg) {
      throw new Error(message ?? 'arugment check fail');
    }
  }
}
