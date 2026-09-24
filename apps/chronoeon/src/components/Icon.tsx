import type { SVGProps } from "react";

export type IconName =
  | "agenda" | "month" | "week" | "day" | "idea" | "insights" | "plus" | "minus" | "search" | "folder"
  | "sun" | "moon" | "languages" | "chevron-left" | "chevron-right" | "calendar"
  | "check" | "clock" | "wallet" | "sparkle" | "more" | "pin" | "expand"
  | "chevron-double-left" | "chevron-double-right"
  | "close" | "trash" | "edit" | "arrow-right" | "map-pin" | "leaf" | "command"
  | "menu" | "inbox" | "target" | "book" | "refresh" | "minimize" | "maximize"
  | "restore" | "filter" | "drag" | "settings" | "download" | "upload"
  | "timer" | "play" | "pause" | "stop" | "image" | "tag" | "copy" | "clipboard" | "flag"
  | "bell" | "keyboard" | "chart" | "coins" | "chevron-down" | "chevron-up" | "camera";

const paths: Record<IconName, React.ReactNode> = {
  agenda: <><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/></>,
  month: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M9 10v11M15 10v11M3 15.5h18"/></>,
  week: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><rect x="5.5" y="13" width="13" height="4.5" rx="1.2" fill="currentColor" stroke="none" opacity=".82"/></>,
  day: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><rect x="8" y="12" width="8" height="6.5" rx="1.4" fill="currentColor" stroke="none" opacity=".82"/></>,
  idea: <><path d="M9 18h6M10 22h4"/><path d="M8.4 14.7A7 7 0 1 1 15.6 14.7C14.6 15.4 14 16.6 14 18h-4c0-1.4-.6-2.6-1.6-3.3Z"/></>,
  insights: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  minus: <path d="M5 12h14"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>,
  moon: <path d="M20.5 14.2A8.2 8.2 0 0 1 9.8 3.5 8.5 8.5 0 1 0 20.5 14.2Z"/>,
  languages: <><path d="m5 8 6 6M4 14l6-6 2-3"/><path d="M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></>,
  "chevron-left": <path d="m15 18-6-6 6-6"/>,
  "chevron-right": <path d="m9 18 6-6-6-6"/>,
  "chevron-double-left": <><path d="m12 18-6-6 6-6"/><path d="m19 18-6-6 6-6"/></>,
  "chevron-double-right": <><path d="m12 18 6-6-6-6"/><path d="m5 18 6-6-6-6"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  wallet: <><path d="M4 6h15a2 2 0 0 1 2 2v10H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12"/><path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z"/></>,
  sparkle: <><path d="m12 3 1.3 4.2L17.5 9l-4.2 1.8L12 15l-1.3-4.2L6.5 9l4.2-1.8Z"/><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  pin: <><path d="m14 4 6 6-3 1-4 4-1 5-3-3-4 4-1-1 4-4-3-3 5-1 4-4Z"/></>,
  expand: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></>,
  close: <path d="M6 6l12 12M18 6 6 18"/>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,
  edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
  "arrow-right": <><path d="M5 12h14M13 6l6 6-6 6"/></>,
  "map-pin": <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  leaf: <><path d="M20 4C12 4 5 8 5 15c0 3 2 5 5 5 7 0 10-8 10-16Z"/><path d="M5 20c2-5 6-8 11-11"/></>,
  command: <><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3Z"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16"/>,
  inbox: <><path d="M4 4h16l2 12H2Z"/><path d="M2 16h6a4 4 0 0 0 8 0h6"/></>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  book: <><path d="M4 5a3 3 0 0 1 3-2h5v18H7a3 3 0 0 0-3 2Z"/><path d="M20 5a3 3 0 0 0-3-2h-5v18h5a3 3 0 0 1 3 2Z"/></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.7-3.9L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.7 3.9L20 15"/><path d="M20 20v-5h-5"/></>,
  minimize: <path d="M5 12h14"/>,
  maximize: <rect x="5" y="5" width="14" height="14" rx="1.5"/>,
  restore: <><rect x="4" y="8" width="12" height="12" rx="1.5"/><path d="M8 8V5h12v12h-4"/></>,
  filter: <path d="M4 5h16l-6.2 7v5.3L10.2 19v-7Z"/>,
  drag: <><circle cx="9" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1" fill="currentColor" stroke="none"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 20h16"/></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/></>,
  timer: <><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6M12 2v3"/></>,
  play: <path d="M8 5.5v13l11-6.5Z"/>,
  pause: <><path d="M9 5v14M15 5v14"/></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.7"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5"/></>,
  camera: <><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/></>,
  tag: <><path d="M20.5 12.5 12 21l-9-9 8.5-8.5H20a1 1 0 0 1 1 1v7.3a1 1 0 0 1-.5.7Z"/><circle cx="16.5" cy="7.5" r="1.3"/></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></>,
  clipboard: <><rect x="8" y="6" width="11" height="13" rx="2"/><path d="M12 6V4h3v2"/><path d="M5 8v11a2 2 0 0 0 2 2h2"/><path d="M13 11h2M13 15h2"/></>,
  flag: <><path d="M5 21V4M5 4h11l-1.5 4L16 12H5"/></>,
  bell: <><path d="M18 15a6 6 0 0 0-12 0l-1.5 3h15Z"/><path d="M10 21h4"/><path d="M12 3v1.5"/></>,
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M7 14h10"/></>,
  chart: <><path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="12" width="3" height="5" rx=".8" fill="currentColor" stroke="none" opacity=".8"/><rect x="12" y="8" width="3" height="9" rx=".8" fill="currentColor" stroke="none" opacity=".8"/><rect x="17" y="14" width="3" height="3" rx=".8" fill="currentColor" stroke="none" opacity=".8"/></>,
  coins: <><ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-6"/><ellipse cx="15" cy="11" rx="6" ry="3"/></>,
  "chevron-down": <path d="m6 9 6 6 6-6"/>,
  "chevron-up": <path d="m6 15 6-6 6 6"/>
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
