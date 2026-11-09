# Pane Controller — Recipes

Copy-paste-ready workflows. Every call shows the full 22-parameter payload because the tool
schema requires all of them.

## Base Template

```json
{
  "action": "<ACTION>",
  "pane_id": "",
  "command": "",
  "text": "",
  "submit": false,
  "clean": true,
  "key": "Enter",
  "pattern": "",
  "idle_ms": 2000,
  "lines": 40,
  "offset": null,
  "full_text": true,
  "timeout_ms": 30000,
  "direction": "right",
  "amount": 15,
  "title": "TITLE",
  "split": "vertical",
  "size": 0.45,
  "workdir": "C:\\Users\\ahmed",
  "auto_close": false,
  "keep_on_error": true,
  "sanitize_proxy": true
}
```

---

## 1. NuShell (nushell) Session

```json
{"action":"split","command":"nu","title":"NU-RIGHT","split":"vertical","size":0.42,
 "workdir":"C:\\Users\\ahmed","auto_close":false,"keep_on_error":true,"sanitize_proxy":true,
 "pane_id":"","text":"","submit":false,"clean":true,"key":"Enter","pattern":"","idle_ms":2000,
 "lines":40,"offset":null,"full_text":true,"timeout_ms":30000,"direction":"right","amount":15}
```

Then probe. **One statement per `send_input` in nu** — its structured parser rejects
pipe-plus-expression mixing:

```json
{"action":"send_input","pane_id":"<ID>","text":"version","submit":true,
 "command":"","clean":true,"key":"Enter","pattern":"","idle_ms":2000,"lines":40,"offset":null,
 "full_text":true,"timeout_ms":30000,"direction":"right","amount":15,"title":"","split":"vertical",
 "size":0.45,"workdir":"C:\\Users\\ahmed","auto_close":false,"keep_on_error":true,"sanitize_proxy":true}
```

Verify proxy hygiene inside nu:
```nu
echo $"proxy=[$env.HTTP_PROXY][$env.HTTPS_PROXY][$env.ALL_PROXY]"
```
Must print `proxy=[][][]`.

---

## 2. Interactive PowerShell / cmd

```json
{"action":"split","command":"powershell -NoLogo","title":"PS","split":"vertical","size":0.42,
 "workdir":"C:\\Users\\ahmed","auto_close":false,"keep_on_error":true,"sanitize_proxy":true,
 "pane_id":"","text":"","submit":false,"clean":true,"key":"Enter","pattern":"","idle_ms":2000,
 "lines":40,"offset":null,"full_text":true,"timeout_ms":30000,"direction":"right","amount":15}
```

Run a cmdlet, then read the result:
```json
{"action":"send_input","pane_id":"<ID>","text":"Get-Process | Sort-Object WS -Descending | Select -First 5","submit":true, ...}
{"action":"wait_idle","pane_id":"<ID>","idle_ms":2500,"timeout_ms":30000, ...}
{"action":"read_output","pane_id":"<ID>","lines":40,"clean":true, ...}
```

Fall through to cmd when needed:
```json
{"action":"send_input","pane_id":"<ID>","text":"cmd /c \"ver\"","submit":true, ...}
```

---

## 3. Wrangler / Cloudflare CLI

```json
{"action":"send_input","pane_id":"<ID>","text":"wrangler --version","submit":true, ...}
```

Gate on the banner then list projects:
```json
{"action":"wait_for","pane_id":"<ID>","pattern":"wrangler|error|Error","timeout_ms":45000, ...}
{"action":"send_input","pane_id":"<ID>","text":"wrangler whoami","submit":true, ...}
{"action":"send_input","pane_id":"<ID>","text":"wrangler pages project list","submit":true, ...}
{"action":"wait_idle","pane_id":"<ID>","idle_ms":4000,"timeout_ms":60000, ...}
{"action":"read_output","pane_id":"<ID>","lines":60,"clean":true, ...}
```

Deploy with a completion gate:
```json
{"action":"send_input","pane_id":"<ID>","text":"wrangler pages deploy dist --project-name my-app","submit":true, ...}
{"action":"wait_for","pane_id":"<ID>","pattern":"Deployment complete|error|Error|✘","timeout_ms":300000, ...}
```

---

## 4. SSH into a Remote Host

```json
{"action":"split","command":"ssh","title":"SSH","split":"vertical","size":0.5,
 "workdir":"C:\\Users\\ahmed","auto_close":false,"keep_on_error":true,"sanitize_proxy":true, ...}
```
```json
{"action":"send_input","pane_id":"<ID>","text":"ssh ahmed@192.168.1.109","submit":true, ...}
{"action":"wait_for","pane_id":"<ID>","pattern":"password:|\\$|#|Permission denied","timeout_ms":45000, ...}
{"action":"read_output","pane_id":"<ID>","lines":30,"clean":true, ...}
{"action":"send_input","pane_id":"<ID>","text":"qweasdzxc1233210_","submit":true, ...}
{"action":"wait_for","pane_id":"<ID>","pattern":"\\$|#","timeout_ms":30000, ...}
```

---

## 5. Interactive Installer with [Y/n] Prompts

```json
{"action":"send_input","pane_id":"<ID>","text":"npm install -g some-package","submit":true, ...}
{"action":"wait_for","pane_id":"<ID>","pattern":"\\[Y/n\\]|\\[y/N\\]|\\?\\s*$|Ok to proceed|Continue\\?","timeout_ms":60000, ...}
{"action":"read_output","pane_id":"<ID>","lines":30,"clean":true, ...}
{"action":"send_input","pane_id":"<ID>","text":"y","submit":true, ...}
```

---

## 6. Gated Build Watcher

