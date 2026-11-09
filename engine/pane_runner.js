const fs = require("fs");
const path = require("path");
const http = require("http");
const net = require("net");
const os = require("os");

const DATA_DIR = path.resolve(__dirname, "..", "data");

process.on("uncaughtException", (err) => {
  console.error("💥 [AGY PANE RUNNER CRASH]:", err);
  try {
    fs.appendFileSync(path.join(DATA_DIR, "crash.log"), `[${new Date().toISOString()}] ${err.stack || err}\n`);
  } catch (_) {}
  setTimeout(() => process.exit(1), 10000);
});

const cio = require("./console_io.js");

// pane_runner.js - Overlord Autonomous Terminal Cockpit & Shared Console Runner v4.0
// Direct Console Architecture: Zero Inner ConPTY · Native Win32 Shared Console I/O
// Managed by Albedo for Dr. Ahmed

// 1. Native Win32 FFI Bindings via Bun (Process Tree Snapshot, Suspend/Resume)
let win32Suspend = null;
let win32Resume = null;
let getProcessTreeSnapshot = null;

try {
  const { dlopen, FFIType, ptr } = require("bun:ffi");
  const kernel32 = dlopen("kernel32.dll", {
    OpenProcess: { args: [FFIType.u32, FFIType.bool, FFIType.u32], returns: FFIType.ptr },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.bool },
    SetConsoleCP: { args: [FFIType.u32], returns: FFIType.bool },
    SetConsoleOutputCP: { args: [FFIType.u32], returns: FFIType.bool },
    CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.ptr },
    Process32FirstW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
    Process32NextW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
  });

  // Force console code page 65001 (UTF-8)
  try {
    kernel32.symbols.SetConsoleCP(65001);
    kernel32.symbols.SetConsoleOutputCP(65001);
  } catch (e) {}

  const ntdll = dlopen("ntdll.dll", {
    NtSuspendProcess: { args: [FFIType.ptr], returns: FFIType.u32 },
    NtResumeProcess: { args: [FFIType.ptr], returns: FFIType.u32 },
  });

  win32Suspend = (pid) => {
    const handle = kernel32.symbols.OpenProcess(0x0800, false, pid); // PROCESS_SUSPEND_RESUME
    if (handle) {
      ntdll.symbols.NtSuspendProcess(handle);
      kernel32.symbols.CloseHandle(handle);
      return true;
    }
    return false;
  };

  win32Resume = (pid) => {
    const handle = kernel32.symbols.OpenProcess(0x0800, false, pid);
    if (handle) {
      ntdll.symbols.NtResumeProcess(handle);
      kernel32.symbols.CloseHandle(handle);
      return true;
    }
    return false;
  };

  // Ultra-fast microsecond process tree snapshot
  getProcessTreeSnapshot = () => {
    const procs = [];
    const buf = new Uint8Array(568);
    const view = new DataView(buf.buffer);
    view.setUint32(0, 568, true);

    const hSnap = kernel32.symbols.CreateToolhelp32Snapshot(0x00000002, 0); // TH32CS_SNAPPROCESS
    if (!hSnap) return procs;

    let ok = kernel32.symbols.Process32FirstW(hSnap, ptr(buf));
    while (ok) {
      const pid = view.getUint32(8, true);
      const ppid = view.getUint32(32, true); // th32ParentProcessID at offset 32 (x64)
      const nameBytes = buf.slice(44, 44 + 520);
      const name = new TextDecoder("utf-16le").decode(nameBytes).replace(/\0.*$/, "");
      procs.push({ pid, ppid, name });
      ok = kernel32.symbols.Process32NextW(hSnap, ptr(buf));
    }
    kernel32.symbols.CloseHandle(hSnap);
    return procs;
  };
} catch (e) {
  // Graceful fallback for non-Bun runtimes
}

function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b\].*?\x07/g, "")
    .replace(/\x1b\].*?\x1b\\/g, "")
    .replace(/\x1b[PX^_].*?\x1b\\/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
}

function vt100ChunkToLines(raw) {
  const lines = raw.split(/\r?\n/);
  return lines.map(stripAnsi);
}

