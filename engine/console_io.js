"use strict";

// console_io.js — Native Win32 Shared Console I/O for Overlord Cockpit Panes
// Managed by Albedo for Dr. Ahmed
// Eliminates Inner ConPTY: Child process shares the Windows Terminal console buffer directly (stdio: inherit)
// Input : WriteConsoleInputW -> synthetic KEY_EVENT records on CONIN$
// Output: ReadConsoleOutputCharacterW -> reads what is actually on screen (CONOUT$)

const { dlopen, ptr } = require("bun:ffi");

const k32 = dlopen("kernel32.dll", {
  CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "u64" },
  CloseHandle: { args: ["u64"], returns: "bool" },
  WriteConsoleInputW: { args: ["u64", "ptr", "u32", "ptr"], returns: "bool" },
  ReadConsoleOutputCharacterW: { args: ["u64", "ptr", "u32", "u32", "ptr"], returns: "bool" },
  GetConsoleScreenBufferInfo: { args: ["u64", "ptr"], returns: "bool" },
  SetConsoleCtrlHandler: { args: ["ptr", "bool"], returns: "bool" },
});

const INVALID = 0xFFFFFFFFFFFFFFFFn;
const wstr = (s) => Buffer.from(s + "\0", "utf16le");
const CONIN = wstr("CONIN$");
const CONOUT = wstr("CONOUT$");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function openConsole(name) {
  // GENERIC_READ | GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, OPEN_EXISTING
  const h = k32.symbols.CreateFileW(ptr(name), 0xC0000000, 3, null, 3, 0, null);
  const b = BigInt(h);
  return b === 0n || b === INVALID ? null : h;
}

// ── Virtual Key Constants ──────────────────────────────────────────────────
const ENHANCED = 0x0100;
const LCTRL = 0x0008;
const SHIFT = 0x0010;

const NAMED = {
  enter: { vk: 0x0D, sc: 0x1C, ch: 13 },
  return: { vk: 0x0D, sc: 0x1C, ch: 13 },
  tab: { vk: 0x09, sc: 0x0F, ch: 9 },
  space: { vk: 0x20, sc: 0x39, ch: 32 },
  esc: { vk: 0x1B, sc: 0x01, ch: 27 },
  escape: { vk: 0x1B, sc: 0x01, ch: 27 },
  backspace: { vk: 0x08, sc: 0x0E, ch: 8 },
  up: { vk: 0x26, sc: 0x48, ch: 0, ctrl: ENHANCED },
  down: { vk: 0x28, sc: 0x50, ch: 0, ctrl: ENHANCED },
  left: { vk: 0x25, sc: 0x4B, ch: 0, ctrl: ENHANCED },
  right: { vk: 0x27, sc: 0x4D, ch: 0, ctrl: ENHANCED },
  home: { vk: 0x24, sc: 0x47, ch: 0, ctrl: ENHANCED },
  end: { vk: 0x23, sc: 0x4F, ch: 0, ctrl: ENHANCED },
  pageup: { vk: 0x21, sc: 0x49, ch: 0, ctrl: ENHANCED },
  pagedown: { vk: 0x22, sc: 0x51, ch: 0, ctrl: ENHANCED },
  delete: { vk: 0x2E, sc: 0x53, ch: 0, ctrl: ENHANCED },
  "ctrl+c": { vk: 0x43, sc: 0x2E, ch: 3, ctrl: LCTRL },
  "ctrl+d": { vk: 0x44, sc: 0x20, ch: 4, ctrl: LCTRL },
  "ctrl+z": { vk: 0x5A, sc: 0x2C, ch: 26, ctrl: LCTRL },
  "ctrl+l": { vk: 0x4C, sc: 0x26, ch: 12, ctrl: LCTRL },
  "shift+enter": { vk: 0x0D, sc: 0x1C, ch: 13, ctrl: SHIFT },
};

NAMED.sigint = NAMED["ctrl+c"];
NAMED["ctrl-c"] = NAMED["ctrl+c"];
NAMED["ctrl-d"] = NAMED["ctrl+d"];
NAMED["ctrl-z"] = NAMED["ctrl+z"];

let hIn = null;
function getIn() {
  if (!hIn) hIn = openConsole(CONIN);
  return hIn;
}

