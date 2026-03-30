# Single-Machine CLI Redesign

## Goal

Reduce `claude-proxy` to a local-only tool. Remove all remote-host concepts, flatten configuration into one top-level local config, and expose four public commands: `config`, `clean`, `start`, and `stop`.

## Scope

This redesign changes command behavior, configuration shape, help text, docs, and tests.

- `config` becomes an interactive local configuration flow.
- `clean` restores Claude and Codex configuration files touched by this tool but does not stop the proxy.
- `start` starts the proxy server only.
- `stop` stops the proxy server only.
- `serve` is removed.
- Remote hosts, SSH sync, and per-host selection are removed entirely.

## CLI Behavior

### `claude-proxy config set`

`config set` loads or creates `~/.claude-proxy/config.toml`, prompts for each supported field one by one, writes the file, and patches local Claude/Codex configuration to use the proxy.

It does not start, restart, or stop the proxy server.

### `claude-proxy config get`

`config get` prints a human-readable summary of the current config file plus key Claude and Codex settings managed by this project.

### `claude-proxy clean`

`clean` restores backed-up local Claude/Codex files and removes managed hooks and env values created by this project.

It does not stop the proxy server.

### `claude-proxy start`

`start` reads the local config and starts the proxy server in the foreground for the configured local upstream.

### `claude-proxy stop`

`stop` reads the local config and stops the managed proxy process if it exists.

## Claude Hook Behavior

`config` installs Claude hooks that keep the proxy aligned with Claude lifecycle:

- `SessionStart` runs `internal ensure-proxy`. It checks whether the managed proxy PID is alive and starts the proxy in the background if it is not.
- `SessionEnd` runs `internal stop-proxy`. It unregisters the Claude session and stops the proxy once the last managed session ends.

This means launching Claude ensures the proxy is running, and closing Claude stops it automatically.

## Configuration Format

The new `config.toml` is a single top-level document with no `[[hosts]]` array:

```toml
server_host = "127.0.0.1"
server_port = 8082
base_url = "https://api.example.com/v1"
api_key = "sk-xxx"
big_model = "gpt-5.4"
middle_model = "gpt-5.3-codex"
small_model = "gpt-5.2-codex"
default_claude_model = "opus[1m]"
home_dir = "~"
claude_dir = "~/.claude"
codex_dir = "~/.codex"
codex_provider = "custom"
```

Required user-facing fields:

- `base_url`
- `api_key`

Fields with defaults:

- `server_host = "127.0.0.1"`
- `server_port = 8082`
- `big_model = "gpt-5.4"`
- `middle_model = "gpt-5.3-codex"`
- `small_model = "gpt-5.2-codex"`
- `default_claude_model = "opus[1m]"`
- `home_dir = "~"`
- `claude_dir = "~/.claude"`
- `codex_dir = "~/.codex"`
- `codex_provider = null`

## Compatibility Rules

Old multi-host or remote configuration is rejected with a clear migration error. Rejected inputs include:

- `[[hosts]]`
- top-level remote/host selection fields
- remote-only fields such as `type`, `host`, `user`, and `sync_project`

The error should explain that only the single-machine top-level format is supported now.

## Internal Architecture Changes

- `src/config.js` becomes a single-config loader/normalizer/prompt helper.
- `src/cli.js` no longer imports or references `remote-manager`.
- `src/services/remote-manager.js` is removed.
- `src/services/host-manager.js` no longer shells out to `serve`; it shells out to `start`.
- Internal commands remain hidden, but they no longer require `--host`.

## Testing

Update tests to cover:

- help output for `config`, `clean`, `start`, and `stop`
- rejection of legacy `[[hosts]]` config
- default-config synthesis in the new flat shape
- prompt collection for missing top-level fields
- Claude hook commands using hostless internal commands
- `clean` no longer stopping the proxy as part of its public action

## Risks

- Existing users with `[[hosts]]` configs will need to migrate manually.
- Hook command changes must stay compatible with existing session tracking logic.
- Removing remote code must not regress local backup/restore behavior.
