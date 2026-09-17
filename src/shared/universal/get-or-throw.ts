export function getOrThrow<T>(value: T | null | undefined, message: Error | string, throwOnNull: true): T;
export function getOrThrow<T>(value: T | undefined, message: Error | string, throwOnNull?: false): T;
export function getOrThrow(value: unknown, message: Error | string, throwOnNull: boolean = false) {
  const shouldThrow = value === undefined || (throwOnNull && value === null);
  if (shouldThrow) throw message instanceof Error ? message : new Error(message);
  return value;
}
