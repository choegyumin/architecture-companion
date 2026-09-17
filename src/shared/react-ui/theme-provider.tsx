import { type ReactNode, useEffect, useState } from "react";

import { type ResolvedTheme, type Theme, ThemeContextProvider } from "@/shared/react-ui/theme-context";

type ThemeProviderProps = Readonly<{
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey: string;
}>;

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredTheme(storageKey: string, fallback: Theme): Theme {
  try {
    const storedTheme = window.localStorage.getItem(storageKey);
    return storedTheme === "dark" || storedTheme === "light" || storedTheme === "system" ? storedTheme : fallback;
  } catch {
    return fallback;
  }
}

function ThemeProvider({ children, defaultTheme = "system", storageKey }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme(storageKey, defaultTheme));
  const resolvedTheme = theme === "system" ? getSystemTheme() : theme;

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const setTheme = (nextTheme: Theme) => {
    try {
      window.localStorage.setItem(storageKey, nextTheme);
    } catch {
      // Keep the in-memory selection when browser storage is unavailable.
    }
    setThemeState(nextTheme);
  };

  return <ThemeContextProvider value={{ resolvedTheme, setTheme, theme }}>{children}</ThemeContextProvider>;
}

export { ThemeProvider };
