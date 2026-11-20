import kali from "../assets/kalilinux.svg";
import linux from "../assets/linux.svg";
import metasploit from "../assets/metasploit.svg";
import windows from "../assets/windows11.svg";
import { cx } from "../lib/cx";
import "./media.scss";

const SRC = { windows, linux, kali, metasploit } as const;
export type Brand = keyof typeof SRC;

/** A brand logo, only where the thing is literally that tool or OS. Decorative: the name is always beside it. */
/** `large`: 24px at full strength, for a logo that stands alone as a node's mark (the Network path's Kali root). */
export function BrandIcon({ brand, large, className }: { brand: Brand; large?: boolean; className?: string }) {
  return (
    <img
      src={SRC[brand]}
      alt=""
      aria-hidden
      data-brand={brand}
      draggable={false}
      className={cx("brand-icon", large && "brand-icon--large", className)}
    />
  );
}
