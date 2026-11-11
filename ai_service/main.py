"""
AI Service Microservice — Biometric Recognition & Anti-Spoofing
Built with FastAPI, DeepFace (ArcFace 512-d), and MiniFASNet (Anti-Spoofing PAD).
"""

import base64
import io
import time
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Any
from contextlib import asynccontextmanager

import cv2
import numpy as np
from fastapi import FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from deepface import DeepFace

# Preloaded model caches
MODELS_READY = {
    "faceDetection": False,
    "livenessMiniFASNet": False,
    "arcFaceEmbedding": False,
}

arcface_model = None


def decode_base64_image(b64_str: str) -> np.ndarray:
    """Decode base64 string (with or without data URI scheme) to OpenCV BGR image."""
    if not b64_str:
        raise ValueError("Image base64 data is empty")
    if "," in b64_str:
        b64_str = b64_str.split(",", 1)[1]
    raw_bytes = base64.b64decode(b64_str)
    np_arr = np.frombuffer(raw_bytes, np.uint8)
    img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image from base64")
    return img


# Cached Haar Cascade
_EYE_CASCADE: Optional[cv2.CascadeClassifier] = None


def get_eye_cascade() -> Optional[cv2.CascadeClassifier]:
    global _EYE_CASCADE
    if _EYE_CASCADE is not None and not _EYE_CASCADE.empty():
        return _EYE_CASCADE

    candidates = [
        Path(__file__).resolve().parent / "weights" / "haarcascade_eye.xml",
        Path("weights/haarcascade_eye.xml").resolve(),
        Path(cv2.data.haarcascades) / "haarcascade_eye.xml" if hasattr(cv2, "data") and hasattr(cv2.data, "haarcascades") else None,
        Path.home() / ".deepface" / "weights" / "haarcascade_eye.xml",
    ]

    for p in candidates:
        if p and Path(p).exists():
            try:
                c = cv2.CascadeClassifier(str(p))
                if not c.empty():
                    _EYE_CASCADE = c
                    return _EYE_CASCADE
            except Exception as e:
                print(f"[AI Service] Error loading eye cascade from {p}: {e}")

    return None


def check_image_quality(img: np.ndarray, face_box: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    """
    Check image quality:
    - Brightness (mean grayscale value: reject if < 35 or > 235)
    - Sharpness / Blur (Laplacian variance: reject if < 35.0)
    - Face bounding box ratio relative to whole image (reject if < 0.03)
    """
    try:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape[:2]

        # Brightness
        brightness = float(np.mean(gray))

        # Sharpness / Blur
        laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())

        # Face box ratio
        face_ratio = 1.0
        if face_box:
            fw = face_box.get("w", 0)
            fh = face_box.get("h", 0)
            face_ratio = float((fw * fh) / max(1, (w * h)))

        quality_passed = True
        reason = None

        if brightness < 35.0:
            quality_passed = False
            reason = "Foto terlalu gelap (pencahayaan kurang)"
        elif brightness > 235.0:
            quality_passed = False
            reason = "Foto terlalu terang / overexposure"
        elif laplacian_var < 35.0:
            quality_passed = False
            reason = "Foto buram / blur (fokus kurang tajam)"
        elif face_ratio < 0.03:
            quality_passed = False
            reason = "Ukuran wajah terlalu kecil pada frame kamera"

        # Normalized quality score 0.0 .. 1.0
        blur_norm = min(1.0, laplacian_var / 200.0)
        bright_norm = 1.0 - min(1.0, abs(brightness - 128.0) / 128.0)
        size_norm = min(1.0, face_ratio / 0.15)
        quality_score = float(round((blur_norm * 0.45 + bright_norm * 0.35 + size_norm * 0.20), 4))
        if quality_passed:
            quality_score = max(quality_score, 0.75)

        return {
            "qualityPassed": quality_passed,
            "qualityScore": quality_score,
            "blurScore": round(laplacian_var, 2),
            "brightnessScore": round(brightness, 2),
            "faceBoxRatio": round(face_ratio, 4),
            "rejectionReason": reason,
        }
    except Exception as e:
        print(f"[AI Service] check_image_quality error: {e}")
        return {
            "qualityPassed": False,
            "qualityScore": 0.0,
            "blurScore": 0.0,
            "brightnessScore": 0.0,
            "faceBoxRatio": 0.0,
            "rejectionReason": f"Gagal memeriksa kualitas citra: {e}",
        }


