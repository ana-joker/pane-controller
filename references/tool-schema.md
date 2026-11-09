# Pane Controller — Complete Tool Schema Reference

Verbatim dictionary of the `pane_controller` tool as registered in the Albedo toolchain.
All 22 parameters are **REQUIRED** in the schema. Pass every one on every call.

---

## Tool Identity

**Name:** `pane_controller`
**Purpose:** Autonomous Terminal Cockpit & Subagent Duplex Control — split Windows Terminal tabs
(`-V` / `-H`), send live stdin prompts, inject virtual keys (Enter, Ctrl+C, Esc), scrape real-time
ANSI-stripped output buffers, wait for prompt patterns, suspend/resume (hide/park) processes, and
bridge subagents (agy / hermes) with structured flight logging.

**Backing layer:** Windows Terminal + ConPTY pseudo-console. Panes are real OS-level terminal tabs
on the real desktop, not simulated buffers.

---

## Parameter Dictionary (22)

| # | Param | Type | Default | Meaning |
|---|---|---|---|---|
| 1 | `action` | enum(string) | — | Operation to perform (see Action Table) |
| 2 | `pane_id` | string | `""` | Target pane ID or title/alias. Required for: `send_input`, `send_key`, `read_output`, `wait_for`, `wait_idle`, `suspend`, `resume`, `restart`, `focus`, `zoom`, `transcript`, `status`, `kill` |
| 3 | `command` | string | `""` | Command line to execute inside the split pane. Required for `split` |
| 4 | `text` | string | `""` | Text to inject into pane stdin. Used by `send_input` and `broadcast` |
| 5 | `submit` | boolean | `false` | Automatically send Enter after `text`. **Opt-in, defaults to false** |
| 6 | `clean` | boolean | `true` | For `read_output`: strip ANSI codes, resolve `\r` line overwrites, collapse repetitive spinner/progress frames |
| 7 | `key` | enum(string) | `""` | Virtual key for `send_key`: `Enter`, `Ctrl+C`, `Esc`, `Tab`, `Backspace`, `Up`, `Down`, `Left`, `Right` |
| 8 | `pattern` | string | `""` | Regex for `wait_for`, e.g. `>\|Ready\|Task completed` |
| 9 | `idle_ms` | number | `1500` | Silence duration (ms) that counts as quiescent for `wait_idle` |
| 10 | `lines` | number | `30` | Output lines for `read_output`; turns for `transcript` |
| 11 | `offset` | number | `null` | Turn offset for `transcript` pagination. `null` = tail |
| 12 | `full_text` | boolean | `true` | For `transcript`: resolve untruncated content from `transcript_full.jsonl` |
| 13 | `timeout_ms` | number | `15000` / `30000` | Timeout for `wait_for` (default 15000) and `wait_idle` (default 30000) |
| 14 | `direction` | enum(string) | `""` | `focus`: `left`, `right`, `up`, `down`, `next`, `previous`. `resize`: `left`, `right`, `up`, `down` |
| 15 | `amount` | number | `15` | Resize amount in percentage points (range roughly 0.1–0.9) |
| 16 | `title` | string | `""` | Header title for `split`, e.g. `AGY Auditor`, `Build Watcher` |
| 17 | `split` | enum(string) | `vertical` | `vertical` = side-by-side columns; `horizontal` = stacked rows |
| 18 | `size` | number | `0.45` | Fraction of window for the new pane. Valid 0.1 – 0.9 |
| 19 | `workdir` | string | current workspace | Working directory for the command |
| 20 | `auto_close` | boolean | `true` | Auto-close pane after successful exit code 0. **Set false to read your own output** |
| 21 | `keep_on_error` | boolean | `true` | Hold pane open on failure so output can be reviewed |
| 22 | `sanitize_proxy` | boolean | `true` | Strip `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` to prevent local VPN/Tor leaks |

---

## Action Table (18)

### Lifecycle (5)

| Action | Behavior | Required params | Returns |
|---|---|---|---|
| `split` | Launch a new pane running `command` | `command`, `title`, `split`, `size`, `workdir` | Pane ID, session, layout, dir, command, flight log path, hygiene summary |
| `kill` | Terminate the pane; the split vanishes from the window | `pane_id` | Termination confirmation |
| `list` | List every pane — active and historical | none | Pane table with IDs, titles, state, timestamps |
| `clear` | Delete logs of already-finished panes | none | Cleanup summary |
| `restart` | Resurrect a dead pane **in place**, same slot | `pane_id` | Restart confirmation |

