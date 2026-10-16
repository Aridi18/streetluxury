"""End-to-end API tests: auth, CSRF, isolation, uploads, playback, analysis, reports, deletion."""

from datetime import timedelta

import numpy as np
from conftest import CSRF, SR, run_worker_until_idle, speech_like, write_audio


def upload(client, path, source="upload", title=None):
    q = f"?source={source}" + (f"&title={title}" if title else "")
    return client.post(
        f"/api/recordings{q}",
        content=path.read_bytes(),
        headers={**CSRF, "X-Filename": path.name, "Content-Type": "application/octet-stream"},
    )


def ready_recording(client, tmp_path, seconds=12.0, name="clip.wav", x=None, codec=None):
    path = write_audio(tmp_path / name, speech_like(seconds) if x is None else x, codec=codec)
    r = upload(client, path)
    assert r.status_code == 201, r.text
    run_worker_until_idle()
    rec = client.get(f"/api/recordings/{r.json()['id']}").json()
    assert rec["status"] == "ready", rec
    return rec, path


def test_auth_flow_and_csrf(client):
    r = client.post("/api/auth/register", json={"email": "Flow@Example.com", "password": "short"}, headers=CSRF)
    assert r.status_code == 400
    r = client.post("/api/auth/register", json={"email": "flow@example.com", "password": "a long test password"})
    assert r.status_code == 403  # missing CSRF header
    r = client.post(
        "/api/auth/register", json={"email": "Flow@Example.com", "password": "a long test password"}, headers=CSRF
    )
    assert r.status_code == 201 and r.json()["email"] == "flow@example.com"
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/api" in cookie
    assert client.get("/api/auth/me").status_code == 200
    r = client.post(
        "/api/auth/register", json={"email": "flow@example.com", "password": "a long test password"}, headers=CSRF
    )
    assert r.status_code == 400
    assert client.post("/api/auth/logout", headers=CSRF).status_code == 204
    assert client.get("/api/auth/me").status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"email": "flow@example.com", "password": "wrong password!"}, headers=CSRF
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/login", json={"email": "flow@example.com", "password": "a long test password"}, headers=CSRF
        ).status_code
        == 200
    )


def test_cross_origin_request_rejected(user_client):
    r = user_client.post("/api/auth/logout", headers={**CSRF, "Origin": "https://evil.example"})
    assert r.status_code == 403


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"
    assert "default-src 'none'" in r.headers["content-security-policy"]


def test_unauthenticated_access_denied(client):
    client.cookies.clear()
    for path in ("/api/recordings", "/api/analyses", "/api/system/status", "/api/dashboard"):
        assert client.get(path).status_code == 401


def test_upload_validation(user_client, tmp_path):
    bad = tmp_path / "x.wav"
    bad.write_bytes(b"<html>" * 100)
    r = upload(user_client, bad)
    assert r.status_code == 415 and "Supported formats" in r.json()["detail"]
    empty = tmp_path / "e.wav"
    empty.write_bytes(b"")
    assert upload(user_client, empty).status_code == 400
    big = tmp_path / "big.wav"
    big.write_bytes(b"RIFF" + b"\x00" * (21 * 1024 * 1024))
    assert upload(user_client, big).status_code == 413
    trunc = tmp_path / "t.wav"
    trunc.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 20)
    assert upload(user_client, trunc).status_code in (415, 422)