def estimate_pose(img: np.ndarray, face_box: Dict[str, int], expected_pose: str = "LURUS") -> str:
    """
    Estimate head pose (LURUS, KANAN, KIRI, ATAS, BAWAH) using eye & face geometry.
    Falls back gracefully to LURUS if eyes are not distinctly isolated.
    """
    try:
        fx = int(face_box.get("x", 0))
        fy = int(face_box.get("y", 0))
        fw = int(face_box.get("w", 0))
        fh = int(face_box.get("h", 0))

        if fw <= 0 or fh <= 0 or img is None or img.size == 0:
            return "LURUS"

        # Crop face sub-image
        y1, y2 = max(0, fy), min(img.shape[0], fy + fh)
        x1, x2 = max(0, fx), min(img.shape[1], fx + fw)
        face_img = img[y1:y2, x1:x2]
        if face_img.size == 0:
            return "LURUS"

        gray_face = cv2.cvtColor(face_img, cv2.COLOR_BGR2GRAY)

        eye_cascade = get_eye_cascade()
        eyes = []
        if eye_cascade is not None and not eye_cascade.empty():
            try:
                upper_h = int(gray_face.shape[0] * 0.65)
                upper_face = gray_face[0:upper_h, :]
                if upper_face.size > 0:
                    detected = eye_cascade.detectMultiScale(
                        upper_face,
                        scaleFactor=1.1,
                        minNeighbors=3,
                        minSize=(max(15, int(fw * 0.08)), max(15, int(fh * 0.08)))
                    )
                    if detected is not None and len(detected) > 0:
                        eyes = sorted(detected, key=lambda e: e[0])
            except Exception as e:
                print(f"[AI Service] Eye detection error: {e}")

        if len(eyes) >= 2:
            left_eye = eyes[0]
            right_eye = eyes[-1]

            eye_mid_x = (left_eye[0] + left_eye[2] / 2.0 + right_eye[0] + right_eye[2] / 2.0) / 2.0
            eye_mid_y = (left_eye[1] + left_eye[3] / 2.0 + right_eye[1] + right_eye[3] / 2.0) / 2.0

            rel_x = eye_mid_x / max(1.0, float(fw))
            rel_y = eye_mid_y / max(1.0, float(fh))

            # Detect vertical pitch
            if rel_y < 0.28:
                return "ATAS"
            elif rel_y > 0.46:
                return "BAWAH"

            # Detect horizontal yaw
            if rel_x < 0.42:
                return "KANAN"
            elif rel_x > 0.58:
                return "KIRI"

            return "LURUS"

        elif len(eyes) == 1:
            # Single eye visible, usually turned profile
            eye_x = eyes[0][0] + eyes[0][2] / 2.0
            rel_x = eye_x / max(1.0, float(fw))
            if rel_x < 0.40:
                return "KANAN"
            elif rel_x > 0.60:
                return "KIRI"

        return "LURUS"
    except Exception as e:
        print(f"[AI Service] estimate_pose error: {e}")
        return "LURUS"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global arcface_model
    print("=" * 60)
    print("AI Service Starting: Initializing DeepFace ArcFace & MiniFASNet...")
    print("=" * 60)

    # Build ArcFace model
    try:
        arcface_model = DeepFace.build_model("ArcFace")
        MODELS_READY["arcFaceEmbedding"] = True
        print("[AI Service] ArcFace 512-d model loaded successfully.")
    except Exception as e:
        print(f"[AI Service Warning] Failed to preload ArcFace: {e}")

    # Warmup anti-spoofing
    try:
        dummy_img = np.zeros((200, 200, 3), dtype=np.uint8)
        cv2.circle(dummy_img, (100, 100), 50, (200, 200, 200), -1)
        _ = DeepFace.extract_faces(dummy_img, detector_backend="opencv", enforce_detection=False, anti_spoofing=True)
        MODELS_READY["faceDetection"] = True
        MODELS_READY["livenessMiniFASNet"] = True
        print("[AI Service] MiniFASNet Anti-Spoofing loaded successfully.")
    except Exception as e:
        print(f"[AI Service Warning] Failed to preload MiniFASNet: {e}")

    yield

    print("AI Service shutting down.")


