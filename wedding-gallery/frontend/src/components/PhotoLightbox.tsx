"use client";

import Lightbox from "yet-another-react-lightbox";
import Download from "yet-another-react-lightbox/plugins/download";
import { getPhotoUrl, type Photo, resolveApiUrl } from "@/lib/api";

type PhotoLightboxProps = {
  photos: Photo[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
};

export default function PhotoLightbox({
  photos,
  index,
  onClose,
  onIndexChange
}: PhotoLightboxProps) {
  const slides = photos.map((photo) => {
    const src = photo.download_url ? resolveApiUrl(photo.download_url) : getPhotoUrl(photo.key);
    return {
      src,
      download: src,
      title: photo.filename
    };
  });

  return (
    <Lightbox
      open={index >= 0}
      close={onClose}
      index={index >= 0 ? index : 0}
      slides={slides}
      plugins={[Download]}
      on={{
        view: ({ index: nextIndex }) => onIndexChange(nextIndex)
      }}
      controller={{ closeOnBackdropClick: true }}
    />
  );
}