function cleanTerminalLines(rawLines) {
  const result = [];
  for (const line of rawLines) {
    const clean = stripAnsi(line).trimEnd();
    if (clean.length > 0) {
      result.push(clean);
    }
  }
  return result;
}

// ── Command Line Argument Parsing ──────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    id: "pane-" + Math.random().toString(36).substring(2, 8),
    title: "[AGY] Cockpit Pane",
    cmd: "cmd",
    sessionId: "default",
    dir: process.cwd(),
    cols: 0,
    rows: 0,
    autoClose: false,
    keepOnError: true,
    sanitizeProxy: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--id" && args[i + 1]) opts.id = args[++i];
    else if (arg === "--title" && args[i + 1]) opts.title = args[++i];
    else if (arg === "--cmd" && args[i + 1]) opts.cmd = args[++i];
    else if (arg === "--session-id" && args[i + 1]) opts.sessionId = args[++i];
    else if (arg === "--dir" && args[i + 1]) opts.dir = args[++i];
    else if (arg === "--cols" && args[i + 1]) opts.cols = parseInt(args[++i], 10);
    else if (arg === "--rows" && args[i + 1]) opts.rows = parseInt(args[++i], 10);
    else if (arg === "--auto-close") opts.autoClose = true;
    else if (arg === "--keep-on-error") opts.keepOnError = true;
    else if (arg === "--no-sanitize-proxy") opts.sanitizeProxy = false;
  }

  // Load configuration from config.json if written by pane_manager
  const configPath = path.join(DATA_DIR, "panes", opts.id, "config.json");
  if (fs.existsSync(configPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (cfg.title) opts.title = cfg.title;
      if (cfg.command) opts.cmd = cfg.command;
      if (cfg.session_id) opts.sessionId = cfg.session_id;
      if (cfg.dir) opts.dir = cfg.dir;
      if (cfg.cols) opts.cols = cfg.cols;
      if (cfg.rows) opts.rows = cfg.rows;
      if (cfg.auto_close !== undefined) opts.autoClose = cfg.auto_close;
      if (cfg.pause_on_error !== undefined) opts.keepOnError = cfg.pause_on_error;
      if (cfg.sanitize_proxy !== undefined) opts.sanitizeProxy = cfg.sanitize_proxy;
    } catch (_) {}
  }

  return opts;
}

const REGISTRY_FILE = path.join(DATA_DIR, "pane_registry.json");

function updateRegistry(paneId, patch) {
  try {
    let reg = {};
    if (fs.existsSync(REGISTRY_FILE)) {
      try {
        reg = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
      } catch (_) {}
    }
    reg[paneId] = { ...(reg[paneId] || {}), ...patch, updated_at: new Date().toISOString() };
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2), "utf8");
  } catch (e) {}
}

const CONSOLE_SHELL_NAMES = new Set([
  "cmd.exe",
  "powershell.exe",
  "pwsh.exe",
  "conhost.exe",
  "openconsole.exe",
  "wt.exe",
]);

function isConsoleIgnored(name) {
  return CONSOLE_SHELL_NAMES.has(name.toLowerCase());
}

function resolveDeepestChild(rootPid) {
  if (!getProcessTreeSnapshot) return { pid: rootPid, name: "cmd.exe" };
  try {
    const procs = getProcessTreeSnapshot();
    const childrenMap = new Map();
    const infoMap = new Map();

    for (const p of procs) {
      infoMap.set(p.pid, p.name);
      if (!childrenMap.has(p.ppid)) childrenMap.set(p.ppid, []);
      childrenMap.get(p.ppid).push(p.pid);
    }

    let current = rootPid;
    let iterations = 0;
    while (iterations++ < 20) {
      const kids = childrenMap.get(current);
      if (!kids || kids.length === 0) break;
      const nonShell = kids.find((k) => !isConsoleIgnored(infoMap.get(k) || ""));
      current = nonShell || kids[kids.length - 1];
    }
    return { pid: current, name: infoMap.get(current) || "cmd.exe" };
  } catch (_) {
    return { pid: rootPid, name: "cmd.exe" };
  }
}

