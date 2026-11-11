// The site mark: a gem outline (a waystone seen from above) holding a "V" for
// "Việt". One colour, drawn with strokes, so it follows the theme through
// currentColor and stays legible from 16px favicons to the home page.
// public/favicon.svg is the same drawing on a fixed dark tile.
export function BrandMark({ size = 32, title }: { size?: number; title?: string }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="4.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d="M32 6 58 32 32 58 6 32Z" />
      <path d="M21 25 32 42 43 25" />
    </svg>
  );
}
