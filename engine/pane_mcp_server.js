#!/usr/bin/env bun
"use strict";

// pane_mcp_server.js - Sovereign Windows Terminal Cockpit MCP Server for Antigravity & Albedo
// Direct Win32 Console Driver & Zero Inner ConPTY Architecture
// Managed by Albedo for Dr. Ahmed

const readline = require("readline");
const path = require("path");
const paneManager = require("./pane_manager.js");

const TOOLS = [
  {
    name: "pane_split",
    description: "Launch a new split pane in Windows Terminal running an interactive command/shell (cmd, powershell, nu, bash, opencode, agy, etc.)",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute (e.g. 'cmd', 'powershell -NoLogo', 'nu', 'opencode'). Default: 'cmd'" },
        title: { type: "string", description: "Title for the pane tab/header" },
        split: { type: "string", enum: ["vertical", "horizontal"], default: "vertical", description: "Split direction ('vertical' = side-by-side, 'horizontal' = stacked)" },
        size: { type: "number", minimum: 0.1, maximum: 0.9, default: 0.45, description: "Fraction of the window width/height for the new pane (0.1 to 0.9, default: 0.45)" },
        workdir: { type: "string", description: "Working directory for the pane (default: C:\\Users\\ahmed)" },
        auto_close: { type: "boolean", default: false, description: "Whether to close the pane when command exits with code 0" },
        keep_on_error: { type: "boolean", default: true, description: "Keep pane open if command fails" },
        sanitize_proxy: { type: "boolean", default: true, description: "Strip proxy environment variables to prevent network leaks" },
      },
    },
  },
  {
    name: "pane_send_input",
    description: "Send text input to a pane's standard input via Win32 WriteConsoleInputW",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "ID of the target pane (e.g. 'pane-mvwhj1y7-qxbr')" },
        text: { type: "string", description: "Text to send" },
        submit: { type: "boolean", default: false, description: "Whether to press Enter after text (default: false)" },
        paste: { type: "boolean", description: "Whether to use bracketed paste" },
      },
      required: ["pane_id", "text"],
    },
  },
  {
    name: "pane_send_key",
    description: "Inject a virtual key event into a pane (Enter, Ctrl+C, Esc, Tab, Backspace, Up, Down, Left, Right)",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "ID of the target pane" },
        key: { type: "string", description: "Virtual key name: 'Enter', 'Ctrl+C', 'Esc', 'Tab', 'Backspace', 'Up', 'Down', 'Left', 'Right', 'Home', 'End'" },
      },
      required: ["pane_id", "key"],
    },
  },
  {
    name: "pane_read_output",
    description: "Scrape output lines from a pane's settled buffer with ANSI stripping",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "ID of the target pane" },
        lines: { type: "number", default: 30, description: "Number of tail lines to read (default: 30)" },
        clean: { type: "boolean", default: true, description: "Strip ANSI escape codes and clean artifacts" },
      },
      required: ["pane_id"],
    },
  },
  {
    name: "pane_read_screen",
    description: "Extract the exact 2D character grid directly from the Windows Terminal console buffer (CONOUT$) with zero ANSI noise",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "ID of the target pane" },
      },
      required: ["pane_id"],
    },
  },
  {
    name: "pane_wait_for",
    description: "Block until a regular expression matches lines on the pane screen/output",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "ID of the target pane" },
        pattern: { type: "string", description: "Regex pattern to wait for (e.g. 'Ready', 'Select a command', 'error')" },
        timeout_ms: { type: "number", default: 15000, description: "Timeout in milliseconds (default: 15000)" },
      },
      required: ["pane_id", "pattern"],
    },
  },
  {
    name: "pane_wait_idle",
    description: "Block until the pane terminal has been silent (quiescent) for N milliseconds",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "ID of the target pane" },
        idle_ms: { type: "number", default: 1500, description: "Milliseconds of terminal silence to consider idle (default: 1500)" },
        timeout_ms: { type: "number", default: 30000, description: "Max timeout in milliseconds (default: 30000)" },
      },
      required: ["pane_id"],
    },
  },
  {
    name: "pane_list",
    description: "List all active and historical terminal panes with IDs, statuses, and commands",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Filter by session ID (optional)" },
      },
    },
  },
  {
    name: "pane_status",
    description: "Get rich process telemetry for a pane (PID, child process name, dimensions, memory, uptime, status)",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "ID of the target pane" },
      },
      required: ["pane_id"],
    },
  },
  {
    name: "pane_kill",
    description: "Terminate a pane process and close the split pane in Windows Terminal",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "ID of the target pane" },
      },
      required: ["pane_id"],
    },
  },
  {
    name: "pane_restart",
    description: "Restart child command in place inside persistent shell slot",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "ID of the target pane" },
        command: { type: "string", description: "New command to run (optional)" },
      },
      required: ["pane_id"],
    },
  },
  {
    name: "pane_focus",
    description: "Shift focus between panes in Windows Terminal (next, previous, left, right, up, down)",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", default: "next", description: "Direction: 'next', 'previous', 'left', 'right', 'up', 'down'" },
      },
    },
  },
  {
    name: "pane_resize",
    description: "Resize pane ratio in Windows Terminal",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", default: "right", description: "Direction: 'left', 'right', 'up', 'down'" },
        amount: { type: "number", default: 15, description: "Percentage points to adjust" },
      },
    },
  },
  {
    name: "pane_zoom",
    description: "Toggle maximize / zoom state of the active pane in Windows Terminal",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "pane_repaint",
    description: "Force clear and complete terminal redraw of a pane",
    inputSchema: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "ID of the target pane" },
      },
      required: ["pane_id"],
    },
  },
  {
    name: "pane_clear",
    description: "Clean completed and dead pane records from the registry",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

async function handleToolCall(name, args) {
  switch (name) {
    case "pane_split": {
      const res = await paneManager.splitPane({
        cmd: args.command || "cmd",
        title: args.title || (args.command ? `Cockpit: ${args.command}` : "Overlord Interactive Shell"),
        split: args.split || "vertical",
        size: typeof args.size === "number" ? args.size : 0.45,
        dir: args.workdir || "C:\\Users\\ahmed",
        autoClose: args.auto_close === true,
        keepOnError: args.keep_on_error !== false,
        sanitizeProxy: args.sanitize_proxy !== false,
      });
      return JSON.stringify(res, null, 2);
    }

    case "pane_send_input": {
      const res = await paneManager.sendInput(args.pane_id, args.text, args.submit === true, args.paste);
      return JSON.stringify(res, null, 2);
    }

    case "pane_send_key": {
      const res = await paneManager.sendKey(args.pane_id, args.key);
      return JSON.stringify(res, null, 2);
    }

    case "pane_read_output": {
      const lines = typeof args.lines === "number" ? args.lines : 30;
      const clean = args.clean !== false;
      const res = await paneManager.readOutput(args.pane_id, lines, clean);
      return res.lines.join("\n");
    }

    case "pane_read_screen": {
      const res = await paneManager.readScreen(args.pane_id);
      return `[Screen: ${res.cols}x${res.rows}]\n` + (res.lines || []).join("\n");
    }

    case "pane_wait_for": {
      const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : 15000;
      const res = await paneManager.waitForPattern(args.pane_id, args.pattern, timeoutMs);
      return JSON.stringify(res, null, 2);
    }

    case "pane_wait_idle": {
      const idleMs = typeof args.idle_ms === "number" ? args.idle_ms : 1500;
      const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : 30000;
      const res = await paneManager.waitForIdle(args.pane_id, idleMs, timeoutMs);
      return JSON.stringify(res, null, 2);
    }

    case "pane_list": {
      const panes = paneManager.listPanes(args.session_id || null);
      return JSON.stringify(panes, null, 2);
    }

    case "pane_status": {
      const res = await paneManager.getRichStatus(args.pane_id);
      return JSON.stringify(res, null, 2);
    }

    case "pane_kill": {
      const res = await paneManager.killPane(args.pane_id);
      return JSON.stringify(res, null, 2);
    }

    case "pane_restart": {
      const res = await paneManager.restartPane(args.pane_id, args.command || null);
      return JSON.stringify(res, null, 2);
    }

    case "pane_focus": {
      const res = paneManager.focusPane(args.direction || "next");
      return JSON.stringify(res, null, 2);
    }

    case "pane_resize": {
      const res = await paneManager.resizePane(args.direction || "right", args.amount || 15);
      return JSON.stringify(res, null, 2);
    }

    case "pane_zoom": {
      const res = paneManager.toggleZoom();
      return JSON.stringify(res, null, 2);
    }

    case "pane_repaint": {
      const res = await paneManager.repaintPane(args.pane_id);
      return JSON.stringify(res, null, 2);
    }

    case "pane_clear": {
      const res = paneManager.clearRegistry(true);
      return JSON.stringify(res, null, 2);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── JSON-RPC 2.0 Stdio Transport ───────────────────────────────────────────
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

function sendResponse(id, result, error = null) {
  const msg = { jsonrpc: "2.0", id };
  if (error) {
    msg.error = error;
  } else {
    msg.result = result;
  }
  process.stdout.write(JSON.stringify(msg) + "\n");
}

rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req;
  try {
    req = JSON.parse(trimmed);
  } catch (_) {
    return;
  }

  const { id, method, params } = req;

  try {
    if (method === "initialize") {
      sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "pane-controller",
          version: "4.0.0",
        },
      });
      return;
    }

    if (method === "notifications/initialized") {
      // Notification, no response required
      return;
    }

    if (method === "ping") {
      sendResponse(id, {});
      return;
    }

    if (method === "tools/list") {
      sendResponse(id, { tools: TOOLS });
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      try {
        const textResult = await handleToolCall(toolName, toolArgs);
        sendResponse(id, {
          content: [{ type: "text", text: String(textResult) }],
        });
      } catch (toolErr) {
        sendResponse(id, {
          isError: true,
          content: [{ type: "text", text: `Error executing ${toolName}: ${toolErr.message}` }],
        });
      }
      return;
    }

    // Unhandled method
    if (id !== undefined) {
      sendResponse(id, null, { code: -32601, message: `Method '${method}' not found` });
    }
  } catch (err) {
    if (id !== undefined) {
      sendResponse(id, null, { code: -32603, message: err.message });
    }
  }
});