### Input (3)

| Action | Behavior | Required params |
|---|---|---|
| `send_input` | Write text to pane stdin | `pane_id`, `text`, `submit` |
| `send_key` | Inject a virtual key press | `pane_id`, `key` |
| `broadcast` | Fan one `text` out to every live pane at once | `text`, `submit` |

### Output (5)

| Action | Behavior | Required params |
|---|---|---|
| `read_output` | Scrape the live buffer from the pane | `pane_id`, `lines`, `clean` |
| `wait_for` | Block until a regex matches pane output | `pane_id`, `pattern`, `timeout_ms` |
| `wait_idle` | Block until N ms of silence (quiescence detection) | `pane_id`, `idle_ms`, `timeout_ms` |
| `transcript` | Pull AGY JSON turns as clean text | `pane_id`, `lines`, `offset`, `full_text` |
| `status` | Rich metrics for a single pane | `pane_id` |

### Control (5)

| Action | Behavior | Required params |
|---|---|---|
| `suspend` | Freeze a process in place (hide/park) | `pane_id` |
| `resume` | Unfreeze a suspended process | `pane_id` |
| `focus` | Bring a pane to the foreground | `pane_id`, `direction` |
| `resize` | Adjust the split ratio | `pane_id`, `direction`, `amount` |
| `zoom` | Toggle pane maximize / restore | `pane_id` |

---

## Split Semantics

- `split: "vertical"` → panes sit **side-by-side** as columns. Use when comparing output.
- `split: "horizontal"` → panes are **stacked** as rows. Use when watching long scroll logs.
- `size: 0.45` → new pane takes 45% of the window. New pane goes to the right for `vertical`,
  to the bottom for `horizontal`.
- Windows Terminal flags behind the scenes: `-V` (vertical/side-by-side), `-H` (horizontal/stacked).

---

## Pane ID Format

```
pane-mumqyo2u-3e1r
 │    │        └── 5-char suffix
 │    └─────────── 8-char random token
 └──────────────── literal prefix "pane-"
```

Titles/aliases also resolve as `pane_id` (e.g. title `AGY Auditor` works directly).

---

## Filesystem Layout

```
C:\Users\ahmed\.config\opencode\panes\
├── pane-mumqyo2u-3e1r\
│   ├── flight.log            ← command + full flight history
│   └── transcript_full.jsonl ← untruncated AGY turns (when applicable)
├── pane-munr29k2-r73z\
├── pane-multi-agy\
└── ...  (historical dirs persist after kill)
```

---

## Return Shapes

### `split`
```
🚀 [OVERLORD COCKPIT PANE LAUNCHED]
⚡ Pane ID   : pane-xxxxxxxx-yyyyy
🆔 Session   : default
🏷️ Title     : NU-RIGHT
📐 Layout    : Side-by-side (Vertical) (Ratio: 0.42)
📂 Directory : C:\Users\ahmed
🛠️ Command   : nu
📜 Flight Log: C:\Users\ahmed\.config\opencode\panes\pane-.../flight.log
🛡️ Hygiene   : Proxy Sanitized: true | Auto-close: false
```

### `read_output`
```
📜 [Output Stream for `pane-id`] (15 lines | Source: ipc_live | Mode: Clean):
<buffer contents>
```

### `send_input`
```
✔ [Input Delivered to `pane-id` [Submitted with Enter]]:
```
<input text echoed>
```

### `send_key`
```
⌨️ [Virtual Key Injected to `pane-id`]: `Ctrl+C`
```

### `kill`
```
🛑 [Cockpit Pane Terminated]: Successfully closed **TITLE** (`pane-id`).
```

---

## Hygiene Contract

`sanitize_proxy: true` guarantees the pane starts with `HTTP_PROXY`, `HTTPS_PROXY`, and
`ALL_PROXY` removed from its environment. This is the guard against the 2026-08-06 incident where
OnionFruit/Tor proxy env vars persisted system-wide and took the entire network stack down for
two hours.

**Post-condition after any proxy-using pane operation:**
```powershell
echo "HTTP=[$env:HTTP_PROXY] HTTPS=[$env:HTTPS_PROXY] ALL=[$env.ALL_PROXY]"
```
All three must render empty.

---

## Timeout Defaults

- `wait_for` → 15000 ms
- `wait_idle` → 30000 ms

Override with `timeout_ms`. Long builds need generous values (300000–900000).
