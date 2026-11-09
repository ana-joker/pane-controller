import { join } from "path"
import { homedir } from "os"

// pane_controller.ts - Overlord Autonomous Terminal Cockpit & Subagent Duplex Control Engine
// Location: ~/.config/opencode/tools/pane_controller.ts
// Managed by Albedo for Dr. Ahmed

export default {
  description: "Autonomous Terminal Cockpit & Subagent Duplex Control: Split Windows Terminal tabs (-V/-H), send live stdin prompts, inject virtual keys (Enter, Ctrl+C, Esc), scrape real-time ANSI-stripped output buffers, wait for prompt patterns, suspend/resume (hide/park) processes, and bridge subagents (agy/hermes) with structured flight logging.",
  args: {
    action: {
      type: "string",
      description: "Action: 'split' (launch pane), 'send_input' (write stdin text), 'send_key' (virtual key: Enter, Ctrl+C, Esc, Tab, Up, Down), 'read_output' (scrape buffer), 'read_screen' (direct 2D console buffer), 'wait_for' (pattern gating), 'wait_idle' (quiescence silence detection), 'suspend' (freeze process), 'resume' (unfreeze), 'restart' (resurrect in place), 'focus' (focus pane), 'resize' (adjust ratio), 'zoom' (toggle maximize), 'repaint' (redraw screen), 'broadcast' (fan-out input), 'transcript' (AGY JSON turns), 'status' (rich metrics), 'list' (list panes), 'kill' (terminate), 'clear' (clean finished).",
    },
    pane_id: {
      type: "string",
      description: "Target pane ID or title/alias (e.g. 'hermes', 'agy', 'backend', 'pane-mum123'). Required for send_input, send_key, read_output, wait_for, wait_idle, suspend, resume, restart, status, transcript, kill.",
    },
    command: {
      type: "string",
      description: "Command line to execute inside the split pane (required for 'split').",
    },
    text: {
      type: "string",
      description: "Text message or prompt to inject into pane stdin (for 'send_input' and 'broadcast').",
    },
    submit: {
      type: "boolean",
      description: "Automatically send Enter keypress to submit input immediately. Opt-in: default is false.",
    },
    paste: {
      type: "boolean",
      description: "Inject text using bracketed paste mode (\\x1b[200~...\\x1b[201~) for atomic multiline entry without keystroke dropped-character race conditions.",
    },
    clean: {
      type: "boolean",
      description: "Clean terminal output: strip ANSI codes, resolve \\r line overwrites, and collapse repetitive spinner/progress frames (for 'read_output', default: true).",
    },
    key: {
      type: "string",
      description: "Virtual key name for 'send_key': 'Enter', 'Ctrl+C', 'Esc', 'Tab', 'Backspace', 'Up', 'Down', 'Right', 'Left'.",
    },
    pattern: {
      type: "string",
      description: "Regex pattern string to wait for in output stream (for 'wait_for', e.g. '>|Ready|Task completed').",
    },
    idle_ms: {
      type: "number",
      description: "Duration of silence/inactivity in milliseconds to consider the terminal idle/quiescent (for 'wait_idle', default: 1500).",
    },
    lines: {
      type: "number",
      description: "Number of output lines or turns to retrieve (for 'read_output' and 'transcript', default: 30 / 10).",
    },
    offset: {
      type: "number",
      description: "Turn offset for 'transcript' pagination (default: null for tail).",
    },
    full_text: {
      type: "boolean",
      description: "Resolve untruncated content from transcript_full.jsonl to eliminate silent data truncation (for 'transcript', default: true).",
    },
    timeout_ms: {
      type: "number",
      description: "Timeout in milliseconds (for 'wait_for' and 'wait_idle', default: 15000 / 30000).",
    },
    direction: {
      type: "string",
      description: "Direction for 'focus' ('left', 'right', 'up', 'down', 'next', 'previous') or 'resize' ('left', 'right', 'up', 'down').",
    },
    amount: {
      type: "number",
      description: "Resize amount percentage points (for 'resize', default: 15).",
    },
    title: {
      type: "string",
      description: "Header title for the pane (for 'split', e.g. 'AGY Auditor', 'Build Watcher').",
    },
    split: {
      type: "string",
      description: "Split orientation: 'vertical' (side-by-side, default) or 'horizontal' (stacked).",
    },
    size: {
      type: "number",
      description: "Fraction of the window for the new pane (0.1 to 0.9, default: 0.45).",
    },
    workdir: {
      type: "string",
      description: "Working directory for the command (default: current workspace).",
    },
    auto_close: {
      type: "boolean",
      description: "Automatically close pane after successful exit code 0 (default: true).",
    },
    keep_on_error: {
      type: "boolean",
      description: "Hold pane open on failure so output can be reviewed (default: true).",
    },
    sanitize_proxy: {
      type: "boolean",
      description: "Sanitize HTTP_PROXY/ALL_PROXY to prevent local VPN/Tor leaks (default: true).",
    },
  },
  async execute(args: any, context: any) {
    const paneManager = require(join(__dirname, "pane_manager.js"))
    const action = (args.action || "list").toLowerCase().trim()

    // 1. SPLIT PANE
    if (action === "split") {
      const command = args.command || "cmd"
      const title = args.title || (command === "cmd" ? "Terminal Shell" : command)
      const split = args.split || "vertical"
      const size = typeof args.size === "number" ? args.size : 0.45
      const workdir = args.workdir || context?.directory || context?.worktree || process.cwd()
      const autoClose = args.auto_close !== undefined ? Boolean(args.auto_close) : false
      const keepOnError = args.keep_on_error !== undefined ? Boolean(args.keep_on_error) : true
      const sanitizeProxy = args.sanitize_proxy !== undefined ? Boolean(args.sanitize_proxy) : true
      const interactive = args.interactive !== undefined ? Boolean(args.interactive) : true
      const sessionId = context?.session?.id || context?.sessionId || process.env.AGY_SESSION_ID || "antigravity"

      try {
        const res = paneManager.splitPane({
          command,
          title,
          split,
          size,
          workdir,
          autoClose,
          keepOnError,
          interactive,
          sanitizeProxy,
          sessionId,
        })

        const orientation = res.split === "vertical" ? "Side-by-side (Vertical)" : "Stacked (Horizontal)"
        return `🚀 [ANTIGRAVITY COCKPIT PANE LAUNCHED]
⚡ Pane ID   : \`${res.pane_id}\`
🆔 Session   : \`${sessionId}\`
🏷️ Title     : **${res.title}**
📐 Layout    : ${orientation} (Ratio: ${res.size})
📂 Directory : \`${res.workdir}\`
🛠️ Command   : \`${res.command}\`
📜 Flight Log: \`${res.flight_log}\`
🛡️ Hygiene   : Proxy Sanitized: \`${res.sanitize_proxy}\` | Auto-close: \`${res.auto_close}\`

✨ Full-duplex ConPTY Cockpit is online. Interactive shell is active at prompt. Commands can be sent and child agents fully monitored!`
      } catch (err: any) {
        return `✖ Failed to split pane: ${err.message}`
      }
    }

    // 2. SEND INPUT (TEXT STREAM INJECTION - submit: opt-in, default: false)
    if (action === "send_input" || action === "input" || action === "write") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for send_input."
      const text = args.text !== undefined ? String(args.text) : ""
      const submit = args.submit === true
      const addNewline = submit || args.add_newline === true
      const paste = args.paste !== undefined ? Boolean(args.paste) : (text.length > 2 || text.includes("\n"))

      try {
        const res = await paneManager.sendInput(paneId, text, addNewline, paste)
        const submitNotice = addNewline ? " [Submitted with Enter]" : " [Unsubmitted Stdin]"
        const pasteNotice = (paste || res.bracketed) ? " [Bracketed Paste]" : ""
        return `✔ [Input Delivered to \`${paneId}\`${submitNotice}${pasteNotice}]:\n\`\`\`\n${text}\n\`\`\``
      } catch (err: any) {
        return `✖ Failed to deliver input to pane '${paneId}': ${err.message}`
      }
    }

    // 3. SEND KEY (VIRTUAL KEYBOARD EVENT)
    if (action === "send_key" || action === "key") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for send_key."
      const key = String(args.key || "Enter").trim()

      try {
        await paneManager.sendKey(paneId, key)
        return `⌨️ [Virtual Key Injected to \`${paneId}\`]: \`${key}\``
      } catch (err: any) {
        return `✖ Failed to send key to pane '${paneId}': ${err.message}`
      }
    }

    // 4. READ OUTPUT (BUFFER SCRAPER WITH CLEAN MODE)
    if (action === "read_output" || action === "output" || action === "read") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for read_output."
      const lines = typeof args.lines === "number" ? args.lines : 30
      const clean = args.clean !== false

      try {
        const res = await paneManager.readOutput(paneId, lines, clean)
        const rendered = res.lines.length > 0 ? res.lines.join("\n") : "(no output received from process yet — process is silent or waiting for input)"
        const cleanNotice = res.clean_mode ? " | Mode: Clean" : ""
        return `📜 [Output Stream for \`${paneId}\`] (${res.lines.length} lines | Source: ${res.source}${cleanNotice}):\n\`\`\`\n${rendered}\n\`\`\``
      } catch (err: any) {
        return `✖ Failed to read output from pane '${paneId}': ${err.message}`
      }
    }

    // 4b. READ SCREEN (DIRECT 2D WIN32 CONSOLE BUFFER)
    if (action === "read_screen" || action === "screen") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for read_screen."

      try {
        const res = await paneManager.readScreen(paneId)
        const rendered = res.lines.length > 0 ? res.lines.join("\n") : "(screen is empty)"
        return `🖥️ [Live Screen for \`${paneId}\`] (${res.cols}x${res.rows} | Source: ${res.source}):\n\`\`\`\n${rendered}\n\`\`\``
      } catch (err: any) {
        return `✖ Failed to read screen from pane '${paneId}': ${err.message}`
      }
    }

    // 5. WAIT FOR PATTERN (EVENT GATING)
    if (action === "wait_for" || action === "wait") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for wait_for."
      const pattern = args.pattern
      if (!pattern) return "✖ Error: 'pattern' parameter is required for wait_for."
      const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : 15000

      try {
        const res = await paneManager.waitForPattern(paneId, pattern, timeoutMs)
        return `🎯 [Pattern Matched on \`${paneId}\`] (Immediate: ${res.immediate}):\nPattern : \`${pattern}\`\nMatched : \`${res.text}\``
      } catch (err: any) {
        return `⚠️ Gating timeout or error on pane '${paneId}': ${err.message}`
      }
    }

    // 5b. WAIT FOR IDLE (QUIESCENCE SILENCE GATING)
    if (action === "wait_idle" || action === "idle") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for wait_idle."
      const idleMs = typeof args.idle_ms === "number" ? args.idle_ms : 1500
      const timeoutMs = typeof args.timeout_ms === "number" ? args.timeout_ms : 30000

      try {
        const res = await paneManager.waitForIdle(paneId, idleMs, timeoutMs)
        const immNotice = res.immediate ? " (Immediate - already quiet)" : ""
        return `⏳ [Quiescence Reached on \`${paneId}\`${immNotice}]: Process output silent for ${res.quiet_ms}ms (total wait: ${res.elapsed_ms}ms).`
      } catch (err: any) {
        return `⚠️ Quiescence wait failed on pane '${paneId}': ${err.message}`
      }
    }

    // 6. SUSPEND (FREEZE / HIDE / PARK)
    if (action === "suspend" || action === "pause" || action === "freeze") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for suspend."

      try {
        const res = await paneManager.suspendPane(paneId)
        return `❄️ [Pane Process Suspended]: \`${paneId}\`\nProcess tree frozen at kernel level (0% CPU). State preserved.`
      } catch (err: any) {
        return `✖ Failed to suspend pane '${paneId}': ${err.message}`
      }
    }

    // 7. RESUME (UNFREEZE)
    if (action === "resume" || action === "unfreeze") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for resume."

      try {
        const res = await paneManager.resumePane(paneId)
        return `🔥 [Pane Process Resumed]: \`${paneId}\`\nExecution unfrozen and active.`
      } catch (err: any) {
        return `✖ Failed to resume pane '${paneId}': ${err.message}`
      }
    }

    // 8. RESTART (RESURRECT IN PLACE)
    if (action === "restart") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for restart."

      try {
        const cmd = args.command || null
        const res = await paneManager.restartPane(paneId, cmd)
        const cmdInfo = res.command ? `\nCommand   : \`${res.command}\`` : ""
        return `🔄 [Pane Resurrected in Place]: \`${paneId}\`\nChild PID : \`${res.child_pid}\`${cmdInfo}\nStatus    : \`${res.status}\`. Terminal layout preserved.`
      } catch (err: any) {
        return `✖ Failed to restart pane '${paneId}': ${err.message}`
      }
    }

    // 9. FOCUS PANE
    if (action === "focus") {
      const dir = args.direction || args.pane_id || "next"
      const res = paneManager.focusPane(dir)
      if (res.ok) return `🎯 [Windows Terminal Focus Switched]: Focused \`${dir}\`.`
      return `✖ Failed to shift focus: ${res.error}`
    }

    // 10. RESIZE PANE
    if (action === "resize") {
      const target = args.pane_id || args.direction || "right"
      const cols = args.cols || args.amount || 15
      const rows = args.rows || null
      const res = await paneManager.resizePane(target, cols, rows)
      if (res && res.cols && res.rows) {
        return `📐 [Pane \`${res.pane_id}\` Geometry Synchronized]: ${res.cols} cols x ${res.rows} rows.`
      }
      return `📐 [Windows Terminal Pane Sizing]:
• ${res.notice}
• Tip: To split with custom ratio, specify 'size: 0.3' to '0.7' (e.g. size: 0.45) during 'split'. For an active pane, press Alt + Shift + Arrow keys.`
    }

    // 11. ZOOM (TOGGLE MAXIMIZE / RESTORE)
    if (action === "zoom" || action === "maximize") {
      const res = paneManager.toggleZoom()
      return `🔍 [Windows Terminal Pane Zoom]:
• ${res.notice}
• Tip: Press Alt + Shift + + to toggle maximize/restore the active pane in Windows Terminal.`
    }

    // 11b. REPAINT (FORCE CLEAN VIEWPORT REDRAW)
    if (action === "repaint" || action === "redraw") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for repaint."
      try {
        const res = await paneManager.repaintPane(paneId)
        return `🎨 [Pane Redrawn Cleanly]: \`${paneId}\` (${res.cols}x${res.rows})\nOuter viewport cleared and TUI screen refreshed.`
      } catch (err: any) {
        return `✖ Failed to repaint pane '${paneId}': ${err.message}`
      }
    }

    // 12. BROADCAST INPUT
    if (action === "broadcast") {
      const text = args.text
      if (!text) return "✖ Error: 'text' parameter is required for broadcast."

      try {
        const res = await paneManager.broadcastInput(text)
        return `📡 [Input Broadcasted to ${res.targets_count} Active Panes]:\n\`\`\`\n${text}\n\`\`\``
      } catch (err: any) {
        return `✖ Broadcast error: ${err.message}`
      }
    }

    // 13. RICH STATUS
    if (action === "status") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for status."

      const st = await paneManager.getRichStatus(paneId)
      if (!st) return `⚠️ Pane '${paneId}' not found in registry.`

      const memDisplay = st.memory_usage_mb
        ? (String(st.memory_usage_mb).includes("MB") || String(st.memory_usage_mb).includes("exited")
            ? String(st.memory_usage_mb)
            : `${st.memory_usage_mb} MB`)
        : "N/A"

      return `📋 [Rich Status for \`${st.id}\`]
• Title       : **${st.title}**
• Session     : \`${st.session_id || "default"}\`
• Status      : **${st.status}** (Live IPC: \`${st.is_live}\`)
• Process     : **${st.active_child_name || st.child_name || "cmd.exe"}** (Active PID: ${st.active_child_pid || st.child_pid || "N/A"} | Root Shell PID: ${st.child_pid || "N/A"} | Runner PID: ${st.pid})
• Command     : \`${st.command}\`
• Directory   : \`${st.dir}\`
• Uptime      : ${st.uptime_seconds !== undefined ? `${st.uptime_seconds}s` : "N/A"}
• Last Active : ${st.last_activity_age_seconds !== undefined ? `${st.last_activity_age_seconds}s ago` : "N/A"}
• Memory      : ${memDisplay}
• Exit Code   : ${st.exit_code !== undefined ? st.exit_code : "running"}
• Flight Log  : \`${st.flight_log || "N/A"}\``
    }

    // 14. AGY / SUBAGENT TRANSCRIPT BRIDGE (FULL-TEXT RESOLVER & PAGINATION)
    if (action === "transcript") {
      const paneId = args.pane_id || ""
      const maxTurns = typeof args.lines === "number" ? args.lines : (typeof args.limit === "number" ? args.limit : 10)
      const offset = typeof args.offset === "number" ? args.offset : null
      const fullText = args.full_text !== false

      const res = paneManager.getTranscript(paneId, maxTurns, offset, fullText)
      if (!res.ok) return `⚠️ Transcript bridge notice: ${res.error}`

      const formatted = res.turns.map((t: any) => {
        const icon = t.role === "assistant" ? "🤖" : "👤"
        const tools = t.toolCalls && t.toolCalls.length > 0 ? `\n  🛠️ Tools: ${t.toolCalls.join(", ")}` : ""
        const think = t.thinking ? `\n  💭 Thinking: ${t.thinking.slice(0, 150)}...` : ""
        const truncTag = t.resolved_full ? " [⚡ Full-Text Restored from transcript_full]" : (t.was_truncated ? " [⚠️ Truncated]" : "")
        return `${icon} **[${t.role.toUpperCase()}]** (Step: ${t.step_index ?? "N/A"} | ${t.created_at || "N/A"}${truncTag}):\n  ${t.content}${tools}${think}`
      }).join("\n\n")

      const paginationInfo = `Total Turns: ${res.total_turns} | Offset: ${res.offset} | Limit: ${res.limit} | Restored: ${res.full_resolved_count || 0}`
      return `🧠 [Structured Subagent Transcript] (${paginationInfo}):\n\n${formatted}`
    }

    // 15. LIST PANES
    if (action === "list") {
      const sessionId = context?.session?.id || context?.sessionId || null
      const panes = paneManager.listPanes(sessionId)
      if (!panes || panes.length === 0) {
        return "ℹ️ No active or recorded cockpit panes found in registry."
      }

      const rows = panes.map((p: any) => {
        const icon = p.status === "running" ? "🟢" : p.status === "idle_at_prompt" ? "🟡" : p.status === "suspended" ? "❄️" : p.status === "completed" ? "✔" : p.status === "failed" ? "✖" : p.status === "orphaned" ? "👻" : "⚪"
        const dur = p.duration ? `(${p.duration}s)` : ""
        const exit = p.exit_code !== undefined ? `[Code: ${p.exit_code}]` : ""
        const ipc = p.ipc_port ? `[IPC :${p.ipc_port}]` : ""
        const childInfo = p.active_child_name ? `[Proc: ${p.active_child_name}]` : ""
        return `• ${icon} **${p.title}** [\`${p.id}\`] — \`${p.status}\` ${childInfo} ${exit} ${dur} ${ipc}\n  Cmd: \`${p.command}\` | Split: \`${p.split}\``
      }).join("\n\n")

      return `📊 [ANTIGRAVITY COCKPIT PANES] (${panes.length} total)\n\n${rows}`
    }

    // 16. KILL PANE
    if (action === "kill") {
      const paneId = args.pane_id
      if (!paneId) return "✖ Error: 'pane_id' parameter is required for kill."

      const res = await paneManager.killPane(paneId)
      if (!res.ok) return `✖ Failed: ${res.error}`
      const targetLabel = res.title ? `**${res.title}** (\`${res.pane_id}\`)` : `\`${res.pane_id}\``
      return `🛑 [Cockpit Pane Terminated]: Successfully closed ${targetLabel}. The split pane has vanished from your window.`
    }

    // 17. CLEAR REGISTRY
    if (action === "clear") {
      const res = paneManager.clearRegistry(true)
      return `🧹 [Cockpit Registry Cleaned]: Removed ${res.removed} completed / dead pane records.`
    }

    return `✖ Unknown action '${action}'. Available: split, send_input, send_key, read_output, read_screen, wait_for, wait_idle, suspend, resume, restart, focus, resize, zoom, repaint, broadcast, transcript, status, list, kill, clear.`
  },
}
