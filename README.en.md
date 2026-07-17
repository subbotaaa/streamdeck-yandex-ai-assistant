# Yandex AI Assistant for Stream Deck

**Русская версия: [README.md](README.md)**

<p align="center">
  <img src="com.subbotaaa.yandex-assistant.sdPlugin/imgs/plugin%402x.png" width="128" alt="Yandex AI Assistant icon">
</p>

**A voice AI assistant on a Stream Deck key.** Hold the key, ask a question out loud —
and get an AI answer as **voice** or **text**. Powered by Yandex Cloud: speech
recognition and synthesis by SpeechKit, answers by YandexGPT, Alice AI, Qwen3,
DeepSeek and other AI Studio models of your choice.

## Features

- 🎙️ **Push-to-talk**: hold the key → speak → release → get the answer. Or
  "press to start, press to stop" mode.
- 🔊 **Voice answers** (8 SpeechKit voices, adjustable speed) and/or
  💬 **text answers** — a popup card with configurable display time.
- 🧠 **Conversation memory**: the assistant remembers recent turns (configurable,
  0–20), so follow-up questions work.
- 🤖 **Model choice**: YandexGPT 5 Lite / Pro / 5.1, Alice AI (+Flash), Qwen3 235B,
  DeepSeek V3.2 / V4 Flash, GPT-OSS 120B, or any custom model URI.
- 📓 **Dialogue journal** — every question and answer saved to a markdown file
  in your Documents folder.
- 🎛️ **Microphone and speaker selection**, recording beeps, clipboard copy.
- 🌐 **Russian and English UI** (auto-detected, switchable).
- 🚫 **No external dependencies**: recording and playback use built-in Windows
  facilities (WinMM) — no ffmpeg or sox required.

## How it works

```
[hold the key]  → microphone recording (WAV 16 kHz, WinMM MCI)
[release]       → SpeechKit STT (speech recognition)
                → the selected LLM (Foundation Models OpenAI-compatible API)
                → SpeechKit TTS (voice) and/or a text popup card
```

## Requirements

