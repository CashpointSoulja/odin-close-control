#!/usr/bin/env python3
"""Capture the real UI at desktop resolution; optionally compose a portrait MP4.

Requires a verified public BASE_URL by default. --allow-local is explicitly a
local rehearsal, and the saved manifest labels it that way. No paid APIs.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright
import playwright as playwright_package

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("browser_qa", ROOT / "scripts" / "browser-qa.py")
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)

SCENES = {
    "desktop-seed": ("A clear path to a ready close", "Odin Close Control is an independent concept by Ayo Ahmed. This synthetic demonstration turns close preparation into an inspectable path: cash, evidence, then an explicit human review."),
    "import-preview": ("Preview both files before saving", "I upload commitments and payment events together. The server validates exact amounts and previews the changes. Both files are applied atomically to this saved session."),
    "after-import": ("The exception stays visible", "Aurora still has a two thousand pound receipt without an allocation. A receipt does not become funded capital until a human assigns it to the correct commitment."),
    "receipt-match": ("Make the cash match explicit", "I select Linden Ventures for this two thousand pound receipt. The account, amount and bank reference stay visible. The selection becomes part of the audit trail."),
    "after-match": ("Cash reconciled. Evidence still required.", "The principal now reconciles. The fee cash is tracked separately using an illustrative fee rule. A draft legal reference still blocks a review request."),
    "legal-metadata": ("Attach the final synthetic reference", "I attach final synthetic legal metadata with a document hash. This records a human supplied reference. It does not verify a real agreement or replace legal judgment."),
    "ready-for-review": ("Ready to ask for human review", "Every deterministic blocker is resolved. Human attestations and the close request are present. The preparer can now request review of this exact revision."),
    "human-review": ("Confirm this exact snapshot", "The synthetic reviewer inspects the current revision and explicitly confirms it. Any relevant later change invalidates that approval. Review is a deliberate action, never an automatic financial decision."),
    "reviewed-packet": ("A current, reviewed handoff", "The reviewed packet includes the cash ledger, evidence, audit trail and snapshot hash. I can download it and verify that the hash matches the exact approved data."),
    "persisted-review": ("Independent concept by Ayo Ahmed", "The reviewed session survives a reload. This is a readiness handoff, with no signatures or transfers. I built the concept to make rules, exceptions and human ownership clear."),
}
BRIDGES = {
    "desktop-seed": "I select both CSV files and confirm the synthetic-only scope.",
    "import-preview": "I apply both files as one validated import.",
    "after-import": "I open the receipt and select Linden's commitment.",
    "receipt-match": "I explicitly confirm this receipt's known commitment account.",
    "after-match": "Next, the final synthetic reference.",
    "legal-metadata": "I attach the final metadata.",
    "ready-for-review": "I request review and open this snapshot.",
    "human-review": "The reviewer approves this snapshot. I open the packet.",
    "reviewed-packet": "I download the packet and ledger, then reload the saved session.",
}


def call(command):
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def recording_encoder():
    """Use installed FFmpeg from a task-local Playwright cache; no download/home write."""
    metadata = Path(playwright_package.__file__).parent / "driver" / "package" / "browsers.json"
    revision = next(item["revision"] for item in json.loads(metadata.read_text())["browsers"] if item["name"] == "ffmpeg")
    cache = ROOT / "work" / "playwright"
    binary = cache / f"ffmpeg-{revision}" / "ffmpeg-linux"
    binary.parent.mkdir(parents=True, exist_ok=True)
    if not binary.exists():
        binary.symlink_to(shutil.which("ffmpeg"))
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(cache)


def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)], text=True))


def prepare_voice(directory):
    voices = {}
    for name, (_, narration) in SCENES.items():
        sentences = re.split(r"(?<=[.!?])\s+", narration)
        chunks = [chunk for sentence in sentences for chunk in caption_chunks(sentence, words=15)]
        parts, cues, offset = [], [], 0.0
        for index, text in enumerate(chunks):
            textfile = directory / f"{name}-voice-{index}.txt"
            textfile.write_text(text)
            part = directory / f"{name}-voice-{index}.wav"
            call(["ffmpeg", "-y", "-f", "lavfi", "-i", f"flite=textfile={textfile}:voice=slt", "-ar", "48000", str(part)])
            length = duration(part)
            cues.append({"text": text, "start": offset, "duration": length})
            offset += length
            parts.append(part)
        wave = directory / f"{name}.wav"
        command = ["ffmpeg", "-y"]
        for part in parts:
            command.extend(["-i", str(part)])
        tracks = "".join(f"[{i}:a]" for i in range(len(parts)))
        command.extend(["-filter_complex", f"{tracks}concat=n={len(parts)}:v=0:a=1[a]", "-map", "[a]", str(wave)])
        call(command)
        voices[name] = {"path": str(wave), "duration": duration(wave), "cues": cues}
    return voices


class RecordingRun(qa.Run):
    def __init__(self, page, directory, observer):
        super().__init__(page, directory, observer)
        self.pointer = (30, 30)

    def capture(self, name, note=""):
        # Full-page screenshots resize Chromium's screencast viewport and can
        # leave stale compositor frames. Video evidence is extracted afterward.
        if name in ("after-import", "after-match", "ready-for-review", "persisted-review"):
            self.page.locator("#deal-detail").evaluate("node => node.scrollIntoView({block:'start', behavior:'instant'})")
        self.page.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
        self.page.wait_for_timeout(150)
        self.page.mouse.move(self.pointer[0] + 1, self.pointer[1], steps=2)
        self.page.wait_for_timeout(100)
        self.steps.append({"name": name, "secondsFromStart": round(time.monotonic() - self.started, 3), "note": note})
        if self.observer:
            self.observer(name, note)

    def click(self, locator):
        locator.scroll_into_view_if_needed()
        box = locator.bounding_box()
        if box:
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            self.page.mouse.move(x, y, steps=28)
            self.page.wait_for_timeout(350)
            self.page.mouse.click(x, y)
            self.pointer = (x, y)
        else:
            locator.click()


def stamp(seconds):
    whole, millis = divmod(round(seconds * 1000), 1000)
    hours, remainder = divmod(whole, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02}:{minutes:02}:{secs:02},{millis:03}"


def caption_chunks(text, words=12):
    tokens = text.split()
    return [" ".join(tokens[i:i + words]) for i in range(0, len(tokens), words)]


def render(video, directory, scenes, voices, outfile, local=False):
    last = scenes[-1]
    total = min(duration(video), last.get("voiceStart", last["start"]) + voices[last["name"]]["duration"] + 0.35)
    tracks = []
    for scene in scenes:
        tracks.append({"path": voices[scene["name"]]["path"], "start": scene.get("voiceStart", scene["start"]), "duration": voices[scene["name"]]["duration"], "cues": voices[scene["name"]]["cues"], "kind": "scene", "name": scene["name"]})
    bridges = []
    for scene, following in zip(scenes, scenes[1:]):
        start = scene.get("voiceStart", scene["start"]) + voices[scene["name"]]["duration"] + 0.1
        end = following.get("voiceStart", following["start"]) - 0.1
        available = end - start
        if available < 0.6:
            continue
        text = BRIDGES[scene["name"]]
        textfile = directory / f"bridge-{scene['name']}.txt"
        textfile.write_text(text)
        original = directory / f"bridge-{scene['name']}-original.wav"
        wave = directory / f"bridge-{scene['name']}.wav"
        call(["ffmpeg", "-y", "-f", "lavfi", "-i", f"flite=textfile={textfile}:voice=slt", "-ar", "48000", str(original)])
        speed = duration(original) / available
        filters = []
        while speed > 2:
            filters.append("atempo=2")
            speed /= 2
        while speed < 0.5:
            filters.append("atempo=0.5")
            speed /= 0.5
        filters.append(f"atempo={speed:.8f}")
        call(["ffmpeg", "-y", "-i", str(original), "-af", ",".join(filters), "-t", f"{available:.6f}", str(wave)])
        length = min(duration(wave), available)
        track = {"path": str(wave), "start": start, "duration": length, "cues": [{"text": text, "start": 0, "duration": length}], "kind": "action bridge", "name": scene["name"]}
        tracks.append(track)
        bridges.append({key: value for key, value in track.items() if key != "path"})
    srt, counter = [], 1
    ass_events = []
    for track in sorted(tracks, key=lambda value: value["start"]):
        start = track["start"]
        for cue in track["cues"]:
            cue_start = start + cue["start"]
            cue_end = min(total, cue_start + cue["duration"])
            chunk = cue["text"]
            srt.extend([str(counter), f"{stamp(cue_start)} --> {stamp(cue_end)}", chunk, ""])
            ass_start = stamp(cue_start).replace(",", ".")[:-1]
            ass_end = stamp(cue_end).replace(",", ".")[:-1]
            ass_events.append(f"Dialogue: 0,{ass_start},{ass_end},Default,,0,0,0,,{chunk}")
            counter += 1
    captions = directory / "captions.srt"
    captions.write_text("\n".join(srt))
    ass = directory / "captions.ass"
    ass.write_text("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,DejaVu Sans,40,&H00181B18,&H00181B18,&H00F6F8F3,&H00F6F8F3,0,0,0,0,100,100,0,0,3,1,0,2,70,70,130,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" + "\n".join(ass_events) + "\n")
    title = directory / "title.txt"
    title.write_text("ODIN CLOSE CONTROL")
    credit = directory / "credit.txt"
    credit.write_text("Ayo Ahmed | Independent synthetic concept")
    environment = directory / "environment.txt"
    environment.write_text("LOCAL DEMONSTRATION | synthetic data" if local else "VERIFIED PUBLIC DEMONSTRATION | synthetic data")
    font = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    filters = [f"[0:v]trim=duration={total:.6f},scale=1080:675:flags=lanczos,pad=1080:1920:0:575:color=0xf6f8f3,setsar=1[v0]"]
    filters.append(f"[v0]drawtext=fontfile={font}:textfile={title}:fontcolor=0x181b18:fontsize=47:x=70:y=140,drawtext=fontfile={font}:textfile={credit}:fontcolor=0x586155:fontsize=25:x=70:y=215,drawtext=fontfile={font}:textfile={environment}:fontcolor=0x586155:fontsize=24:x=70:y=1480[v1]")
    prior = "v1"
    for i, scene in enumerate(scenes):
        heading = directory / f"heading-{i}.txt"
        # Line breaks fit the portrait canvas without resizing the desktop.
        words, lines, line = SCENES[scene["name"]][0].split(), [], ""
        for word in words:
            if len(line + " " + word) > 31:
                lines.append(line)
                line = word
            else:
                line = (line + " " + word).strip()
        lines.append(line)
        heading.write_text("\n".join(lines))
        end = scenes[i + 1]["start"] if i + 1 < len(scenes) else total
        nxt = f"h{i}"
        heading_start = 0 if i == 0 else scene["start"]
        filters.append(f"[{prior}]drawtext=fontfile={font}:textfile={heading}:fontcolor=0x181b18:fontsize=43:line_spacing=14:x=70:y=350:enable='gte(t,{heading_start:.3f})*lt(t,{end:.3f})'[{nxt}]")
        prior = nxt
    filters.append(f"[{prior}]subtitles={ass}[v]")
    command = ["ffmpeg", "-y", "-i", str(video)]
    for track in tracks:
        command.extend(["-i", track["path"]])
    for i, track in enumerate(tracks):
        delay = round(track["start"] * 1000)
        filters.append(f"[{i + 1}:a]adelay={delay}:all=1[a{i}]")
    audio_inputs = "".join(f"[a{i}]" for i in range(len(tracks)))
    filters.append(f"{audio_inputs}amix=inputs={len(tracks)}:normalize=0,apad,atrim=0:{total:.3f}[a]")
    command.extend(["-filter_complex", ";".join(filters), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(outfile)])
    call(command)
    return {"actionBridges": bridges, "renderedDuration": total}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=os.environ.get("BASE_URL", ""))
    parser.add_argument("--allow-local", action="store_true", help="Explicitly record a labelled local rehearsal")
    parser.add_argument("--render", action="store_true", help="Compose portrait MP4 with local voice and synchronized captions")
    parser.add_argument("--reuse-voice", action="store_true", help="Reuse the generated speech timing from an earlier manifest")
    parser.add_argument("--render-only", action="store_true", help="Recompose the existing capture and manifest without a new browser session")
    parser.add_argument("--output", default=str(ROOT / "work" / "walkthrough"))
    args = parser.parse_args()
    if not args.base_url:
        parser.error("Supply the verified deployment URL with BASE_URL or --base-url")
    local = urlparse(args.base_url).hostname in ("127.0.0.1", "localhost")
    if local and not args.allow_local:
        parser.error("Local URLs require --allow-local and produce rehearsal evidence")
    directory = Path(args.output).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    previous = directory / "recording-manifest.json"
    if args.render_only:
        manifest = json.loads(previous.read_text())
        manifest.update(render(directory / "desktop-source.webm", directory, manifest["scenes"], manifest["voiceTiming"], directory / "odin-close-control-walkthrough.mp4", local=local))
        previous.write_text(json.dumps(manifest, indent=2) + "\n")
        print(json.dumps({"renderedDuration": manifest["renderedDuration"], "bridges": len(manifest["actionBridges"])}))
        return
    voices = json.loads(previous.read_text())["voiceTiming"] if args.reuse_voice and previous.exists() else prepare_voice(directory)
    scenes = []
    recording_encoder()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path="/usr/bin/chromium", args=["--no-sandbox"])
        context = browser.new_context(viewport={"width": 1440, "height": 900}, record_video_dir=str(directory), record_video_size={"width": 1440, "height": 900}, accept_downloads=True, bypass_csp=True)
        # This recording-only cursor overlay makes mouse motion visible in video.
        context.add_init_script("""document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style');
          style.textContent = '#walkthrough-cursor{position:fixed;left:25px;top:25px;width:18px;height:18px;border:2px solid #181b18;border-radius:50%;background:#d0ff7199;pointer-events:none;z-index:2147483647;box-shadow:0 0 0 5px #d0ff7133;transform:translate(-50%,-50%)}';
          document.head.appendChild(style);
          const cursor = document.createElement('span'); cursor.id='walkthrough-cursor'; cursor.setAttribute('aria-hidden','true'); document.body.appendChild(cursor);
          window.addEventListener('mousemove', event => {cursor.style.left=event.clientX+'px';cursor.style.top=event.clientY+'px';});
        });""")
        page = context.new_page()
        started = time.monotonic()
        page.goto(args.base_url, wait_until="networkidle")
        qa.loaded(page)

        def observe(name, note):
            scene_start = round(time.monotonic() - started, 3)
            scenes.append({"name": name, "start": scene_start, "note": note, **({"voiceStart": 0} if name == "desktop-seed" else {})})
            hold = max(0, voices[name]["duration"] + 0.2 - (scene_start if name == "desktop-seed" else 0)) * 1000
            if name == "import-preview":
                page.wait_for_timeout(int(hold / 2))
                # Show both the validation summary and the atomic-confirm action.
                page.locator("#import-dialog").evaluate("node => node.scrollTo({top: node.scrollHeight, behavior: 'smooth'})")
                page.wait_for_timeout(600)
                page.wait_for_timeout(max(0, int(hold / 2) - 600))
            else:
                page.wait_for_timeout(int(hold))

        run = RecordingRun(page, directory / "frames", observe)
        packet = qa.run_workflow(run, include_invalid=False)
        assert not run.errors, run.errors
        assert not run.api_failures, run.api_failures
        video = page.video
        context.close()
        original = Path(video.path())
        source = directory / "desktop-source.webm"
        if original != source:
            shutil.move(str(original), str(source))
        browser.close()
    manifest = {"baseUrl": args.base_url, "evidenceType": "local demonstration" if local else "remote deployment walkthrough", "desktopResolution": [1440, 900], "portraitResolution": [1080, 1920], "desktopIsCropped": False, "credit": "Ayo Ahmed | Independent synthetic concept", "narration": "Synthetic narration; all records fictional.", "scenes": scenes, "voiceTiming": voices, "packetVerification": packet}
    (directory / "recording-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    if args.render:
        manifest.update(render(source, directory, scenes, voices, directory / "odin-close-control-walkthrough.mp4", local=local))
        (directory / "recording-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
