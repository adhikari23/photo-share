# Wedding Photo Gallery (Local + Face Match)

Self-hosted wedding gallery where guests upload one or more selfies and instantly see the photos they appear in.

- All photos stay local on your laptop.
- Face indexing + matching runs on CPU using InsightFace.
- Public sharing happens through an ngrok tunnel.
- No database; `embeddings.json` is the primary data store.

## 1. High-Level Workflow

1. Configure photo folders in `.env` (`PHOTO_DIRS`).
2. Run `index_faces.py` once (or rerun incrementally) to build `embeddings.json`.
3. Start services with `./start.sh`:
   - FastAPI backend
   - Next.js frontend
   - ngrok tunnel (or reuse existing tunnel)
4. Share ngrok URL with family.
5. Guest enters name + password, uploads/captures selfies, and gets matched gallery.

## 2. Architecture Diagram

```mermaid
flowchart LR
    U[Guest Browser] -->|Upload selfies + password + name| FE[Next.js Frontend :3000]
    FE -->|POST /api/visitor| BE[FastAPI Backend :8000]
    FE -->|POST /api/match (multipart selfies)| BE
    FE -->|GET /api/photo/...| BE
    FE -->|GET /api/hero-image| BE

    BE -->|Append visitor name| USERS[users.txt]
    BE -->|Load face vectors on startup| EMB[embeddings.json]
    IDX[index_faces.py] -->|Build/Update| EMB
    IDX -->|Read raw photos| PH[PHOTO_DIRS]
    BE -->|Serve original/thumb photos| PH
    BE -->|Compute cosine similarities| MAT[In-memory face matrix]

    NG[ngrok] -->|Public URL| FE
```

## 3. Project Structure

```text
wedding-gallery/
├── .env
├── index_faces.py
├── embeddings.json
├── users.txt
├── start.sh
├── backend/
│   ├── main.py
│   └── requirements.txt
└── frontend/
    ├── package.json
    ├── next.config.js
    └── src/...
```

## 4. Setup

### Prerequisites

- Python 3.9+
- Node.js 18+
- `ngrok` CLI
- Mac/Linux shell

### Install ngrok

```bash
brew install ngrok/ngrok/ngrok
ngrok config add-authtoken YOUR_TOKEN
```

### Configure `.env`

Example:

```env
PHOTO_DIRS=/abs/path/folder1,/abs/path/folder2
GALLERY_PASSWORD=wedding2024
BACKEND_PORT=8000
FRONTEND_PORT=3000
MATCH_THRESHOLD=0.45
SECOND_PASS_ANCHORS=50
HERO_IMAGE_PATH=/Users/.../ARP_1150.JPG
USERS_FILE=/Users/.../wedding-gallery/users.txt
NGROK_AUTHTOKEN=YOUR_TOKEN
```

## 5. Indexing Pipeline (Offline / One-Time + Incremental)

Run:

```bash
cd /Users/aadhikari/Downloads/workspace/wedding-gallery
python3 index_faces.py --index-only
```

What indexing does:

- Recursively scans `PHOTO_DIRS` for `.jpg/.jpeg/.png`.
- Loads InsightFace (`buffalo_l`, CPU).
- Resizes image for detection if max dimension > 2000 px.
- Detects all faces per image.
- Stores, per face:
  - 512D embedding
  - bounding box
  - detection score
- Saves progress every 100 photos to `embeddings.json`.
- Skips already-indexed entries on rerun (incremental behavior).

## 6. Runtime Flow (On-the-fly Match)

### 6.1 Visitor Intake

- Frontend asks for:
  - Visitor name
  - Gallery password
  - One or more selfies (file upload or webcam capture)
- Name is stored via `POST /api/visitor` into `users.txt`.

### 6.2 Matching Request

- Frontend sends all selfies as multipart field `selfie`.
- Backend extracts one best face embedding per uploaded selfie (highest detection score face in that image).
- Query set = all selfie embeddings.

### 6.3 First-Pass Retrieval

- Backend keeps all indexed embeddings in memory:
  - `face_matrix`: shape `[num_faces, 512]`
  - `face_owner_idx`: map face row -> photo index
- For each indexed face, score = max cosine similarity over uploaded selfie embeddings.
- Keep faces where score >= `MATCH_THRESHOLD`.
- Collapse to photo-level by taking max score per photo.

### 6.4 Second-Pass Expansion (Diverse Anchors)

