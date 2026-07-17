// Yandex AI Assistant — Stream Deck plugin
// Hold the key -> record from the default microphone -> Yandex SpeechKit STT ->
// YandexGPT -> answer via SpeechKit TTS (voice) and/or Windows toast (text).

import { WebSocket } from "ws";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPERS = path.join(__dirname, "..", "helpers");
const TMP = path.join(os.tmpdir(), "sd-yandex-assistant");
fs.mkdirSync(TMP, { recursive: true });

const MAX_RECORD_MS = 29_000; // SpeechKit sync STT limit is 30 s / 1 MB
const MIN_RECORD_MS = 400;

// ---------------------------------------------------------------------------
// Runtime localization (RU/EN). Language: per-button setting, or OS language.
// ---------------------------------------------------------------------------
const RUNTIME_I18N = {
	ru: {
		setupTitle: "Yandex AI Assistant — настройка",
		setupMsg: "Не заданы API-ключ и Folder ID. Откройте настройки кнопки в Stream Deck и заполните их.",
		recErrTitle: "Ошибка записи",
		errTitle: "Ошибка Yandex AI Assistant",
		appTitle: "Yandex AI Assistant",
		sttEmpty: "Речь не распознана — попробуйте ещё раз, говорите ближе к микрофону.",
		tooShort: "Слишком\nкоротко",
		youPrefix: "Вы: ",
		micPrefix: "Микрофон: ",
		badWav: "Некорректный WAV-файл записи",
		emptyWav: "Пустая запись (нет данных с микрофона)",
		emptyAnswer: "Модель вернула пустой ответ",
		customMissing: "Выбрана «Своя модель», но её имя не заполнено в настройках.",
		codeSkipped: " (фрагмент кода пропущен) ",
		journalFile: "YandexAssistant-журнал.md",
		journalHeader: "# Журнал диалогов Yandex AI Assistant\n",
		journalEmpty: "\n(пока пусто — задайте первый вопрос)\n",
		jYou: "**Вы:**", jBot: "**Ассистент:**",
		testSys: "Отвечай одним словом.",
		testAsk: "Скажи «готово»",
		testOk: "Подключение работает. Ответ модели: ",
		sysPrompt: "Ты голосовой ассистент-эрудит. У тебя НЕТ доступа к интернету и поиску — " +
			"никогда не предлагай «найти информацию» или «поискать». Всегда отвечай на основе " +
			"собственных знаний. Если точных сведений нет, дай наиболее вероятный ответ и честно " +
			"отметь, в чём не уверен. Отвечай по делу, обычным текстом без markdown-разметки.",
	},
	en: {
		setupTitle: "Yandex AI Assistant — setup",
		setupMsg: "API key and Folder ID are not set. Open the key's settings in Stream Deck and fill them in.",
		recErrTitle: "Recording error",
		errTitle: "Yandex AI Assistant error",
		appTitle: "Yandex AI Assistant",
		sttEmpty: "Speech was not recognized — try again, speak closer to the microphone.",
		tooShort: "Too\nshort",
		youPrefix: "You: ",
		micPrefix: "Microphone: ",
		badWav: "Invalid WAV recording file",
		emptyWav: "Empty recording (no microphone data)",
		emptyAnswer: "The model returned an empty answer",
		customMissing: "\"Custom model\" is selected, but its name is empty in the settings.",
		codeSkipped: " (code fragment skipped) ",
		journalFile: "YandexAssistant-journal.md",
		journalHeader: "# Yandex AI Assistant dialogue journal\n",
		journalEmpty: "\n(empty so far — ask your first question)\n",
		jYou: "**You:**", jBot: "**Assistant:**",
		testSys: "Answer with a single word.",
		testAsk: "Say \"ready\"",
		testOk: "Connection works. Model answer: ",
		sysPrompt: "You are an erudite voice assistant. You have NO internet or search access — " +
			"never offer to \"look something up\". Always answer from your own knowledge. If you lack " +
			"precise information, give the most likely answer and honestly note your uncertainty. " +
			"Be concise, respond in plain text without markdown.",
	},
};
let systemLang = "en";
function langOf(settings) {
	const pref = settings?.uiLang;
	if (pref === "ru" || pref === "en") return pref;
	return systemLang;
}
function tr(settings, key) {
	return RUNTIME_I18N[langOf(settings)][key] ?? RUNTIME_I18N.en[key];
}
// detect OS language once at startup (used when the button is set to "auto")
(function detectSystemLanguage() {
	try {
		const p = spawn(
			"powershell.exe",
			["-NoLogo", "-NoProfile", "-Command", "(Get-Culture).TwoLetterISOLanguageName"],
			{ stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
		);
		let out = "";
		p.stdout.setEncoding("utf8");
		p.stdout.on("data", (d) => { out += d; });
		p.on("exit", () => { if (out.trim().toLowerCase() === "ru") systemLang = "ru"; });
	} catch {}
})();

// ---------------------------------------------------------------------------
// Command-line registration parameters supplied by the Stream Deck app
// ---------------------------------------------------------------------------
function argValue(flag) {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
}
const port = argValue("-port");
const pluginUUID = argValue("-pluginUUID");
const registerEvent = argValue("-registerEvent");

// ---------------------------------------------------------------------------
// Stream Deck connection
// ---------------------------------------------------------------------------
const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const send = (obj) => {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
};
const log = (message) => {
	send({ event: "logMessage", payload: { message: `[yandex-assistant] ${message}` } });
};

const setTitle = (context, title) =>
	send({ event: "setTitle", context, payload: { title, target: 0 } });
const setImage = (context, svg) =>
	send({
		event: "setImage",
		context,
		payload: { image: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, target: 0 },
	});
const showOk = (context) => send({ event: "showOk", context });
const showAlert = (context) => send({ event: "showAlert", context });

// ---------------------------------------------------------------------------
// Key images (inline SVG states) — same visual language as imgs/*.png:
// gradient tile, gradient microphone, four-pointed "AI sparkles"
// ---------------------------------------------------------------------------
function sparkPath(cx, cy, r) {
	return `M ${cx} ${cy - r} Q ${cx} ${cy} ${cx + r} ${cy} Q ${cx} ${cy} ${cx} ${cy + r} Q ${cx} ${cy} ${cx - r} ${cy} Q ${cx} ${cy} ${cx} ${cy - r} Z`;
}
function micSvg({ bgA, bgB, sparkles = true, recDot = false, dots = false, speaker = false, dim = false }) {
	const micFill = dim ? "url(#micDim)" : "url(#mic)";
	const glyph = speaker
		? `<path d="M28 58 h15 l19 -17 v60 l-19 -17 h-15 z" fill="${micFill}"/>
		   <path d="M74 51 q13 21 0 42" stroke="${micFill}" stroke-width="7.5" fill="none" stroke-linecap="round"/>
		   <path d="M87 41 q23 31 0 62" stroke="${micFill}" stroke-width="7.5" fill="none" stroke-linecap="round"/>`
		: `<rect x="45.4" y="28.8" width="30.2" height="57.6" rx="15.1" fill="${micFill}"/>
		   <path d="M 33.9 67.7 A 26.6 26.6 0 0 0 87.1 67.7" stroke="${micFill}" stroke-width="7.8" fill="none" stroke-linecap="round"/>
		   <line x1="60.5" y1="94.3" x2="60.5" y2="105.8" stroke="${micFill}" stroke-width="7.8" stroke-linecap="round"/>
		   <line x1="43.2" y1="109.7" x2="77.8" y2="109.7" stroke="${micFill}" stroke-width="7.8" stroke-linecap="round"/>`;
	const sparkFill = dim ? "url(#sparkDim)" : "url(#spark)";
	const sparks = sparkles
		? `<path d="${sparkPath(111.6, 35.3, 23.8)}" fill="${sparkFill}"/>
		   <path d="${sparkPath(91.4, 15.1, 8.9)}" fill="${sparkFill}"/>
		   <path d="${sparkPath(127.4, 62.6, 7.5)}" fill="${sparkFill}"/>`
		: "";
	const extra = recDot
		? `<circle cx="111.6" cy="35.3" r="14" fill="#ff5252" stroke="#ffffff" stroke-width="4.5"/>`
		: dots
			? `<circle cx="48" cy="126" r="7" fill="#cdd3ff" opacity="0.95"/>
			   <circle cx="72" cy="126" r="7" fill="#cdd3ff" opacity="0.6"/>
			   <circle cx="96" cy="126" r="7" fill="#cdd3ff" opacity="0.35"/>`
			: "";
	return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
	<defs>
		<linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="144" y2="144">
			<stop offset="0" stop-color="${bgA}"/><stop offset="1" stop-color="${bgB}"/>
		</linearGradient>
		<linearGradient id="mic" gradientUnits="userSpaceOnUse" x1="30" y1="20" x2="95" y2="115">
			<stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cdd3ff"/>
		</linearGradient>
		<linearGradient id="micDim" gradientUnits="userSpaceOnUse" x1="30" y1="20" x2="95" y2="115">
			<stop offset="0" stop-color="#a7b0d6"/><stop offset="1" stop-color="#8089b3"/>
		</linearGradient>
		<linearGradient id="spark" gradientUnits="userSpaceOnUse" x1="82" y1="6" x2="136" y2="70">
			<stop offset="0" stop-color="#6ee7ff"/><stop offset="1" stop-color="#c77dff"/>
		</linearGradient>
		<linearGradient id="sparkDim" gradientUnits="userSpaceOnUse" x1="82" y1="6" x2="136" y2="70">
			<stop offset="0" stop-color="#4f96ab"/><stop offset="1" stop-color="#7d5b9e"/>
		</linearGradient>
	</defs>
	<rect width="144" height="144" rx="24" fill="url(#bg)"/>${glyph}${sparks}${extra}</svg>`;
}
const IMG_IDLE = micSvg({ bgA: "#222a58", bgB: "#4b2775" });
const IMG_REC = micSvg({ bgA: "#7a1728", bgB: "#a92a3c", sparkles: false, recDot: true });
const IMG_THINK = micSvg({ bgA: "#242946", bgB: "#38305c", dim: true, dots: true });
const IMG_SPEAK = micSvg({ bgA: "#14543a", bgB: "#1e7a4b", speaker: true });

// ---------------------------------------------------------------------------
// Persistent microphone recorder (PowerShell + WinMM MCI)
// ---------------------------------------------------------------------------
class Recorder {
	constructor() {
		this.proc = null;
		this.buffer = "";
		this.waiters = [];
	}

	ensure() {
		if (this.proc && this.proc.exitCode === null) return;
		this.buffer = "";
		this.waiters = [];
		this.proc = spawn(
			"powershell.exe",
			["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HELPERS, "recorder.ps1")],
			{ stdio: ["pipe", "pipe", "pipe"], windowsHide: true }
		);
		this.proc.stdout.setEncoding("utf8");
		this.proc.stdout.on("data", (chunk) => {
			this.buffer += chunk;
			let idx;
			while ((idx = this.buffer.indexOf("\n")) >= 0) {
				const line = this.buffer.slice(0, idx).trim();
				this.buffer = this.buffer.slice(idx + 1);
				if (line && this.waiters.length) this.waiters.shift().resolve(line);
			}
		});
		this.proc.stderr.setEncoding("utf8");
		this.proc.stderr.on("data", (d) => log(`recorder stderr: ${d.trim()}`));
		this.proc.on("exit", (code) => {
			log(`recorder exited with code ${code}`);
			for (const w of this.waiters) w.reject(new Error("Recorder process exited"));
			this.waiters = [];
			this.proc = null;
		});
		// consume the initial READY line
		this.readLine(10_000).catch(() => {});
	}

	readLine(timeoutMs) {
		return new Promise((resolve, reject) => {
			const waiter = { resolve, reject };
			this.waiters.push(waiter);
			const t = setTimeout(() => {
				const i = this.waiters.indexOf(waiter);
				if (i >= 0) this.waiters.splice(i, 1);
				reject(new Error("Recorder timeout"));
			}, timeoutMs);
			const origResolve = waiter.resolve;
			const origReject = waiter.reject;
			waiter.resolve = (v) => { clearTimeout(t); origResolve(v); };
			waiter.reject = (e) => { clearTimeout(t); origReject(e); };
		});
	}

	async command(cmd, timeoutMs = 10_000) {
		this.ensure();
		this.proc.stdin.write(cmd + "\r\n");
		const reply = await this.readLine(timeoutMs);
		if (reply.startsWith("ERR")) throw new Error(RUNTIME_I18N[systemLang].micPrefix + reply.slice(4));
		return reply;
	}

	start(micName) {
		return this.command(micName ? `START|${micName}` : "START");
	}
	stop(file) { return this.command(`STOP ${file}`, 15_000); }
	cancel() { return this.command("CANCEL").catch(() => {}); }
	beep(freq, dur) { return this.command(`BEEP ${freq} ${dur}`).catch(() => {}); }
}
const recorder = new Recorder();

// ---------------------------------------------------------------------------
// Helper process runners
// ---------------------------------------------------------------------------
let playProc = null;
function stopPlayback() {
	if (playProc && playProc.exitCode === null) {
		try { playProc.kill(); } catch {}
	}
	playProc = null;
}
function playWav(file, outputName) {
	return new Promise((resolve) => {
		stopPlayback();
		const args = ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HELPERS, "play.ps1"), "-File", file];
		if (outputName) args.push("-Output", outputName);
		playProc = spawn("powershell.exe", args, { stdio: "ignore", windowsHide: true });
		playProc.on("exit", () => resolve());
		playProc.on("error", () => resolve());
	});
}

// Enumerate audio devices for the property inspector (cached briefly)
let devicesCache = null;
let devicesCacheAt = 0;
function listDevices() {
	if (devicesCache && Date.now() - devicesCacheAt < 15_000) return Promise.resolve(devicesCache);
	return new Promise((resolve) => {
		const p = spawn(
			"powershell.exe",
			["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HELPERS, "devices.ps1")],
			{ stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
		);
		let out = "";
		p.stdout.setEncoding("utf8");
		p.stdout.on("data", (d) => { out += d; });
		p.on("exit", () => {
			try {
				devicesCache = JSON.parse(out.trim());
				devicesCacheAt = Date.now();
				resolve(devicesCache);
			} catch {
				resolve({ inputs: [], outputs: [] });
			}
		});
		p.on("error", () => resolve({ inputs: [], outputs: [] }));
	});
}

// ---------------------------------------------------------------------------
// Dialogue journal (markdown file in the user's Documents folder)
// ---------------------------------------------------------------------------
let docsDirCache = null;
async function journalPath(settings) {
	if (docsDirCache) return path.join(docsDirCache, tr(settings, "journalFile"));
	const docs = await new Promise((resolve) => {
		const p = spawn(
			"powershell.exe",
			["-NoLogo", "-NoProfile", "-Command",
				"[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments')"],
			{ stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
		);
		let out = "";
		p.stdout.setEncoding("utf8");
		p.stdout.on("data", (d) => { out += d; });
		p.on("exit", () => resolve(out.trim()));
		p.on("error", () => resolve(""));
	});
	docsDirCache = docs && fs.existsSync(docs) ? docs : os.homedir();
	return path.join(docsDirCache, tr(settings, "journalFile"));
}

async function appendJournal(settings, question, answer) {
	if (settings.journal === false) return;
	try {
		const file = await journalPath(settings);
		const locale = langOf(settings) === "ru" ? "ru-RU" : "en-US";
		const stamp = new Date().toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
		let entry = `\n### ${stamp}\n\n${tr(settings, "jYou")} ${question}\n\n${tr(settings, "jBot")} ${answer}\n`;
		if (!fs.existsSync(file)) entry = "\uFEFF" + tr(settings, "journalHeader") + entry;
		fs.appendFileSync(file, entry, "utf8");
	} catch (e) {
		log(`journal write failed: ${e.message}`);
	}
}

