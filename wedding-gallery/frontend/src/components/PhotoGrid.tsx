"use client";

import { getPhotoUrl, type Photo, resolveApiUrl } from "@/lib/api";

type PhotoGridProps = {
  photos: Photo[];
  onOpen: (index: number) => void;
};

export default function PhotoGrid({ photos, onOpen }: PhotoGridProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {photos.map((photo, index) => {
        const thumbUrl = photo.thumbnail_url
          ? resolveApiUrl(photo.thumbnail_url)
          : getPhotoUrl(photo.key, true);
        const downloadUrl = photo.download_url
          ? resolveApiUrl(photo.download_url)
          : getPhotoUrl(photo.key);

        return (
          <article
            key={photo.key}
            className="glass-panel overflow-hidden rounded-2xl shadow-romantic transition-transform duration-300 hover:-translate-y-1"
          >
            <button
              type="button"
              onClick={() => onOpen(index)}
              className="block w-full text-left"
              aria-label={`Open ${photo.filename}`}
            >
              <img
                src={thumbUrl}
                alt={photo.filename}
                loading="lazy"
                className="h-72 w-full object-cover"
              />
            </button>

            <div className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-blush/25 px-3 py-1 text-xs font-semibold tracking-wide text-charcoal">
                  {photo.album}
                </span>
                <span className="text-xs font-medium text-charcoal/70">
                  Match {(photo.score * 100).toFixed(0)}%
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="line-clamp-1 text-sm text-charcoal/90">{photo.filename}</p>
                <a
                  href={downloadUrl}
                  download={photo.filename}
                  onClick={(event) => event.stopPropagation()}
                  className="rounded-lg bg-charcoal px-3 py-1.5 text-xs font-semibold text-cream transition hover:bg-charcoal/85"
                >
                  Download
                </a>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
