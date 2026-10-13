#!/usr/bin/env python3
"""Real-server browser verification. BASE_URL defaults to local SQLite Durable Objects."""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "public" / "samples"
EVIDENCE = Path(os.environ.get("EVIDENCE_DIR", str(ROOT / "docs" / "evidence")))
BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8787").rstrip("/")


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def verify_packet(packet):
    snapshot = {key: packet[key] for key in ("demo", "revision", "calculationRuleVersion", "deal", "commitments", "events", "reconciliation")}
    digest = hashlib.sha256(canonical(snapshot).encode("utf-8")).hexdigest()
    assert digest == packet["snapshotHash"], "Downloaded data does not match its snapshot hash"
    assert packet["review"]["approvedHash"] == digest, "Approval is for a different snapshot"
    assert packet["review"]["approvedRevision"] == packet["revision"], "Approval is stale"
    assert packet["review"]["reviewer"] == "DEMO-REVIEWER-01"
    assert packet["reconciliation"]["ready"] is True
    matched = next(item for item in packet["events"] if item["id"] == "DEMO-AURORA-PAY-003")
    assert matched["commitmentId"] == "DEMO-AURORA-COM-002"
    assert matched["amountMinor"] == "200000"
    assert packet["deal"]["legal"]["status"] == "final"
    return {"revision": packet["revision"], "snapshotHash": digest, "reviewer": packet["review"]["reviewer"],
            "matchedEventId": matched["id"], "matchedCommitmentId": matched["commitmentId"]}


class Run:
    def __init__(self, page, directory=EVIDENCE, observer=None):
        self.page, self.directory, self.observer = page, Path(directory), observer
        self.directory.mkdir(parents=True, exist_ok=True)
        self.started = time.monotonic()
        self.steps = []
        self.checks = []
        self.errors = []
        self.api_failures = []
        self.console_errors = []
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.on("console", lambda message: self.console_errors.append(message.text) if message.type == "error" else None)
        page.on("response", lambda response: self.api_failures.append({"url": response.url, "status": response.status})
                if "/api/" in response.url and response.status >= 400 else None)

    def capture(self, name, note=""):
        self.page.screenshot(path=str(self.directory / f"{name}.png"), full_page=self.page.locator("dialog[open]").count() == 0)
        self.steps.append({"name": name, "secondsFromStart": round(time.monotonic() - self.started, 3), "note": note})
        if self.observer:
            self.observer(name, note)

    def click(self, locator):
        locator.scroll_into_view_if_needed()
        locator.click()


def loaded(page):
    expect(page.locator("#workbench")).to_have_attribute("aria-busy", "false", timeout=15000)
    expect(page.locator("#import-open")).to_be_enabled()


def open_import(run):
    run.click(run.page.locator("#import-open"))
    expect(run.page.locator("#import-dialog")).to_be_visible()


def supply_files(page, invalid=False):
    commitments = (FIXTURES / "commitments.csv").read_bytes()
    if invalid:
        commitments = commitments.replace(b"30000.00", b"3e4")
    page.locator("#commitments-file").set_input_files({"name": "commitments.csv", "mimeType": "text/csv", "buffer": commitments})
    page.locator("#payments-file").set_input_files(str(FIXTURES / "payments.csv"))
    page.locator("#import-ack").check()


def keyboard_checks(run):
    page = run.page
    page.keyboard.press("Tab")
    assert page.locator(":focus").get_attribute("class") == "skip-link", "First Tab should reach skip link"
    open_import(run)
    assert page.evaluate("document.querySelector('#import-dialog').contains(document.activeElement)")
    for _ in range(16):
        page.keyboard.press("Tab")
        assert page.evaluate("document.querySelector('#import-dialog').contains(document.activeElement)"), "Focus escaped dialog"
    page.keyboard.press("Escape")
    expect(page.locator("#import-dialog")).not_to_be_visible()
    expect(page.locator("#import-open")).to_be_focused()


