#!/usr/bin/env python3
"""Record the real public application and render a focused portrait walkthrough.

Free local dependencies: Python Playwright, Chromium, FFmpeg (with flite/libass).
No local server, paid voice service, credentials, or deployment is involved.
The browser uses the configured proxy and trusts only its supplied certificate
SPKI when ODIN_PROXY_CA_CERT is present; general TLS validation stays enabled.

  python docs/walkthrough-public/record-public.py --base-url PUBLIC_HTTPS_URL
  python docs/walkthrough-public/record-public.py --render-only

Capture is a continuous desktop browser recording. Portrait composition crops
the active panel for each scene; the application layout and data are unchanged.
"""
import argparse
import base64
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib.parse import urlparse

import playwright as playwright_package
from playwright.sync_api import sync_playwright, expect

DIRECTORY = Path(__file__).resolve().parent
ROOT = DIRECTORY.parents[1]
SCRATCH = ROOT / "work" / "public-recording"
FIXTURES = ROOT / "public" / "samples"
VIEWPORT = {"width": 1200, "height": 1080}
PUBLIC_URL = "https://ayo-odin-close-control.ayoahmed-49d.workers.dev/"

STORYBOARD = [
    ("intro", "A clear path to a ready close", "This is Odin Close Control, an independent concept by Ayo Ahmed. On the public app, I'll take one fictional deal from a cash exception to a reviewed handoff."),
    ("commitments-upload", "01 · Upload commitments", "First, I upload the commitments CSV: known synthetic accounts and exact amounts."),
    ("payments-upload", "02 · Upload payment events", "Then the payment events CSV. I confirm that these are the supplied synthetic records and ask for a preview."),
    ("validated-preview", "Preview before saving", "The server shows commitment changes and new payment events before anything is saved. The preview is tied to this revision."),
    ("atomic-import", "Apply one atomic import", "I apply these validated files together. Either every change is saved, or none is."),
    ("cash-exception", "Keep the exception visible", "Aurora still has a two thousand pound receipt without an account. It stays outside matched cash until someone resolves it."),
    ("explicit-match", "Choose the exact account", "I choose Linden Ventures' commitment for this receipt, then explicitly confirm the match. That decision is recorded in the audit trail."),
    ("reconciled-cash", "Cash reconciled", "The cash shortfall is now zero. Principal and illustrative fees stay separate. Final legal evidence is still required."),
    ("legal-metadata", "Attach a final reference", "I attach the final synthetic legal metadata. It records a document reference and hash; it does not verify a real agreement."),
    ("ready-request", "Request human review", "The readiness checks are met. I request a human review of this saved revision."),
    ("human-review", "Review this exact snapshot", "The synthetic reviewer checks this exact snapshot and explicitly approves it. A relevant later change would clear that approval."),
    ("persisted-reload", "Reload the saved review", "I reload the public app. The approved revision is still present in the saved session."),
    ("packet-download", "Download the reviewed packet", "Now I download the actual packet JSON and cash ledger. The packet contains the approved revision and its snapshot hash."),
    ("handoff", "An inspectable human handoff", "This is a reviewed readiness handoff. It does not sign an agreement, close an investment, or move funds."),
]
STORIES = {name: {"heading": heading, "narration": narration} for name, heading, narration in STORYBOARD}


def utc():
    return datetime.now(timezone.utc).isoformat()


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def run(command):
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)], text=True))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def verify_packet(packet):
    snapshot = {key: packet[key] for key in ("demo", "revision", "calculationRuleVersion", "deal", "commitments", "events", "reconciliation")}
    digest = hashlib.sha256(canonical(snapshot).encode()).hexdigest()
    assert digest == packet["snapshotHash"]
    assert packet["review"]["approvedHash"] == digest
    assert packet["review"]["approvedRevision"] == packet["revision"]
    assert packet["reconciliation"]["ready"] is True
    assert packet["deal"]["legal"]["status"] == "final"
    event = next(row for row in packet["events"] if row["id"] == "DEMO-AURORA-PAY-003")
    assert event["commitmentId"] == "DEMO-AURORA-COM-002" and event["amountMinor"] == "200000"
    return {"revision": packet["revision"], "snapshotHash": digest, "approvedRevision": packet["review"]["approvedRevision"], "reviewer": packet["review"]["reviewer"], "matchedEventId": event["id"], "matchedCommitmentId": event["commitmentId"]}


