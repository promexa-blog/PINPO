import type { SVGProps } from "react";

/** PINPO icon set: 24-unit grid, 1.75 stroke, round joins, currentColor. Decorative by default. */
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const IconPlus = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
export const IconCheck = (p: P) => <Svg {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
export const IconMenu = (p: P) => <Svg {...p}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>;
export const IconX = (p: P) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconArrowRight = (p: P) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const IconArrowUp = (p: P) => <Svg {...p}><path d="M12 19V5M6 11l6-6 6 6" /></Svg>;
export const IconArrowDown = (p: P) => <Svg {...p}><path d="M12 5v14M6 13l6 6 6-6" /></Svg>;
export const IconPause = (p: P) => <Svg {...p}><path d="M8 5.5v13M16 5.5v13" strokeWidth={2.5} /></Svg>;
export const IconArrowLeft = (p: P) => <Svg {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></Svg>;
export const IconChevronDown = (p: P) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconPlay = (p: P) => <Svg {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" /></Svg>;
export const IconSearch = (p: P) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>;
export const IconUpload = (p: P) => <Svg {...p}><path d="M12 15V4M7 9l5-5 5 5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" /></Svg>;
export const IconDownload = (p: P) => <Svg {...p}><path d="M12 4v11M7 10l5 5 5-5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15" /></Svg>;
export const IconTrash = (p: P) => <Svg {...p}><path d="M4.5 7h15M10 4h4M6.5 7l.8 11.6A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v5M14 11v5" /></Svg>;
export const IconCopy = (p: P) => <Svg {...p}><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></Svg>;
export const IconAlert = (p: P) => <Svg {...p}><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4M12 17h.01" /></Svg>;
export const IconInfo = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></Svg>;
export const IconSun = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" /></Svg>;
export const IconMoon = (p: P) => <Svg {...p}><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" /></Svg>;
export const IconMonitor = (p: P) => <Svg {...p}><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M8.5 20h7M12 16.5V20" /></Svg>;
/** Frames: three nested aspect ratios — the studio mark. */
export const IconFrames = (p: P) => <Svg {...p}><rect x="3" y="7" width="11" height="10" rx="1.5" /><rect x="9.5" y="3.5" width="7" height="17" rx="1.5" /><rect x="15" y="9" width="6" height="6" rx="1.2" /></Svg>;
export const IconFilm = (p: P) => <Svg {...p}><rect x="6.5" y="3" width="11" height="18" rx="2" /><path d="M6.5 7.5h11M6.5 16.5h11" /></Svg>;
export const IconSwatch = (p: P) => <Svg {...p}><circle cx="8" cy="8.5" r="4" /><circle cx="16" cy="8.5" r="4" /><circle cx="12" cy="15.5" r="4" /></Svg>;
export const IconLayout = (p: P) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9.5 4.5v15M9.5 11h11" /></Svg>;
export const IconSliders = (p: P) => <Svg {...p}><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></Svg>;
export const IconImage = (p: P) => <Svg {...p}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m4 18 5-5 4 4 2.5-2.5 4.5 4.5" /></Svg>;
export const IconMusic = (p: P) => <Svg {...p}><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></Svg>;
export const IconMic = (p: P) => <Svg {...p}><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></Svg>;
export const IconText = (p: P) => <Svg {...p}><path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" /></Svg>;
export const IconSparkCost = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M14.5 9.2c-.5-.9-1.4-1.4-2.5-1.4-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1.2 0-2.1-.5-2.6-1.5M12 6.2v1.6M12 16.2v1.6" /></Svg>;
export const IconLock = (p: P) => <Svg {...p}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></Svg>;
export const IconStar = (p: P) => <Svg {...p}><path d="m12 4 2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8 5.4-.7z" /></Svg>;
export const IconRefresh = (p: P) => <Svg {...p}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" /></Svg>;