- From first-pass matches, backend builds an anchor pool from lower-scoring side.
- Picks up to `min(SECOND_PASS_ANCHORS, available_matches)` diverse anchors.
- Diversity is selected by farthest-first style rule:
  - Iteratively pick candidate least similar to already selected anchors.
- Adds those anchor embeddings to the query set and recomputes scores.

### 6.5 Final Dedup + Ranking

- Rank by photo max similarity descending.
- Enforce uniqueness:
  - unique by photo key
  - unique by local file path
- Return final matched list + thumbnail/download URLs.

## 7. Matching Algorithm (Pseudo)

```text
Q = normalized embeddings from uploaded selfies
S = face_matrix @ Q.T
best_face_score = rowwise_max(S)
first_pass_photos = aggregate_max_by_photo(best_face_score >= threshold)

anchors = diverse_select(lower_scoring(first_pass_photos), k=min(SECOND_PASS_ANCHORS, N))
Q2 = concat(Q, anchor_face_embeddings)
S2 = face_matrix @ Q2.T
best_face_score2 = rowwise_max(S2)
final_photos = aggregate_max_by_photo(best_face_score2 >= threshold)
return unique_sorted(final_photos)
```

## 8. Model Card (Current System)

### Model

- Library: `insightface`
- Face pack: `buffalo_l`
- Runtime: `CPUExecutionProvider` (`onnxruntime`)
- Embedding size: 512
- Detection prep: `det_size=(640,640)`

### Intended Use

- Event/wedding guest photo discovery on private local datasets.
- Small to medium temporary self-hosted deployments.

### Strengths

- Fast CPU inference for practical local hosting.
- Multi-selfie query improves recall across pose/accessory changes.
- Second-pass anchor expansion improves coverage for appearance shifts.

### Known Limitations

- Performance can drop with:
  - heavy occlusions (masks, veils, crowns)
  - extreme side profiles
  - blur/low light
  - very small faces
- Threshold tuning (`MATCH_THRESHOLD`) trades precision vs recall.
- No identity clustering or long-term model calibration.

### Safety / Bias Notes

- Like most face-recognition systems, accuracy may vary across lighting, demographics, and capture quality.
- Use as a convenience retrieval tool; do not use for high-stakes identity decisions.

## 9. API Summary

Backend endpoints:

- `GET /api/health`
- `POST /api/visitor` (JSON: `{ "name": "..." }`)
- `POST /api/match` (multipart: `selfie` repeated + `password`)
- `GET /api/photo/{album}/{filename}`
- `GET /api/hero-image`

## 10. Operations

### Start Everything

```bash
cd /Users/aadhikari/Downloads/workspace/wedding-gallery
./start.sh
```

### OCI Fixed-IP Deployment (No Laptop Required)

If you want a fixed public URL with Oracle VM (no ngrok/cloudflare), use:

- `ops/oci/provision_vm.sh`
- `ops/oci/redeploy.sh`
- `ops/oci/sync_to_vm.sh`
- `ops/oci/bootstrap_remote.sh`

Detailed usage: `ops/oci/README.md`

### Logs

- `logs/backend.log`
- `logs/frontend.log`
- `logs/ngrok.log`

### Stable Public Link Behavior

- `start.sh` reuses existing ngrok tunnel if available.
- By default ngrok is kept running so URL does not rotate.
- Optional old behavior:

```bash
STOP_NGROK_ON_EXIT=1 ./start.sh
```

## 11. Tuning Guide

- Increase recall: lower `MATCH_THRESHOLD` (e.g., `0.45` -> `0.40`)
- Increase diversity expansion: raise `SECOND_PASS_ANCHORS` (e.g., `10` -> `30`)
- Better query quality: upload 2-5 selfies with varied angles/accessories
- Re-index after adding folders/photos: rerun `index_faces.py --index-only`

## 12. Data + Privacy

- Photos remain local on host machine.
- Embeddings stored locally in `embeddings.json`.
- Visitor names stored in `users.txt`.
- Public access is only through current ngrok URL while process is running.

## 13. Troubleshooting

- `Failed to fetch`:
  - Ensure frontend is up on `:3000`
  - Check `logs/frontend.log`, `logs/backend.log`
- ngrok token errors:
  - Verify `NGROK_AUTHTOKEN` in `.env`
- No matches:
  - Lower `MATCH_THRESHOLD`
  - Upload multiple selfies
  - Re-index missing folders/photos
- Port conflicts:
  - free ports `3000` and `8000` before restart