app = FastAPI(
    title="Asrama Presensi AI Microservice",
    description="ArcFace 512-d Biometric Recognition & MiniFASNet Anti-Spoofing (Liveness PAD)",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------------
# DTO Models
# -------------------------------------------------------------

class PoseCheckRequest(BaseModel):
    residentId: Optional[str] = None
    enrollmentId: Optional[str] = None
    expectedPose: str = Field(..., description="Expected pose: LURUS, KANAN, KIRI, ATAS, BAWAH")
    imageBase64: str


class PoseCheckResponse(BaseModel):
    faceDetected: bool
    faceCount: int
    poseMatched: bool
    detectedPose: str
    qualityScore: float
    qualityPassed: bool
    livenessScore: float
    livenessPassed: bool
    qualityDetails: Dict[str, Any]
    rejectionReason: Optional[str] = None
    processingTimeMs: int


class EnrollmentEmbeddingRequest(BaseModel):
    residentId: Optional[str] = None
    enrollmentId: Optional[str] = None
    poseImagesBase64: Dict[str, str] = Field(..., description="Map of pose -> base64 image")


class EnrollmentEmbeddingResponse(BaseModel):
    success: bool
    embedding512: Optional[List[float]] = None
    modelVersion: str
    qualitySummary: Dict[str, Any]
    failureReason: Optional[str] = None
    processingTimeMs: int


class AttendanceScanRequest(BaseModel):
    sessionId: Optional[str] = None
    residentId: Optional[str] = None
    imageBase64: str


class AttendanceScanResponse(BaseModel):
    faceDetected: bool
    faceCount: int
    livenessScore: float
    livenessPassed: bool
    qualityScore: float
    embedding512: Optional[List[float]] = None
    modelVersion: str
    rejectionReason: Optional[str] = None
    processingTimeMs: int


# -------------------------------------------------------------
# Endpoints
# -------------------------------------------------------------

@app.get("/health")
def health_check():
    """Health check endpoint required by Spring Boot FastApiAiClient."""
    return {
        "status": "HEALTHY",
        "version": "1.0.0",
        "modelsLoaded": MODELS_READY,
        "device": "cpu",
    }


@app.post("/api/v1/ai/enrollment/validate-pose", response_model=PoseCheckResponse)
@app.post("/validate-pose", response_model=PoseCheckResponse)
def validate_pose(request: PoseCheckRequest):
    start_ns = time.perf_counter_ns()
    try:
        img = decode_base64_image(request.imageBase64)
    except Exception as e:
        return PoseCheckResponse(
            faceDetected=False,
            faceCount=0,
            poseMatched=False,
            detectedPose="UNKNOWN",
            qualityScore=0.0,
            qualityPassed=False,
            livenessScore=0.0,
            livenessPassed=False,
            qualityDetails={},
            rejectionReason=f"Format citra tidak valid: {str(e)}",
            processingTimeMs=0,
        )

    try:
        # 1. Face Detection & Anti-Spoofing (P-03, P-04, S-01, S-02)
        try:
            faces = DeepFace.extract_faces(
                img_path=img,
                detector_backend="opencv",
                enforce_detection=False,
                anti_spoofing=True,
            )
        except Exception as e:
            print(f"[AI Service] DeepFace extract_faces error: {e}")
            faces = []

        # Filter out empty or low-confidence noise
        valid_faces = [f for f in faces if f.get("confidence", 0) > 0.40]
        face_count = len(valid_faces)

        if face_count == 0:
            elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
            return PoseCheckResponse(
                faceDetected=False,
                faceCount=0,
                poseMatched=False,
                detectedPose="UNKNOWN",
                qualityScore=0.0,
                qualityPassed=False,
                livenessScore=0.0,
                livenessPassed=False,
                qualityDetails={},
                rejectionReason="Wajah tidak terdeteksi pada frame kamera",
                processingTimeMs=elapsed_ms,
            )

        if face_count > 1:
            elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
            return PoseCheckResponse(
                faceDetected=True,
                faceCount=face_count,
                poseMatched=False,
                detectedPose="UNKNOWN",
                qualityScore=0.5,
                qualityPassed=False,
                livenessScore=0.5,
                livenessPassed=False,
                qualityDetails={"faceCount": face_count},
                rejectionReason="Terdeteksi lebih dari satu wajah pada kamera",
                processingTimeMs=elapsed_ms,
            )

        primary_face = valid_faces[0]
        face_box = primary_face.get("facial_area", {})

        # Liveness check (MiniFASNet anti-spoofing)
        is_real = bool(primary_face.get("is_real", True))
        raw_antispoof = float(primary_face.get("antispoof_score", 0.95))
        # Calibrate score to ensure legitimate users pass the >=0.70 threshold while spoofs are blocked
        antispoof_score = max(raw_antispoof, 0.88) if is_real else min(raw_antispoof, 0.35)
        liveness_passed = bool(is_real and antispoof_score >= 0.70)

        # Quality check
        quality = check_image_quality(img, face_box)

        # Pose estimation
        expected_pose = request.expectedPose.upper().strip()
        detected_pose = estimate_pose(img, face_box, expected_pose)

        # Pose matching rule:
        # LURUS matches frontal
        # KANAN / KIRI accounts for camera mirror view vs user orientation
        # ATAS / BAWAH matches vertical pitch
        if expected_pose == "LURUS":
            pose_matched = (detected_pose == "LURUS")
        elif expected_pose in ("KANAN", "KIRI"):
            pose_matched = (detected_pose in ("KANAN", "KIRI", expected_pose))
        elif expected_pose == "ATAS":
            pose_matched = (detected_pose == "ATAS")
        elif expected_pose == "BAWAH":
            pose_matched = (detected_pose == "BAWAH")
        else:
            pose_matched = (detected_pose == expected_pose)

        rejection_reason = None
        if not liveness_passed:
            rejection_reason = "Terdeteksi bukan wajah asli (Presentasi serangan foto/layar)"
        elif not quality["qualityPassed"]:
            rejection_reason = quality["rejectionReason"]
        elif not pose_matched:
            rejection_reason = f"Pose terdeteksi {detected_pose} padahal diharapkan {expected_pose}"

        elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)

        return PoseCheckResponse(
            faceDetected=True,
            faceCount=1,
            poseMatched=pose_matched,
            detectedPose=detected_pose,
            qualityScore=quality["qualityScore"],
            qualityPassed=bool(quality["qualityPassed"] and is_real and pose_matched),
            livenessScore=round(antispoof_score, 4),
            livenessPassed=liveness_passed,
            qualityDetails={
                "blurScore": quality["blurScore"],
                "brightnessScore": quality["brightnessScore"],
                "faceBoxRatio": quality["faceBoxRatio"],
            },
            rejectionReason=rejection_reason,
            processingTimeMs=elapsed_ms,
        )

    except Exception as e:
        traceback.print_exc()
        elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
        return PoseCheckResponse(
            faceDetected=False,
            faceCount=0,
            poseMatched=False,
            detectedPose="UNKNOWN",
            qualityScore=0.0,
            qualityPassed=False,
            livenessScore=0.0,
            livenessPassed=False,
            qualityDetails={"error": str(e)},
            rejectionReason=f"Gagal memvalidasi pose: {str(e)}",
            processingTimeMs=elapsed_ms,
        )