def run_workflow(run, include_invalid=True):
    """All core actions use the UI. Selectors are intentionally explicit and reusable."""
    page = run.page
    run.capture("desktop-seed", "Fresh private synthetic session")
    if include_invalid:
        before = page.context.request.get(f"{page.url.rstrip('/')}/api/state").json()["state"]
        open_import(run)
        supply_files(page, invalid=True)
        with page.expect_response(lambda response: response.url.endswith("/api/import/preview")) as invalid_info:
            run.click(page.locator("#preview-button"))
        invalid_preview = invalid_info.value.json()
        assert invalid_preview["valid"] is False and invalid_preview["errors"]
        expect(page.locator("#import-preview [role=alert]")).to_be_visible()
        expect(page.locator("#import-confirm")).not_to_be_visible()
        after = page.context.request.get(f"{page.url.rstrip('/')}/api/state").json()["state"]
        assert before == after, "Invalid preview mutated state"
        run.checks.append({"name": "invalid-server-preview-does-not-mutate", "status": "passed", "errorCount": len(invalid_preview["errors"])})
        run.capture("invalid-import", "Real server validation of exponent-form money; no mutation")
        page.keyboard.press("Escape")
    open_import(run)
    supply_files(page)
    with page.expect_response(lambda response: response.url.endswith("/api/import/preview")) as preview_info:
        run.click(page.locator("#preview-button"))
    preview = preview_info.value.json()
    assert preview["valid"] is True and len(preview["previewHash"]) == 64
    run.checks.append({"name": "valid-server-preview", "status": "passed", "summary": preview["summary"]})
    expect(page.locator("#import-preview")).to_be_visible(timeout=15000)
    expect(page.locator("#import-confirm")).to_be_enabled()
    run.capture("import-preview", "Both CSV files validated by the server before atomic import")
    run.click(page.locator("#import-confirm"))
    expect(page.locator("#import-dialog")).not_to_be_visible(timeout=15000)
    loaded(page)
    run.capture("after-import", "Imported receipt remains unassigned until a human matches it")
    run.click(page.locator('[data-select-deal="DEMO-AURORA"]').first)
    run.click(page.locator('[data-match-event="DEMO-AURORA-PAY-003"]').first)
    expect(page.locator("#match-dialog")).to_be_visible()
    page.locator("#match-account").select_option("DEMO-AURORA-COM-002")
    run.capture("receipt-match", "Explicit selection of Linden Ventures' commitment for the 2,000 GBP receipt")
    run.click(page.locator('#match-form button[type="submit"]'))
    expect(page.locator("#match-dialog")).not_to_be_visible(timeout=15000)
    run.capture("after-match", "Principal is reconciled; final legal evidence is still required")
    run.click(page.locator("#legal-open"))
    page.locator("#legal-file").set_input_files(str(FIXTURES / "final-legal.json"))
    run.capture("legal-metadata", "Synthetic final-reference metadata; no real legal document is verified")
    run.click(page.locator('#legal-form button[type="submit"]'))
    expect(page.locator("#legal-dialog")).not_to_be_visible(timeout=15000)
    expect(page.locator("#review-request")).to_be_enabled()
    run.capture("ready-for-review", "Every deterministic blocker resolved; human approval remains required")
    run.click(page.locator("#review-request"))
    expect(page.locator("#review-open")).to_be_enabled(timeout=15000)
    run.click(page.locator("#review-open"))
    expect(page.locator("#review-dialog")).to_be_visible()
    expect(page.locator("#review-check")).not_to_be_checked()
    page.locator("#review-check").check()
    run.capture("human-review", "Synthetic reviewer explicitly confirms the exact requested current revision")
    run.click(page.locator('#review-form button[type="submit"]'))
    expect(page.locator("#review-dialog")).not_to_be_visible(timeout=15000)
    expect(page.locator("#packet-open")).to_be_enabled()
    run.click(page.locator("#packet-open"))
    expect(page.locator("#packet-dialog")).to_be_visible(timeout=15000)
    run.capture("reviewed-packet", "Current reviewed data and revision-bound hash can be downloaded")
    with page.expect_download() as download_info:
        run.click(page.locator("#packet-download"))
    downloaded = download_info.value
    downloaded.save_as(str(run.directory / "demo-closing-packet.json"))
    packet = json.loads(Path(downloaded.path()).read_text())
    verified = verify_packet(packet)
    with page.expect_download() as ledger_info:
        run.click(page.locator("#ledger-download"))
    ledger = Path(ledger_info.value.path()).read_text()
    ledger_info.value.save_as(str(run.directory / "demo-closing-packet.csv"))
    ledger_rows = list(csv.DictReader(io.StringIO(ledger)))
    ledger_event = next(row for row in ledger_rows if row["event_id"] == "DEMO-AURORA-PAY-003")
    assert ledger_event["commitment_id"] == "DEMO-AURORA-COM-002" and ledger_event["amount_minor"] == "200000"
    verified["packetFilename"] = downloaded.suggested_filename
    verified["ledgerFilename"] = ledger_info.value.suggested_filename
    page.keyboard.press("Escape")
    page.reload(wait_until="networkidle")
    loaded(page)
    expect(page.locator("#packet-open")).to_be_enabled()
    run.capture("persisted-review", "Actual server-backed approved session survives reload")
    return verified


