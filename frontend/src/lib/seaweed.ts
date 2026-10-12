const FILER_BASE = (process.env.NEXT_PUBLIC_SEAWEEDFS_FILER_URL ?? "").replace(/\/$/, "");

export function getSafeImageUrl(croppedImagePath: string | null | undefined): string {
  if (!croppedImagePath) return "";
  const path = croppedImagePath.trim();
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (!FILER_BASE) return "";
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  return `${FILER_BASE}/${cleanPath}`;
}