async function openJournal(settings) {
	const file = await journalPath(settings);
	if (!fs.existsSync(file)) {
		fs.writeFileSync(file, "\uFEFF" + tr(settings, "journalHeader") + tr(settings, "journalEmpty"), "utf8");
	}
	spawn("cmd.exe", ["/c", "start", "", file], { stdio: "ignore", windowsHide: true });
}

let notifyProc = null;
function showToast(title, text, clip, seconds = 5) {
	// only one popup at a time — a new one replaces the previous
	if (notifyProc && notifyProc.exitCode === null) {
		try { notifyProc.kill(); } catch {}
	}
	const file = path.join(TMP, "answer.txt");
	fs.writeFileSync(file, text, "utf8");
	const args = [
		"-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass",
		"-File", path.join(HELPERS, "toast.ps1"),
		"-File", file, "-Title", title, "-Seconds", String(seconds),
	];
	if (clip) args.push("-Clip");
	notifyProc = spawn("powershell.exe", args, { stdio: "ignore", windowsHide: true });
}

function toastSeconds(settings) {
	const n = parseInt(settings.toastSeconds ?? "5", 10);
	return Number.isFinite(n) && n >= 0 ? n : 5;
}

// ---------------------------------------------------------------------------
// WAV utilities
// ---------------------------------------------------------------------------
function parseWav(buf, settings) {
	if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
		throw new Error(tr(settings, "badWav"));
	}
	let offset = 12;
	let sampleRate = 16000;
	let pcm = null;
	while (offset + 8 <= buf.length) {
		const id = buf.toString("ascii", offset, offset + 4);
		const size = buf.readUInt32LE(offset + 4);
		if (id === "fmt ") sampleRate = buf.readUInt32LE(offset + 12);
		if (id === "data") { pcm = buf.subarray(offset + 8, offset + 8 + size); break; }
		offset += 8 + size + (size % 2);
	}
	if (!pcm || pcm.length === 0) throw new Error(tr(settings, "emptyWav"));
	return { sampleRate, pcm };
}

