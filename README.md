# I SEE

Point a camera at an object and learn what it is, how it works, what is inside it, its
history, how to look after it, and what would happen if you changed something about it,
with every sentence telling you how it is known.

- **Seen** in your photo, pinned to an outline drawn by SAM 3.1.
- **Cited** from a source that was actually retrieved, with the quote checked word for word.
- **Reasoned**, **Guess** or **Unknown** when that is the honest answer.

When it cannot decide, it shows the competing identities and asks for the one photo that
would settle it. It refuses to tell you from a photo whether a plant, mushroom, food or pill
is safe. What-if numbers come from its own unit-checked calculator, never from a model's
arithmetic.

Built on Meta's models: **Muse Spark** (looking, naming parts, reading, writing, web
search), **SAM 3.1** (outlines), **Muse Wonder** (settling doubts), **Muse Image** (the
drawing of what is inside), **Muse Voice Transcribe** (spoken questions) through the Meta
Model API; **Muse Spark Open** and **Muse Glimmer** as open-weight routes; project rules for
**Muse Code** in [.agents/AGENTS.md](.agents/AGENTS.md). An independent project, not made or endorsed by Meta.

## Run it

Requires Node 22.9 or later.

```bash
npm install
npm run dev                   # web on http://localhost:5173, API on :8787
```

To examine your own photos, create a file named `.env` in the project folder with your key
from https://dev.meta.ai on one line, then restart `npm run dev`:

```
MODEL_API_KEY=your-key-here
```

`.env` is never uploaded to GitHub. Every other setting is optional and explained in
[docs/SETTINGS.md](docs/SETTINGS.md).

Without a key the app still runs: it offers two **sample runs** (no model is called; the
real firewall and calculator still check them).

Production:

```bash
npm run build && npm start    # serves the app and the API on PORT (default 8787)
```

Before trusting live behaviour, check the connection and probe each model once:

```bash
npm run check:connection      # where a connection to the Meta Model API fails, if it does
npm run models:probe          # add --with-image to include Muse Image (about $0.01)
```

Single-file offline preview (samples only):

```bash
npm run build:preview         # dist-preview/i-see-preview.html
```

### On a phone

The camera only works over HTTPS. While `npm run dev` is running, open a Cloudflare quick
tunnel to it from the same computer:

```bash
cloudflared tunnel --url http://localhost:5173
```

(Install it once with `winget install --id Cloudflare.cloudflared` on Windows, or
`brew install cloudflared` on a Mac.) Open the `https://….trycloudflare.com` address it
prints on your phone. The address changes each time you start the tunnel.

## Put it online

I SEE is one Node server that serves the web app and the API together, keeps each scan in
memory while it runs, and streams its progress to the browser. Host it somewhere that runs
one long-lived Node process: Render, Railway, Fly.io or a small server of your own.

Serverless hosts such as Vercel are not a good fit as it stands: a scan is started by one
request and followed by another, which may reach a different instance that knows nothing of
it; a request or response may be at most 4.5 MB (several photos can exceed that); and a full
scan can take minutes, while the free plan stops a request after five.

**Railway.** `railway.json` holds the build and start commands.

1. On railway.com choose **New Project > Deploy from GitHub repo** and pick this repository.
2. In the service's **Variables**, add `MODEL_API_KEY` (your key), `HOST` = `0.0.0.0` and
   `TRUST_PROXY` = `1`.
3. In **Settings > Networking**, choose **Generate Domain** to get the public address.

Every push to GitHub deploys again by itself.

**Render.** `render.yaml` describes the service. On render.com choose **New > Blueprint**,
pick this repository, and enter your `MODEL_API_KEY` when asked. A free service sleeps after
15 minutes without visitors and takes about a minute to wake.

