#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from dotenv import load_dotenv
from insightface.app import FaceAnalysis
from tqdm import tqdm

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
MAX_DIMENSION = 2000
SAVE_EVERY = 100
OUTPUT_FILE = Path("embeddings.json")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Index faces from PHOTO_DIRS and write embeddings.json."
    )
    parser.add_argument(
        "--index-only",
        action="store_true",
        help="Compatibility flag for one-time indexing mode.",
    )
    return parser.parse_args()


def load_photo_dirs() -> list[Path]:
    raw = os.getenv("PHOTO_DIRS", "")
    if not raw.strip():
        raise RuntimeError("PHOTO_DIRS is missing in .env")

    parsed: list[Path] = []
    for part in raw.split(","):
        candidate = Path(part.strip()).expanduser()
        if candidate.is_dir():
            parsed.append(candidate.resolve())
        else:
            print(f"[warn] Skipping missing directory: {candidate}")

    if not parsed:
        raise RuntimeError("No valid PHOTO_DIRS were found.")
    return parsed


def collect_images(photo_dirs: list[Path]) -> list[Path]:
    images: list[Path] = []
    for photo_dir in photo_dirs:
        for path in photo_dir.rglob("*"):
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
                images.append(path.resolve())
    images.sort(key=lambda p: str(p).lower())
    return images


def read_image(path: Path) -> np.ndarray | None:
    try:
        data = np.fromfile(str(path), dtype=np.uint8)
        if data.size == 0:
            return None
        return cv2.imdecode(data, cv2.IMREAD_COLOR)
    except Exception:
        return None


def normalize_album(path: Path, photo_dirs: list[Path]) -> str:
    for root in photo_dirs:
        try:
            rel = path.relative_to(root)
        except ValueError:
            continue
        if len(rel.parts) > 1:
            return rel.parts[-2]
        return root.name
    return path.parent.name


def image_key(path: Path, photo_dirs: list[Path]) -> tuple[str, str, str]:
    album = normalize_album(path, photo_dirs)
    filename = path.name
    return f"{album}/{filename}", album, filename


def load_existing(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as infile:
        loaded = json.load(infile)
    if not isinstance(loaded, dict):
        raise RuntimeError("embeddings.json must contain a JSON object.")
    return loaded


def atomic_save(path: Path, payload: dict[str, Any]) -> None:
    tmp_path = path.with_suffix(".tmp")
    with tmp_path.open("w", encoding="utf-8") as outfile:
        json.dump(payload, outfile, ensure_ascii=False, separators=(",", ":"))
    tmp_path.replace(path)


def detect_faces(
    face_app: FaceAnalysis, image: np.ndarray
) -> tuple[list[dict[str, Any]], int]:
    height, width = image.shape[:2]
    scale = 1.0
    resized = image

    max_dim = max(height, width)
    if max_dim > MAX_DIMENSION:
        scale = MAX_DIMENSION / float(max_dim)
        new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
        resized = cv2.resize(image, new_size, interpolation=cv2.INTER_AREA)

    faces = face_app.get(resized)
    converted: list[dict[str, Any]] = []

    for face in faces:
        embedding = np.asarray(face.embedding, dtype=np.float32)
        if embedding.ndim != 1 or embedding.size != 512:
            continue

        bbox = np.asarray(face.bbox, dtype=np.float32)
        if scale != 1.0:
            bbox = bbox / scale

        converted.append(
            {
                "embedding": embedding.tolist(),
                "bbox": [int(round(v)) for v in bbox.tolist()],
                "det_score": float(face.det_score),
            }
        )

    return converted, len(converted)


def print_summary(indexed: dict[str, Any], elapsed_seconds: float) -> None:
    total_photos = len(indexed)
    photos_with_faces = 0
    total_faces = 0
    for item in indexed.values():
        count = int(item.get("face_count", 0))
        total_faces += count
        if count > 0:
            photos_with_faces += 1

    print("")
    print("Indexing complete")
    print(f"Total photos: {total_photos}")
    print(f"Photos with faces: {photos_with_faces}")
    print(f"Total faces: {total_faces}")
    print(f"Time taken: {elapsed_seconds:.2f}s")


def main() -> None:
    args = parse_args()
    if args.index_only:
        print("[info] Running in index-only mode.")

    load_dotenv()
    photo_dirs = load_photo_dirs()
    images = collect_images(photo_dirs)
    if not images:
        raise RuntimeError("No images found under PHOTO_DIRS.")

    existing = load_existing(OUTPUT_FILE)

    face_app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    face_app.prepare(ctx_id=0, det_size=(640, 640))

    start_time = time.perf_counter()
    processed_new = 0
    skipped_existing = 0
    skipped_collisions = 0

    for image_path in tqdm(images, desc="Indexing photos", unit="photo"):
        key, album, filename = image_key(image_path, photo_dirs)
        local_path = str(image_path)

        if key in existing:
            if existing[key].get("local_path") == local_path:
                skipped_existing += 1
                continue

            # Keep deterministic key shape (album/filename) and skip collisions.
            fingerprint = hashlib.sha1(local_path.encode("utf-8")).hexdigest()[:8]
            print(
                f"[warn] Key collision for {key} ({fingerprint}), keeping first occurrence."
            )
            skipped_collisions += 1
            continue

        image = read_image(image_path)
        if image is None:
            existing[key] = {
                "album": album,
                "filename": filename,
                "local_path": local_path,
                "face_count": 0,
                "faces": [],
            }
        else:
            faces, face_count = detect_faces(face_app, image)
            existing[key] = {
                "album": album,
                "filename": filename,
                "local_path": local_path,
                "face_count": face_count,
                "faces": faces,
            }

        processed_new += 1
        if processed_new % SAVE_EVERY == 0:
            atomic_save(OUTPUT_FILE, existing)

    atomic_save(OUTPUT_FILE, existing)
    elapsed = time.perf_counter() - start_time

    print(
        f"[info] Newly processed: {processed_new}, already indexed: {skipped_existing}, collisions skipped: {skipped_collisions}"
    )
    print_summary(existing, elapsed)


if __name__ == "__main__":
    main()
