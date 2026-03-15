"use client";

import { startTransition, type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SelfieUpload from "@/components/SelfieUpload";
import { matchSelfie, registerVisitor } from "@/lib/api";

const STORAGE_KEY = "wedding-gallery-results";

export default function HomePage() {
  const router = useRouter();
  const [visitorName, setVisitorName] = useState("");
  const [password, setPassword] = useState("");
  const [selfies, setSelfies] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPreviousResults, setHasPreviousResults] = useState(false);

  useEffect(() => {
    const hasSaved = Boolean(sessionStorage.getItem(STORAGE_KEY));
    setHasPreviousResults(hasSaved);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!visitorName.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!password.trim()) {
      setError("Please enter the gallery password.");
      return;
    }
    if (!selfies.length) {
      setError("Please upload at least one selfie.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      await registerVisitor(visitorName.trim());
      const results = await matchSelfie(selfies, password.trim());
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(results));
      startTransition(() => {
        router.push("/gallery");
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen px-4 py-10 sm:px-8">
      <div className="mx-auto grid min-h-[85vh] max-w-7xl items-stretch gap-8 lg:grid-cols-[1.2fr_1fr]">
        <section className="relative min-h-[34rem] overflow-hidden rounded-3xl shadow-romantic lg:min-h-[42rem]">
          <div
            className="absolute inset-0 scale-110 bg-cover bg-center"
            style={{ backgroundImage: "url('/api/hero-image')", backgroundPosition: "center 28%" }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-charcoal/25 via-charcoal/45 to-charcoal/80" />
          <div className="relative z-10 flex h-full flex-col justify-end p-6 text-cream sm:p-8">
            <p className="text-[11px] uppercase tracking-[0.22em] text-cream/90 sm:text-xs">
              Welcome To
            </p>
            <h1 className="mt-2 max-w-xl text-2xl leading-tight sm:text-3xl lg:text-[2rem]">
              The Wedding Gallery of
              <br />
              Akash and Suchismita
            </h1>
            <p className="mt-3 text-sm font-medium text-cream/95 sm:text-base">3rd February 2026</p>
            <p className="mt-4 text-xs tracking-wide text-cream/90 sm:text-sm">
              Developed by Akash Adhikari
            </p>
          </div>
        </section>

        <section className="glass-panel animate-fade-up rounded-3xl p-6 shadow-romantic sm:p-8">
          {hasPreviousResults ? (
            <div className="mb-4 rounded-xl border border-gold/35 bg-gold/10 p-3">
              <p className="text-sm text-charcoal/85">
                You have a previous matched gallery in this browser session.
              </p>
              <button
                type="button"
                onClick={() => router.push("/gallery")}
                className="mt-2 text-sm font-semibold text-charcoal underline"
              >
                Resume previous gallery
              </button>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="visitorName" className="text-sm font-semibold text-charcoal/90">
                Your Name
              </label>
              <input
                id="visitorName"
                type="text"
                value={visitorName}
                onChange={(event) => setVisitorName(event.target.value)}
                placeholder="Enter your name"
                className="w-full rounded-xl border border-charcoal/20 bg-white px-4 py-3 text-base outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/30"
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="text-sm font-semibold text-charcoal/90">
                Gallery Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter password"
                className="w-full rounded-xl border border-charcoal/20 bg-white px-4 py-3 text-base outline-none transition focus:border-gold focus:ring-2 focus:ring-gold/30"
                disabled={loading}
              />
            </div>

            <SelfieUpload files={selfies} onFilesChange={setSelfies} disabled={loading} />

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-charcoal px-5 py-3 text-base font-semibold text-cream transition hover:bg-charcoal/90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? (
                <>
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-cream/50 border-t-cream" />
                  Searching through 5,402 photos...
                </>
              ) : (
                "Find My Photos →"
              )}
            </button>

            {error ? (
              <p className="rounded-xl bg-blush/25 px-3 py-2 text-sm text-charcoal">{error}</p>
            ) : null}
          </form>
        </section>
      </div>
    </main>
  );
}