def responsive_checks(run):
    page = run.page
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Desktop page has horizontal overflow"
    page.evaluate("window.scrollTo(0, 0)")
    page.screenshot(path=str(EVIDENCE / "desktop-viewport.png"))
    page.locator("#queue-search").fill("No synthetic deal has this name")
    expect(page.locator("#queue-empty")).to_be_visible()
    run.capture("empty-search-results", "Actual no-results state produced by the deal search")
    run.click(page.locator("[data-clear-filters]"))
    expect(page.locator("#queue-empty")).not_to_be_visible()
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(200)
    assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile page has horizontal overflow"
    run.capture("mobile-reviewed", "390 × 844 responsive layout in the actual approved session")
    page.evaluate("window.scrollTo(0, 0)")
    page.screenshot(path=str(EVIDENCE / "mobile-viewport.png"))
    open_import(run)
    run.capture("mobile-dialog", "Responsive native dialog; all controls remain reachable by scrolling")
    for _ in range(16):
        page.keyboard.press("Tab")
        assert page.evaluate("document.querySelector('#import-dialog').contains(document.activeElement)")
    page.keyboard.press("Escape")
    expect(page.locator("#import-open")).to_be_focused()
    page.set_viewport_size({"width": 1440, "height": 1000})


def induced_state_checks(browser, base_url, storage_state=None):
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, storage_state=storage_state)
    page = context.new_page()
    held = []
    page.route("**/api/session", lambda route: held.append(route))
    page.goto(base_url, wait_until="domcontentloaded")
    expect(page.locator(".loading-state")).to_be_visible()
    page.screenshot(path=str(EVIDENCE / "loading-induced-delay.png"), full_page=True)
    # Let the genuine server request finish after recording the induced delay.
    for route in held:
        route.continue_()
    page.unroute("**/api/session")
    loaded(page)
    context.close()
    context = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = context.new_page()
    page.route("**/api/session", lambda route: route.fulfill(status=503, content_type="application/json", body=json.dumps({"error": {"code": "STORAGE_UNAVAILABLE", "message": "Induced QA condition: synthetic session database unavailable."}})))
    page.goto(base_url, wait_until="networkidle")
    expect(page.locator("#error")).to_be_visible()
    page.screenshot(path=str(EVIDENCE / "error-induced-unavailable.png"), full_page=True)
    context.close()
    return ["loading-induced-delay: held session request, then continued to genuine server", "error-induced-unavailable: deliberately fulfilled one session request with labelled 503"]