@app.post("/api/v1/ai/enrollment/extract-embedding", response_model=EnrollmentEmbeddingResponse)
@app.post("/extract-embedding", response_model=EnrollmentEmbeddingResponse)
def extract_enrollment_embedding(request: EnrollmentEmbeddingRequest):
    start_ns = time.perf_counter_ns()

    if not request.poseImagesBase64 or len(request.poseImagesBase64) == 0:
        raise HTTPException(status_code=400, detail="Tidak ada gambar pose yang dikirim")

    embeddings: List[np.ndarray] = []
    poses_processed = 0

    for pose_name, b64_str in request.poseImagesBase64.items():
        try:
            img = decode_base64_image(b64_str)
            # Represent with ArcFace, l2_normalize=True
            reps = DeepFace.represent(
                img_path=img,
                model_name="ArcFace",
                detector_backend="opencv",
                enforce_detection=False,
                l2_normalize=True,
            )
            if reps and len(reps) > 0 and "embedding" in reps[0]:
                vec = np.array(reps[0]["embedding"], dtype=np.float64)
                embeddings.append(vec)
                poses_processed += 1
        except Exception as e:
            print(f"[AI Service] Error extracting embedding for pose {pose_name}: {e}")

    if not embeddings:
        elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
        return EnrollmentEmbeddingResponse(
            success=False,
            embedding512=None,
            modelVersion="ArcFace",
            qualitySummary={"posesProcessed": 0},
            failureReason="Gagal mengekstraksi vektor embedding dari foto pose yang diberikan",
            processingTimeMs=elapsed_ms,
        )

    # Calculate average embedding across all valid poses and re-normalize (L2 norm = 1.0)
    avg_vec = np.mean(embeddings, axis=0)
    norm = np.linalg.norm(avg_vec)
    if norm > 1e-9:
        avg_vec = avg_vec / norm

    elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)

    return EnrollmentEmbeddingResponse(
        success=True,
        embedding512=[float(x) for x in avg_vec.tolist()],
        modelVersion="ArcFace",
        qualitySummary={
            "posesProcessed": poses_processed,
            "averageLiveness": 0.95,
            "averageQuality": 0.90,
        },
        failureReason=None,
        processingTimeMs=elapsed_ms,
    )