function buildWav(pcm, sampleRate) {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0, "ascii");
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8, "ascii");
	header.write("fmt ", 12, "ascii");
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36, "ascii");
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

// ---------------------------------------------------------------------------
// Yandex Cloud API
// ---------------------------------------------------------------------------
async function apiFetch(url, options, timeoutMs = 60_000) {
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...options, signal: controller.signal });
	} finally {
		clearTimeout(t);
	}
}

async function speechToText(settings, pcm, sampleRate) {
	const params = new URLSearchParams({
		topic: "general",
		folderId: settings.folderId,
		format: "lpcm",
		sampleRateHertz: String(sampleRate),
	});
	if (settings.sttLang && settings.sttLang !== "auto") params.set("lang", settings.sttLang);
	const res = await apiFetch(`https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?${params}`, {
		method: "POST",
		headers: { Authorization: `Api-Key ${settings.apiKey}` },
		body: pcm,
	});
	if (!res.ok) throw new Error(`SpeechKit STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const data = await res.json();
	return (data.result || "").trim();
}

// ---------------------------------------------------------------------------
// Conversation history (context memory), persisted across plugin restarts
// ---------------------------------------------------------------------------
const HISTORY_FILE = path.join(TMP, "history.json");
const HISTORY_HARD_CAP = 20;       // pairs stored per button, regardless of the setting
const HISTORY_CHAR_BUDGET = 12000; // rough guard against overflowing the model context
let history = {};
try { history = JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")); } catch {}
function saveHistory() {
	try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history)); } catch (e) { log(`history save failed: ${e.message}`); }
}
function historySize(settings) {
	const n = parseInt(settings.historySize ?? "5", 10);
	return Number.isFinite(n) && n >= 0 ? n : 5;
}
function getHistory(context, settings) {
	const size = historySize(settings);
	if (size === 0) return [];
	const pairs = (history[context] || []).slice(-size);
	// drop oldest pairs if the total text volume is too large
	let total = 0;
	const kept = [];
	for (let i = pairs.length - 1; i >= 0; i--) {
		total += pairs[i].q.length + pairs[i].a.length;
		if (total > HISTORY_CHAR_BUDGET && kept.length > 0) break;
		kept.unshift(pairs[i]);
	}
	return kept;
}
function rememberExchange(context, settings, question, answer) {
	if (historySize(settings) === 0) return;
	history[context] = [...(history[context] || []), { q: question, a: answer }].slice(-HISTORY_HARD_CAP);
	saveHistory();
}

function resolveModelUri(settings) {
	const model = settings.model || "yandexgpt-lite";
	if (model === "custom") {
		const custom = (settings.customModel || "").trim();
		if (!custom) throw new Error(tr(settings, "customMissing"));
		if (custom.startsWith("gpt://")) return custom;
		return `gpt://${settings.folderId}/${custom}${custom.includes("/") ? "" : "/latest"}`;
	}
	return `gpt://${settings.folderId}/${model}${model.includes("/") ? "" : "/latest"}`;
}

