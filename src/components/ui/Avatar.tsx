import { initials, textOn } from "@/lib/format";

interface AvatarProps {
  name: string;
  color: string;
  /** Diameter in rem (the TV scales rem with screen width). */
  size?: number;
  dimmed?: boolean;
  className?: string;
}

/** A player's token: their colour, their initials, a thick ink outline. */
export function Avatar({ name, color, size = 4, dimmed = false, className = "" }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center rounded-full border-ink font-black transition ${
        dimmed ? "opacity-40 grayscale" : ""
      } ${className}`}
      style={{
        width: `${size}rem`,
        height: `${size}rem`,
        background: color,
        color: textOn(color),
        borderWidth: `${Math.max(0.15, size * 0.06)}rem`,
        fontSize: `${size * 0.38}rem`,
      }}
    >
      {initials(name)}
    </span>
  );
}
