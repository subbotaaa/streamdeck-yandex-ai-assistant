// Generates the plugin's PNG icons with no external dependencies.
// Scene-based renderer: shapes are membership functions over the unit square,
// painted with gradients, rasterized with 4x4 supersampling, encoded via zlib.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMGS = path.join(__dirname, "..", "com.subbotaaa.yandex-assistant.sdPlugin", "imgs");
fs.mkdirSync(IMGS, { recursive: true });

// ---- PNG encoder -----------------------------------------------------------
const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		t[n] = c >>> 0;
	}
	return t;
})();
function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const typeBuf = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;  // bit depth
	ihdr[9] = 6;  // RGBA
	const raw = Buffer.alloc(height * (1 + width * 4));
	for (let y = 0; y < height; y++) {
		raw[y * (1 + width * 4)] = 0; // filter: none
		rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

// ---- Shape membership tests (coordinates are fractions of icon size) -------
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const inRoundRect = (x, y, cx, cy, hw, hh, r) => {
	const qx = Math.abs(x - cx) - (hw - r);
	const qy = Math.abs(y - cy) - (hh - r);
	if (qx <= 0 && qy <= 0) return true;
	return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= r;
};
const inSegment = (x, y, ax, ay, bx, by, w) => {
	const abx = bx - ax, aby = by - ay;
	const t = clamp(((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby || 1), 0, 1);
	return Math.hypot(x - (ax + abx * t), y - (ay + aby * t)) <= w;
};
// lower-half ring with rounded tips (the mic "cradle")
const inCradle = (x, y, cx, cy, R, w) => {
	if (y >= cy) return Math.abs(Math.hypot(x - cx, y - cy) - R) <= w;
	return Math.hypot(x - (cx - R), y - cy) <= w || Math.hypot(x - (cx + R), y - cy) <= w;
};
// four-pointed AI sparkle: concave superellipse |dx|^m + |dy|^m <= R^m
const inSparkle = (x, y, cx, cy, R, m = 0.55) => {
	const dx = Math.abs(x - cx) / R, dy = Math.abs(y - cy) / R;
	if (dx > 1 || dy > 1) return false;
	return Math.pow(dx, m) + Math.pow(dy, m) <= 1;
};

// ---- Paints ----------------------------------------------------------------
function hexToRgb(hex) {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const solid = (hex) => {
	const c = hexToRgb(hex);
	return () => c;
};
// diagonal gradient between two colors, t = (x + y) / 2
const gradient = (hexA, hexB) => {
	const a = hexToRgb(hexA), b = hexToRgb(hexB);
	return (x, y) => {
		const t = clamp((x + y) / 2, 0, 1);
		return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
	};
};

// ---- Scene assembly --------------------------------------------------------
// Each layer: { test(x, y) -> bool, paint(x, y) -> [r, g, b] }. Last hit wins.
function micLayers(paint) {
	// microphone shifted left/down to give the sparkle the top-right corner
	const cx = 0.42;
	return [
		{ test: (x, y) => inRoundRect(x, y, cx, 0.40, 0.105, 0.20, 0.105), paint },
		{ test: (x, y) => inCradle(x, y, cx, 0.47, 0.185, 0.027), paint },
		{ test: (x, y) => inSegment(x, y, cx, 0.655, cx, 0.735, 0.027), paint },
		{ test: (x, y) => inSegment(x, y, cx - 0.12, 0.762, cx + 0.12, 0.762, 0.027), paint },
	];
}
function sparkleLayers(paint) {
	return [
		{ test: (x, y) => inSparkle(x, y, 0.775, 0.245, 0.165), paint },
		{ test: (x, y) => inSparkle(x, y, 0.635, 0.105, 0.062), paint },
		{ test: (x, y) => inSparkle(x, y, 0.885, 0.435, 0.052), paint },
	];
}

const BG = gradient("#222a58", "#4b2775");
const MIC = gradient("#ffffff", "#cdd3ff");
const SPARK = gradient("#6ee7ff", "#c77dff");
const WHITE = solid("#ffffff");

const actionScene = [
	{ test: (x, y) => inRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.17), paint: BG },
	...micLayers(MIC),
	...sparkleLayers(SPARK),
];
const categoryScene = [
	...micLayers(WHITE),
	...sparkleLayers(WHITE),
];

// ---- Rasterizer (4x4 supersampling) ----------------------------------------
function renderScene(size, layers) {
	const rgba = Buffer.alloc(size * size * 4);
	const SS = 4;
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			let r = 0, g = 0, b = 0, a = 0;
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					const x = (px + (sx + 0.5) / SS) / size;
					const y = (py + (sy + 0.5) / SS) / size;
					let hit = null;
					for (const layer of layers) {
						if (layer.test(x, y)) hit = layer.paint(x, y);
					}
					if (hit) { r += hit[0]; g += hit[1]; b += hit[2]; a += 1; }
				}
			}
			const n = SS * SS;
			const i = (py * size + px) * 4;
			if (a === 0) continue;
			rgba[i] = Math.round(r / a);
			rgba[i + 1] = Math.round(g / a);
			rgba[i + 2] = Math.round(b / a);
			rgba[i + 3] = Math.round((a / n) * 255);
		}
	}
	return encodePng(size, size, rgba);
}

const files = {
	"action.png": renderScene(72, actionScene),
	"action@2x.png": renderScene(144, actionScene),
	"plugin.png": renderScene(144, actionScene),
	"plugin@2x.png": renderScene(288, actionScene),
	"category.png": renderScene(28, categoryScene),
	"category@2x.png": renderScene(56, categoryScene),
};
for (const [name, buf] of Object.entries(files)) {
	fs.writeFileSync(path.join(IMGS, name), buf);
	console.log(`${name}: ${buf.length} bytes`);
}