async function askGpt(settings, question, hist = []) {
	const messages = [];
	if (settings.sysPrompt && settings.sysPrompt.trim()) {
		messages.push({ role: "system", content: settings.sysPrompt.trim() });
	} else {
		messages.push({ role: "system", content: tr(settings, "sysPrompt") });
	}
	for (const pair of hist) {
		messages.push({ role: "user", content: pair.q });
		messages.push({ role: "assistant", content: pair.a });
	}
	messages.push({ role: "user", content: question });
	// OpenAI-compatible endpoint: works for YandexGPT, Alice AI and the open models
	// (Qwen, DeepSeek, GPT-OSS), unlike the native completion API
	const res = await apiFetch("https://llm.api.cloud.yandex.net/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: `Api-Key ${settings.apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: resolveModelUri(settings),
			// generous cap: reasoning models spend part of the budget on thinking
			max_tokens: 4000,
			temperature: Number(settings.temperature ?? 0.4),
			messages,
		}),
	}, 120_000);
	if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
	const data = await res.json();
	let text = data?.choices?.[0]?.message?.content || "";
	// reasoning models may embed their chain of thought in <think> tags
	text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
	if (!text) throw new Error(tr(settings, "emptyAnswer"));
	return text;
}

function splitForTts(text, maxLen = 4500) {
	const chunks = [];
	let rest = text;
	while (rest.length > maxLen) {
		let cut = rest.lastIndexOf(". ", maxLen);
		if (cut < maxLen * 0.5) cut = rest.lastIndexOf(" ", maxLen);
		if (cut <= 0) cut = maxLen;
		chunks.push(rest.slice(0, cut + 1));
		rest = rest.slice(cut + 1);
	}
	if (rest.trim()) chunks.push(rest);
	return chunks;
}

