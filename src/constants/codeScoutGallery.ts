export type CodeScoutGallerySlide = {
  /** Path under `public/` (served from site root), e.g. `/code-scout-gallery/workbench.webp` */
  src: string;
  alt: string;
  /** Short label under the image */
  caption?: string;
};

/**
 * Drop screenshots into `public/code-scout-gallery/` (or any `public/` path) and list them here.
 * Recommended: WebP or PNG, ~16:9 or your native window aspect ratio.
 */
export const CODE_SCOUT_GALLERY_SLIDES: CodeScoutGallerySlide[] = [
  // Example (uncomment after adding files):
  // { src: "/code-scout-gallery/01-workbench.webp", alt: "Code Scout workbench with editor and AI panel", caption: "Workbench" },
  // { src: "/code-scout-gallery/02-plans.webp", alt: "Plan and agent activity", caption: "Plans & agents" },
];
