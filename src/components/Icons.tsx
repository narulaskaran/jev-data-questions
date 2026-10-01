import type { ReactNode, SVGProps } from 'react'

const Svg = ({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>{children}</svg>
)

export const PlayIcon = () => <Svg fill="currentColor" stroke="none"><path d="M4.5 2.8v10.4a.6.6 0 0 0 .92.5l8.1-5.2a.6.6 0 0 0 0-1L5.42 2.3a.6.6 0 0 0-.92.5Z" /></Svg>
export const PauseIcon = () => <Svg fill="currentColor" stroke="none"><rect x="3.5" y="2.5" width="3.2" height="11" rx="1" /><rect x="9.3" y="2.5" width="3.2" height="11" rx="1" /></Svg>
export const LinkIcon = () => <Svg><path d="M6.7 9.3a3 3 0 0 0 4.2 0l2.2-2.2a3 3 0 0 0-4.2-4.2l-.9.9" /><path d="M9.3 6.7a3 3 0 0 0-4.2 0L2.9 8.9a3 3 0 0 0 4.2 4.2l.9-.9" /></Svg>
export const DownloadIcon = () => <Svg><path d="M8 2.5v8" /><path d="m4.8 7.6 3.2 3.2 3.2-3.2" /><path d="M2.8 13.2h10.4" /></Svg>
export const CheckIcon = () => <Svg strokeWidth="2"><path d="m3.2 8.4 3.1 3.1 6.5-7" /></Svg>
export const CrossIcon = () => <Svg strokeWidth="2"><path d="m4 4 8 8M12 4l-8 8" /></Svg>
export const UploadIcon = () => <Svg><path d="M8 10.5v-8" /><path d="M4.8 5.4 8 2.2l3.2 3.2" /><path d="M2.8 10.2v2a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-2" /></Svg>
export const SparkIcon = () => <Svg><path d="M8 1.8v3.4M8 10.8v3.4M1.8 8h3.4M10.8 8h3.4M3.6 3.6l2 2M10.4 10.4l2 2M12.4 3.6l-2 2M5.6 10.4l-2 2" /></Svg>
export const ArrowIcon = () => <Svg><path d="M3 8h10" /><path d="m9 4 4 4-4 4" /></Svg>
export const PlusIcon = () => <Svg><path d="M8 3v10M3 8h10" /></Svg>
export const AlertIcon = () => <Svg><path d="M8 2.2 1.8 13h12.4L8 2.2Z" /><path d="M8 6.5v3" /><path d="M8 11.4v.1" /></Svg>
export const StopIcon = () => <Svg fill="currentColor" stroke="none"><rect x="3.5" y="3.5" width="9" height="9" rx="1.6" /></Svg>