async function textToSpeech(settings, text) {
	const sampleRate = 48000;
	const parts = [];
	for (const chunk of splitForTts(text)) {
		const body = new URLSearchParams({
			text: chunk,
			lang: "ru-RU",
			voice: settings.voice || "alena",
			speed: String(settings.speed || "1.0"),
			format: "lpcm",
			sampleRateHertz: String(sampleRate),
			folderId: settings.folderId,
		});
		const res = await apiFetch("https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize", {
			method: "POST",
			headers: {
				Authorization: `Api-Key ${settings.apiKey}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: body.toString(),
		});
		if (!res.ok) throw new Error(`SpeechKit TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
		parts.push(Buffer.from(await res.arrayBuffer()));
	}
	return buildWav(Buffer.concat(parts), sampleRate);
}

// Markdown artifacts sound bad when spoken aloud
function cleanForSpeech(text, settings) {
	return text
		.replace(/```[\s\S]*?```/g, tr(settings, "codeSkipped"))
		.replace(/[*_`#>|]+/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/\s{2,}/g, " ")
		.trim();
}

// ---------------------------------------------------------------------------
// Action state machine
// ---------------------------------------------------------------------------
const contextSettings = new Map();
let busy = false;           // a press is being processed
let recordingCtx = null;    // context that is currently recording
let recordStartedAt = 0;
let autoStopTimer = null;

function validateSettings(s) {
	if (!s || !s.apiKey || !s.folderId) {
		return tr(s, "setupMsg");
	}
	return null;
}

async function onKeyDown(context) {
	const settings = contextSettings.get(context) || {};
	const err = validateSettings(settings);
	if (err) {
		showAlert(context);
		showToast(tr(settings, "setupTitle"), err, false, 8);
		return;
	}
	// toggle mode: the second press stops the recording and processes it
	if (settings.pressMode === "toggle" && recordingCtx === context) {
		stopAndProcess(context);
		return;
	}
	if (busy || recordingCtx) {
		showAlert(context);
		return;
	}
	stopPlayback(); // pressing while an answer is playing interrupts it
	try {
		recordingCtx = context;
		recordStartedAt = Date.now();
		await recorder.start(settings.micName);
		setImage(context, IMG_REC);
		if (settings.beeps !== false) recorder.beep(1150, 90);
		autoStopTimer = setTimeout(() => {
			if (recordingCtx === context) stopAndProcess(context, true);
		}, MAX_RECORD_MS);
	} catch (e) {
		recordingCtx = null;
		setImage(context, IMG_IDLE);
		showAlert(context);
		log(`start recording failed: ${e.message}`);
		showToast(tr(settings, "recErrTitle"), String(e.message), false, 8);
	}
}

function onKeyUp(context) {
	const settings = contextSettings.get(context) || {};
	// in toggle mode releasing the key does nothing — recording is stopped by the next press
	if (settings.pressMode === "toggle") return;
	stopAndProcess(context);
}

async function stopAndProcess(context, isAutoStop = false) {
	if (recordingCtx !== context) return;
	clearTimeout(autoStopTimer);
	autoStopTimer = null;
	const duration = Date.now() - recordStartedAt;
	recordingCtx = null;

	if (duration < MIN_RECORD_MS) {
		await recorder.cancel();
		setImage(context, IMG_IDLE);
		setTitle(context, tr(settings, "tooShort"));
		setTimeout(() => setTitle(context, ""), 2500);
		return;
	}

	const settings = contextSettings.get(context) || {};
	const wavFile = path.join(TMP, "question.wav");
	busy = true;
	setImage(context, IMG_THINK);
	try {
		try { fs.unlinkSync(wavFile); } catch {}
		await recorder.stop(wavFile);
		if (settings.beeps !== false) recorder.beep(700, 90);
		const { sampleRate, pcm } = parseWav(fs.readFileSync(wavFile), settings);

		const question = await speechToText(settings, pcm, sampleRate);
		if (!question) {
			showAlert(context);
			showToast(tr(settings, "appTitle"), tr(settings, "sttEmpty"), false);
			return;
		}
		log(`question: ${question}`);

		const answer = await askGpt(settings, question, getHistory(context, settings));
		log(`answer: ${answer.slice(0, 200)}`);
		rememberExchange(context, settings, question, answer);
		appendJournal(settings, question, answer);

		const mode = settings.mode || "voice";
		if (mode === "text" || mode === "both") {
			showToast(tr(settings, "youPrefix") + question.slice(0, 80), answer, settings.copyClipboard !== false, toastSeconds(settings));
		}
		if (mode === "voice" || mode === "both") {
			const speech = cleanForSpeech(answer, settings);
			if (speech) {
				const wav = await textToSpeech(settings, speech);
				const answerFile = path.join(TMP, "answer.wav");
				fs.writeFileSync(answerFile, wav);
				setImage(context, IMG_SPEAK);
				showOk(context);
				// release the busy flag before playback so a new press can
				// interrupt the answer and start the next question right away
				busy = false;
				await playWav(answerFile, settings.speakerName);
			}
		} else {
			showOk(context);
		}
		if (isAutoStop) log("recording auto-stopped at 29s limit");
	} catch (e) {
		log(`processing failed: ${e.message}`);
		showAlert(context);
		showToast(tr(settings, "errTitle"), String(e.message), false, 8);
	} finally {
		busy = false;
		// don't clobber the "recording" image if a new press already started
		if (recordingCtx !== context) setImage(context, IMG_IDLE);
	}
}

// Connectivity test triggered from the property inspector
async function runTest(context, piContext, actionUUID) {
	const settings = contextSettings.get(context) || {};
	const reply = (payload) =>
		send({ action: actionUUID, event: "sendToPropertyInspector", context, payload });
	const err = validateSettings(settings);
	if (err) return reply({ event: "testResult", ok: false, message: err });
	try {
		const answer = await askGpt({ ...settings, sysPrompt: tr(settings, "testSys") }, tr(settings, "testAsk"));
		reply({ event: "testResult", ok: true, message: tr(settings, "testOk") + answer.slice(0, 60) });
	} catch (e) {
		reply({ event: "testResult", ok: false, message: String(e.message) });
	}
}

// ---------------------------------------------------------------------------
// Event loop
// ---------------------------------------------------------------------------
ws.on("open", () => {
	send({ event: registerEvent, uuid: pluginUUID });
	log("plugin registered");
	recorder.ensure(); // pre-warm so the first press starts recording instantly
});

ws.on("message", (raw) => {
	let msg;
	try { msg = JSON.parse(raw.toString()); } catch { return; }
	const { event, context, payload, action } = msg;
	switch (event) {
		case "willAppear":
			contextSettings.set(context, payload?.settings || {});
			setImage(context, IMG_IDLE);
			setTitle(context, "");
			break;
		case "willDisappear":
			contextSettings.delete(context);
			break;
		case "didReceiveSettings":
			contextSettings.set(context, payload?.settings || {});
			break;
		case "keyDown":
			contextSettings.set(context, payload?.settings || contextSettings.get(context) || {});
			onKeyDown(context);
			break;
		case "keyUp":
			onKeyUp(context);
			break;
		case "sendToPlugin":
			if (payload?.cmd === "test") runTest(context, context, action);
			if (payload?.cmd === "getDevices") {
				listDevices().then((devices) =>
					send({
						action, event: "sendToPropertyInspector", context,
						payload: { event: "devices", ...devices },
					})
				);
			}
			if (payload?.cmd === "openJournal") openJournal(contextSettings.get(context) || {});
			if (payload?.cmd === "clearHistory") {
				delete history[context];
				saveHistory();
				send({
					action, event: "sendToPropertyInspector", context,
					payload: { event: "historyCleared" },
				});
			}
			break;
	}
});

ws.on("close", () => process.exit(0));
ws.on("error", (e) => {
	log(`websocket error: ${e.message}`);
});
process.on("uncaughtException", (e) => log(`uncaught: ${e.stack || e.message}`));
process.on("unhandledRejection", (e) => log(`unhandled rejection: ${e}`));
