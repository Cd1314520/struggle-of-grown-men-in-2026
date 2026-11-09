import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const merge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["2xs", "xs", "sm", "base", "lg", "xl", "2xl", "3xl"] }] } },
});

export const cn = (...classes: ClassValue[]) => merge(clsx(classes));
