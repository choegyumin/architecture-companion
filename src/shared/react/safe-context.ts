import React, { useContext } from "react";

const NotInitializedSymbol = Symbol("");

export type SafeContext<T> = {
  Provider: React.Provider<T>;
  useSafeContext: () => T;
};

export function createSafeContext<T>(config?: { defaultValue?: T; displayName?: string }): SafeContext<T> {
  // oxlint-disable-next-line repo/no-restricted-syntax -- This is the safe context factory implementation.
  const Context = React.createContext<T | typeof NotInitializedSymbol>(config?.defaultValue ?? NotInitializedSymbol);
  Context.displayName = config?.displayName ?? "SafeContext";

  function useSafeContext(): T {
    const value = useContext(Context);
    if (value === NotInitializedSymbol) {
      throw new Error(`Component must be wrapped with <${Context.displayName}.Provider>.`);
    }
    return value;
  }

  return { Provider: Context.Provider as React.Provider<T>, useSafeContext };
}
