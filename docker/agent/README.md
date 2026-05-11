# Agent container image

Run-once base image used for every coding-agent session.

```bash
docker build -t rca-agent:latest -f Dockerfile .
```

## Environment

| Var | Default | Meaning |
| --- | --- | --- |
| `AGENT_KIND` | `shell` | `claude` to autostart Claude Code in YOLO mode; `shell` for bare bash. |
| `TTYD_PORT` | `7681` | Port ttyd binds inside the container. |
| `TTYD_AUTH` | _(unset)_ | Basic-auth `user:pass` for the ttyd WebSocket. |
| `INITIAL_CMD` | _(unset)_ | Command to run before dropping into the shell. |
| `ANTHROPIC_API_KEY` | _(unset)_ | Forwarded by the backend when `AGENT_KIND=claude`. |

The backend bind-mounts the project folder onto `/workspace`.
