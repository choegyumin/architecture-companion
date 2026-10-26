/* oxlint-disable no-restricted-imports -- Sole assembly point of the project's class-name utility; every other module must import `cn` from here. */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
