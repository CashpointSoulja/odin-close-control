#!/usr/bin/env python3
"""Extract final-frame evidence without claiming continuous playback review.

Images go to ignored scratch space by default. Choose --output explicitly to
retain selected frame evidence. This is a sampling aid, not watch/listen proof.
"""
import argparse
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=str(ROOT / "work" / "public-recording" / "review-frames"))
    args = parser.parse_args()
    directory = Path(args.output)
    directory.mkdir(parents=True, exist_ok=True)
    composition = json.loads((HERE / "composition.json").read_text())
    frames = []
    for index, scene in enumerate(composition["scenes"]):
        start, end = scene["outputStart"], scene["outputEnd"]
        for phase, moment in [("early", start + min(0.8, (end-start)/4)), ("middle", (start+end)/2), ("late", end - min(0.8, (end-start)/4))]:
            filename = f"{index:02}-{scene['name']}-{phase}.png"
            subprocess.run(["ffmpeg", "-y", "-ss", str(moment), "-i", str(HERE / composition["output"]), "-frames:v", "1", str(directory / filename)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            frames.append({"scene": scene["name"], "phase": phase, "outputSeconds": round(moment, 3), "file": filename})
    (directory / "frame-index.json").write_text(json.dumps({"method": "Three extracted final frames per scene; sampling only, no continuous video/audio review", "frames": frames}, indent=2) + "\n")
    print(json.dumps({"directory": str(directory), "frames": len(frames), "continuousPlaybackEstablished": False}))


if __name__ == "__main__":
    main()