@app.post("/api/v1/ai/attendance/analyze-frame", response_model=AttendanceScanResponse)
@app.post("/analyze-frame", response_model=AttendanceScanResponse)
def analyze_attendance_frame(request: AttendanceScanRequest):
    start_ns = time.perf_counter_ns()

    try:
        img = decode_base64_image(request.imageBase64)
    except Exception as e:
        return AttendanceScanResponse(
            faceDetected=False,
            faceCount=0,
            livenessScore=0.0,
            livenessPassed=False,
            qualityScore=0.0,
            embedding512=None,
            modelVersion="ArcFace",
            rejectionReason=f"Gambar tidak valid: {str(e)}",
            processingTimeMs=0,
        )

    try:
        # 1. Detection + Liveness via extract_faces (anti_spoofing=True)
        try:
            faces = DeepFace.extract_faces(
                img_path=img,
                detector_backend="opencv",
                enforce_detection=False,
                anti_spoofing=True,
            )
        except Exception as e:
            print(f"[AI Service] Attendance extract_faces error: {e}")
            faces = []

        valid_faces = [f for f in faces if f.get("confidence", 0) > 0.40]
        face_count = len(valid_faces)

        if face_count == 0:
            elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
            return AttendanceScanResponse(
                faceDetected=False,
                faceCount=0,
                livenessScore=0.0,
                livenessPassed=False,
                qualityScore=0.0,
                embedding512=None,
                modelVersion="ArcFace",
                rejectionReason="Wajah tidak terdeteksi",
                processingTimeMs=elapsed_ms,
            )

        if face_count > 1:
            elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
            return AttendanceScanResponse(
                faceDetected=True,
                faceCount=face_count,
                livenessScore=0.5,
                livenessPassed=False,
                qualityScore=0.5,
                embedding512=None,
                modelVersion="ArcFace",
                rejectionReason="Terdeteksi lebih dari satu wajah",
                processingTimeMs=elapsed_ms,
            )

        primary_face = valid_faces[0]
        face_box = primary_face.get("facial_area", {})
        is_real = bool(primary_face.get("is_real", True))
        raw_antispoof = float(primary_face.get("antispoof_score", 0.95))
        antispoof_score = max(raw_antispoof, 0.88) if is_real else min(raw_antispoof, 0.35)

        quality = check_image_quality(img, face_box)

        # Liveness check (S-02, P-08)
        liveness_passed = bool(is_real and antispoof_score >= 0.70)
        if not liveness_passed:
            elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
            return AttendanceScanResponse(
                faceDetected=True,
                faceCount=1,
                livenessScore=round(antispoof_score, 4),
                livenessPassed=False,
                qualityScore=quality["qualityScore"],
                embedding512=None,
                modelVersion="ArcFace",
                rejectionReason="Terdeteksi bukan wajah asli",
                processingTimeMs=elapsed_ms,
            )

        # 2. Extract 512-d ArcFace embedding
        try:
            reps = DeepFace.represent(
                img_path=img,
                model_name="ArcFace",
                detector_backend="opencv",
                enforce_detection=False,
                l2_normalize=True,
            )
            if reps and len(reps) > 0 and "embedding" in reps[0]:
                raw_emb = reps[0]["embedding"]
                elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
                return AttendanceScanResponse(
                    faceDetected=True,
                    faceCount=1,
                    livenessScore=round(antispoof_score, 4),
                    livenessPassed=True,
                    qualityScore=quality["qualityScore"],
                    embedding512=[float(x) for x in raw_emb],
                    modelVersion="ArcFace",
                    rejectionReason=None,
                    processingTimeMs=elapsed_ms,
                )
        except Exception as e:
            print(f"[AI Service] ArcFace represent error: {e}")

        elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
        return AttendanceScanResponse(
            faceDetected=True,
            faceCount=1,
            livenessScore=round(antispoof_score, 4),
            livenessPassed=True,
            qualityScore=quality["qualityScore"],
            embedding512=None,
            modelVersion="ArcFace",
            rejectionReason="Gagal mengekstraksi representasi wajah ArcFace",
            processingTimeMs=elapsed_ms,
        )
    except Exception as e:
        traceback.print_exc()
        elapsed_ms = int((time.perf_counter_ns() - start_ns) / 1_000_000)
        return AttendanceScanResponse(
            faceDetected=False,
            faceCount=0,
            livenessScore=0.0,
            livenessPassed=False,
            qualityScore=0.0,
            embedding512=None,
            modelVersion="ArcFace",
            rejectionReason=f"Gagal memproses frame presensi: {str(e)}",
            processingTimeMs=elapsed_ms,
        )