**Anywhere else.** Build with `npm ci && npm run build`, start with `npm start`, and set
`HOST=0.0.0.0`, `TRUST_PROXY=1` (when behind the host's proxy) and `MODEL_API_KEY`. The host
sets `PORT`.

**Check it is working.** Open `https://<your address>/api/v1/health?recheck`. Under
`modelCheck`, `listed` should name the models your key can use (`muse-spark-1.3` and the
rest). If it is empty (`[]`), Meta is not offering your key any models when asked from that
server, and every scan will fail with "does not offer the model". Compare:

- `key.ends`: the last four characters of the key the server is using. They should match
  your key.
- `network`: the server's public address and country, which Meta may use to decide what to
  offer.
- `reply`: exactly what Meta answered.

If the same key lists models from your own computer, the difference is where the request
comes from: try another region in the host's settings, or another host.

**Before you share the address:** every scan runs on your Meta key, and anyone with the
address can scan. Keep `RATE_PER_MINUTE` low, watch your usage on dev.meta.ai, and share the
address only with people you trust.

## How to use I SEE

### 1. Check that it is connected

The pill at the top right says how I SEE is running:

| Pill | Meaning |
|---|---|
| **Live** | Connected. You can examine your own photos. |
| **Examples only** | No key is set, or the server cannot be reached. You can explore the examples. |
| **Preview** | The single-file preview. Examples only; nothing is sent anywhere. |

### 2. Take a good photo

- One object, filling most of the frame, on a plain background if you can.
- Good, even light; no strong glare. Hold still so it is sharp.
- Show the side that tells it apart: the label, the maker's mark, the face, the leaves.
- You can add up to **four photos** of the same object (front, back, a close-up of a
  marking). More views mean fewer guesses.
- Add a **note** if you know something: where it came from, how old it is. It is used as a
  hint, never as proof.

Each photo gets instant hints on the device (sharp, well lit, large enough) before anything
is sent.

### 3. Examine it

Go to **Examine** and either **Use the camera** or **Choose a photo** (or drop one onto the
page). Then choose:

- **Where it is analysed** (see [Routes](#routes)). **Standard** is the default and the most
  complete.
- **How detailed**: **Full profile** (the default: each part is named twice, independently,
  for accuracy) or **Quick look** (faster: each part is named once).

Press **Examine**. The first time, a sheet lists exactly what will be sent, to whom, and what
is kept. Nothing leaves your device until you press **Send and examine**.

While it works you see each step: preparing the photo, checking it, recognising the object,
finding its parts, looking it up, writing, double-checking the facts and settling any
doubt. On a full profile, **Finding its parts** takes longest, because every outline is
named twice, independently, and any disagreement gets a third look. You can **Stop** at any
time.

With the camera, I SEE can name what you point at while the camera is open (**Recognise
things live**) and start the scan by itself when it has locked on. Both can be switched off
in Settings.

### 4. Read the profile

At the top: what it is, how sure I SEE is, and a count of the evidence behind it. Every
sentence carries its label:

| Label | Meaning |
|---|---|
| **Seen** | Visible in your photo. The number beside it is the part on the photo. |
| **Cited** | From a source that was fetched; the quote was checked against the page. Open **How we know** to read it. |
| **Reasoned** | Worked out from what was seen and cited. |
| **Guess** | Plausible, not established. |
| **Unknown** | Nobody can tell from this photo. |
| **Yours** | Something you added. Never graded. |

**The photo.** Each part is outlined, with a line to its number at the edge of the photo (as
in a technical drawing), so no names cover it. Tap a number, or a name in the list below the
photo, to see that part's name and focus on it. Tap anywhere else on the
object to outline something I SEE missed. If an outline is wrong, select it and choose
**Remove this outline**, or put it right in [Train](#8-train).

**The tabs:**

- **Profile**: what it is, how it works, what it is made of, where it is from, how people
  use it, safety, markings read from the photo, and open questions.
- **Parts**: the parts list, and a drawing of what is inside it, made from your photo. Switch
  between the labelled drawing, the plain drawing, and **Against your photo** (drag to
  compare).
- **History**: a timeline, where sources support one.
- **What if**: questions such as "how much energy does it carry at this speed?", with sliders
  for each assumption. The numbers come from I SEE's own calculator, and each assumption is
  labelled, so you can see what was assumed.
- **Sources**: every page used, and what was taken from it.
- **Ask**: ask anything about this object, by typing or with the microphone. Answers are
  graded like the rest of the profile.

Below the profile you can **Add what you know**. At the top: **Report** (a printable page),
**Compare** and **Delete**.

### 5. When it is not sure

If two or more things are still possible, I SEE says so (**Also considered**), shows what
would tell them apart, and suggests the single most useful next photo. Press **Take that
photo** and the new scan builds on the first.

### 6. Passport

Everything you examine is saved in your **Passport**, in this browser only. Use **Export
all** to save a copy as a file, and **Import** to bring it back on another browser or
device.

### 7. Compare

Pick two objects from your Passport to see them side by side: what kind of thing each is,
what it is made of, what it is for, its parts, safety notes and evidence. When online, I SEE
can add a written comparison, graded like everything else.

### 8. Train

Train is a short eye test for I SEE: it shows you what it saw on your own photos, and you
put it right where it is wrong. Choose a kind of round and press **Start a round** (ten
questions, about a minute):

- **Right or wrong?** A close-up of one outlined part: "Is this the headlight?" Press
  **Right**, **Wrong** or **Not sure** (keys Y, N, S). After **Wrong**, type the right name,
  say it is not a part of the object, or say the outline is wrong and draw it.
- **Which one?** Three numbered outlines: "Which one is the nose?" (keys 1, 2, 3). If I SEE
  mixed two names up, swap them back.
- **Where is it?** Tap the part on the whole photo. If I SEE's outline is somewhere else,
  you can **trace it where you tapped**, or **draw it yourself**.

**Drawing a part:** draw a loop around it with your finger, a pen or the mouse, back to
where you started. Use **Closer** for small parts. **Snap to the edges** lets Meta's AI trace
the part's real edges inside your loop; then keep the green outline or your own drawing.

**How your answers are checked.** Anyone can be wrong, you included, so:

1. Your fix corrects your own scan straight away.
2. Meta's AI takes an independent second look: it is shown both names in a random order,
   without knowing whose is whose, and picks the one that fits. If it disagrees, you see why
   and decide (**Keep my answer**, **I SEE is right** or **Change my answer**).
3. Once a round there is a **check question** from an example whose answer is known. How
   you do on these decides how far your answers are trusted.
4. A name you taught goes with your later scans only when the second look agreed, or when
   you made the same fix on two photos and do well on check questions.

Your points, levels (the lines of the eye chart), streaks and lens badges are kept in this
browser.

### 9. Help improve Meta's models

On the Train page (or under **Use of my photos** in Settings) you can switch on **Use my
scans to improve Meta's models**. From then on, your scans are analysed by the contributor
version of Muse Spark, which Meta uses to improve its models. Your game answers and your
Passport stay on your device either way, and outlining, drawing and voice have no
contributor version. Switch it off at any time.

### 10. Settings

- **Language**: profiles and answers in your language; **Translate the interface too**
  translates the menus and buttons (translations are saved on the device). Voice questions
  and **Read answers aloud** are here as well.
- **Analysis**: the default route, **How detailed**, and **Use of my photos**.
- **Camera**: **Recognise things live** and **Scan by itself when locked on**.
- **Reading and access**: **Appearance** (match device, light, dark), **Text size**,
  **Contrast** and **Motion**.
- **Privacy**: stop skipping the consent sheet (**Ask me every time**), and **Delete
  everything on this device**.

### 11. If something goes wrong

| What you see | What to do |
|---|---|
| **Examples only** in the pill | Check that `.env` has `MODEL_API_KEY`, then restart `npm run dev`. Run `npm run check:connection` to see where the connection fails. |
| A scan takes a long time | A full profile uses Meta's models heavily (each part is named twice, independently). **Quick look** names each part once and is faster. |
| A part has the wrong name or outline | Fix it in **Train**. On the profile, you can also remove the outline, or tap the right spot to add one. |
| The camera does not open on a phone | The camera needs HTTPS: use the tunnel in [On a phone](#on-a-phone), and allow camera access when the browser asks. |
| Online, every scan says "does not offer the model" | Open `/api/v1/health?recheck` on your address and read `modelCheck` (see [Put it online](#put-it-online)). |
| "Port already in use" | Another copy is still running. Close it (Ctrl+C in its window) and start again. |

### Privacy, in short

Nothing is sent until you agree. Photos are re-encoded on your device first, which removes
location data. The server keeps a scan in memory only while it runs (at most ten minutes)
and never writes photos to disk. Your Passport and your Train progress live only in your
browser. Web searches use words only, never your photo. The full detail is on the
**Privacy** page in the app and in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Routes

| In the app | What happens |
|---|---|
| **Standard** (default) | Meta Model API: Muse Spark, SAM 3.1 and Muse Wonder. Every part outlined, sources found and checked, doubts weighed. |
| **Private** | Muse Spark Open on the host you configure; nothing is sent to Meta. Parts are marked with approximate pins instead of exact outlines. |
| **Second opinion** | Standard, plus an independent Muse Spark Open opinion; where the two disagree, you see it. |
| **On my own computer** | Muse Glimmer on your machine; asks before anything is sent further. |

A route shows as unavailable until its settings are filled in `.env`.

## Check it

```bash
npm run typecheck
npm test                       # 282 tests
npm run build:preview && node scripts/e2e.cjs   # screenshots at 1440 px, 390 px, dark
npm run e2e:live               # a live scan through the real UI and gateway, against a mock Meta API
npm run eval -- --samples      # or: npm run eval -- eval/cases.json  (live)
```

## Read more

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): pipeline, firewall, calculator, privacy, what was and was not
  verified, deviations from the brief
- [docs/MODELS.md](docs/MODELS.md): which Meta model does what, endpoints, privacy tiers, capability registry
- [docs/SETTINGS.md](docs/SETTINGS.md): every setting, what it does, and its default
- [docs/DESIGN.md](docs/DESIGN.md): the visual system and why
- [docs/MUSE_CODE.md](docs/MUSE_CODE.md): continuing development with Muse Code
