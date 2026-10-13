# Public walkthrough sources — capture and review held

I prepared this walkthrough for the actual [public synthetic app](https://ayo-odin-close-control.ayoahmed-49d.workers.dev/), reported deployed from `8a734d804d4c3d59f45c09fe34f3f403a9aead3e`, provider version `0e12fd95-21b8-47e7-8f86-4913865f3e04`.

**There is no new public-app video in this directory yet.** This cloud environment's proxy rejects the exact hostname with CONNECT 403 before reaching the application. I have not substituted local footage. [The access record](../evidence/public-build-verification.json) distinguishes that blockage from the separately reported successful deployment.

The committed sources include the public-only capture/composition script, 14 planned narration scenes, their individual audio sources, timing and storyboard. The planned spoken material totals 94.048 seconds; that is not a finished video duration. The scene crops focus on active desktop panels and controls rather than fitting the whole desktop into a tiny portrait frame. Actual public framing and readability remain unverified until capture is possible.

The [downloadable source bundle](walkthrough-sources.zip) uses repository-relative paths and includes the original synthetic CSV/JSON fixtures. Extract it into a working directory and run from that directory, or use the committed sources in this repository.

From the repository root, with the existing local browser and media dependencies installed:

```sh
python docs/walkthrough-public/record-public.py \
  --base-url https://ayo-odin-close-control.ayoahmed-49d.workers.dev/
```

No Cloudflare account credentials or deployment command is involved. The app is anonymous and the script submits only the supplied synthetic fixtures. In a managed proxy environment, `HTTPS_PROXY` and optional `ODIN_PROXY_CA_CERT` configure its existing proxy and public CA trust. The script does not bypass destination policy or broadly disable TLS validation.

The script records a continuous 1200 × 1080 desktop source, composes a 1080 × 1920 portrait export with captions, and saves the actual downloaded packet and ledger. It verifies the exact approved packet hash and persisted state after reload. Those actions are planned and implemented in source; they have not been executed against the public app here. Successful capture will produce `desktop-source.webm`, `walkthrough-public.mp4`, `recording-manifest.json`, narration, captions, composition and download evidence in this directory.

I checked script syntax and source consistency. A private 12-second test pattern exercised the compositor and decoded successfully; it contains no application footage and remains outside the public deliverables. That encoder check does not verify the public workflow or video framing.

**Continuous audiovisual review remains held.** The current tool set does not expose a way for me to watch synchronized moving video and listen to its entire soundtrack continuously. Full decoding, extracted frames, transcripts, signal checks and unattended playback are not that review. The frame-extraction script explicitly labels its output as sampling. I will not call the walkthrough fully watched or delivered on that basis. Independent complete review and externally handled browser-playable publication remain required.

All records and narration are synthetic. The walkthrough makes no savings, production-finance, signature, transfer or real-investment-closing claim. Public credit is Ayo Ahmed, independent concept.
