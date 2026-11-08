import kali from "../assets/kalilinux.svg";
import linux from "../assets/linux.svg";
import metasploit from "../assets/metasploit.svg";
import windows from "../assets/windows11.svg";
import { cx } from "../lib/cx";

const SRC = { windows, linux, kali, metasploit } as const;
export type Brand = keyof typeof SRC;

/** A brand logo, only where the thing is literally that tool or OS. Decorative: the name is always beside it. */
export function BrandIcon({ brand, className }: { brand: Brand; className?: string }) {
  return (
    <img
      src={SRC[brand]}
      alt=""
      aria-hidden
      data-brand={brand}
      draggable={false}
      // The SVGs are single-colour (some white, some black): normalise to the muted foreground.
      className={cx("size-4 brightness-0 invert opacity-70", className)}
    />
  );
}