def test_upload_playback_and_isolation(user_client, client, tmp_path):
    rec, path = ready_recording(user_client, tmp_path, name="evidence.mp3", codec=["-c:a", "libmp3lame", "-b:a", "64k"])
    rid = rec["id"]
    import hashlib

    assert rec["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert rec["spectrogram"]["tiles"] and not rec["playback_transcoded"]
    r = user_client.get(f"/api/recordings/{rid}/audio", headers={"Range": "bytes=10-109"})
    assert r.status_code == 206 and len(r.content) == 100
    assert r.content == path.read_bytes()[10:110]
    assert r.headers["content-range"] == f"bytes 10-109/{len(path.read_bytes())}"
    assert user_client.get(f"/api/recordings/{rid}/audio?download=1").content == path.read_bytes()
    assert user_client.get(f"/api/recordings/{rid}/audio", headers={"Range": "bytes=999999999-"}).status_code == 416
    assert user_client.get(f"/api/recordings/{rid}/peaks").json()["peaks"]
    assert user_client.get(f"/api/recordings/{rid}/spectrogram/0.png").headers["content-type"] == "image/png"

    # A different user cannot see, stream or analyse it (404, not 403).
    client.cookies.clear()
    r = client.post(
        "/api/auth/register", json={"email": "other@example.com", "password": "another long password"}, headers=CSRF
    )
    assert r.status_code in (201, 400)
    if r.status_code == 400:
        client.post(
            "/api/auth/login", json={"email": "other@example.com", "password": "another long password"}, headers=CSRF
        )
    for url in (f"/api/recordings/{rid}", f"/api/recordings/{rid}/audio", f"/api/recordings/{rid}/peaks"):
        assert client.get(url).status_code == 404
    assert client.post(f"/api/recordings/{rid}/analyses", json={}, headers=CSRF).status_code == 404
    assert client.delete(f"/api/recordings/{rid}", headers=CSRF).status_code == 404
    assert client.get("/api/recordings/not-a-uuid").status_code == 404


def test_opus_voice_note_gets_playback_copy(user_client, tmp_path):
    rec, _ = ready_recording(
        user_client, tmp_path, name="PTT-20240101-WA0001.ogg", codec=["-c:a", "libopus", "-b:a", "24k"]
    )
    assert rec["playback_transcoded"]
    r = user_client.get(f"/api/recordings/{rec['id']}/audio")
    assert r.headers["content-type"] == "audio/flac" and r.content[:4] == b"fLaC"


def test_analysis_report_and_audit(user_client, tmp_path):
    x = speech_like(16, seed=5, noise_db=-50)
    y = np.concatenate([x[: 8 * SR], np.zeros(int(0.5 * SR), np.float32), x[8 * SR :]])
    rec, _ = ready_recording(user_client, tmp_path, x=y, name="edited.wav")
    r = user_client.post(f"/api/recordings/{rec['id']}/analyses", json={}, headers=CSRF)
    assert r.status_code == 201 and r.json()["status"] == "queued"
    aid = r.json()["id"]
    run_worker_until_idle()
    a = user_client.get(f"/api/analyses/{aid}").json()
    assert a["status"] == "succeeded", a["error"]
    res = a["result"]
    assert res["file"]["sha256"] == rec["sha256"]
    assert res["assessments"]["synthetic"]["status"] == "not_configured"
    assert any(f["label"] == "Possible edit" and f["start"] - 0.3 <= 8.0 <= f["end"] + 0.3 for f in res["findings"])
    pdf = user_client.get(f"/api/analyses/{aid}/report.pdf")
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"
    hist = user_client.get("/api/analyses").json()
    assert hist["total"] >= 1 and hist["items"][0]["findings_count"] is not None
    # Segment analysis validation.
    assert (
        user_client.post(
            f"/api/recordings/{rec['id']}/analyses", json={"start": 3, "end": 3.5}, headers=CSRF
        ).status_code
        == 422
    )
    assert (
        user_client.post(
            f"/api/recordings/{rec['id']}/analyses", json={"start": 3, "end": 99}, headers=CSRF
        ).status_code
        == 422
    )
    seg = user_client.post(f"/api/recordings/{rec['id']}/analyses", json={"start": 4, "end": 12}, headers=CSRF).json()
    run_worker_until_idle()
    s = user_client.get(f"/api/analyses/{seg['id']}").json()
    assert s["status"] == "succeeded" and s["result"]["scope"]["whole_file"] is False


def test_cancel_queued_analysis(user_client, tmp_path):
    rec, _ = ready_recording(user_client, tmp_path)
    aid = user_client.post(f"/api/recordings/{rec['id']}/analyses", json={}, headers=CSRF).json()["id"]
    assert user_client.post(f"/api/analyses/{aid}/cancel", headers=CSRF).json()["status"] == "cancelled"
    run_worker_until_idle()
    assert user_client.get(f"/api/analyses/{aid}").json()["status"] == "cancelled"


def test_comparison_endpoint(user_client, tmp_path):
    a = speech_like(20, seed=31)
    b = np.concatenate([a[: 6 * SR], a[9 * SR :]])
    ra, _ = ready_recording(user_client, tmp_path, x=a, name="orig.wav")
    rb, _ = ready_recording(user_client, tmp_path, x=b, name="cut.wav", codec=["-c:a", "libmp3lame", "-b:a", "96k"])
    assert (
        user_client.post(
            "/api/comparisons", json={"original_id": ra["id"], "suspect_id": ra["id"]}, headers=CSRF
        ).status_code
        == 422
    )
    c = user_client.post(
        "/api/comparisons", json={"original_id": ra["id"], "suspect_id": rb["id"]}, headers=CSRF
    ).json()
    run_worker_until_idle()
    c = user_client.get(f"/api/comparisons/{c['id']}").json()
    assert c["status"] == "succeeded", c["error"]
    assert any(p["kind"] == "removed" for p in c["result"]["splice_points"])
    assert user_client.get(f"/api/comparisons/{c['id']}/report.pdf").content[:5] == b"%PDF-"


def test_delete_recording_removes_objects(user_client, tmp_path):
    from app.storage import get_store

    rec, _ = ready_recording(user_client, tmp_path)
    key = f"recordings/{rec['id']}/original"
    assert get_store().exists(key)
    assert user_client.delete(f"/api/recordings/{rec['id']}", headers=CSRF).status_code == 204
    assert not get_store().exists(key)
    assert user_client.get(f"/api/recordings/{rec['id']}").status_code == 404


def test_retention_purges_audio_but_keeps_results(user_client, tmp_path):
    from app.db import session_scope
    from app.models import Recording, utcnow
    from app.services.retention import purge_expired
    from app.storage import get_store

    rec, _ = ready_recording(user_client, tmp_path)
    with session_scope() as db:
        db.get(Recording, rec["id"]).audio_expires_at = utcnow() - timedelta(minutes=1)
    with session_scope() as db:
        assert purge_expired(db) >= 1
    after = user_client.get(f"/api/recordings/{rec['id']}").json()
    assert after["audio_purged_at"] and not after["has_audio"]
    assert not get_store().exists(f"recordings/{rec['id']}/original")
    assert user_client.get(f"/api/recordings/{rec['id']}/audio").status_code == 410
    assert user_client.post(f"/api/recordings/{rec['id']}/analyses", json={}, headers=CSRF).status_code == 410


def test_settings_and_delete_after_analysis(user_client, tmp_path):
    s = user_client.put(
        "/api/settings", json={"retention_days": 7, "delete_audio_after_analysis": True}, headers=CSRF
    ).json()
    assert s["retention_days"] == 7 and s["delete_audio_after_analysis"]
    assert user_client.put("/api/settings", json={"retention_days": 9999}, headers=CSRF).status_code == 422
    rec, _ = ready_recording(user_client, tmp_path)
    user_client.post(f"/api/recordings/{rec['id']}/analyses", json={"run_synthetic": False}, headers=CSRF)
    run_worker_until_idle()
    assert user_client.get(f"/api/recordings/{rec['id']}").json()["audio_purged_at"]


def test_delete_all_data_and_account(user_client, tmp_path):
    ready_recording(user_client, tmp_path)
    assert user_client.post("/api/account/delete-data", json={"password": "wrong"}, headers=CSRF).status_code == 403
    r = user_client.post("/api/account/delete-data", json={"password": "a long test password"}, headers=CSRF)
    assert r.status_code == 200 and r.json()["deleted_recordings"] >= 1
    assert user_client.get("/api/recordings").json()["total"] == 0
    assert (
        user_client.post("/api/account/delete", json={"password": "a long test password"}, headers=CSRF).status_code
        == 204
    )
    assert user_client.get("/api/auth/me").status_code == 401


def test_system_status_reports_unconfigured_models(user_client):
    s = user_client.get("/api/system/status").json()
    assert s["storage"]["public_urls"] is False
    assert len(s["signal_checks"]) == 11
    assert s["calibration"]["editing"]["provenance"]["validated"] is False


def test_job_queue_retry_and_dedupe():
    from app.db import session_scope
    from app.jobs import queue
    from app.models import Job

    with session_scope() as db:
        j = queue.enqueue(db, "noop-test", {}, max_attempts=2)
        assert queue.enqueue(db, "noop-test", {}, dedupe_key="only-one") is not None
        assert queue.enqueue(db, "noop-test", {}, dedupe_key="only-one") is None
        claimed = queue.claim(db, "w1", ["noop-test"])
        assert claimed is not None and claimed.status == "running"
        queue.fail(db, claimed, "boom")
        assert db.get(Job, claimed.id).status == "queued"  # retried with backoff
        db.query(Job).filter(Job.kind == "noop-test").delete()
        _ = j


def test_analysis_waits_for_ingest_without_failing(user_client, tmp_path):
    """An analysis claimed before its recording is processed is deferred, not failed."""
    from app.db import session_scope
    from app.jobs import queue
    from app.jobs.worker import Worker
    from app.models import Job

    path = write_audio(tmp_path / "late.wav", speech_like(6))
    rid = upload(user_client, path).json()["id"]
    aid = user_client.post(f"/api/recordings/{rid}/analyses", json={}, headers=CSRF).json()["id"]
    w = Worker(worker_id="test-defer", kinds=["analysis"])
    assert w.run_once()  # analysis claimed first: deferred because ingest has not run
    with session_scope() as db:
        job = db.query(Job).filter(Job.kind == "analysis").order_by(Job.id.desc()).first()
        assert job.status == "queued" and job.attempts == 0
        job.run_after = job.created_at  # make it runnable again now
    assert user_client.get(f"/api/analyses/{aid}").json()["status"] == "queued"
    run_worker_until_idle()
    assert user_client.get(f"/api/analyses/{aid}").json()["status"] == "succeeded"
    _ = queue
