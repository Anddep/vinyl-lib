/**
 * Geometric icon set, transcribed from section 05 of the design system.
 *
 * The prototype drew these with nested divs and borders; here they are inline
 * SVG on a 1px stroke so they scale and inherit color via `currentColor`.
 * Every icon is decorative — the surrounding label carries the meaning — so
 * they render aria-hidden.
 */
import type { SetupIconName, StatIconName } from '../../types/collection';

interface IconProps {
  size?: number;
}

const decorative = {
  'aria-hidden': true,
  focusable: false,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  xmlns: 'http://www.w3.org/2000/svg',
} as const;

/** Vinyl mark: outer ring with a filled spindle dot. */
export function DiscIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={size} viewBox="0 0 26 26">
      <circle cx="13" cy="13" r="12.5" />
      <circle cx="13" cy="13" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BarsIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={size} viewBox="0 0 26 26" stroke="none">
      <rect x="4" y="16" width="4" height="10" fill="currentColor" />
      <rect x="11" y="6" width="4" height="20" fill="currentColor" />
      <rect x="18" y="12" width="4" height="14" fill="currentColor" />
    </svg>
  );
}

function SquareIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={size} viewBox="0 0 26 26">
      <rect x="0.5" y="0.5" width="25" height="25" rx="4" />
    </svg>
  );
}

/** Record sleeve: square with the opening seam near the top. */
function SleeveIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={size} viewBox="0 0 26 26">
      <rect x="0.5" y="0.5" width="25" height="25" rx="4" />
      <line x1="5" y1="7.5" x2="21" y2="7.5" />
    </svg>
  );
}

function TurntableIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={size} viewBox="0 0 26 26">
      <rect x="0.5" y="0.5" width="25" height="25" rx="4" />
      <circle cx="13" cy="13" r="5" />
      <line x1="21.5" y1="4" x2="17.5" y2="13" />
    </svg>
  );
}

function CartridgeIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={size} viewBox="0 0 26 26">
      <rect x="7.5" y="7.5" width="11" height="11" transform="rotate(45 13 13)" />
    </svg>
  );
}

function AmplifierIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={size} viewBox="0 0 26 26">
      <rect x="0.5" y="4.5" width="25" height="17" rx="4" />
      <circle cx="9" cy="13" r="3" />
      <line x1="15" y1="13" x2="21" y2="13" />
    </svg>
  );
}

function SpeakersIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={size} viewBox="0 0 26 26">
      <rect x="4.5" y="0.5" width="17" height="25" rx="4" />
      <circle cx="13" cy="7" r="2.5" />
      <circle cx="13" cy="17" r="4.5" />
    </svg>
  );
}

function CableIcon({ size = 26 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={size} viewBox="0 0 26 26">
      <line x1="2" y1="13" x2="24" y2="13" />
    </svg>
  );
}

/** Empty ring used on wishlist covers — a record slot with nothing in it. */
export function EmptyRingIcon({ size = 44 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={size} viewBox="0 0 44 44">
      <circle cx="22" cy="22" r="21.5" />
      <circle cx="22" cy="22" r="3" fill="currentColor" stroke="none" />
    </svg>
  );
}

const statIcons: Record<StatIconName, (props: IconProps) => JSX.Element> = {
  disc: DiscIcon,
  bars: BarsIcon,
  square: SquareIcon,
  sleeve: SleeveIcon,
};

const setupIcons: Record<SetupIconName, (props: IconProps) => JSX.Element> = {
  turntable: TurntableIcon,
  cartridge: CartridgeIcon,
  amplifier: AmplifierIcon,
  speakers: SpeakersIcon,
  cable: CableIcon,
};

export function StatIcon({ name, size }: { name: StatIconName } & IconProps): JSX.Element {
  const Icon = statIcons[name];
  return <Icon size={size} />;
}

export function SetupIcon({ name, size }: { name: SetupIconName } & IconProps): JSX.Element {
  const Icon = setupIcons[name];
  return <Icon size={size} />;
}

/* ---- Footer social marks ---- */

export function SocialSquareIcon({ size = 12 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={size} viewBox="0 0 12 12">
      <rect x="0.5" y="0.5" width="11" height="11" rx="3" />
    </svg>
  );
}

export function SocialRingsIcon({ size = 18 }: IconProps): JSX.Element {
  return (
    <svg {...decorative} width={size} height={(size * 8) / 18} viewBox="0 0 18 8">
      <circle cx="4" cy="4" r="3.5" />
      <circle cx="14" cy="4" r="3.5" />
    </svg>
  );
}

export function SocialPlayIcon({ size = 7 }: IconProps): JSX.Element {
  return (
    <svg
      {...decorative}
      width={size}
      height={(size * 8) / 7}
      viewBox="0 0 7 8"
      stroke="none"
      fill="currentColor"
    >
      <path d="M0 0 L7 4 L0 8 Z" />
    </svg>
  );
}