def encoder_cache():
    metadata = Path(playwright_package.__file__).parent / "driver" / "package" / "browsers.json"
    revision = next(row["revision"] for row in json.loads(metadata.read_text())["browsers"] if row["name"] == "ffmpeg")
    cache = SCRATCH / "playwright"
    binary = cache / f"ffmpeg-{revision}" / "ffmpeg-linux"
    binary.parent.mkdir(parents=True, exist_ok=True)
    if not binary.exists():
        binary.symlink_to(shutil.which("ffmpeg"))
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(cache)


def browser_options():
    options = {"executable_path": shutil.which("chromium"), "headless": True, "args": ["--no-sandbox"]}
    proxy = os.environ.get("HTTPS_PROXY")
    if proxy:
        options["proxy"] = {"server": proxy}
    certificate = os.environ.get("ODIN_PROXY_CA_CERT") or os.environ.get("CODEX_PROXY_CERT")
    if certificate:
        public_key = subprocess.check_output(["openssl", "x509", "-in", certificate, "-pubkey", "-noout"])
        der = subprocess.check_output(["openssl", "pkey", "-pubin", "-outform", "der"], input=public_key)
        pin = base64.b64encode(hashlib.sha256(der).digest()).decode()
        options["args"].append("--ignore-certificate-errors-spki-list=" + pin)
    return options


def prepare_voice(directory):
    voices = {}
    for name, _, narration in STORYBOARD:
        pieces = re.split(r"(?<=[.!?;])\s+", narration)
        parts, cues, offset = [], [], 0.0
        for index, sentence in enumerate(pieces):
            tokens = sentence.split()
            chunks = [" ".join(tokens[i:i + 13]) for i in range(0, len(tokens), 13)]
            for chunk in chunks:
                text_path = SCRATCH / f"{name}-{len(parts)}.txt"
                text_path.write_text(chunk)
                wave = SCRATCH / f"{name}-{len(parts)}.wav"
                run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"flite=textfile={text_path}:voice=slt", "-af", "atempo=1.05", "-ar", "48000", str(wave)])
                length = duration(wave)
                cues.append({"text": chunk, "start": round(offset, 6), "duration": length})
                offset += length
                parts.append(wave)
        final = directory / "voice" / f"{name}.wav"
        final.parent.mkdir(exist_ok=True)
        command = ["ffmpeg", "-y"]
        for part in parts:
            command.extend(["-i", str(part)])
        streams = "".join(f"[{index}:a]" for index in range(len(parts)))
        command.extend(["-filter_complex", f"{streams}concat=n={len(parts)}:v=0:a=1[a]", "-map", "[a]", str(final)])
        run(command)
        voices[name] = {"file": str(final.relative_to(directory)), "duration": duration(final), "cues": cues}
    write_json(directory / "storyboard.json", [{"name": name, **STORIES[name]} for name, _, _ in STORYBOARD])
    return voices


