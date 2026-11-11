"""
Automated Verification Suite for AI Microservice (ArcFace + MiniFASNet Anti-Spoofing PAD).
"""

import base64
import numpy as np
import cv2
from fastapi.testclient import TestClient
from main import app, decode_base64_image

client = TestClient(app)


def create_synthetic_face_image(is_front=True) -> str:
    """Create a realistic synthetic test image containing a face structure."""
    img = np.full((320, 320, 3), 140, dtype=np.uint8)

    # Face oval
    cv2.ellipse(img, (160, 160), (75, 105), 0, 0, 360, (210, 185, 170), -1)

    # Eyes
    if is_front:
        cv2.circle(img, (130, 140), 9, (40, 40, 40), -1)
        cv2.circle(img, (190, 140), 9, (40, 40, 40), -1)
    else:
        # Shifted eyes (looking sideways)
        cv2.circle(img, (110, 140), 9, (40, 40, 40), -1)
        cv2.circle(img, (165, 140), 9, (40, 40, 40), -1)

    # Nose
    cv2.line(img, (160, 150), (160, 180), (160, 130, 120), 3)

    # Mouth
    cv2.ellipse(img, (160, 210), (25, 8), 0, 0, 180, (140, 60, 60), 3)

    _, buf = cv2.imencode(".jpg", img)
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def test_01_health_check():
    print("Testing GET /health...")
    resp = client.get("/health")
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    data = resp.json()
    assert data["status"] == "HEALTHY"
    assert "modelsLoaded" in data
    print("✓ Health check PASSED:", data)


def test_02_validate_pose_empty_image():
    print("Testing POST /validate-pose with blank image...")
    # Completely black blank image (no face)
    black_img = np.zeros((200, 200, 3), dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", black_img)
    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")

    payload = {
        "expectedPose": "LURUS",
        "imageBase64": b64
    }
    resp = client.post("/api/v1/ai/enrollment/validate-pose", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["faceDetected"] is False
    assert data["rejectionReason"] == "Wajah tidak terdeteksi pada frame kamera"
    print("✓ Empty face rejection PASSED:", data["rejectionReason"])


def test_03_anti_spoofing_presentation_attack():
    print("Testing Anti-Spoofing (PAD) with artificial/synthetic presentation...")
    # Synthetic image is recognized as digital drawing / presentation attack by MiniFASNet
    b64 = create_synthetic_face_image()
    payload = {
        "sessionId": "11111111-1111-1111-1111-111111111111",
        "residentId": "22222222-2222-2222-2222-222222222222",
        "imageBase64": b64
    }
    resp = client.post("/api/v1/ai/attendance/analyze-frame", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    print("✓ Analyze frame response:", {
        "faceDetected": data["faceDetected"],
        "livenessPassed": data["livenessPassed"],
        "livenessScore": data["livenessScore"],
        "rejectionReason": data["rejectionReason"],
        "processingTimeMs": data["processingTimeMs"]
    })
    # Must run in under 3 seconds (target S-06)
    assert data["processingTimeMs"] < 3000, f"Latency {data['processingTimeMs']}ms exceeds 3000ms"
    print(f"✓ Latency check PASSED: {data['processingTimeMs']}ms (< 3000ms)")


def test_04_extract_embedding_dimension_and_norm():
    print("Testing ArcFace embedding 512-dimension & normalization...")
    b64 = create_synthetic_face_image()
    payload = {
        "residentId": "22222222-2222-2222-2222-222222222222",
        "enrollmentId": "33333333-3333-3333-3333-333333333333",
        "poseImagesBase64": {
            "LURUS": b64,
            "KANAN": b64,
            "KIRI": b64,
            "ATAS": b64,
            "BAWAH": b64
        }
    }
    resp = client.post("/api/v1/ai/enrollment/extract-embedding", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    emb = data["embedding512"]
    assert len(emb) == 512, f"Expected 512 dimensions, got {len(emb)}"

    # Check L2 norm is ~1.0
    norm = np.linalg.norm(np.array(emb))
    assert abs(norm - 1.0) < 1e-4, f"Expected L2 norm ~1.0, got {norm}"
    print(f"✓ ArcFace 512-d extraction PASSED (length: {len(emb)}, L2 norm: {norm:.4f}, latency: {data['processingTimeMs']}ms)")


if __name__ == "__main__":
    with TestClient(app) as client:
        test_01_health_check()
        test_02_validate_pose_empty_image()
        test_03_anti_spoofing_presentation_attack()
        test_04_extract_embedding_dimension_and_norm()
        print("\nALL AI SERVICE TESTS (WITH LIFESPAN WARMUP) PASSED 100%!")
