import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui's class helper: merge conditional classes, last Tailwind wins. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