class Capture:
    def __init__(self, page, voices, started):
        self.page, self.voices, self.started = page, voices, started
        self.scenes, self.requests, self.errors, self.console_errors = [], [], [], []
        self.pointer = (40, 40)
        page.on("pageerror", lambda error: self.errors.append(str(error)))
        page.on("console", lambda message: self.console_errors.append(message.text) if message.type == "error" else None)
        page.on("response", self.response)

    def response(self, response):
        if "/api/" in response.url:
            self.requests.append({"url": response.url, "method": response.request.method, "status": response.status, "at": utc()})
            assert response.status < 400, f"API {response.status}: {response.url}"

    def loaded(self):
        expect(self.page.locator("#workbench")).to_have_attribute("aria-busy", "false", timeout=20000)
        expect(self.page.locator("#import-open")).to_be_enabled()

    def point(self, locator):
        locator.scroll_into_view_if_needed()
        box = locator.bounding_box()
        assert box
        x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        for step in range(1, 19):
            ratio = step / 18
            ease = ratio * ratio * (3 - 2 * ratio)
            self.page.mouse.move(self.pointer[0] + (x - self.pointer[0]) * ease, self.pointer[1] + (y - self.pointer[1]) * ease)
            self.page.wait_for_timeout(20)
        self.pointer = (x, y)
        self.page.wait_for_timeout(140)

    def click(self, locator):
        self.point(locator)
        self.page.mouse.click(*self.pointer)
        self.page.wait_for_timeout(250)

    def focus(self, locator, width=None):
        box = locator.bounding_box()
        assert box
        crop_width = min(VIEWPORT["width"], round(width or max(500, box["width"] + 48)))
        crop_height = min(1060, round(crop_width * 1.30))
        x = max(0, min(VIEWPORT["width"] - crop_width, round(box["x"] + box["width"] / 2 - crop_width / 2)))
        y = max(0, min(VIEWPORT["height"] - crop_height, round(box["y"] + box["height"] / 2 - crop_height / 2)))
        return {"x": x, "y": y, "width": crop_width, "height": crop_height}

    def scene(self, name, locator, action=None, width=None, minimum=0):
        self.page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        scene_started = time.monotonic()
        self.scenes.append({"name": name, "sourceStart": round(scene_started - self.started, 6), "recordedAt": utc(), "crop": self.focus(locator, width), "voiceDelay": 0.35})
        if action:
            action()
        hold = max(minimum, self.voices[name]["duration"] + 1.4) - (time.monotonic() - scene_started)
        if hold > 0:
            self.page.wait_for_timeout(round(hold * 1000))

    def detail_top(self):
        self.page.locator("#deal-detail").evaluate("node => node.scrollIntoView({block:'start', behavior:'smooth'})")
        self.page.wait_for_timeout(650)


