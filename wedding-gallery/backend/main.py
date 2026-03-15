from __future__ import annotations

import json
import logging
import mimetypes
import os
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from insightface.app import FaceAnalysis
from PIL import Image, ImageOps
from pydantic import BaseModel

DEFAULT_SIMILARITY_THRESHOLD = 0.65
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
THUMBNAIL_WIDTH = 400
DEFAULT_SECOND_PASS_DIVERSE_ANCHORS = 10
MAX_SECOND_PASS_DIVERSE_ANCHORS = 100
SECOND_PASS_POOL_SIZE = 300

ROOT_DIR = Path(__file__).resolve().parents[1]
EMBEDDINGS_FILE = ROOT_DIR / "embeddings.json"
DEFAULT_HERO_IMAGE_PATH = Path("/Users/aadhikari/Downloads/WEDDING/ARP_1133.JPG")
DEFAULT_USERS_FILE = ROOT_DIR / "users.txt"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("wedding-gallery")

load_dotenv(ROOT_DIR / ".env")


def get_similarity_threshold() -> float:
    raw = os.getenv("MATCH_THRESHOLD", str(DEFAULT_SIMILARITY_THRESHOLD))
    try:
        parsed = float(raw)
    except ValueError:
        logger.warning(
            "Invalid MATCH_THRESHOLD=%s, falling back to default %.2f",
            raw,
            DEFAULT_SIMILARITY_THRESHOLD,
        )
        parsed = DEFAULT_SIMILARITY_THRESHOLD
    return float(max(0.0, min(1.0, parsed)))


def get_second_pass_anchor_count() -> int:
    raw = os.getenv("SECOND_PASS_ANCHORS", str(DEFAULT_SECOND_PASS_DIVERSE_ANCHORS))
    try:
        parsed = int(raw)
    except ValueError:
        logger.warning(
            "Invalid SECOND_PASS_ANCHORS=%s, falling back to default %d",
            raw,
            DEFAULT_SECOND_PASS_DIVERSE_ANCHORS,
        )
        parsed = DEFAULT_SECOND_PASS_DIVERSE_ANCHORS
    return max(0, min(MAX_SECOND_PASS_DIVERSE_ANCHORS, parsed))


def get_hero_image_path() -> Path:
    raw = os.getenv("HERO_IMAGE_PATH", str(DEFAULT_HERO_IMAGE_PATH))
    return Path(raw).expanduser()


def get_users_file_path() -> Path:
    raw = os.getenv("USERS_FILE", str(DEFAULT_USERS_FILE))
    return Path(raw).expanduser()


def display_album_name(album: str) -> str:
    mapping = {
        "Akash-Aiburobhat": "Akash-Aashirbad",
    }
    return mapping.get(album, album)


def load_photo_dirs() -> list[Path]:
    raw = os.getenv("PHOTO_DIRS", "")
    if not raw.strip():
        raise RuntimeError("PHOTO_DIRS is missing in .env")

    dirs: list[Path] = []
    for part in raw.split(","):
        candidate = Path(part.strip()).expanduser()
        if candidate.is_dir():
            dirs.append(candidate.resolve())
        else:
            logger.warning("Skipping missing PHOTO_DIR: %s", candidate)
    if not dirs:
        raise RuntimeError("No valid PHOTO_DIRS found.")
    return dirs


