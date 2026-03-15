"use client";

import { useEffect, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";

type SelfieUploadProps = {
  files: File[];
  disabled?: boolean;
  onFilesChange: (files: File[]) => void;
  maxFiles?: number;
};

export default function SelfieUpload({
  files,
  disabled = false,
  onFilesChange,
  maxFiles = 5
}: SelfieUploadProps) {
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [uploadHint, setUploadHint] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!files.length) {
      setPreviewUrls([]);
      return;
    }

    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviewUrls(urls);

    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) {
      return;
    }
    videoRef.current.srcObject = streamRef.current;
    void videoRef.current.play().catch(() => undefined);
  }, [cameraOpen]);

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }

  async function openCamera() {
    stopCamera();
    setUploadHint(null);
    setCameraError(null);
    setCameraLoading(true);
    setCameraOpen(true);

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraLoading(false);
      setCameraError("Camera access is not supported by this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to access camera.";
      setCameraError(message);
    } finally {
      setCameraLoading(false);
    }
  }

  function closeCamera() {
    stopCamera();
    setCameraOpen(false);
    setCameraLoading(false);
    setCameraError(null);
  }

  function captureFromCamera() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("Camera stream is not ready yet. Please try again.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Could not capture image from camera.");
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError("Could not capture image from camera.");
          return;
        }
        const capturedFile = new File([blob], `camera-selfie-${Date.now()}.jpg`, {
          type: "image/jpeg"
        });
        addFiles([capturedFile]);
        closeCamera();
      },
      "image/jpeg",
      0.92
    );
  }

  function addFiles(newFiles: File[]) {
    if (!newFiles.length) {
      return;
    }

    const existing = new Set(files.map((item) => `${item.name}:${item.size}:${item.lastModified}`));
    const merged = [...files];
    let added = 0;

    for (const candidate of newFiles) {
      const id = `${candidate.name}:${candidate.size}:${candidate.lastModified}`;
      if (existing.has(id)) {
        continue;
      }
      if (merged.length >= maxFiles) {
        break;
      }
      merged.push(candidate);
      existing.add(id);
      added += 1;
    }

    if (added === 0 && merged.length >= maxFiles) {
      setUploadHint(`You can upload up to ${maxFiles} selfies.`);
      return;
    }
    setUploadHint(null);
    onFilesChange(merged);
  }

  function removeFile(index: number) {
    onFilesChange(files.filter((_, idx) => idx !== index));
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"]
    },
    multiple: true,
    maxFiles,
    maxSize: 20 * 1024 * 1024,
    disabled,
    onDrop: (acceptedFiles) => {
      addFiles(acceptedFiles);
    },
    onDropRejected: (rejections) => {
      const reason = rejections[0]?.errors?.[0]?.message;
      setUploadHint(reason ?? "Please upload a JPG or PNG image (max 20 MB).");
    }
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={openCamera}
          className="rounded-xl border border-charcoal/25 bg-white px-4 py-2 text-sm font-semibold text-charcoal transition hover:border-charcoal/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Open Camera
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => cameraInputRef.current?.click()}
          className="rounded-xl border border-charcoal/15 bg-white/80 px-4 py-2 text-sm font-semibold text-charcoal/85 transition hover:border-charcoal/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Choose File
        </button>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          capture="user"
          disabled={disabled}
          className="hidden"
          onChange={(event) => {
            const selectedFiles = Array.from(event.target.files ?? []);
            addFiles(selectedFiles);
            event.target.value = "";
          }}
        />
        <p className="text-xs text-charcoal/65">Add up to {maxFiles} selfies for better matching.</p>
      </div>

      <div
        {...getRootProps()}
        className={[
          "cursor-pointer rounded-2xl border-2 border-dashed p-6 text-center transition",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-gold",
          isDragActive
            ? "border-gold bg-gold/10"
            : "border-charcoal/30 bg-white/70 hover:border-gold/80 hover:bg-white"
        ].join(" ")}
      >
        <input {...getInputProps()} />
        {!previewUrls.length ? (
          <div className="space-y-2">
            <p className="text-base font-semibold text-charcoal">
              Drag and drop your selfies here
            </p>
            <p className="text-sm text-charcoal/70">or click to upload (JPG/PNG, max {maxFiles})</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {previewUrls.map((url, index) => (
              <div key={`${url}-${index}`} className="relative overflow-hidden rounded-xl soft-border">
                <img
                  src={url}
                  alt={`Selected selfie ${index + 1}`}
                  className="h-32 w-full object-cover"
                />
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeFile(index);
                  }}
                  className="absolute right-1 top-1 rounded-md bg-black/65 px-2 py-1 text-xs font-semibold text-cream"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {files.length ? (
        <div className="space-y-2">
          <p className="text-sm text-charcoal/80">
            Selected selfies: <span className="font-semibold">{files.length}</span>
          </p>
        </div>
      ) : null}
      {uploadHint ? (
        <p className="rounded-lg bg-blush/25 px-3 py-2 text-sm text-charcoal">{uploadHint}</p>
      ) : null}

      {cameraOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-xl rounded-2xl bg-cream p-4 shadow-romantic">
            <p className="mb-3 text-base font-semibold text-charcoal">Take a selfie</p>
            <div className="overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-[22rem] w-full object-cover sm:h-[26rem]"
              />
            </div>
            {cameraLoading ? (
              <p className="mt-3 text-sm text-charcoal/75">Starting camera...</p>
            ) : null}
            {cameraError ? (
              <p className="mt-3 rounded-lg bg-blush/25 px-3 py-2 text-sm text-charcoal">
                {cameraError}
              </p>
            ) : null}
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeCamera}
                className="rounded-xl border border-charcoal/25 bg-white px-4 py-2 text-sm font-semibold text-charcoal transition hover:border-charcoal/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={captureFromCamera}
                disabled={cameraLoading}
                className="rounded-xl bg-charcoal px-4 py-2 text-sm font-semibold text-cream transition hover:bg-charcoal/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                Capture Photo
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