def capture(directory, base_url, voices):
    encoder_cache()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**browser_options())
        context = browser.new_context(viewport=VIEWPORT, record_video_dir=str(SCRATCH / "capture"), record_video_size=VIEWPORT, accept_downloads=True)
        # Recording-only pointer visibility; it has no app interaction or data.
        context.add_init_script("""document.addEventListener('DOMContentLoaded', () => {
          const cursor=document.createElement('span');cursor.id='walkthrough-cursor';cursor.setAttribute('aria-hidden','true');
          Object.assign(cursor.style,{position:'fixed',left:'40px',top:'40px',width:'15px',height:'15px',border:'2px solid #151619',borderRadius:'50%',background:'#d0ff71bb',pointerEvents:'none',zIndex:'2147483647',boxShadow:'0 0 0 4px #d0ff7133',transform:'translate(-50%,-50%)'});
          document.body.appendChild(cursor);
          window.addEventListener('mousemove', event => {cursor.style.left=event.clientX+'px';cursor.style.top=event.clientY+'px';});
        });""")
        page = context.new_page()
        started = time.monotonic()
        run_capture = Capture(page, voices, started)
        navigation = page.goto(base_url, wait_until="networkidle", timeout=45000)
        assert navigation.status == 200 and page.url.rstrip("/") == base_url.rstrip("/")
        run_capture.loaded()
        assert page.locator("#walkthrough-cursor").evaluate("node => {const style=getComputedStyle(node);return style.position==='fixed' && style.width==='15px'}"), "Visible recording pointer styles did not apply"
        run_capture.scene("intro", page.locator(".page-heading>div").first, width=680)
        run_capture.click(page.locator("#import-open"))
        expect(page.locator("#import-dialog")).to_be_visible()
        file_boxes = page.locator("#import-dialog .file-box")
        def commitment_upload():
            run_capture.point(page.locator("#commitments-file"))
            page.locator("#commitments-file").set_input_files(str(FIXTURES / "commitments.csv"))
        run_capture.scene("commitments-upload", file_boxes.nth(0), commitment_upload, width=510)
        def payment_upload():
            run_capture.point(page.locator("#payments-file"))
            page.locator("#payments-file").set_input_files(str(FIXTURES / "payments.csv"))
            run_capture.click(page.locator("#import-ack"))
        run_capture.scene("payments-upload", file_boxes.nth(1), payment_upload, width=510)
        with page.expect_response(lambda response: response.url.endswith("/api/import/preview")) as preview_response:
            run_capture.click(page.locator("#preview-button"))
        preview = preview_response.value.json()
        assert preview["valid"] is True and len(preview["previewHash"]) == 64
        expect(page.locator("#import-confirm")).to_be_enabled()
        page.locator("#import-dialog").evaluate("node => node.scrollTo({top:390,behavior:'smooth'})")
        page.wait_for_timeout(650)
        run_capture.scene("validated-preview", page.locator("#import-preview"), width=810)
        page.locator("#import-dialog").evaluate("node => node.scrollTo({top:node.scrollHeight,behavior:'smooth'})")
        page.wait_for_timeout(650)
        def import_files():
            page.wait_for_timeout(1700)
            run_capture.click(page.locator("#import-confirm"))
            expect(page.locator("#import-dialog")).not_to_be_visible(timeout=20000)
            run_capture.loaded()
            run_capture.detail_top()
        run_capture.scene("atomic-import", page.locator("#import-confirm"), import_files, width=660)
        run_capture.detail_top()
        run_capture.scene("cash-exception", page.locator(".detail-grid>section"), width=650)
        run_capture.click(page.locator('[data-match-event="DEMO-AURORA-PAY-003"]').first)
        expect(page.locator("#match-dialog")).to_be_visible()
        def match_receipt():
            run_capture.point(page.locator("#match-account"))
            page.locator("#match-account").select_option("DEMO-AURORA-COM-002")
            page.wait_for_timeout(4500)
            run_capture.click(page.locator('#match-form button[type="submit"]'))
            expect(page.locator("#match-dialog")).not_to_be_visible(timeout=20000)
        run_capture.scene("explicit-match", page.locator("#match-dialog"), match_receipt, width=620)
        run_capture.detail_top()
        run_capture.scene("reconciled-cash", page.locator(".cash-card"), width=510)
        run_capture.click(page.locator("#legal-open"))
        expect(page.locator("#legal-dialog")).to_be_visible()
        def attach_legal():
            run_capture.point(page.locator("#legal-file"))
            page.locator("#legal-file").set_input_files(str(FIXTURES / "final-legal.json"))
            page.wait_for_timeout(4800)
            run_capture.click(page.locator('#legal-form button[type="submit"]'))
            expect(page.locator("#legal-dialog")).not_to_be_visible(timeout=20000)
        run_capture.scene("legal-metadata", page.locator("#legal-dialog"), attach_legal, width=620)
        run_capture.detail_top()
        expect(page.locator("#review-request")).to_be_enabled()
        def request_review():
            page.wait_for_timeout(2700)
            run_capture.click(page.locator("#review-request"))
            expect(page.locator("#review-open")).to_be_enabled(timeout=20000)
        run_capture.scene("ready-request", page.locator(".detail-sidebar"), request_review, width=510)
        run_capture.click(page.locator("#review-open"))
        expect(page.locator("#review-dialog")).to_be_visible()
        expect(page.locator("#review-check")).not_to_be_checked()
        def approve_review():
            run_capture.click(page.locator("#review-check"))
            page.wait_for_timeout(4300)
            run_capture.click(page.locator('#review-form button[type="submit"]'))
            expect(page.locator("#review-dialog")).not_to_be_visible(timeout=20000)
            expect(page.locator("#packet-open")).to_be_enabled()
        run_capture.scene("human-review", page.locator("#review-dialog"), approve_review, width=620)
        run_capture.detail_top()
        pre_reload = context.request.get(base_url.rstrip("/") + "/api/state").json()["state"]
        def persisted_reload():
            page.reload(wait_until="networkidle")
            run_capture.loaded()
            expect(page.locator("#packet-open")).to_be_enabled()
            run_capture.detail_top()
        run_capture.scene("persisted-reload", page.locator(".detail-status"), persisted_reload, width=600, minimum=8)
        post_reload = context.request.get(base_url.rstrip("/") + "/api/state").json()["state"]
        assert pre_reload == post_reload
        run_capture.click(page.locator("#packet-open"))
        expect(page.locator("#packet-dialog")).to_be_visible(timeout=20000)
        downloads = []
        def download_packet():
            for selector, name in [("#packet-download", "downloaded-packet.json"), ("#ledger-download", "downloaded-ledger.csv")]:
                with page.expect_download() as download_info:
                    run_capture.click(page.locator(selector))
                download = download_info.value
                download.save_as(str(directory / name))
                downloads.append({"file": name, "suggestedFilename": download.suggested_filename, "url": download.url, "downloadedAt": utc(), "bytes": (directory / name).stat().st_size, "sha256": sha256(directory / name), "trigger": "Actual visible public-app download control"})
        run_capture.scene("packet-download", page.locator("#ledger-download"), download_packet, width=660)
        packet = json.loads((directory / "downloaded-packet.json").read_text())
        verification = verify_packet(packet)
        ledger_rows = list(csv.DictReader(io.StringIO((directory / "downloaded-ledger.csv").read_text())))
        ledger_event = next(row for row in ledger_rows if row["event_id"] == "DEMO-AURORA-PAY-003")
        assert ledger_event["commitment_id"] == "DEMO-AURORA-COM-002" and ledger_event["amount_minor"] == "200000"
        run_capture.scene("handoff", page.locator("#packet-summary"), width=710)
        assert not run_capture.errors, run_capture.errors
        assert not run_capture.console_errors, run_capture.console_errors
        capture_end = time.monotonic() - started
        video = page.video
        context.close()
        shutil.move(video.path(), str(directory / "desktop-source.webm"))
        browser.close()
    return {"recordedAt": utc(), "baseUrl": base_url, "navigationStatus": navigation.status, "evidenceType": "Actual public application browser recording", "desktopResolution": [VIEWPORT["width"], VIEWPORT["height"]], "portraitResolution": [1080, 1920], "desktopIsCropped": True, "applicationLayoutChanged": False, "credit": "Ayo Ahmed · Independent concept", "dataScope": "Supplied fictional synthetic fixtures only", "narrationMethod": "Free local speech synthesis", "scenes": run_capture.scenes, "captureEnd": capture_end, "voiceTiming": voices, "serverPreview": {"revision": preview["revision"], "previewHash": preview["previewHash"], "summary": preview["summary"]}, "reloadVerification": {"sameStateBeforeAndAfter": True, "revision": post_reload["revision"]}, "packetVerification": verification, "downloads": downloads, "publicApiRequests": run_capture.requests, "reviewStatus": {"continuousWatchAndListen": "pending", "reason": "Requires continuous playback review; frame extraction and technical checks do not establish it."}}


