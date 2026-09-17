import { createSafeContext } from "@/shared/react/safe-context";

type Theme = "dark" | "light" | "system";
type ResolvedTheme = Exclude<Theme, "system">;

type ThemeContextValue = Readonly<{
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  theme: Theme;
}>;

const { Provider: ThemeContextProvider, useSafeContext: useTheme } = createSafeContext<ThemeContextValue>({
  defaultValue: { resolvedTheme: "light", setTheme: () => undefined, theme: "system" },
  displayName: "ThemeContext",
});

export { ThemeContextProvider, useTheme };
export type { ResolvedTheme, Theme };
