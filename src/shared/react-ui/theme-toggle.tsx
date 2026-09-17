import { type ComponentProps } from "react";

import { cn } from "@/shared/react/class-name";
import { Button } from "@/shared/react-ui/button";
import { useTheme } from "@/shared/react-ui/theme-context";

type ThemeToggleProps = Readonly<{
  className?: ComponentProps<typeof Button>["className"];
  variant?: ComponentProps<typeof Button>["variant"];
}>;

function ThemeToggle({ variant = "ghost", className }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      aria-label="Toggle theme"
      className={cn("size-8", className)}
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      size="icon"
      variant={variant}
    >
      <svg
        aria-hidden="true"
        className="size-4.5"
        fill="none"
        height="24"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M0 0h24v24H0z" fill="none" stroke="none" />
        <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
        <path d="M12 3l0 18" />
        <path d="M12 9l4.65 -4.65" />
        <path d="M12 14.3l7.37 -7.37" />
        <path d="M12 19.6l8.85 -8.85" />
      </svg>
    </Button>
  );
}

export { ThemeToggle };