def normalize_embedding(vec: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    if norm <= 0:
        return vec
    return vec / norm


def scan_photo_lookup(photo_dirs: list[Path]) -> dict[tuple[str, str], Path]:
    lookup: dict[tuple[str, str], Path] = {}
    for root in photo_dirs:
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            key = (path.parent.name.lower(), path.name.lower())
            lookup.setdefault(key, path.resolve())
    return lookup


def load_embeddings(path: Path) -> dict[str, dict]:
    if not path.exists():
        logger.warning("embeddings.json not found at %s", path)
        return {}
    with path.open("r", encoding="utf-8") as infile:
        payload = json.load(infile)
    if not isinstance(payload, dict):
        raise RuntimeError("embeddings.json must contain a JSON object")
    return payload


def build_face_matrix(embeddings: dict[str, dict]) -> tuple[np.ndarray, np.ndarray, list[str]]:
    photo_keys = list(embeddings.keys())
    key_to_idx = {key: idx for idx, key in enumerate(photo_keys)}

    vectors: list[np.ndarray] = []
    owners: list[int] = []

    for key, photo in embeddings.items():
        photo_idx = key_to_idx[key]
        for face in photo.get("faces", []):
            raw = face.get("embedding", [])
            vec = np.asarray(raw, dtype=np.float32)
            if vec.ndim != 1 or vec.size != 512:
                continue
            vec = normalize_embedding(vec)
            vectors.append(vec)
            owners.append(photo_idx)

    if not vectors:
        return np.empty((0, 512), dtype=np.float32), np.empty((0,), dtype=np.int32), photo_keys

    return np.vstack(vectors), np.asarray(owners, dtype=np.int32), photo_keys


def decode_upload(bytes_payload: bytes) -> np.ndarray:
    arr = np.frombuffer(bytes_payload, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is not None:
        return image

    # Fallback path for images OpenCV cannot decode directly (e.g., some JPEG variants).
    try:
        with Image.open(BytesIO(bytes_payload)) as pil_image:
            pil_image = ImageOps.exif_transpose(pil_image).convert("RGB")
            image = cv2.cvtColor(np.asarray(pil_image), cv2.COLOR_RGB2BGR)
            return image
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="Unable to decode uploaded image. Please upload a JPG or PNG file.",
        )


def rank_photos_from_face_scores(
    face_owner_idx: np.ndarray,
    best_similarity_per_face: np.ndarray,
    threshold: float,
    photo_count: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    candidate_mask = best_similarity_per_face >= threshold
    if not np.any(candidate_mask):
        return (
            np.empty((0,), dtype=np.int32),
            np.full(photo_count, -np.inf, dtype=np.float32),
            np.empty((0,), dtype=np.int32),
        )

    candidate_face_indices = np.flatnonzero(candidate_mask).astype(np.int32)
    candidate_photo_idx = face_owner_idx[candidate_mask]
    candidate_scores = best_similarity_per_face[candidate_mask]

    best_scores = np.full(photo_count, -np.inf, dtype=np.float32)
    np.maximum.at(best_scores, candidate_photo_idx, candidate_scores)

    matched_photo_idx = np.where(best_scores >= threshold)[0]
    rank_order = matched_photo_idx[np.argsort(best_scores[matched_photo_idx])[::-1]]
    return rank_order.astype(np.int32), best_scores, candidate_face_indices


def build_photo_representative_faces(
    face_owner_idx: np.ndarray,
    candidate_face_indices: np.ndarray,
    best_similarity_per_face: np.ndarray,
) -> dict[int, int]:
    photo_to_face: dict[int, int] = {}
    photo_to_score: dict[int, float] = {}
    for face_idx in candidate_face_indices.tolist():
        photo_idx = int(face_owner_idx[face_idx])
        score = float(best_similarity_per_face[face_idx])
        if score > photo_to_score.get(photo_idx, -np.inf):
            photo_to_score[photo_idx] = score
            photo_to_face[photo_idx] = int(face_idx)
    return photo_to_face


def select_diverse_anchor_faces(
    face_matrix: np.ndarray, face_indices_ordered: list[int], anchor_count: int
) -> list[int]:
    if not face_indices_ordered or anchor_count <= 0:
        return []

    remaining = list(face_indices_ordered)
    selected = [remaining.pop(0)]
    selected_vectors = face_matrix[np.asarray(selected, dtype=np.int32)]

    while remaining and len(selected) < anchor_count:
        remaining_arr = np.asarray(remaining, dtype=np.int32)
        remaining_vectors = face_matrix[remaining_arr]
        similarities = remaining_vectors @ selected_vectors.T
        max_similarity_to_selected = np.max(similarities, axis=1)
        pick_pos = int(np.argmin(max_similarity_to_selected))
        pick_face_idx = int(remaining_arr[pick_pos])
        selected.append(pick_face_idx)
        selected_vectors = np.vstack((selected_vectors, face_matrix[pick_face_idx]))
        remaining.pop(pick_pos)

    return selected


def find_best_face(face_app: FaceAnalysis, image: np.ndarray):
    faces = face_app.get(image)
    if not faces:
        raise HTTPException(status_code=422, detail="No face detected in the selfie.")
    return max(faces, key=lambda face: float(face.det_score))


def resolve_photo_path(app: FastAPI, album: str, filename: str) -> Path:
    key = (album.lower(), filename.lower())
    found = app.state.photo_lookup.get(key)
    if found and found.exists():
        return found

    for root in app.state.photo_dirs:
        for candidate in root.rglob(filename):
            if candidate.is_file() and candidate.parent.name.lower() == album.lower():
                app.state.photo_lookup[key] = candidate.resolve()
                return candidate.resolve()

    raise HTTPException(status_code=404, detail="Photo not found.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    photo_dirs = load_photo_dirs()
    embeddings = load_embeddings(EMBEDDINGS_FILE)
    face_matrix, face_owner_idx, photo_keys = build_face_matrix(embeddings)
    photo_lookup = scan_photo_lookup(photo_dirs)
    similarity_threshold = get_similarity_threshold()
    second_pass_anchor_count = get_second_pass_anchor_count()
    hero_image_path = get_hero_image_path()
    users_file_path = get_users_file_path()

    model = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    model.prepare(ctx_id=0, det_size=(640, 640))

    total_faces = int(sum(int(item.get("face_count", 0)) for item in embeddings.values()))
    logger.info(
        "Startup complete: %s photos indexed, %s faces indexed, %s face vectors loaded",
        len(embeddings),
        total_faces,
        face_matrix.shape[0],
    )
    logger.info("Similarity threshold: %.2f", similarity_threshold)
    logger.info("Second-pass diverse anchors: %d", second_pass_anchor_count)
    logger.info("Hero image path: %s", hero_image_path)
    logger.info("Users file path: %s", users_file_path)

    app.state.photo_dirs = photo_dirs
    app.state.embeddings = embeddings
    app.state.face_matrix = face_matrix
    app.state.face_owner_idx = face_owner_idx
    app.state.photo_keys = photo_keys
    app.state.photo_lookup = photo_lookup
    app.state.face_model = model
    app.state.similarity_threshold = similarity_threshold
    app.state.second_pass_anchor_count = second_pass_anchor_count
    app.state.hero_image_path = hero_image_path
    app.state.users_file_path = users_file_path
    app.state.model_ready = True

    try:
        yield
    finally:
        app.state.model_ready = False


app = FastAPI(title="Wedding Photo Gallery API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "photos_indexed": len(app.state.embeddings),
        "model_ready": bool(getattr(app.state, "model_ready", False)),
        "match_threshold": float(getattr(app.state, "similarity_threshold", 0.0)),
        "second_pass_anchors": int(getattr(app.state, "second_pass_anchor_count", 0)),
        "hero_image_exists": bool(
            Path(getattr(app.state, "hero_image_path", DEFAULT_HERO_IMAGE_PATH)).exists()
        ),
    }


class VisitorPayload(BaseModel):
    name: str


def normalize_visitor_name(name: str) -> str:
    # Collapse internal whitespace so near-duplicates are treated as the same name.
    return " ".join(name.split()).strip()


@app.post("/api/visitor")
async def visitor(payload: VisitorPayload):
    name = normalize_visitor_name(payload.name)
    if not name:
        raise HTTPException(status_code=422, detail="Name is required.")
    if len(name) > 120:
        raise HTTPException(status_code=422, detail="Name is too long.")

    users_file = Path(getattr(app.state, "users_file_path", DEFAULT_USERS_FILE))
    users_file.parent.mkdir(parents=True, exist_ok=True)

    try:
        existing_unique: dict[str, str] = {}
        if users_file.exists():
            with users_file.open("r", encoding="utf-8") as infile:
                for raw_line in infile:
                    line = raw_line.strip()
                    if not line:
                        continue
                    # Backward-compatible parsing for older "timestamp<TAB>name" entries.
                    parsed_name = normalize_visitor_name(line.split("\t")[-1])
                    if not parsed_name:
                        continue
                    canonical = parsed_name.casefold()
                    if canonical not in existing_unique:
                        existing_unique[canonical] = parsed_name

        canonical_name = name.casefold()
        added = canonical_name not in existing_unique
        if added:
            existing_unique[canonical_name] = name

        # Persist as unique names only (one name per line).
        with users_file.open("w", encoding="utf-8") as outfile:
            for unique_name in existing_unique.values():
                outfile.write(f"{unique_name}\n")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not store visitor name: {exc}")

    return {"status": "ok", "added": added}


@app.get("/api/hero-image")
async def hero_image():
    image_path = Path(getattr(app.state, "hero_image_path", DEFAULT_HERO_IMAGE_PATH))
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Hero image not found.")

    media_type, _ = mimetypes.guess_type(image_path.name)
    return FileResponse(
        path=str(image_path),
        media_type=media_type or "image/jpeg",
        headers={
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.post("/api/match")
async def match_selfie(selfie: list[UploadFile] = File(...), password: str = Form(...)):
    expected_password = os.getenv("GALLERY_PASSWORD", "")
    if not expected_password:
        raise HTTPException(status_code=500, detail="Gallery password not configured.")
    if password != expected_password:
        raise HTTPException(status_code=401, detail="Invalid password.")

    uploads = [item for item in selfie if item is not None]
    if not uploads:
        raise HTTPException(status_code=400, detail="Please upload at least one selfie.")

    query_vectors: list[np.ndarray] = []
    for upload in uploads:
        payload = await upload.read()
        if not payload:
            continue
        try:
            image = decode_upload(payload)
            best_face = find_best_face(app.state.face_model, image)
            query = np.asarray(best_face.embedding, dtype=np.float32)
            if query.ndim != 1 or query.size != 512:
                continue
            query = normalize_embedding(query)
            if float(np.linalg.norm(query)) == 0:
                continue
            query_vectors.append(query)
        except HTTPException:
            continue

    if not query_vectors:
        raise HTTPException(
            status_code=422,
            detail="No detectable face found in uploaded selfies. Try clearer front-facing selfies.",
        )

    face_matrix: np.ndarray = app.state.face_matrix
    if face_matrix.size == 0:
        return {"matched": [], "total": 0}

    queries = np.vstack(query_vectors).astype(np.float32)
    similarities = face_matrix @ queries.T
    best_similarity_per_face = np.max(similarities, axis=1).astype(np.float32)
    threshold = float(getattr(app.state, "similarity_threshold", DEFAULT_SIMILARITY_THRESHOLD))

    rank_order, best_scores, candidate_face_indices = rank_photos_from_face_scores(
        app.state.face_owner_idx,
        best_similarity_per_face,
        threshold,
        len(app.state.photo_keys),
    )
    if rank_order.size == 0:
        return {"matched": [], "total": 0}

    representative_faces = build_photo_representative_faces(
        app.state.face_owner_idx,
        candidate_face_indices,
        best_similarity_per_face,
    )
    # Build second-pass anchors from the lower-scoring matched photos first.
    # This helps recover appearance variations (attire, accessories, pose changes).
    anchor_pool_photo_idx = rank_order[::-1][:SECOND_PASS_POOL_SIZE].tolist()
    anchor_pool_face_idx = [
        representative_faces[int(photo_idx)]
        for photo_idx in anchor_pool_photo_idx
        if int(photo_idx) in representative_faces
    ]
    configured_anchor_count = int(
        getattr(app.state, "second_pass_anchor_count", DEFAULT_SECOND_PASS_DIVERSE_ANCHORS)
    )
    effective_anchor_count = min(configured_anchor_count, len(anchor_pool_face_idx))

    anchor_face_indices = select_diverse_anchor_faces(
        face_matrix,
        anchor_pool_face_idx,
        effective_anchor_count,
    )
    if anchor_face_indices:
        anchor_queries = face_matrix[np.asarray(anchor_face_indices, dtype=np.int32)]
        expanded_queries = np.vstack((queries, anchor_queries))
        expanded_similarities = face_matrix @ expanded_queries.T
        expanded_best_similarity_per_face = np.max(expanded_similarities, axis=1).astype(np.float32)

        rank_order, best_scores, _ = rank_photos_from_face_scores(
            app.state.face_owner_idx,
            expanded_best_similarity_per_face,
            threshold,
            len(app.state.photo_keys),
        )

    matched = []
    seen_keys: set[str] = set()
    seen_paths: set[str] = set()
    for idx in rank_order.tolist():
        key = app.state.photo_keys[idx]
        if key in seen_keys:
            continue
        item = app.state.embeddings[key]
        local_path = str(item.get("local_path", ""))
        if local_path and local_path in seen_paths:
            continue

        album = item.get("album", "")
        filename = item.get("filename", "")
        score = float(best_scores[idx])
        display_album = display_album_name(str(album))
        encoded_album = quote(str(album), safe="")
        encoded_filename = quote(str(filename), safe="")
        matched.append(
            {
                "key": key,
                "album": display_album,
                "filename": filename,
                "score": round(score, 4),
                "face_count": int(item.get("face_count", 0)),
                "thumbnail_url": f"/api/photo/{encoded_album}/{encoded_filename}?size=thumb",
                "download_url": f"/api/photo/{encoded_album}/{encoded_filename}",
            }
        )
        seen_keys.add(key)
        if local_path:
            seen_paths.add(local_path)

    return {"matched": matched, "total": len(matched)}


@app.get("/api/photo/{album}/{filename}")
async def get_photo(album: str, filename: str, size: str | None = None):
    photo_path = resolve_photo_path(app, album, filename)

    if size == "thumb":
        with Image.open(photo_path) as image:
            image = ImageOps.exif_transpose(image).convert("RGB")
            if image.width > THUMBNAIL_WIDTH:
                new_height = int((THUMBNAIL_WIDTH / image.width) * image.height)
                image = image.resize((THUMBNAIL_WIDTH, new_height), Image.Resampling.LANCZOS)

            buffer = BytesIO()
            image.save(buffer, format="JPEG", quality=88, optimize=True)
            buffer.seek(0)
        return StreamingResponse(buffer, media_type="image/jpeg")

    media_type, _ = mimetypes.guess_type(photo_path.name)
    return FileResponse(
        path=str(photo_path),
        media_type=media_type or "application/octet-stream",
        filename=photo_path.name,
        headers={"Content-Disposition": f'attachment; filename="{photo_path.name}"'},
    )


@app.exception_handler(RuntimeError)
async def runtime_error_handler(_, exc: RuntimeError):
    return JSONResponse(status_code=500, content={"detail": str(exc)})