def stale_download_check(browser, base_url):
    """Prepare a separate genuine server session, then mutate it behind an open packet."""
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    page = context.new_page()
    page.goto(base_url, wait_until="networkidle")
    loaded(page)
    payload = context.request.get(f"{base_url}/api/state").json()
    revision = payload["state"]["revision"]
    headers = {"Origin": base_url}

    def post(operation, body, expected_status=200):
        response = context.request.post(f"{base_url}/api/{operation}", data={**body, "expectedRevision": revision}, headers=headers)
        assert response.status == expected_status, response.text()
        return response.json()

    files = {"commitmentsCsv": (FIXTURES / "commitments.csv").read_text(), "paymentsCsv": (FIXTURES / "payments.csv").read_text()}
    preview = post("import/preview", files)
    result = post("import", {**files, "previewHash": preview["previewHash"]})
    revision = result["state"]["revision"]
    result = post("match", {"dealId": "DEMO-AURORA", "eventId": "DEMO-AURORA-PAY-003", "commitmentId": "DEMO-AURORA-COM-002"})
    revision = result["state"]["revision"]
    result = post("legal", {"dealId": "DEMO-AURORA", "metadata": json.loads((FIXTURES / "final-legal.json").read_text())})
    revision = result["state"]["revision"]
    result = post("review/request", {"dealId": "DEMO-AURORA"})
    revision = result["state"]["revision"]
    page.reload(wait_until="networkidle")
    loaded(page)
    page.locator("#review-open").click()
    page.locator("#review-check").check()
    # A real second client changes the session while the review dialog is open.
    result = post("legal", {"dealId": "DEMO-AURORA", "metadata": json.loads((FIXTURES / "final-legal.json").read_text())})
    revision = result["state"]["revision"]
    with page.expect_response(lambda response: "/api/review/approve" in response.url) as stale_review:
        page.locator('#review-form button[type="submit"]').click()
    assert stale_review.value.status == 409
    expect(page.locator("#review-error")).to_be_visible()
    expect(page.locator("#review-check")).not_to_be_checked()
    page.screenshot(path=str(EVIDENCE / "stale-review-rejected.png"))
    page.keyboard.press("Escape")
    # Request/approve the new revision explicitly, then test a stale packet modal.
    result = post("review/request", {"dealId": "DEMO-AURORA"})
    revision = result["state"]["revision"]
    result = post("review/approve", {"dealId": "DEMO-AURORA", "reviewer": "DEMO-REVIEWER-01", "confirmed": True})
    revision = result["state"]["revision"]
    page.reload(wait_until="networkidle")
    loaded(page)
    page.locator("#packet-open").click()
    expect(page.locator("#packet-dialog")).to_be_visible()
    downloads = []
    page.on("download", lambda download: downloads.append(download.suggested_filename))
    result = post("fee", {"dealId": "DEMO-AURORA", "payer": "investors"})
    revision = result["state"]["revision"]
    with page.expect_response(lambda response: "/api/export?" in response.url) as stale_packet:
        page.locator("#packet-download").click()
    assert stale_packet.value.status == 409
    expect(page.locator("#packet-error")).to_be_visible()
    expect(page.locator("#packet-download")).to_be_disabled()
    assert page.locator("#packet-json").inner_text() == ""
    page.wait_for_timeout(250)
    assert not downloads, "A stale cached packet was downloaded"
    page.screenshot(path=str(EVIDENCE / "stale-packet-rejected.png"))
    current = context.request.get(f"{base_url}/api/state").json()["state"]
    assert current["revision"] == revision and all(deal["review"] is None for deal in current["deals"])
    context.close()
    return {"staleReview": "409; checkbox cleared; UI refreshed", "stalePacket": "409; no download; cached JSON cleared; controls disabled", "currentRevision": revision}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=BASE_URL)
    args = parser.parse_args()
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    report = {"capturedAt": datetime.now(timezone.utc).isoformat(), "baseUrl": args.base_url, "target": "local Wrangler with SQLite Durable Objects" if urlparse(args.base_url).hostname in ("localhost", "127.0.0.1") else "remote deployment",
              "desktopViewport": {"width": 1440, "height": 1000}, "mobileViewport": {"width": 390, "height": 844}, "passed": False}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
        page = context.new_page()
        run = Run(page)
        try:
            page.goto(args.base_url, wait_until="networkidle")
            loaded(page)
            keyboard_checks(run)
            report["packet"] = run_workflow(run)
            responsive_checks(run)
            (ROOT / "work").mkdir(exist_ok=True)
            context.storage_state(path=str(ROOT / "work" / "qa-session.json"))
            report["inducedStateConditions"] = induced_state_checks(browser, args.base_url, storage_state=context.storage_state())
            report["staleRegression"] = stale_download_check(browser, args.base_url)
            assert not run.errors, run.errors
            assert not run.console_errors, run.console_errors
            unexpected = [failure for failure in run.api_failures if not (failure["url"].endswith("/api/import/preview") and failure["status"] == 400)]
            assert not unexpected, unexpected
            report["passed"] = True
        except Exception as error:
            report["failure"] = str(error) or repr(error)
            page.screenshot(path=str(EVIDENCE / "failure.png"), full_page=True)
            raise
        finally:
            report.update({"steps": run.steps, "checks": run.checks, "pageErrors": run.errors, "consoleErrors": run.console_errors, "apiFailures": run.api_failures})
            (EVIDENCE / "browser-results.json").write_text(json.dumps(report, indent=2) + "\n")
            browser.close()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
