# Security

Orkestr is a single-user, local application. The threat model is: other websites in your browser, other users on
the network, malformed media/inputs, and model output.

| Control | Implementation |
| --- | --- |
| Local binding | `next dev/start -H 127.0.0.1`; the worker opens no port. Remotion's file server binds an ephemeral `127.0.0.1` port with unguessable per-file tokens and only lives during a render. |
| DNS rebinding | every API route rejects a non-loopback `Host` header (403). |
| CSRF | state-changing requests with a foreign `Origin` are rejected (403). |
| Credentials | AES-256-GCM, key in `data/secret.key` (created `0600` where supported), never returned by the API (masked hint only), registered for log redaction when loaded. `ELEVENLABS_API_KEY` env var is supported as an override. |
| Log redaction | events, errors and stderr pass through `redact()` (registered secrets + key/bearer patterns); event data is deep-redacted by key name. |
| Paths | every stored/served path goes through `resolveInside(base, p)` (no `..`, no absolute escapes, no NUL, no NTFS alternate streams). Imports only from Settings → import folders. Export names are sanitized; existing exports are never overwritten. |
| Processes | allowlist populated by discovery; `spawn` with argv arrays, `shell:false`, timeouts, output caps, abort → SIGTERM then SIGKILL. Workflow nodes cannot run arbitrary commands: they can only call capabilities of registered adapters with Zod-validated params. |
| Model output | the Claude CLI runs with no tools (`--tools ""`, no MCP, no persistence) and a budget cap; output is JSON validated by schema; it is never executed. The review node gets read-only access to a temp folder of frames. |
| Uploads | extension allowlist, 1 GB cap, content-addressed storage, `X-Content-Type-Options: nosniff` on serving. |
| URL capture | Playwright accepts only `http(s)` URLs, downloads disabled. |
| Spending | paid capabilities require approval unless inside a preauthorized, *known-price* budget; unknown prices always ask; approvals are single-use and audited. |
| Resource limits | worker concurrency (Settings), per-process timeouts, bounded retries. |

## Known limitations

- No authentication beyond loopback: any process running as you on this machine can call the API (including
  approving paid steps). Don't run untrusted software alongside it, or put it behind an OS-level firewall/user.
- `data/secret.key` sits next to the database; anyone with your user account can decrypt credentials (same as most
  local tools). On Windows, wrapping the key with DPAPI is a possible next step.
- Playwright captures may load third-party content of the captured site.
- Remotion Studio (`npm run remotion:studio`) is a separate dev tool with its own server; run it only when needed.

Report issues privately to the maintainer.
