"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import PhotoGrid from "@/components/PhotoGrid";
import PhotoLightbox from "@/components/PhotoLightbox";
import { downloadAll, type MatchResponse } from "@/lib/api";

const STORAGE_KEY = "wedding-gallery-results";

export default function GalleryPage() {
  const [results, setResults] = useState<MatchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const [selectedAlbum, setSelectedAlbum] = useState<string | null>(null);

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setLoading(false);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as MatchResponse;
      if (Array.isArray(parsed.matched)) {
        setResults(parsed);
      }
    } catch {
      // Ignore invalid storage payload.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  async function handleDownloadAll() {
    const targetPhotos = selectedAlbum
      ? results?.matched.filter((photo) => photo.album === selectedAlbum) ?? []
      : results?.matched ?? [];

    if (!targetPhotos.length) {
      return;
    }

    try {
      setDownloading(true);
      setDownloadError(null);
      await downloadAll(targetPhotos);
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "Could not create ZIP. Please try again."
      );
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="glass-panel rounded-2xl px-6 py-4 text-sm text-charcoal/80">
          Loading your gallery...
        </div>
      </main>
    );
  }

  if (!results) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="glass-panel max-w-md space-y-3 rounded-2xl p-6 text-center">
          <h1 className="text-3xl">No matches loaded</h1>
          <p className="text-sm text-charcoal/80">
            Upload a selfie on the home page to see your personalized wedding gallery.
          </p>
          <Link href="/" className="inline-block font-semibold text-charcoal underline">
            Try a different selfie
          </Link>
        </div>
      </main>
    );
  }

  const groupedByAlbum = results.matched.reduce<Record<string, typeof results.matched>>(
    (acc, photo) => {
      if (!acc[photo.album]) {
        acc[photo.album] = [];
      }
      acc[photo.album].push(photo);
      return acc;
    },
    {}
  );
  const albumEntries = Object.entries(groupedByAlbum).sort((a, b) => b[1].length - a[1].length);

  const eventPhotos = selectedAlbum ? groupedByAlbum[selectedAlbum] ?? [] : [];
  const eventTitle = selectedAlbum ? selectedAlbum : "All Events";

  return (
    <main className="min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="glass-panel rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h1 className="text-4xl text-charcoal sm:text-5xl">
                We found {results.total} photos with you 🎉
              </h1>
              <p className="text-sm text-charcoal/75">
                {selectedAlbum
                  ? `Viewing event: ${eventTitle}. Tap any photo to open full-screen.`
                  : "Choose an event first, then browse only that event's photos."}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDownloadAll}
                disabled={downloading}
                className="rounded-xl bg-charcoal px-4 py-2 text-sm font-semibold text-cream transition hover:bg-charcoal/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {downloading
                  ? "Preparing ZIP..."
                  : selectedAlbum
                    ? `Download ${eventTitle}`
                    : "Download All"}
              </button>
              {selectedAlbum ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAlbum(null);
                    setLightboxIndex(-1);
                  }}
                  className="rounded-xl border border-charcoal/20 bg-white px-4 py-2 text-sm font-semibold text-charcoal transition hover:border-charcoal/40"
                >
                  Back to Events
                </button>
              ) : null}
              <Link
                href="/"
                className="rounded-xl border border-charcoal/20 bg-white px-4 py-2 text-sm font-semibold text-charcoal transition hover:border-charcoal/40"
              >
                Try a different selfie
              </Link>
            </div>
          </div>
          {downloadError ? (
            <p className="mt-3 rounded-xl bg-blush/25 px-3 py-2 text-sm text-charcoal">
              {downloadError}
            </p>
          ) : null}
        </header>

        {!selectedAlbum ? (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {albumEntries.map(([album, photos]) => (
              <button
                key={album}
                type="button"
                onClick={() => {
                  setSelectedAlbum(album);
                  setLightboxIndex(-1);
                }}
                className="glass-panel overflow-hidden rounded-2xl text-left shadow-romantic transition hover:-translate-y-1"
              >
                <img
                  src={photos[0]?.thumbnail_url}
                  alt={`${album} preview`}
                  className="h-56 w-full object-cover"
                  loading="lazy"
                />
                <div className="space-y-1 p-4">
                  <p className="text-2xl text-charcoal">{album}</p>
                  <p className="text-sm text-charcoal/70">{photos.length} matched photos</p>
                </div>
              </button>
            ))}
          </section>
        ) : (
          <PhotoGrid photos={eventPhotos} onOpen={setLightboxIndex} />
        )}
      </div>

      <PhotoLightbox
        photos={selectedAlbum ? eventPhotos : []}
        index={lightboxIndex}
        onClose={() => setLightboxIndex(-1)}
        onIndexChange={setLightboxIndex}
      />
    </main>
  );
}