// ── Main Runner Execution ──────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  const PANE_DATA_DIR = path.join(DATA_DIR, "panes", opts.id);
  try {
    fs.mkdirSync(PANE_DATA_DIR, { recursive: true });
  } catch (e) {}

  const FLIGHT_LOG = path.join(PANE_DATA_DIR, "flight.log");
  try {
    fs.writeFileSync(FLIGHT_LOG, `[${new Date().toISOString()}] [AGY] Cockpit pane started: ${opts.id}\n`, "utf8");
  } catch (e) {}

  // Set terminal window title
  process.stdout.write(`\x1b]0;⚡ ${opts.title} [${opts.id}]\x07`);

  const startTime = Date.now();
  let lastActivityTimestamp = Date.now();
  const outputBuffer = [];
  const MAX_BUFFER = 2000;
  const waitListeners = [];
  let isSuspended = false;
  let exitCode = null;

  // Environment setup for child shell
  const childEnv = {
    ...process.env,
    AGY_PANE_ID: opts.id,
    AGY_PANE_TITLE: opts.title,
    AGY_SESSION_ID: opts.sessionId,
    FORCE_COLOR: "1",
    TERM: "xterm-256color",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
  };

  if (opts.sanitizeProxy) {
    delete childEnv.HTTP_PROXY;
    delete childEnv.HTTPS_PROXY;
    delete childEnv.ALL_PROXY;
    delete childEnv.http_proxy;
    delete childEnv.https_proxy;
    delete childEnv.all_proxy;
  }

  // Remove fixed COLUMNS/LINES overrides so child uses real terminal dimensions
  delete childEnv.COLUMNS;
  delete childEnv.LINES;

  // 2. Launch Root Shell with INHERITED STDIO (Zero Nested ConPTY)
  // Both runner and child share the Windows Terminal console buffer directly!
  // Eliminates double VT rendering, reflow misalignment, and frozen left-margin prefixes!
  const proc = Bun.spawn(["cmd.exe", "/k", "chcp 65001 >nul"], {
    cwd: opts.dir,
    env: childEnv,
    stdio: ["inherit", "inherit", "inherit"],
  });

  // Ignore Ctrl+C in runner process so runner does not terminate on Ctrl+C
  cio.ignoreCtrlC();
  const rootShellPid = proc.pid;

  // 3. Screen Polling & Buffering Engine
  // Reads the 2D console character grid directly via Win32 ReadConsoleOutputCharacterW
  let latestScreen = { cols: 0, rows: 0, lines: [] };
  let lastKey = "";
  let settleAt = 0;
  let committed = [];

  function pushLine(l) {
    outputBuffer.push(l);
    if (outputBuffer.length > MAX_BUFFER) {
      outputBuffer.shift();
    }
    try {
      fs.appendFileSync(FLIGHT_LOG, l + "\n", { encoding: "utf8" });
    } catch (_) {}
  }

  function pollScreen() {
    const snap = cio.readScreen();
    if (!snap) return;
    latestScreen = snap;
    const key = snap.lines.join("\n");
    const now = Date.now();

    if (key !== lastKey) {
      lastKey = key;
      lastActivityTimestamp = now;
      settleAt = now + 300; // Screen is mutating; settle timer reset

      // Fire active waitListeners on live screen matching
      for (let i = waitListeners.length - 1; i >= 0; i--) {
        const hit = snap.lines.find((l) => waitListeners[i].rx.test(l));
        if (hit) {
          waitListeners[i].resolve({ matched: true, text: hit, lines: snap.lines });
          waitListeners.splice(i, 1);
        }
      }
    } else if (settleAt && now >= settleAt) {
      // Screen settled for 300ms: commit new non-duplicate rows to log and outputBuffer
      const seen = new Set(committed);
      for (const l of snap.lines) {
        const trimmed = l.trimEnd();
        if (trimmed.length > 0 && !seen.has(trimmed)) {
          pushLine(trimmed);
        }
      }
      committed = snap.lines.map((l) => l.trimEnd());
      settleAt = 0;
    }
  }

  const screenPoller = setInterval(pollScreen, 120);

  // Pre-register active state in registry
  updateRegistry(opts.id, {
    id: opts.id,
    title: opts.title,
    command: opts.cmd,
    session_id: opts.sessionId,
    dir: opts.dir,
    pid: process.pid,
    child_pid: rootShellPid,
    active_child_pid: rootShellPid,
    active_child_name: "cmd.exe",
    flight_log: FLIGHT_LOG,
    status: "running",
    started_at: new Date().toISOString(),
  });

  // 4. Smart Initial Command Injection via Synthetic Keyboard Events
  const trimmedInitialCmd = (opts.cmd || "").trim();
  if (trimmedInitialCmd && trimmedInitialCmd.toLowerCase() !== "cmd" && trimmedInitialCmd.toLowerCase() !== "cmd.exe") {
    let autoTyped = false;
    const triggerAutoType = async () => {
      if (autoTyped) return;
      autoTyped = true;
      const cleanCmd = trimmedInitialCmd.replace(/^&\s*/, "");
      await cio.typeText(cleanCmd, { submit: true });
    };

    // Wait for the prompt '>' to appear on screen
    waitListeners.push({
      rx: />\s*$/,
      resolve: () => {
        setTimeout(triggerAutoType, 100);
      },
    });

    // Fallback timer: auto-type after 1500ms if prompt listener didn't catch it
    setTimeout(triggerAutoType, 1500);
  }

  // 5. HTTP IPC Server for Programmatic Agent Control
  const authToken = "auth-" + Math.random().toString(36).substring(2, 10);
  const ipcServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    function sendJson(status, data) {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    }

    // 5.0 Auth Token Verification
    const authHeader = req.headers["authorization"] || req.headers["x-auth-token"] || "";
    const tokenProvided = authHeader.replace(/^Bearer\s+/i, "").trim() || url.searchParams.get("token") || "";
    if (authToken && tokenProvided !== authToken) {
      sendJson(401, { ok: false, error: "Unauthorized: Invalid or missing auth token" });
      return;
    }

    function readBody(cb) {
      const chunks = [];
      req.on("data", (chunk) => { chunks.push(chunk); });
      req.on("end", () => {
        try {
          const bodyStr = Buffer.concat(chunks).toString("utf8");
          cb(bodyStr ? JSON.parse(bodyStr) : {});
        } catch (e) {
          sendJson(400, { ok: false, error: "Invalid JSON body" });
        }
      });
    }

    // 5.1 POST /input - Inject text via synthetic Win32 keyboard events
    if (req.method === "POST" && pathname === "/input") {
      readBody(async (data) => {
        const text = data.text !== undefined ? String(data.text) : "";
        const shouldSubmit = data.submit === true || data.addNewline === true;
        const deepest = resolveDeepestChild(rootShellPid);
        const atShell = /^(cmd|powershell|pwsh)\.exe$/i.test(deepest.name || "");
        // Do NOT send bracketed paste to cmd.exe/powershell as they do not understand it
        const usePaste = data.paste ?? (!atShell && (text.length > 2 || text.includes("\n")));

        try {
          fs.appendFileSync(FLIGHT_LOG, `\n>>> [STDIN INJECTED]: ${text}${shouldSubmit ? " [ENTER]" : ""}${usePaste ? " [PASTE]" : ""}\n`, { encoding: "utf8" });
        } catch (_) {}

        await cio.typeText(text, { paste: usePaste, submit: shouldSubmit });
        lastActivityTimestamp = Date.now();

        sendJson(200, {
          ok: true,
          delivered: true,
          length: text.length,
          submitted: shouldSubmit,
          pasted: usePaste,
        });
      });
      return;
    }

    // 5.1b POST /resize - Geometry query/sync (Windows Terminal owns geometry natively)
    if (req.method === "POST" && pathname === "/resize") {
      const snap = cio.readScreen() || latestScreen;
      sendJson(200, { ok: true, cols: snap.cols, rows: snap.rows });
      return;
    }

    // 5.1c POST /repaint - Force console screen buffer refresh
    if (req.method === "POST" && pathname === "/repaint") {
      process.stdout.write("\x1b[2J\x1b[H");
      const snap = cio.readScreen() || latestScreen;
      sendJson(200, { ok: true, repainted: true, cols: snap.cols, rows: snap.rows });
      return;
    }

    // 5.2 POST /key - Virtual key event injection via Win32 WriteConsoleInputW
    if (req.method === "POST" && pathname === "/key") {
      readBody(async (data) => {
        const key = String(data.key || "").toLowerCase().trim();
        await cio.pressKey(key);
        lastActivityTimestamp = Date.now();
        sendJson(200, { ok: true, key: data.key, delivered: true });
      });
      return;
    }

    // 5.2b GET /screen - Direct 2D Screen Buffer Extraction
    if (req.method === "GET" && pathname === "/screen") {
      const snap = cio.readScreen() || latestScreen;
      sendJson(200, { ok: true, ...snap });
      return;
    }

    // 5.3 GET /output - Scrape buffer with Clean Mode
    if (req.method === "GET" && pathname === "/output") {
      const linesReq = parseInt(url.searchParams.get("lines") || "30", 10);
      const cleanMode = url.searchParams.get("clean") !== "false";

      let source = outputBuffer.length > 0 ? outputBuffer : latestScreen.lines;
      let sliced = source.slice(-linesReq);
      if (cleanMode) {
        sliced = cleanTerminalLines(sliced);
      }

      sendJson(200, {
        ok: true,
        lines: sliced,
        total_buffered: outputBuffer.length,
        clean_mode: cleanMode,
        last_activity_age_seconds: Math.round((Date.now() - lastActivityTimestamp) / 1000),
      });
      return;
    }

    // 5.4 POST /wait - Event-driven pattern gating
    if (req.method === "POST" && pathname === "/wait") {
      readBody((data) => {
        const patternStr = data.pattern;
        const timeoutMs = typeof data.timeout_ms === "number" ? data.timeout_ms : 15000;
        if (!patternStr) {
          sendJson(400, { ok: false, error: "Pattern is required" });
          return;
        }

        let rx;
        try {
          rx = new RegExp(patternStr, "i");
        } catch (e) {
          sendJson(400, { ok: false, error: "Invalid regex pattern" });
          return;
        }

        // Check if pattern matches current screen immediately
        const snap = cio.readScreen() || latestScreen;
        for (const l of snap.lines) {
          if (rx.test(l)) {
            sendJson(200, { ok: true, matched: true, text: l, immediate: true });
            return;
          }
        }

        let timer = null;
        const listenerObj = {
          rx,
          resolve: (resObj) => {
            if (timer) clearTimeout(timer);
            sendJson(200, { ok: true, ...resObj, immediate: false });
          },
        };

        timer = setTimeout(() => {
          const idx = waitListeners.indexOf(listenerObj);
          if (idx !== -1) waitListeners.splice(idx, 1);
          sendJson(408, { ok: false, error: `Timeout waiting for pattern '${patternStr}' after ${timeoutMs}ms` });
        }, timeoutMs);

        waitListeners.push(listenerObj);
      });
      return;
    }

    // 5.4b POST /wait_idle - Event-driven quiescence gating
    if (req.method === "POST" && pathname === "/wait_idle") {
      readBody((data) => {
        const idleMs = typeof data.idle_ms === "number" ? Math.max(100, data.idle_ms) : 1500;
        const timeoutMs = typeof data.timeout_ms === "number" ? Math.max(500, data.timeout_ms) : 30000;
        const reqStartTime = Date.now();

        const currentSilence = Date.now() - lastActivityTimestamp;
        if (currentSilence >= idleMs) {
          sendJson(200, {
            ok: true,
            quiescent: true,
            quiet_ms: currentSilence,
            elapsed_ms: 0,
            immediate: true,
          });
          return;
        }

        let checkInterval = null;
        let timeoutTimer = null;

        const cleanup = () => {
          if (checkInterval) clearInterval(checkInterval);
          if (timeoutTimer) clearTimeout(timeoutTimer);
        };

        checkInterval = setInterval(() => {
          const silence = Date.now() - lastActivityTimestamp;
          if (silence >= idleMs) {
            cleanup();
            sendJson(200, {
              ok: true,
              quiescent: true,
              quiet_ms: silence,
              elapsed_ms: Date.now() - reqStartTime,
              immediate: false,
            });
          }
        }, 100);

        timeoutTimer = setTimeout(() => {
          cleanup();
          const silence = Date.now() - lastActivityTimestamp;
          sendJson(408, {
            ok: false,
            error: `Timeout waiting for idle quiescence (${idleMs}ms silence) after ${timeoutMs}ms`,
            quiet_ms: silence,
            elapsed_ms: Date.now() - reqStartTime,
          });
        }, timeoutMs);
      });
      return;
    }

    // 5.5 POST /suspend - Freeze active child process
    if (req.method === "POST" && pathname === "/suspend") {
      const deepest = resolveDeepestChild(rootShellPid);
      const targetPid = deepest.pid !== rootShellPid ? deepest.pid : rootShellPid;
      let ok = false;
      if (win32Suspend) {
        ok = win32Suspend(targetPid);
      }
      isSuspended = true;
      updateRegistry(opts.id, { status: "suspended" });
      sendJson(200, { ok, status: "suspended", pid: targetPid, name: deepest.name });
      return;
    }

    // 5.6 POST /resume - Resume active child process
    if (req.method === "POST" && pathname === "/resume") {
      const deepest = resolveDeepestChild(rootShellPid);
      const targetPid = deepest.pid !== rootShellPid ? deepest.pid : rootShellPid;
      let ok = false;
      if (win32Resume) {
        ok = win32Resume(targetPid);
      }
      isSuspended = false;
      updateRegistry(opts.id, { status: "running" });
      sendJson(200, { ok, status: "running", pid: targetPid, name: deepest.name });
      return;
    }

    // 5.7 POST /clear - Clear buffer and reset terminal screen
    if (req.method === "POST" && pathname === "/clear") {
      outputBuffer.length = 0;
      committed = [];
      process.stdout.write("\x1b[2J\x1b[H");
      sendJson(200, { ok: true, cleared: true });
      return;
    }

    // 5.7b POST /restart - Restart child command in place inside persistent shell
    if (req.method === "POST" && pathname === "/restart") {
      readBody(async (data) => {
        const cmdToRun = (data && data.command) ? String(data.command).trim() : (opts.cmd || "").trim();
        try {
          await cio.pressKey("ctrl+c");
          await new Promise((r) => setTimeout(r, 200));

          if (cmdToRun && cmdToRun.toLowerCase() !== "cmd" && cmdToRun.toLowerCase() !== "cmd.exe") {
            await cio.typeText(cmdToRun, { submit: true });
          }

          const newDeepest = resolveDeepestChild(rootShellPid);
          sendJson(200, { ok: true, restarted: true, command: cmdToRun, child_pid: newDeepest.pid });
        } catch (err) {
          sendJson(500, { ok: false, error: err.message });
        }
      });
      return;
    }

    // 5.8 GET /status - Rich Status Report
    if (req.method === "GET" && pathname === "/status") {
      const deepest = resolveDeepestChild(rootShellPid);
      const uptimeSec = Math.round((Date.now() - startTime) / 1000);
      const lastActSec = Math.round((Date.now() - lastActivityTimestamp) / 1000);
      const memMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);
      const deepestName = (deepest.name || "").toLowerCase().trim();
      const isIdle = deepest.pid === rootShellPid || deepestName === "cmd.exe" || isConsoleIgnored(deepestName);
      const currentStatus = isSuspended ? "suspended" : (isIdle ? "idle_at_prompt" : "running");
      const snap = cio.readScreen() || latestScreen;

      sendJson(200, {
        ok: true,
        id: opts.id,
        title: opts.title,
        session_id: opts.sessionId,
        status: currentStatus,
        pid: process.pid,
        child_pid: rootShellPid,
        active_child_pid: deepest.pid,
        active_child_name: deepest.name,
        cols: snap.cols,
        rows: snap.rows,
        uptime_seconds: uptimeSec,
        last_activity_age_seconds: lastActSec,
        buffer_lines: outputBuffer.length,
        memory_usage_mb: memMb,
        flight_log: FLIGHT_LOG,
      });
      return;
    }

    // 5.9 POST /kill - Kill persistent session and terminate pane
    if (req.method === "POST" && pathname === "/kill") {
      try {
        await cio.typeText("exit", { submit: true });
        proc.kill();
      } catch (e) {}
      if (screenPoller) clearInterval(screenPoller);
      try { ipcServer.close(); } catch (e) {}
      updateRegistry(opts.id, { status: "killed", ended_at: new Date().toISOString() });
      sendJson(200, { ok: true, killed: true });
      setTimeout(() => process.exit(0), 50);
      return;
    }

    sendJson(404, { ok: false, error: "Endpoint not found" });
  });

  // Helper to find an open port in assigned Antigravity range 8800-8899
  async function findAgyPort(min = 8800, max = 8899) {
    for (let p = min; p <= max; p++) {
      const isFree = await new Promise((res) => {
        const s = net.createServer();
        s.once("error", () => res(false));
        s.once("listening", () => s.close(() => res(true)));
        s.listen(p, "127.0.0.1");
      });
      if (isFree) return p;
    }
    throw new Error(`[AGY Pane Runner] No available ports in assigned range ${min}-${max}`);
  }

  // Start IPC server on assigned Antigravity port range (8800-8899)
  const assignedPort = await findAgyPort();
  await new Promise((resolve) => {
    ipcServer.listen(assignedPort, "127.0.0.1", () => {
      const port = ipcServer.address().port;
      updateRegistry(opts.id, {
        id: opts.id,
        title: opts.title,
        command: opts.cmd,
        session_id: opts.sessionId,
        dir: opts.dir,
        pid: process.pid,
        child_pid: rootShellPid,
        active_child_pid: rootShellPid,
        active_child_name: "cmd.exe",
        ipc_port: port,
        auth_token: authToken,
        flight_log: FLIGHT_LOG,
        status: "running",
        started_at: new Date().toISOString(),
        uptime_seconds: 0,
        last_activity_age_seconds: 0,
        memory_usage_mb: (process.memoryUsage().rss / (1024 * 1024)).toFixed(1),
        auto_close: opts.autoClose,
        pause_on_error: opts.pauseOnError,
      });
      resolve();
    });
  });

  // 7. Await persistent root shell exit (only occurs when user types 'exit' or process is killed)
  await proc.exited;

  if (screenPoller) clearInterval(screenPoller);
  try { ipcServer.close(); } catch (_) {}
  const durSec = ((Date.now() - startTime) / 1000).toFixed(2);
  const finalExitCode = proc.exitCode ?? 0;

  updateRegistry(opts.id, {
    status: finalExitCode === 0 ? "completed" : "failed",
    exit_code: finalExitCode,
    ended_at: new Date().toISOString(),
    duration_seconds: parseFloat(durSec),
    uptime_seconds: Math.round(parseFloat(durSec)),
  });

  // Respect pauseOnError: if non-zero exit and keepOnError is true, hold console open for review
  if (finalExitCode !== 0 && opts.keepOnError) {
    console.log(`\n\x1b[31m[AGY] Shell exited with code ${finalExitCode}. (keepOnError: holding pane open for review)\x1b[0m`);
    console.log(`\x1b[90mPress Ctrl+C or close tab to dismiss.\x1b[0m\n`);
    await new Promise(() => {});
  }

  // Respect autoClose: if autoClose is false on clean exit, hold open
  if (!opts.autoClose && finalExitCode === 0) {
    console.log(`\n\x1b[32m[AGY] Shell exited cleanly. (autoClose: false — holding pane open)\x1b[0m\n`);
    await new Promise(() => {});
  }

  // Default: exit cleanly so Windows Terminal immediately closes and disappears the split pane!
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Cockpit Pane Runner fatal error:", err);
    process.exit(1);
  });
}

module.exports = {
  stripAnsi,
  vt100ChunkToLines,
  cleanTerminalLines,
};