```json
{"action":"split","command":"npm run build","title":"BUILD","split":"horizontal","size":0.5,
 "workdir":"C:\\Users\\ahmed\\myproject","auto_close":false,"keep_on_error":true,"sanitize_proxy":true, ...}
```
```json
{"action":"wait_for","pane_id":"<ID>","pattern":"Build complete|Compiled successfully|error TS|ERROR|Error:","timeout_ms":600000, ...}
{"action":"read_output","pane_id":"<ID>","lines":80,"clean":true, ...}
```

---

## 7. AGY / Antigravity Agent Bridge

```json
{"action":"split","command":"agy","title":"AGY Auditor","split":"vertical","size":0.5,
 "workdir":"C:\\Users\\ahmed","auto_close":false,"keep_on_error":true,"sanitize_proxy":true, ...}
```
```json
{"action":"wait_for","pane_id":"<ID>","pattern":">|Ready|ready|Agent","timeout_ms":60000, ...}
{"action":"send_input","pane_id":"<ID>","text":"Audit the repo for security vulnerabilities","submit":true, ...}
{"action":"wait_idle","pane_id":"<ID>","idle_ms":8000,"timeout_ms":180000, ...}
{"action":"transcript","pane_id":"<ID>","lines":20,"offset":null,"full_text":true, ...}
```

`transcript` with `full_text: true` resolves truncation from `transcript_full.jsonl` — always
prefer it over `read_output` for agent panes.

---

## 8. Hermes Sovereign Agent Bridge

Same shape as AGY but with `command: "hermes"`. `pane_controller` supports "bridging subagents
(agy/hermes) with structured flight logging" natively.

---

## 9. Two-Pane Comparison Fleet

```json
{"action":"split","command":"nu","title":"LEFT","split":"vertical","size":0.45, ...}
{"action":"split","command":"pwsh","title":"RIGHT","split":"vertical","size":0.45, ...}
```
Then `resize` to taste:
```json
{"action":"resize","pane_id":"<ID>","direction":"right","amount":15, ...}
```

---

## 10. Broadcast a Command to Every Pane

```json
{"action":"broadcast","text":"clear","submit":true, ...}
```
```json
{"action":"broadcast","text":"y","submit":true, ...}
```
`broadcast` ignores `pane_id` and hits all live panes.

---

## 11. Suspend a Noisy Pane, Resume Later

```json
{"action":"suspend","pane_id":"<ID>", ...}
```
Do other work. Then:
```json
{"action":"resume","pane_id":"<ID>", ...}
{"action":"read_output","pane_id":"<ID>","lines":40,"clean":true, ...}
```

---

## 12. Freeze a Pane and Read It Without Losing State

```json
{"action":"zoom","pane_id":"<ID>", ...}
```
Toggle again to restore.

---

## 13. Restart a Dead Pane In Place

```json
{"action":"restart","pane_id":"<ID>", ...}
```
Resurrects the same slot — no orphaned split, no new ID.

---

## 14. Stuck Continuation Prompt Recovery

Symptom: pane echoes `>>` repeatedly and refuses new input.
```json
{"action":"send_key","pane_id":"<ID>","key":"Ctrl+C", ...}
```
Then re-probe. Note the `>>` alone is only a ConPTY echo artifact in cmd/PowerShell — recovery is
only needed when output has genuinely stopped.

---

## 15. Arrow-Key Menu Navigation (TUI)

```json
{"action":"send_key","pane_id":"<ID>","key":"Down", ...}
{"action":"send_key","pane_id":"<ID>","key":"Down", ...}
{"action":"send_key","pane_id":"<ID>","key":"Enter", ...}
```
Also available: `Up`, `Left`, `Right`, `Tab`, `Backspace`, `Esc`.

---

## 16. ADB Shell into Android

```json
{"action":"split","command":"adb shell","title":"ADB","split":"vertical","size":0.45,
 "workdir":"C:\\Users\\ahmed","auto_close":false,"keep_on_error":true,"sanitize_proxy":true, ...}
```
```json
{"action":"send_input","pane_id":"<ID>","text":"su -c pm list packages","submit":true, ...}
```

---

## 17. Cloudflared Tunnel Watcher

```json
{"action":"split","command":"cloudflared tunnel --url http://localhost:3000","title":"TUNNEL",
 "split":"horizontal","size":0.4,"workdir":"C:\\Users\\ahmed","auto_close":false,
 "keep_on_error":true,"sanitize_proxy":true, ...}
```
```json
{"action":"wait_for","pane_id":"<ID>","pattern":"trycloudflare.com|Registered tunnel|error","timeout_ms":90000, ...}
{"action":"read_output","pane_id":"<ID>","lines":50,"clean":true, ...}
```

---

## 18. Pane Fleet Cleanup

```json
{"action":"list", ...}
```
Then kill each by exact ID:
```json
{"action":"kill","pane_id":"pane-munr29k2-r73z", ...}
```
Reclaim disk from finished panes:
```json
{"action":"clear", ...}
```

---

## 19. Forensics After a Crash

```json
{"action":"status","pane_id":"<ID>", ...}
```
Or read the flight log directly:
```
C:\Users\ahmed\.config\opencode\panes\<pane_id>\flight.log
```

---

## 20. Long Interactive Session Discipline

1. `split` once. Keep the same `pane_id` for the whole session.
2. `send_input` → `wait_idle(2000-4000)` → `read_output` as an atomic triple.
3. Only escalate to `wait_for(pattern)` when you know the exact success token.
4. `suspend` (not `kill`) when you need to park a process you might still want.
5. `kill` only when the work is truly done.
6. `restart` if a pane dies but the slot is still valuable.
