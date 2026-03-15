import { saveAs } from "file-saver";
import JSZip from "jszip";

export type Photo = {
  key: string;
  album: string;
  filename: string;
  score: number;
  face_count: number;
  thumbnail_url: string;
  download_url: string;
};

export type MatchResponse = {
  matched: Photo[];
  total: number;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function prepareSelfie(file: File): Promise<File> {
  const maxDimension = 1600;
  const quality = 0.9;

  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    const ratio = Math.min(1, maxDimension / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * ratio));
    const targetHeight = Math.max(1, Math.round(height * ratio));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (!blob) {
      return file;
    }
    return new File([blob], "selfie.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export function resolveApiUrl(urlOrPath: string): string {
  if (urlOrPath.startsWith("http://") || urlOrPath.startsWith("https://")) {
    return urlOrPath;
  }
  return `${API_BASE_URL}${urlOrPath.startsWith("/") ? "" : "/"}${urlOrPath}`;
}

export async function matchSelfie(files: File[], password: string): Promise<MatchResponse> {
  if (!files.length) {
    throw new Error("Please upload at least one selfie.");
  }

  const preparedFiles = await Promise.all(files.map((file) => prepareSelfie(file)));
  const formData = new FormData();
  for (const file of preparedFiles) {
    formData.append("selfie", file);
  }
  formData.append("password", password);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/match`, {
      method: "POST",
      body: formData
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network error";
    throw new Error(`Could not reach matching server: ${message}`);
  }

  const rawBody = await response.text();

  if (!response.ok) {
    let detail = `Could not match photos (HTTP ${response.status}).`;
    try {
      const body = JSON.parse(rawBody) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      if (rawBody.trim()) {
        detail = `${detail} ${rawBody.slice(0, 160)}`;
      }
    }
    throw new Error(detail);
  }

  return JSON.parse(rawBody) as MatchResponse;
}

export async function registerVisitor(name: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/visitor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });

  if (!response.ok) {
    let detail = "Could not store visitor name.";
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) {
        detail = body.detail;
      }
    } catch {
      // Keep fallback message.
    }
    throw new Error(detail);
  }
}

export function getPhotoUrl(key: string, thumb = false): string {
  const separatorIndex = key.indexOf("/");
  if (separatorIndex < 0) {
    throw new Error(`Invalid photo key format: ${key}`);
  }

  const album = key.slice(0, separatorIndex);
  const filename = key.slice(separatorIndex + 1);
  const query = thumb ? "?size=thumb" : "";
  return `${API_BASE_URL}/api/photo/${encodeURIComponent(album)}/${encodeURIComponent(filename)}${query}`;
}

export async function downloadAll(photos: Photo[]): Promise<void> {
  if (!photos.length) {
    return;
  }

  const zip = new JSZip();
  const concurrency = 6;

  for (let i = 0; i < photos.length; i += concurrency) {
    const batch = photos.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (photo) => {
        const downloadUrl = photo.download_url
          ? resolveApiUrl(photo.download_url)
          : getPhotoUrl(photo.key);
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error(`Failed to download ${photo.filename}`);
        }
        const blob = await response.blob();
        const folder = zip.folder(photo.album) ?? zip;
        folder.file(photo.filename, blob);
      })
    );
  }

  const zipBlob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
  saveAs(zipBlob, "wedding-memories.zip");
}