def timestamp(seconds, ass=False):
    milliseconds = round(seconds * 1000)
    hours, milliseconds = divmod(milliseconds, 3600000)
    minutes, milliseconds = divmod(milliseconds, 60000)
    secs, milliseconds = divmod(milliseconds, 1000)
    return f"{hours}:{minutes:02}:{secs:02}.{milliseconds // 10:02}" if ass else f"{hours:02}:{minutes:02}:{secs:02},{milliseconds:03}"


def render(directory, manifest):
    source = directory / "desktop-source.webm"
    start = manifest["scenes"][0]["sourceStart"]
    end = min(duration(source), manifest["captureEnd"])
    length = end - start
    clips, srt, events, cues = [], [], [], []
    voice_inputs, filters = [], []
    for index, scene in enumerate(manifest["scenes"]):
        next_start = manifest["scenes"][index + 1]["sourceStart"] if index + 1 < len(manifest["scenes"]) else end
        segment_duration = next_start - scene["sourceStart"]
        crop = scene["crop"]
        clip = SCRATCH / f"portrait-{index:02}.mp4"
        run(["ffmpeg", "-y", "-ss", str(scene["sourceStart"]), "-i", str(source), "-t", str(segment_duration), "-vf", f"crop={crop['width']}:{crop['height']}:{crop['x']}:{crop['y']},scale=1016:1320:force_original_aspect_ratio=decrease:flags=lanczos,pad=1080:1920:(ow-iw)/2:340+(1320-ih)/2:color=0xf6f8f3,setsar=1,fps=25", "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", str(clip)])
        clips.append(clip)
        heading = SCRATCH / f"heading-{index:02}.txt"
        heading.write_text(STORIES[scene["name"]]["heading"])
        scene["outputStart"] = round(scene["sourceStart"] - start, 6)
        scene["outputEnd"] = round(next_start - start, 6)
        voice = manifest["voiceTiming"][scene["name"]]
        voice_inputs.append(directory / voice["file"])
        voice_start = scene["outputStart"] + scene["voiceDelay"]
        delay = round(voice_start * 1000)
        filters.append(f"[{index + 1}:a]adelay={delay}:all=1[a{index}]")
        for cue in voice["cues"]:
            cue_start = voice_start + cue["start"]
            cue_end = min(length, cue_start + cue["duration"])
            caption = cue["text"]
            cues.append({"scene": scene["name"], "start": round(cue_start, 6), "end": round(cue_end, 6), "text": caption})
            srt.extend([str(len(cues)), f"{timestamp(cue_start)} --> {timestamp(cue_end)}", caption, ""])
            events.append(f"Dialogue: 0,{timestamp(cue_start, True)},{timestamp(cue_end, True)},Default,,0,0,0,,{caption}")
    concatenation = SCRATCH / "portrait-clips.txt"
    concatenation.write_text("".join(f"file '{clip}'\n" for clip in clips))
    joined = SCRATCH / "portrait-picture.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concatenation), "-c", "copy", str(joined)])
    (directory / "captions.srt").write_text("\n".join(srt))
    write_json(directory / "caption-timing.json", cues)
    (directory / "transcript.txt").write_text("\n\n".join(f"{timestamp(scene['outputStart'])}  {STORIES[scene['name']]['heading']}\n{STORIES[scene['name']]['narration']}" for scene in manifest["scenes"]) + "\n")
    ass = directory / "captions.ass"
    ass.write_text("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,36,&H00151619,&H00151619,&H00F3F8F6,&H00F3F8F6,0,0,0,0,100,100,0,0,3,2,0,2,70,70,95,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" + "\n".join(events) + "\n")
    title, credit, source_label = SCRATCH / "title.txt", SCRATCH / "credit.txt", SCRATCH / "source.txt"
    title.write_text("ODIN CLOSE CONTROL")
    credit.write_text("Ayo Ahmed · Independent concept · Synthetic data")
    source_label.write_text("Public app · " + urlparse(manifest["baseUrl"]).hostname)
    font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    video_filter = f"[0:v]drawtext=fontfile={font}:textfile={title}:fontcolor=0x151619:fontsize=42:x=56:y=68,drawtext=fontfile={font}:textfile={credit}:fontcolor=0x626663:fontsize=24:x=56:y=134,drawtext=fontfile={font}:textfile={source_label}:fontcolor=0x626663:fontsize=20:x=56:y=176[v0]"
    video_filters = [video_filter]
    previous = "v0"
    for index, scene in enumerate(manifest["scenes"]):
        next_name = f"v{index + 1}"
        heading = SCRATCH / f"heading-{index:02}.txt"
        video_filters.append(f"[{previous}]drawtext=fontfile={font}:textfile={heading}:fontcolor=0x151619:fontsize=39:x=56:y=248:enable='gte(t,{scene['outputStart']:.6f})*lt(t,{scene['outputEnd']:.6f})'[{next_name}]")
        previous = next_name
    video_filters.append(f"[{previous}]subtitles={ass}[v]")
    audio_streams = "".join(f"[a{index}]" for index in range(len(voice_inputs)))
    filters.append(f"{audio_streams}amix=inputs={len(voice_inputs)}:normalize=0,apad,atrim=0:{length:.6f},alimiter=limit=0.95[a]")
    command = ["ffmpeg", "-y", "-i", str(joined)]
    for wave in voice_inputs:
        command.extend(["-i", str(wave)])
    command.extend(["-filter_complex", ";".join(video_filters + filters), "-map", "[v]", "-map", "[a]", "-t", str(length), "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(directory / "walkthrough-public.mp4")])
    run(command)
    # A standalone narration track makes the sound source inspectable/reusable.
    run(["ffmpeg", "-y", "-i", str(directory / "walkthrough-public.mp4"), "-vn", "-c:a", "pcm_s16le", str(directory / "narration.wav")])
    write_json(directory / "composition.json", {"output": "walkthrough-public.mp4", "resolution": [1080, 1920], "frameRate": 25, "mediaBox": {"x": 32, "y": 340, "width": 1016, "height": 1320}, "source": "desktop-source.webm", "sourceTrimStart": start, "duration": duration(directory / "walkthrough-public.mp4"), "scenes": [{key: scene[key] for key in ("name", "sourceStart", "outputStart", "outputEnd", "crop", "voiceDelay")} for scene in manifest["scenes"]], "captions": "captions.ass", "narration": "narration.wav"})
    manifest["renderedDuration"] = duration(directory / "walkthrough-public.mp4")
    manifest["artifacts"] = [{"file": filename, "bytes": (directory / filename).stat().st_size, "sha256": sha256(directory / filename)} for filename in ("desktop-source.webm", "walkthrough-public.mp4", "narration.wav", "captions.srt", "captions.ass", "transcript.txt", "composition.json", "storyboard.json", "caption-timing.json")]
    write_json(directory / "recording-manifest.json", manifest)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=PUBLIC_URL)
    parser.add_argument("--render-only", action="store_true")
    parser.add_argument("--voice-only", action="store_true")
    parser.add_argument("--output", default=str(DIRECTORY))
    args = parser.parse_args()
    parsed = urlparse(args.base_url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.hostname in ("localhost", "127.0.0.1", "::1"):
        parser.error("A real public HTTPS URL is required. Local rehearsal is intentionally unsupported.")
    directory = Path(args.output).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    SCRATCH.mkdir(parents=True, exist_ok=True)
    manifest_path = directory / "recording-manifest.json"
    if args.render_only:
        render(directory, json.loads(manifest_path.read_text()))
    else:
        voices = prepare_voice(directory)
        write_json(directory / "voice-timing.json", voices)
        if args.voice_only:
            print(json.dumps({"voiceSeconds": round(sum(voice['duration'] for voice in voices.values()), 3), "scenes": len(voices)}))
            return
        manifest = capture(directory, args.base_url, voices)
        write_json(manifest_path, manifest)
        render(directory, manifest)
    print(json.dumps({"baseUrl": args.base_url, "output": str(directory / 'walkthrough-public.mp4'), "reviewStatus": json.loads(manifest_path.read_text())["reviewStatus"]}))


if __name__ == "__main__":
    main()
