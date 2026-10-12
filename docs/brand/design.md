# Odin Close Control — design guide

I am Ayo Ahmed. I built this independent concept to demonstrate one close-readiness workflow with synthetic data. This guide records the live public brand before implementation; it does not imply an Odin relationship or permission to use private systems.

## My observed reference

I captured [Odin's live homepage](https://www.joinodin.com/) on 12 October 2026 at approximately 23:51 BST (22:51 UTC), after waiting ten seconds for the entrance treatment. I inspected both images. The main headline is sharp; the secondary hero word cycles through operating activities. Some remotely hosted decorative media did not load in this restricted capture environment. The screenshots record what the live page rendered, including that limitation.

- [Desktop viewport, 1440 × 1000](homepage-desktop.png)
- [Mobile viewport, 390 × 844](homepage-mobile.png)
- [Full desktop page](homepage-desktop-full.png)
- [Full mobile page](homepage-mobile-full.png)
- [CSS declarations, source URLs and hashes](css-evidence.json)
- [Computed live styles](computed-styles.json)
- [Visual guide](visual-guide.html)

## My visual system

| Token | Observed value | My use |
|---|---|---|
| Canvas | `#f6f8f3` | Main background and generous negative space |
| Ink | `#151619` | Text and broad primary surfaces |
| Pale lime | `#f5ffdf` | Selected states, status highlights and primary action |
| Secondary ink | `#6f7070` | Supplementary context, subject to contrast checks |
| Divider | `#e0e1dd` | Quiet separators |
| Pale red | `#f2dedb` | Blocking issue background with dark red text |
| Error ink | `#b42318` | Explicit errors alongside words and icons |

I use a literal eye mark from the supplied [official SVG source](https://www.joinodin.com/logo-wordmark.svg?dpl=dpl_6QbMcqFDZdtq2NxaDpM3zKRnhNDj), recorded as [logo-wordmark.svg](logo-wordmark.svg). I keep its path geometry and proportions. I use it in this independent demonstrator with visible attribution and no suggestion of affiliation. The file is Odin's intellectual property; no license grant was discovered. I make no rights claim and would seek approval before any commercial use. The public concept can remove this asset if requested.

The live CSS declares Die Grotesk C for primary type, Die Grotesk A for secondary type and MD Thermochrome for accents. I recorded the declarations without retaining or redistributing font files. My app uses `Arial, Helvetica, ui-sans-serif, system-ui, sans-serif`. It aims for the same restrained scale, tight heading rhythm and open spacing without claiming identical licensed typography. I avoid imitating the accent type with unreadable text.

I use rounded pills for navigation, chips and buttons; larger surfaces have 28–48 px corner radii. The public desktop hero is oversized and spare, with centered type and a roughly 1000 px wide dark surface. The mobile screenshot keeps 20 px side gutters, stacks the headline into clear lines and preserves broad rounded cards. I translate that feel to an operational workbench: a large purposeful title, a dark summary surface, a calm light queue, and one clear next action per blocker.

## My component rules

I keep close target, blocker severity, assignee, next action and evidence together. I separate cash already settled, expected cash and unresolved events visually and in words. Amounts use tabular numerals, explicit ISO currency and fixed minor-unit arithmetic. Colors never carry the only meaning.

I make status chips descriptive: “Cash short”, “Final legals missing”, “Human review requested”, “Current revision approved”. I never call synthetic KYC inputs automated compliance decisions, and never call a real investment closed. Source links remain available in the checklist. “Independent concept by Ayo Ahmed · Synthetic data only” remains visible.

I use visible keyboard focus, native inputs, labelled file controls and table captions. On mobile I stack the deal context and checklist, allow the cash ledger to scroll horizontally inside its own region, and keep actions reachable without truncating critical totals. Errors explain what to change and preserve the pending files. Loading and empty states state what is happening.

## My scope boundary

This is a design interpretation of publicly visible branding, not a replica of Odin's private product. I did not access internal operations, live investor accounts or proprietary workflows. I will test the actual app at desktop and mobile widths and record any remaining differences separately.