- Windows 10/11
- [Stream Deck](https://www.elgato.com/downloads) 6.9+ (tested on 7.1)
- A [Yandex Cloud](https://console.yandex.cloud/) account with active billing

## Installation

**Option 1 — prebuilt package.** Download `com.subbotaaa.yandex-assistant.streamDeckPlugin`
from [Releases](https://github.com/subbotaaa/streamdeck-yandex-ai-assistant/releases)
and double-click it — Stream Deck installs the plugin automatically.

**Option 2 — from source:**

```powershell
git clone https://github.com/subbotaaa/streamdeck-yandex-ai-assistant.git
cd streamdeck-yandex-ai-assistant
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Requires Node.js + npm. The script installs dependencies, copies the plugin into
the Stream Deck plugins folder and restarts the app.

## Yandex Cloud setup (once, ~5 minutes)

1. Sign in to the [Yandex Cloud console](https://console.yandex.cloud/). Create
   a billing account if you don't have one (the "Billing" section).
2. Open or create a **folder**. Copy its **ID** (a string like `b1g...`) — this is
   the **Folder ID** field in the key settings.
3. Create a **service account**: IAM → Service accounts → "Create". Assign roles:
   - `ai.speechkit-stt.user` — speech recognition;
   - `ai.speechkit-tts.user` — speech synthesis;
   - `ai.languageModels.user` — language models.
4. Open the service account → **"API keys"** tab → "Create API key". Copy the
   **secret** (a string like `AQVN...`, shown only once!) — this is the **API key**
   field in the key settings.

The same instructions are built into the key settings — the "📖 How to get an API
key" button.

## Key settings

Drag the **Voice Assistant** action (the "Yandex AI Assistant" category) onto a key
and fill in the settings:

| Setting | Description | Default |
|---|---|---|
| API key, Folder ID | from Yandex Cloud (see above) | — |
| Model | YandexGPT / Alice AI / Qwen3 / DeepSeek / GPT-OSS / custom | YandexGPT 5 Lite |
| System prompt | the assistant's role and style | built-in |
| Speech language | Russian / English / auto-detect | Russian |
| Microphone / Speaker | specific audio devices | system defaults |
| Recording mode | hold (push-to-talk) / press-start-press-stop | hold |
| Beeps | tones on recording start/stop | on |
| Response format | voice / text / both | voice |
| Voice and speed | 8 SpeechKit voices, 0.5–2× | Alena, 1.0× |
| Notification duration | 3–30 seconds or until clicked | 5 seconds |
| Dialogue journal | log to `YandexAssistant-journal.md` (Documents) | on |
| Conversation memory | how many Q→A pairs to remember (0–20) | 5 |
| Language / Язык | UI language: auto / Russian / English | auto |

After filling everything in, click **"Test connection"** — the plugin makes a test
request to the selected model.

## Usage

- **Hold** the key and speak (up to 29 seconds — the SpeechKit synchronous
  recognition limit), then release.
- Key states: 🎙 purple — ready; 🔴 red dot — recording; ⚪ dots — processing;
  🟢 speaker — playing the answer.
- Pressing during playback interrupts the sound and starts a new question.
- Follow-ups work thanks to conversation memory: "tell me more", "translate that".

## Cost

You only pay for Yandex Cloud API usage (AI Studio rates, subject to change —
[current pricing](https://yandex.cloud/en/docs/ai-studio/pricing)). Ballpark: one
voice question-and-answer with YandexGPT Lite ≈ ₽0.8, with Qwen3 235B ≈ ₽1.2
(recognition ≈ ₽0.16 + model + synthesis ≈ ₽0.4).

## Security

⚠️ Stream Deck stores key settings (including the API key) in **plain text** in the
profile on disk. Use a dedicated service account with only the three roles above and
don't reuse that key anywhere else. The plugin only sends requests to
`*.api.cloud.yandex.net` / `llm.api.cloud.yandex.net`.

## Troubleshooting

- Logs: `%APPDATA%\Elgato\StreamDeck\logs\com.subbotaaa.yandex-assistant*.log`
- API errors are shown in the popup card with the error text.
- "Speech not recognized" — speak closer to the microphone, check the selected
  microphone in the settings and the input level in Windows Sound settings.
- Plugin doesn't appear after installation — restart Stream Deck.

## Project structure

```
com.subbotaaa.yandex-assistant.sdPlugin/
├── manifest.json          # plugin manifest (SDK v3, Node.js 20)
├── bin/plugin.js          # core: Stream Deck WebSocket protocol + Yandex Cloud APIs
├── helpers/recorder.ps1   # microphone recording (WinMM MCI), persistent process
├── helpers/play.ps1       # WAV playback with output device selection
├── helpers/devices.ps1    # audio device enumeration
├── helpers/toast.ps1      # popup notification card (WinForms)
├── ui/pi.html             # Property Inspector (key settings, RU/EN)
└── imgs/                  # icons
tools/gen-icons.mjs        # icon generator (pure Node, no dependencies)
install.ps1                # install from source
```

## Development

```powershell
# icons
node tools/gen-icons.mjs
# syntax check
node --check com.subbotaaa.yandex-assistant.sdPlugin/bin/plugin.js
# local install
powershell -ExecutionPolicy Bypass -File .\install.ps1
# package for distribution
npx @elgato/cli pack com.subbotaaa.yandex-assistant.sdPlugin --output dist
```

Technical notes: the plugin talks to Stream Deck over the WebSocket protocol
directly (the only dependency is `ws`); audio capture uses `winmm.dll` MCI commands
from a persistent PowerShell process; models are called through the
OpenAI-compatible endpoint `llm.api.cloud.yandex.net/v1/chat/completions`, which
works for every AI Studio model including the open-source ones.

## License

[MIT](LICENSE)