// Write synthetic KEY_EVENT records to CONIN$ (down + up per key)
function writeKeys(keys) {
  const h = getIn();
  if (!h || !keys || !keys.length) return false;
  const n = keys.length * 2;
  const buf = new Uint8Array(n * 20);
  const dv = new DataView(buf.buffer);
  let i = 0;
  for (const k of keys) {
    for (const down of [1, 0]) {
      const o = i++ * 20;
      dv.setUint16(o, 1, true);                 // EventType = KEY_EVENT (1)
      dv.setInt32(o + 4, down, true);           // bKeyDown
      dv.setUint16(o + 8, 1, true);             // wRepeatCount = 1
      dv.setUint16(o + 10, k.vk || 0, true);    // wVirtualKeyCode
      dv.setUint16(o + 12, k.sc || 0, true);    // wVirtualScanCode
      dv.setUint16(o + 14, k.ch || 0, true);    // UnicodeChar
      dv.setUint32(o + 16, k.ctrl || 0, true);  // dwControlKeyState
    }
  }
  const written = new Uint32Array(1);
  return k32.symbols.WriteConsoleInputW(h, ptr(buf), n, ptr(written));
}

const charKey = (c) => {
  if (c === 13 || c === 10) return NAMED.enter;
  if (c === 9) return NAMED.tab;
  if (c === 32) return NAMED.space;
  return { vk: 0, sc: 0, ch: c, ctrl: 0 }; // printable UTF-16 code point
};

const strKeys = (s) => {
  const a = [];
  for (let i = 0; i < s.length; i++) {
    a.push(charKey(s.charCodeAt(i)));
  }
  return a;
};

// Bracketed-paste escape sequences must land in ONE call
async function writeAtomic(s) {
  writeKeys(strKeys(s));
}

// Pace non-bracketed long text into chunks of 48 with 3ms gaps
async function writeChunked(s, chunk = 48, gapMs = 3) {
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + chunk, s.length);
    const last = s.charCodeAt(end - 1);
    // Don't split a surrogate pair across chunk boundaries
    if (end < s.length && last >= 0xD800 && last <= 0xDBFF) {
      end++;
    }
    writeKeys(strKeys(s.slice(i, end)));
    i = end;
    if (i < s.length) {
      await sleep(gapMs);
    }
  }
}

async function typeText(text, { paste = false, submit = false } = {}) {
  if (paste) {
    await writeAtomic("\x1b[200~");
    await writeChunked(text.replace(/\r\n/g, "\n"));
    await writeAtomic("\x1b[201~");
    await sleep(60); // Allow TUI time to consume bracketed paste
  } else {
    await writeChunked(text);
  }
  if (submit) {
    await sleep(20);
    writeKeys([NAMED.enter]);
  }
}

async function pressKey(name) {
  const k = NAMED[String(name).toLowerCase().trim()];
  if (k) {
    writeKeys([k]);
    return true;
  }
  await writeChunked(String(name));
  return true;
}

// ── Output: Read 2D Screen Buffer from CONOUT$ ──────────────────────────────
function readScreen() {
  const h = openConsole(CONOUT); // Reopen to track active screen buffer
  if (!h) return null;
  try {
    const csbi = new Uint8Array(22);
    if (!k32.symbols.GetConsoleScreenBufferInfo(h, ptr(csbi))) return null;
    const v = new DataView(csbi.buffer);
    const cursorX = v.getInt16(4, true);
    const cursorY = v.getInt16(6, true);
    const left = v.getInt16(10, true);
    const top = v.getInt16(12, true);
    const right = v.getInt16(14, true);
    const bottom = v.getInt16(16, true);
    const cols = right - left + 1;
    const rows = bottom - top + 1;
    if (cols <= 0 || rows <= 0) return null;

    const w = new Uint16Array(cols);
    const nread = new Uint32Array(1);
    const lines = [];

    for (let r = 0; r < rows; r++) {
      const coord = (((top + r) << 16) | (left & 0xFFFF)) >>> 0;
      nread[0] = 0;
      k32.symbols.ReadConsoleOutputCharacterW(h, ptr(w), cols, coord, ptr(nread));
      lines.push(String.fromCharCode(...w.subarray(0, nread[0])).trimEnd());
    }

    return { cols, rows, cursor: { x: cursorX, y: cursorY }, lines };
  } finally {
    k32.symbols.CloseHandle(h);
  }
}

// Ignore Ctrl+C in runner process so Ctrl+C only signals the child
function ignoreCtrlC() {
  return k32.symbols.SetConsoleCtrlHandler(null, true);
}

module.exports = {
  typeText,
  pressKey,
  readScreen,
  ignoreCtrlC,
  writeKeys,
  NAMED,
};
