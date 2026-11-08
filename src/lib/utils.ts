import { createCn } from "cn/config";

/**
 * shadcn's class joiner and Tailwind conflict resolver (`cn`), taught Raven's type roles so
 * `text-body` and a colour such as `text-fg-2` don't cancel each other. Feature code keeps
 * using `cx` (src/lib/cx.ts), which only joins; `cn` is for src/ui/shadcn.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["title", "heading", "body", "code", "meta", "label"] }],
    },
  },
});
