const { spawn, spawnSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");

// pane_manager.js - Antigravity Cockpit Full-Duplex Auto-Splitting Pane Engine
// Location: ~/.gemini/skills/pane-controller/engine/pane_manager.js
// Managed by Albedo for Dr. Ahmed

const DATA_DIR = path.resolve(__dirname, "..", "data");
const REGISTRY_FILE = path.join(DATA_DIR, "pane_registry.json");
const RUNNER_SCRIPT = path.join(__dirname, "pane_runner.js");
const PANES_DIR = path.join(DATA_DIR, "panes");
const BUN_EXE = "C:\\Users\\ahmed\\.bun\\bin\\bun.exe";
function getRealWtPath() {
  const alias = path.join(
    process.env.LOCALAPPDATA || "C:\\Users\\ahmed\\AppData\\Local",
    "Microsoft",
    "WindowsApps",
    "wt.exe"
  );
  if (fs.existsSync(alias)) return alias;

  try {
    const wtDir = "C:\\Program Files\\WindowsApps";
    if (fs.existsSync(wtDir)) {
      const dirs = fs.readdirSync(wtDir).filter(d => d.startsWith("Microsoft.WindowsTerminal_") && d.includes("_x64__"));
      if (dirs.length > 0) {
        dirs.sort().reverse();
        const candidate = path.join(wtDir, dirs[0], "wt.exe");
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch (e) {}

  return "wt.exe";
}
const WT_EXE = getRealWtPath();
const AGY_BRAIN_DIR = path.join(os.homedir(), ".gemini", "antigravity-cli", "brain");

let getPhysicalConsoleSize = null;
try {
  const { dlopen, FFIType, ptr } = require("bun:ffi");
  const kernel32 = dlopen("kernel32.dll", {
    CreateFileW: { args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr], returns: FFIType.ptr },
    GetConsoleScreenBufferInfo: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.bool },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.bool },
  });
  const conoutUtf16 = Buffer.from("CONOUT$\0", "utf16le");
  getPhysicalConsoleSize = () => {
    try {
      const hCon = kernel32.symbols.CreateFileW(ptr(conoutUtf16), 0xC0000000, 3, null, 3, 0, null);
      if (!hCon || hCon === -1n || hCon === 0n) return null;
      const csbi = new Uint8Array(22);
      const ok = kernel32.symbols.GetConsoleScreenBufferInfo(hCon, ptr(csbi));
      kernel32.symbols.CloseHandle(hCon);
      if (ok) {
        const view = new DataView(csbi.buffer);
        const cols = view.getInt16(14, true) - view.getInt16(10, true) + 1;
        const rows = view.getInt16(16, true) - view.getInt16(12, true) + 1;
        if (cols > 0 && rows > 0) return { cols, rows };
      }
    } catch (_) {}
    return null;
  };
} catch (_) {}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function derivePaneStatus(pane) {
  if (!pane) return "unknown";
  if (pane.status === "killed") return "killed";
  if (pane.status === "orphaned") return "orphaned";

  const alive = isPidAlive(pane.pid) || isPidAlive(pane.child_pid);
  if (!alive && pane.status !== "spawning") {
    return pane.exit_code !== undefined ? (pane.exit_code === 0 ? "completed" : "failed") : "closed";
  }
  if (pane.status === "spawning") {
    const createdTime = pane.created_at ? new Date(pane.created_at).getTime() : 0;
    if (Date.now() - createdTime > 15000) return "orphaned";
    return "spawning";
  }
  return pane.status || "running";
}

function reapOrphanPanes(registry) {
  let modified = false;
  const now = Date.now();

  for (const [id, pane] of Object.entries(registry)) {
    // 1. Check for stuck "spawning" state (> 15 seconds without PID / IPC)
    if (pane.status === "spawning") {
      const createdTime = pane.created_at ? new Date(pane.created_at).getTime() : 0;
      if (now - createdTime > 15000) {
        pane.status = "orphaned";
        pane.error = "Spawn timed out — no PID or IPC reported within 15s";
        pane.ended_at = new Date().toISOString();
        modified = true;
      }
    }

    // 2. Check for running/suspended/idle panes whose processes are actually dead
    if (pane.status === "running" || pane.status === "suspended" || pane.status === "idle_at_prompt") {
      const alive = isPidAlive(pane.pid) || isPidAlive(pane.child_pid);
      if (!alive) {
        pane.status = pane.exit_code !== undefined ? (pane.exit_code === 0 ? "completed" : "failed") : "closed";
        if (!pane.ended_at) {
          pane.ended_at = pane.updated_at || new Date().toISOString();
        }
        modified = true;
      }
    }
  }

  // 3. Auto-prune dead/finished panes if registry grows too large (prevent unbounded growth)
  const deadIds = Object.keys(registry).filter((id) => {
    const s = registry[id].status;
    return s === "completed" || s === "failed" || s === "killed" || s === "closed" || s === "orphaned";
  });
  if (deadIds.length > 25) {
    deadIds.sort((a, b) => {
      const ta = new Date(registry[a].ended_at || registry[a].created_at || 0).getTime();
      const tb = new Date(registry[b].ended_at || registry[b].created_at || 0).getTime();
      return ta - tb;
    });
    const toRemove = deadIds.slice(0, deadIds.length - 25);
    for (const remId of toRemove) {
      delete registry[remId];
      modified = true;
    }
  }

  if (modified) {
    saveRegistry(registry);
  }
  return registry;
}

function getRegistry() {
  try {
    if (fs.existsSync(REGISTRY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
      return reapOrphanPanes(parsed);
    }
  } catch (e) {}
  return {};
}

function saveRegistry(data) {
  try {
    fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {}
}

// Low-level HTTP IPC Client to talk to pane_runner.js
async function ipcRequest(paneId, method, requestPath, body = null, timeoutMs = 15000) {
  const registry = getRegistry();
  const pane = registry[paneId];
  if (!pane) {
    throw new Error(`Pane '${paneId}' not found in registry.`);
  }

  const port = pane.ipc_port;
  if (!port) {
    const exitMsg = pane.exit_code !== undefined ? ` (exit code: ${pane.exit_code})` : "";
    const logMsg = pane.flight_log ? ` See flight log: ${pane.flight_log}` : "";
    throw new Error(`Pane '${paneId}' process exited or has no active IPC port${exitMsg}.${logMsg}`);
  }

  return new Promise((resolve, reject) => {
    const postData = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: requestPath,
      method,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...(pane.auth_token ? { "Authorization": `Bearer ${pane.auth_token}` } : {}),
        ...(postData ? { "Content-Length": postData.length } : {}),
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => { chunks.push(chunk); });
      res.on("end", () => {
        const data = Buffer.concat(chunks).toString("utf8");
        try {
          const parsed = JSON.parse(data);
          resolve(parsed);
        } catch (e) {
          resolve({ raw: data, statusCode: res.statusCode });
        }
      });
    });

    req.on("error", (err) => {
      const exitMsg = pane.exit_code !== undefined ? ` (code ${pane.exit_code})` : "";
      const logMsg = pane.flight_log ? ` See flight log: ${pane.flight_log}` : "";
      reject(new Error(`IPC request to pane '${paneId}' failed: process exited or connection refused${exitMsg}.${logMsg}`));
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`IPC request to pane '${paneId}' timed out after ${timeoutMs}ms.`));
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

/**
 * Split active Windows Terminal window and execute command in a dedicated full-duplex pane.
 */
function splitPane(options = {}) {
  const {
    command = "cmd",
    title = "Terminal Shell",
    split = "vertical", // 'vertical' (-V) or 'horizontal' (-H)
    size = 0.45,
    workdir = process.cwd(),
    autoClose = false,
    keepOnError = true,
    interactive = true,
    sanitizeProxy = true,
    sessionId = options.session_id || process.env.AGY_SESSION_ID || "antigravity",
  } = options;

  let finalTitle = String(title || (command === "cmd" ? "Terminal Shell" : command)).trim();
  if (!finalTitle.startsWith("[AGY] ")) {
    finalTitle = `[AGY] ${finalTitle}`;
  }

  const paneId = "pane-" + Date.now().toString(36) + "-" + Math.random().toString(36).substring(2, 6);
  const splitFlag = split.toLowerCase() === "horizontal" || split === "-H" ? "-H" : "-V";
  const sizeRatio = Math.max(0.1, Math.min(0.9, Number(size) || 0.45)).toFixed(2);
  const resolvedDir = path.resolve(workdir);
  const paneDir = path.join(PANES_DIR, paneId);
  const flightLog = path.join(paneDir, "flight.log");

  if (!fs.existsSync(paneDir)) {
    fs.mkdirSync(paneDir, { recursive: true });
  }

  const phys = typeof getPhysicalConsoleSize === "function" ? getPhysicalConsoleSize() : null;
  const parentCols = (process.stdout.isTTY && process.stdout.columns) ? process.stdout.columns : ((phys && phys.cols > 0) ? phys.cols : 130);
  const parentRows = (process.stdout.isTTY && process.stdout.rows) ? process.stdout.rows : ((phys && phys.rows > 0) ? phys.rows : 36);
  const numRatio = parseFloat(sizeRatio);
  const targetCols = splitFlag === "-V" ? Math.max(20, Math.floor(parentCols * numRatio)) : parentCols;
  const targetRows = splitFlag === "-H" ? Math.max(10, Math.floor(parentRows * numRatio)) : parentRows;

  // Pre-write pane config.json for zero-mangling parameter injection
  const paneConfig = {
    id: paneId,
    title: finalTitle,
    command: command || "cmd",
    session_id: sessionId,
    dir: resolvedDir,
    split: splitFlag === "-V" ? "vertical" : "horizontal",
    size: parseFloat(sizeRatio),
    cols: targetCols,
    rows: targetRows,
    auto_close: autoClose,
    pause_on_error: keepOnError,
    sanitize_proxy: sanitizeProxy,
    interactive,
  };
  fs.writeFileSync(path.join(paneDir, "config.json"), JSON.stringify(paneConfig, null, 2), "utf8");

  // Canonical split-pane: ALWAYS use -w 0 to split in the current active window beside the current session
  const windowArgs = ["-w", "0"];

  const wtArgs = [
    ...windowArgs,
    "split-pane",
    splitFlag,
    "-s",
    sizeRatio,
    "-d",
    resolvedDir,
    "--",
    BUN_EXE,
    RUNNER_SCRIPT,
    "--id",
    paneId,
  ];

  // Pre-register pane
  const registry = getRegistry();
  registry[paneId] = {
    ...paneConfig,
    status: "spawning",
    flight_log: flightLog,
    created_at: new Date().toISOString(),
  };
  saveRegistry(registry);

  // Execute wt.exe targeting WinSta0\Default desktop via standalone bridge
  const SPAWN_HELPER = path.join(__dirname, "..", "scripts", "spawn_wt.py");
  const pythonBin = process.env.PYTHON || (fs.existsSync("C:\\Python314\\python.exe") ? "C:\\Python314\\python.exe" : "python.exe");
  spawnSync(pythonBin, [SPAWN_HELPER, "wt.exe", ...wtArgs], {
    stdio: "ignore",
    windowsHide: true,
  });

  return {
    ok: true,
    pane_id: paneId,
    title: finalTitle,
    command,
    split: splitFlag === "-V" ? "vertical" : "horizontal",
    size: parseFloat(sizeRatio),
    workdir: resolvedDir,
    flight_log: flightLog,
    auto_close: autoClose,
    keep_on_error: keepOnError,
    sanitize_proxy: sanitizeProxy,
  };
}

/**
 * Resolves a pane record by pane_id, title, or alias (case-insensitive & substring match).
 * Allows effortless multi-split control (e.g. targeting "hermes", "agy", "backend", etc.).
 */
function resolvePane(target) {
  if (!target) return null;
  const registry = getRegistry();
  const q = String(target).trim().toLowerCase();

  // 1. Direct ID match
  if (registry[target]) return registry[target];

  // 2. Case-insensitive ID match
  for (const [id, p] of Object.entries(registry)) {
    if (id.toLowerCase() === q) return p;
  }

  // 3. Exact title match (case-insensitive)
  for (const [id, p] of Object.entries(registry)) {
    if ((p.title || "").toLowerCase() === q) return p;
  }

  // 4. Substring ID match
  for (const [id, p] of Object.entries(registry)) {
    if (id.toLowerCase().includes(q)) return p;
  }

  // 5. Substring title match
  for (const [id, p] of Object.entries(registry)) {
    if ((p.title || "").toLowerCase().includes(q)) return p;
  }

  return null;
}

/**
 * Send text input into child stdin (opt-in submit, default: false).
 */
async function sendInput(target, text, submitOrAddNewline = false, paste = null) {
  const pane = resolvePane(target);
  if (!pane) {
    throw new Error(`Pane '${target}' not found in registry.`);
  }
  const paneId = pane.id;

  const derived = derivePaneStatus(pane);
  if (derived === "completed" || derived === "failed" || derived === "killed" || derived === "closed" || derived === "orphaned") {
    const exitMsg = pane.exit_code !== undefined ? ` (code ${pane.exit_code})` : "";
    const durMsg = pane.duration_seconds ? ` after ${pane.duration_seconds}s` : "";
    const logMsg = pane.flight_log ? ` See flight log: ${pane.flight_log}` : "";
    throw new Error(`Cannot send input: pane '${paneId}' process has already exited${exitMsg}${durMsg}.${logMsg}`);
  }

  const shouldSubmit = submitOrAddNewline === true;
  const shouldPaste = paste !== null ? Boolean(paste) : (text.length > 2 || text.includes("\n"));
  try {
    const res = await ipcRequest(paneId, "POST", "/input", { text, submit: shouldSubmit, addNewline: shouldSubmit, paste: shouldPaste });
    return { ok: res.ok !== false, pane_id: paneId, delivered: true, text, submitted: shouldSubmit, bracketed: res.bracketed ?? shouldPaste };
  } catch (err) {
    const exitMsg = pane.exit_code !== undefined ? ` (code ${pane.exit_code})` : "";
    const logMsg = pane.flight_log ? ` See flight log: ${pane.flight_log}` : "";
    throw new Error(`Cannot send input: pane '${paneId}' process exited or unreachable${exitMsg}.${logMsg}`);
  }
}

/**
 * Send virtual key event into child (Enter, Ctrl+C, Esc, Tab, Up, Down, etc.).
 */
async function sendKey(target, key) {
  const pane = resolvePane(target);
  if (!pane) {
    throw new Error(`Pane '${target}' not found in registry.`);
  }
  const paneId = pane.id;

  const derived = derivePaneStatus(pane);
  if (derived === "completed" || derived === "failed" || derived === "killed" || derived === "closed" || derived === "orphaned") {
    const exitMsg = pane.exit_code !== undefined ? ` (code ${pane.exit_code})` : "";
    const durMsg = pane.duration_seconds ? ` after ${pane.duration_seconds}s` : "";
    const logMsg = pane.flight_log ? ` See flight log: ${pane.flight_log}` : "";
    throw new Error(`Cannot send key: pane '${paneId}' process has already exited${exitMsg}${durMsg}.${logMsg}`);
  }

  try {
    const res = await ipcRequest(paneId, "POST", "/key", { key });
    return { ok: res.ok !== false, pane_id: paneId, key, delivered: true };
  } catch (err) {
    const exitMsg = pane.exit_code !== undefined ? ` (code ${pane.exit_code})` : "";
    const logMsg = pane.flight_log ? ` See flight log: ${pane.flight_log}` : "";
    throw new Error(`Cannot send key: pane '${paneId}' process exited or unreachable${exitMsg}.${logMsg}`);
  }
}

/**
 * Read last N output lines with Clean Mode (strip ANSI, collapse spinners, resolve \r).
 */
async function readOutput(target, lines = 30, clean = true) {
  const pane = resolvePane(target);
  if (!pane) {
    throw new Error(`Pane '${target}' not found in registry.`);
  }
  const paneId = pane.id;

  // 1. Try IPC Live if port exists
  if (pane.ipc_port) {
    try {
      const res = await ipcRequest(paneId, "GET", `/output?lines=${lines}&clean=${clean}&strip_ansi=true`, null, 2500);
      return {
        ok: true,
        pane_id: paneId,
        lines: res.lines || [],
        total_buffered: res.total_buffered || 0,
        clean_mode: res.clean_mode !== false,
        last_activity_age_seconds: res.last_activity_age_seconds,
        source: "ipc_live",
      };
    } catch (e) {
      // IPC live unreachable, seamlessly fall back to flight log
    }
  }

  // 2. Flight log fallback (process finished, closed, or IPC unreachable)
  if (pane.flight_log && fs.existsSync(pane.flight_log)) {
    try {
      const raw = fs.readFileSync(pane.flight_log, "utf8");
      const allLines = raw.split(/\r?\n/).filter(Boolean);
      const sliced = allLines.slice(-lines);
      const runner = require("./pane_runner.js");
      const cleanLines = clean
        ? (runner.cleanTerminalLines ? runner.cleanTerminalLines(sliced) : sliced.map(runner.stripAnsi))
        : sliced;
      const exitMsg = pane.exit_code !== undefined ? ` (exit code: ${pane.exit_code})` : "";
      return {
        ok: true,
        pane_id: paneId,
        lines: cleanLines,
        total_buffered: allLines.length,
        clean_mode: clean,
        source: `flight_log${exitMsg}`,
      };
    } catch (e) {}
  }

  // 3. Neither IPC nor flight log available
  const exitMsg = pane.exit_code !== undefined ? ` (code ${pane.exit_code})` : "";
  const logMsg = pane.flight_log ? ` See flight log: ${pane.flight_log}` : "";
  throw new Error(`Cannot read output: pane '${paneId}' process exited and no log buffer is available${exitMsg}.${logMsg}`);
}

/**
 * Direct 2D Screen Buffer Extraction from Windows Terminal CONOUT$ via IPC.
 */
async function readScreen(target) {
  const pane = resolvePane(target);
  if (!pane) {
    throw new Error(`Pane '${target}' not found in registry.`);
  }
  const paneId = pane.id;

  if (pane.ipc_port) {
    try {
      const res = await ipcRequest(paneId, "GET", "/screen", null, 2500);
      return {
        ok: true,
        pane_id: paneId,
        cols: res.cols || 80,
        rows: res.rows || 25,
        cursor: res.cursor || { x: 0, y: 0 },
        lines: res.lines || [],
        source: "ipc_screen",
      };
    } catch (e) {
      // IPC failed, fallback to flight log
    }
  }

  // Fallback: read flight log tail
  if (pane.flight_log && fs.existsSync(pane.flight_log)) {
    try {
      const raw = fs.readFileSync(pane.flight_log, "utf8");
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const exitMsg = pane.exit_code !== undefined ? ` (exit code: ${pane.exit_code})` : "";
      return {
        ok: true,
        pane_id: paneId,
        cols: 80,
        rows: Math.min(lines.length, 30),
        cursor: { x: 0, y: lines.length },
        lines: lines.slice(-30),
        source: `flight_log${exitMsg}`,
      };
    } catch (e) {}
  }

  const exitMsg = pane.exit_code !== undefined ? ` (code ${pane.exit_code})` : "";
  const logMsg = pane.flight_log ? ` See flight log: ${pane.flight_log}` : "";
  throw new Error(`Cannot read screen: pane '${paneId}' has no active IPC port and no log buffer${exitMsg}.${logMsg}`);
}

/**
 * Wait for a regex pattern in the output stream with timeout.
 */
async function waitForPattern(target, pattern, timeoutMs = 15000) {
  const pane = resolvePane(target);
  if (!pane) {
    throw new Error(`Pane '${target}' not found in registry.`);
  }
  const paneId = pane.id;

  const derived = derivePaneStatus(pane);
  if (derived === "completed" || derived === "failed" || derived === "killed" || derived === "closed" || derived === "orphaned") {
    // If pane already exited, check if pattern matches flight log
    if (pane.flight_log && fs.existsSync(pane.flight_log)) {
      try {
        const raw = fs.readFileSync(pane.flight_log, "utf8");
        const rx = new RegExp(pattern, "i");
        const lines = raw.split(/\r?\n/);
        for (const l of lines.slice(-50)) {
          if (rx.test(l)) {
            return { ok: true, pane_id: paneId, matched: true, text: l.trim(), immediate: true, source: "flight_log" };
          }
        }
      } catch (e) {}
    }
    const exitMsg = pane.exit_code !== undefined ? ` (code ${pane.exit_code})` : "";
    const logMsg = pane.flight_log ? ` See flight log: ${pane.flight_log}` : "";
    throw new Error(`Cannot wait for pattern: pane '${paneId}' process has already exited${exitMsg}.${logMsg}`);
  }

  try {
    const res = await ipcRequest(paneId, "POST", "/wait", { pattern, timeout_ms: timeoutMs }, timeoutMs + 2000);
    return {
      ok: res.ok !== false,
      pane_id: paneId,
      matched: res.matched || false,
      text: res.text || "",
      immediate: res.immediate || false,
    };
  } catch (err) {
    const exitMsg = pane.exit_code !== undefined ? ` (code ${pane.exit_code})` : "";
    const logMsg = pane.flight_log ? ` See flight log: ${pane.flight_log}` : "";
    throw new Error(`Wait for pattern failed on pane '${paneId}': process exited or timed out${exitMsg}.${logMsg}`);
  }
}

/**
 * Wait for process quiescence / silence in output stream (idle_ms of continuous silence).
 */
async function waitForIdle(target, idleMs = 1500, timeoutMs = 30000) {
  const pane = resolvePane(target);
  if (!pane) {
    throw new Error(`Pane '${target}' not found in registry.`);
  }
  const paneId = pane.id;

  const derived = derivePaneStatus(pane);
  if (derived === "completed" || derived === "failed" || derived === "killed" || derived === "closed" || derived === "orphaned") {
    return { ok: true, pane_id: paneId, quiescent: true, quiet_ms: 999999, elapsed_ms: 0, immediate: true, source: "exited" };
  }

  try {
    const res = await ipcRequest(paneId, "POST", "/wait_idle", { idle_ms: idleMs, timeout_ms: timeoutMs }, timeoutMs + 2000);
    return {
      ok: res.ok !== false,
      pane_id: paneId,
      quiescent: res.quiescent || false,
      quiet_ms: res.quiet_ms || idleMs,
      elapsed_ms: res.elapsed_ms || 0,
      immediate: res.immediate || false,
    };
  } catch (err) {
    const exitMsg = pane.exit_code !== undefined ? ` (code ${pane.exit_code})` : "";
    const logMsg = pane.flight_log ? ` See flight log: ${pane.flight_log}` : "";
    throw new Error(`Wait for idle failed on pane '${paneId}': ${err.message}${exitMsg}.${logMsg}`);
  }
}

/**
 * Freeze/suspend process tree.
 */
async function suspendPane(target) {
  const pane = resolvePane(target);
  if (!pane) throw new Error(`Pane '${target}' not found in registry.`);
  const res = await ipcRequest(pane.id, "POST", "/suspend");
  return { ok: res.ok !== false, pane_id: pane.id, status: "suspended" };
}

/**
 * Resume/unfreeze process tree.
 */
async function resumePane(target) {
  const pane = resolvePane(target);
  if (!pane) throw new Error(`Pane '${target}' not found in registry.`);
  const res = await ipcRequest(pane.id, "POST", "/resume");
  return { ok: res.ok !== false, pane_id: pane.id, status: "running" };
}

/**
 * Restart child command in place inside the same pane.
 */
async function restartPane(target, command = null) {
  const pane = resolvePane(target);
  if (!pane) throw new Error(`Pane '${target}' not found in registry.`);
  const body = command ? { command: String(command) } : {};
  const res = await ipcRequest(pane.id, "POST", "/restart", body);
  return { ok: res.ok !== false, pane_id: pane.id, status: "restarted", child_pid: res.child_pid, command: res.command || command || pane.command };
}

/**
 * Focus pane in Windows Terminal.
 */
function focusPane(directionOrTarget = "next") {
  const dir = String(directionOrTarget).toLowerCase().trim();
  const validDirs = ["left", "right", "up", "down", "previous", "next", "first"];
  const wt = fs.existsSync(WT_EXE) ? WT_EXE : "wt.exe";

  try {
    if (validDirs.includes(dir)) {
      execSync(`"${wt}" -w 0 move-focus ${dir}`, { stdio: "ignore" });
    } else {
      execSync(`"${wt}" -w 0 focus-pane -t ${dir}`, { stdio: "ignore" });
    }
    return { ok: true, focused: directionOrTarget };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Resize pane in Windows Terminal.
 * Note: wt.exe CLI natively sets pane ratio via -s <size> during split-pane.
 * Dynamic in-terminal pane resizing is bound to: Alt + Shift + Arrow keys.
 * Also supports direct PTY geometry sync via POST /resize.
 */
async function resizePane(directionOrTarget = "right", amountOrCols = 15, maybeRows = null) {
  const dir = String(directionOrTarget).toLowerCase().trim();
  const pane = resolvePane(directionOrTarget);

  if (pane) {
    let cols = parseInt(amountOrCols, 10);
    let rows = parseInt(maybeRows, 10);
    try {
      const res = await ipcRequest(pane.id, "POST", "/resize", { cols: cols || 0, rows: rows || 0 });
      return {
        ok: true,
        pane_id: pane.id,
        cols: res.cols,
        rows: res.rows,
        notice: `Terminal geometry synchronized: ${res.cols} cols x ${res.rows} rows.`
      };
    } catch (_) {}
  }

  const amt = Math.max(1, Math.min(100, Number(amountOrCols) || 15));
  return {
    ok: true,
    direction: dir,
    amount: amt,
    notice: `Windows Terminal CLI sets initial pane ratio via -s <size> (e.g. size: 0.35). For live resizing of an open pane, use: Alt + Shift + ${dir.toUpperCase()}`,
  };
}

/**
 * Toggle pane zoom (maximize pane or restore split).
 * Note: Windows Terminal natively binds zoom toggle to: Alt + Shift + +
 */
function toggleZoom() {
  return {
    ok: true,
    notice: "Windows Terminal binds pane zoom toggle to: Alt + Shift + + (Plus)",
  };
}

/**
 * Broadcast text input to multiple running panes simultaneously.
 */
async function broadcastInput(text, paneIds = null, addNewline = true) {
  const registry = getRegistry();
  const targets = Array.isArray(paneIds) && paneIds.length > 0
    ? paneIds
    : Object.keys(registry).filter(id => registry[id].status === "running" && registry[id].ipc_port);

  const results = [];
  for (const id of targets) {
    try {
      await sendInput(id, text, addNewline);
      results.push({ pane_id: id, ok: true });
    } catch (e) {
      results.push({ pane_id: id, ok: false, error: e.message });
    }
  }

  return { ok: true, text, targets_count: targets.length, results };
}

/**
 * Get rich runtime metrics for a pane.
 */
async function getRichStatus(target) {
  const pane = resolvePane(target);
  if (!pane) return null;
  const paneId = pane.id;

  let live = null;
  if (pane.ipc_port) {
    try {
      live = await ipcRequest(paneId, "GET", "/status", null, 2000);
    } catch (e) {
      live = null;
    }
  }

  const isLive = Boolean(live && live.ok);
  const derivedStatus = isLive && live.status ? live.status : derivePaneStatus(pane);

  // Compute robust metrics so none are N/A (Defect 4)
  const startTime = new Date(pane.started_at || pane.created_at || Date.now()).getTime();
  const endTime = pane.ended_at ? new Date(pane.ended_at).getTime() : Date.now();
  const derivedUptime = live && live.uptime_seconds !== undefined
    ? live.uptime_seconds
    : (pane.uptime_seconds !== undefined
        ? pane.uptime_seconds
        : Math.max(0, Math.round((endTime - startTime) / 1000)));

  const derivedLastActive = live && live.last_activity_age_seconds !== undefined
    ? live.last_activity_age_seconds
    : (pane.last_activity_age_seconds !== undefined && isLive
        ? pane.last_activity_age_seconds
        : (pane.ended_at
            ? Math.max(0, Math.round((Date.now() - new Date(pane.ended_at).getTime()) / 1000))
            : (pane.updated_at
                ? Math.max(0, Math.round((Date.now() - new Date(pane.updated_at).getTime()) / 1000))
                : 0)));

  let derivedMemory = live && live.memory_usage_mb
    ? live.memory_usage_mb
    : (pane.memory_usage_mb || null);

  if (!derivedMemory) {
    if (isPidAlive(pane.child_pid) || isPidAlive(pane.pid)) {
      try {
        const targetPid = pane.child_pid || pane.pid;
        const out = execSync(`tasklist /fi "PID eq ${targetPid}" /fo csv /nh`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        const parts = out.trim().split('","');
        if (parts.length >= 5) {
          const memStr = parts[4].replace(/[^\d]/g, "");
          const kb = parseInt(memStr, 10);
          if (!isNaN(kb)) derivedMemory = (kb / 1024).toFixed(1);
        }
      } catch (e) {}
    }
    if (!derivedMemory) {
      derivedMemory = (derivedStatus === "completed" || derivedStatus === "failed" || derivedStatus === "killed" || derivedStatus === "closed" || derivedStatus === "orphaned")
        ? "0.0 (exited)"
        : "N/A";
    }
  }

  // Update pane in registry if status changed
  if (pane.status !== derivedStatus) {
    pane.status = derivedStatus;
    try {
      const reg = getRegistry();
      if (reg[paneId]) {
        reg[paneId].status = derivedStatus;
        saveRegistry(reg);
      }
    } catch (_) {}
  }

  return {
    ...pane,
    ...(live || {}),
    status: derivedStatus,
    uptime_seconds: derivedUptime,
    last_activity_age_seconds: derivedLastActive,
    memory_usage_mb: derivedMemory,
    is_live: isLive,
    is_alive: Boolean(isPidAlive(pane.pid) || isPidAlive(pane.child_pid)),
  };
}

/**
 * AGY / Hermes Transcript Bridge: Extract structured JSON turns with full-text resolution and pagination.
 */
function getTranscript(paneId = null, maxTurns = 10, offset = null, fullText = true) {
  const registry = getRegistry();
  const pane = paneId ? registry[paneId] : null;

  // Find newest transcript in AGY brain directory
  if (!fs.existsSync(AGY_BRAIN_DIR)) {
    return { ok: false, error: "AGY brain directory not found." };
  }

  try {
    const convDirs = fs.readdirSync(AGY_BRAIN_DIR);
    let newestTranscript = null;
    let newestMtime = 0;

    for (const d of convDirs) {
      const transPath = path.join(AGY_BRAIN_DIR, d, ".system_generated", "logs", "transcript.jsonl");
      if (fs.existsSync(transPath)) {
        const mtime = fs.statSync(transPath).mtimeMs;
        if (mtime > newestMtime) {
          newestMtime = mtime;
          newestTranscript = transPath;
        }
      }
    }

    if (!newestTranscript) {
      return { ok: false, error: "No AGY transcript files found." };
    }

    const convLogsDir = path.dirname(newestTranscript);
    const fullTransPath = path.join(convLogsDir, "transcript_full.jsonl");

    // Build step_index map from transcript_full.jsonl if requested and present
    const fullStepMap = new Map();
    if (fullText && fs.existsSync(fullTransPath)) {
      try {
        const fullRaw = fs.readFileSync(fullTransPath, "utf8");
        const fullLines = fullRaw.split(/\r?\n/).filter(Boolean);
        for (const fl of fullLines) {
          try {
            const fObj = JSON.parse(fl);
            if (fObj.step_index !== undefined) {
              fullStepMap.set(fObj.step_index, fObj);
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    const raw = fs.readFileSync(newestTranscript, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const turns = [];

    for (const l of lines) {
      try {
        const item = JSON.parse(l);
        if (item.type === "USER_INPUT" || item.type === "PLANNER_RESPONSE") {
          let content = item.content || "";
          let thinking = item.thinking || "";
          let toolCalls = Array.isArray(item.tool_calls)
            ? item.tool_calls.map(tc => tc.toolAction || tc.toolSummary || tc.name || "tool")
            : [];
          const wasTruncated = Array.isArray(item.truncated_fields) && item.truncated_fields.length > 0;
          let resolvedFull = false;

          // Full text resolution via step_index
          if (fullStepMap.has(item.step_index)) {
            const fullItem = fullStepMap.get(item.step_index);
            if (fullItem.content && (!content || (item.truncated_fields && item.truncated_fields.includes("content")))) {
              content = fullItem.content;
              resolvedFull = true;
            }
            if (fullItem.thinking && (!thinking || (item.truncated_fields && item.truncated_fields.includes("thinking")))) {
              thinking = fullItem.thinking;
              resolvedFull = true;
            }
            if (Array.isArray(fullItem.tool_calls) && fullItem.tool_calls.length > 0) {
              toolCalls = fullItem.tool_calls.map(tc => tc.toolAction || tc.toolSummary || tc.name || "tool");
            }
          }

          turns.push({
            step_index: item.step_index,
            role: item.type === "USER_INPUT" ? "user" : "assistant",
            content,
            content_length: content.length,
            thinking: thinking ? thinking.slice(0, 300) : "",
            toolCalls,
            status: item.status || "DONE",
            created_at: item.created_at,
            was_truncated: wasTruncated,
            resolved_full: resolvedFull,
          });
        }
      } catch (e) {}
    }

    const totalTurns = turns.length;
    let pagedTurns = [];
    if (typeof offset === "number") {
      const start = offset >= 0 ? offset : Math.max(0, totalTurns + offset);
      pagedTurns = turns.slice(start, start + maxTurns);
    } else {
      pagedTurns = turns.slice(-maxTurns);
    }

    return {
      ok: true,
      pane_id: paneId,
      transcript_path: newestTranscript,
      transcript_full_path: fs.existsSync(fullTransPath) ? fullTransPath : null,
      total_turns: totalTurns,
      offset: typeof offset === "number" ? offset : Math.max(0, totalTurns - pagedTurns.length),
      limit: maxTurns,
      full_resolved_count: turns.filter(t => t.resolved_full).length,
      turns: pagedTurns,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * List all known panes and refresh their status.
 */
function listPanes(filterSessionId = null) {
  const registry = getRegistry();
  const list = [];
  let modified = false;

  for (const [id, info] of Object.entries(registry)) {
    if (filterSessionId && info.session_id && info.session_id !== filterSessionId) {
      continue;
    }
    const derivedStatus = derivePaneStatus(info);
    if (info.status !== derivedStatus) {
      info.status = derivedStatus;
      modified = true;
    }

    const startTime = new Date(info.started_at || info.created_at || Date.now()).getTime();
    const endTime = info.ended_at ? new Date(info.ended_at).getTime() : Date.now();
    const dur = info.duration_seconds !== undefined
      ? Math.max(0, info.duration_seconds)
      : Math.max(0, parseFloat(((endTime - startTime) / 1000).toFixed(2)));

    list.push({
      id,
      title: info.title || "Unknown",
      command: info.command || "",
      session_id: info.session_id || "default",
      status: derivedStatus,
      split: info.split || "vertical",
      dir: info.dir || "",
      ipc_port: info.ipc_port || null,
      child_pid: info.child_pid,
      active_child_pid: info.active_child_pid,
      active_child_name: info.active_child_name,
      exit_code: info.exit_code,
      duration: dur,
      started_at: info.started_at || info.created_at,
      ended_at: info.ended_at,
    });
  }

  if (modified) {
    saveRegistry(registry);
  }

  list.sort((a, b) => new Date(b.started_at || 0) - new Date(a.started_at || 0));
  return list;
}

/**
 * Terminate a running pane and cause the split pane to disappear instantly from Windows Terminal.
 */
async function killPane(target) {
  const pane = resolvePane(target);
  if (!pane) {
    return { ok: false, error: `Pane '${target}' not found.` };
  }

  const realId = pane.id;
  let killed = false;

  // 1. Graceful IPC kill: causes pane_runner to terminate cmd.exe and exit with 0 (WT disappears the pane immediately)
  if (pane.ipc_port) {
    try {
      await ipcRequest(realId, "POST", "/kill", {}, 800);
      killed = true;
    } catch (e) {}
  }

  // 2. Short pause for WT to close and disappear the split
  await new Promise(r => setTimeout(r, 150));

  // 3. Fallback: Force kill remaining processes if still alive
  if (pane.child_pid && isPidAlive(pane.child_pid)) {
    try {
      execSync(`taskkill /pid ${pane.child_pid} /t /f`, { stdio: "ignore" });
      killed = true;
    } catch (e) {
      try { process.kill(pane.child_pid, "SIGKILL"); killed = true; } catch (e2) {}
    }
  }
  if (pane.pid && isPidAlive(pane.pid)) {
    // Also kill the parent OpenConsole.exe so Windows Terminal immediately collapses the split pane tab
    try {
      const ppidOut = execSync(`powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pane.pid}'; if ($p) { $parent = Get-CimInstance Win32_Process -Filter \\\"ProcessId = $($p.ParentProcessId)\\\"; if ($parent.Name -like '*OpenConsole*') { $parent.ProcessId } }"`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      const ppid = parseInt(ppidOut, 10);
      if (ppid && !isNaN(ppid)) {
        execSync(`taskkill /pid ${ppid} /f`, { stdio: "ignore" });
      }
    } catch (_) {}

    try {
      execSync(`taskkill /pid ${pane.pid} /t /f`, { stdio: "ignore" });
      killed = true;
    } catch (e) {
      try { process.kill(pane.pid, "SIGKILL"); killed = true; } catch (e2) {}
    }
  }

  pane.status = "killed";
  pane.ended_at = new Date().toISOString();
  const registry = getRegistry();
  registry[realId] = { ...pane };
  saveRegistry(registry);

  return { ok: true, pane_id: realId, title: pane.title, killed };
}

/**
 * Clear inactive / completed panes from registry.
 */
function clearRegistry(onlyFinished = true) {
  const registry = getRegistry();
  const updated = {};
  let removedCount = 0;

  for (const [id, info] of Object.entries(registry)) {
    const isLive = (info.status === "running" || info.status === "suspended") &&
                   (isPidAlive(info.pid) || isPidAlive(info.child_pid));

    if (onlyFinished) {
      if (isLive) {
        updated[id] = info;
      } else {
        removedCount++;
      }
    } else {
      removedCount++;
    }
  }

  saveRegistry(updated);
  return { ok: true, removed: removedCount };
}

module.exports = {
  splitPane,
  sendInput,
  sendKey,
  readOutput,
  readScreen,
  waitForPattern,
  waitForIdle,
  suspendPane,
  resumePane,
  restartPane,
  focusPane,
  resizePane,
  toggleZoom,
  broadcastInput,
  getRichStatus,
  getTranscript,
  listPanes,
  killPane,
  clearRegistry,
};
