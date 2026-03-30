# claude-proxy

`claude-proxy` is a Node.js rewrite of `claude-code-proxy` plus a local setup tool for Claude Code and Codex.

It provides:

- a Claude-compatible `/v1/messages` proxy backed by an OpenAI-compatible upstream
- `claude-proxy config` to interactively configure the full local proxy and patch Claude Code and Codex config
- `claude-proxy config claude` to configure only the Claude-owned settings
- `claude-proxy config openai` to configure only the OpenAI/Codex-owned settings
- `claude-proxy config get` to show the current local proxy, Claude, and Codex configuration summary
- `claude-proxy clean` to restore all managed files and clear Claude/OpenAI-owned config fields
- `claude-proxy clean claude` to restore Claude files from backups
- `claude-proxy clean openai` to restore Codex/OpenAI files from backups
- `claude-proxy start` and `claude-proxy stop` to manage the local proxy process directly

## Commands

```bash
npm install
npm test
npm link

claude-proxy config
claude-proxy config claude
claude-proxy config openai
claude-proxy config get
claude-proxy clean
claude-proxy clean claude
claude-proxy clean openai
claude-proxy start
claude-proxy stop
```

## Install After Publishing

Install globally to run from any directory:

```bash
npm install -g claude-proxy
claude-proxy config
```

Or run without a global install:

```bash
npx claude-proxy config
```

For automatic Claude start/stop hooks, `claude-proxy` must be available on `PATH`. A global install is the intended setup.

## What `config` Does

`claude-proxy config` will:

- prompt for each config item in `~/.claude-proxy/config.toml`
- update `~/.codex/config.toml` so the active provider uses the configured `base_url`
- update `~/.codex/auth.json` so `OPENAI_API_KEY` matches the configured `api_key`
- update `~/.claude/settings.json` so Claude uses `ANTHROPIC_BASE_URL=http://localhost:8082`
- set `ANTHROPIC_API_KEY` to the fixed placeholder value `arbitrary value`
- install Claude `SessionStart` and `SessionEnd` hooks which auto-start and auto-stop the proxy
- write the config file and apply local Claude/Codex settings only

## What `config claude` Does

`claude-proxy config claude` will:

- prompt only for Claude-owned config fields in `~/.claude-proxy/config.toml`
- update Claude settings and hooks only
- leave Codex/OpenAI files untouched

## What `config openai` Does

`claude-proxy config openai` will:

- prompt only for OpenAI/Codex-owned config fields in `~/.claude-proxy/config.toml`
- update Codex config and auth only
- leave Claude files untouched

## What `config get` Does

`claude-proxy config get` will:

- show the current config file path and effective config values
- show key Claude settings and whether the managed hooks are installed
- show key Codex config and auth values

## What `clean` Does

`claude-proxy clean` will:

- restore all managed Claude and Codex files from backups created during `config`
- remove Claude-owned and OpenAI/Codex-owned fields from `~/.claude-proxy/config.toml`
- leave any currently running proxy process untouched

## What `clean claude` Does

`claude-proxy clean claude` will:

- remove the Claude hooks installed by this project
- restore the original Claude settings file from backups created during `config`
- remove Claude-owned fields from `~/.claude-proxy/config.toml`
- leave Codex/OpenAI files untouched
- leave any currently running proxy process untouched

## What `clean openai` Does

`claude-proxy clean openai` will:

- restore the original Codex config and auth files from backups created during `config`
- remove OpenAI/Codex-owned fields from `~/.claude-proxy/config.toml`
- leave Claude settings untouched
- leave any currently running proxy process untouched

## What `start` Does

`claude-proxy start` will:

- read the local config file
- start the local proxy server in the foreground

## What `stop` Does

`claude-proxy stop` will:

- stop the managed local proxy process if it is running

## Config

By default the CLI uses:

- `~/.claude-proxy/config.toml`

You can always override this with `--config /path/to/config.toml`.

The config file format matches [config_example.toml](./config_example.toml).

- `server_host`: proxy listen host, defaults to `127.0.0.1`
- `server_port`: proxy listen port, defaults to `8082`
- `base_url`: upstream OpenAI-compatible API base URL
  If you use a provider root such as `https://newapis.xyz`, the Claude proxy will automatically send chat-completions traffic to `/v1/chat/completions`.
- `api_key`: upstream provider API key
- `big_model`, `middle_model`, `small_model`: Claude-to-upstream model mapping
- `default_claude_model`: Claude UI default model
- `home_dir`: base home directory, defaults to `~`
- `claude_dir`: Claude config directory, defaults to `~/.claude`
- `codex_dir`: Codex config directory, defaults to `~/.codex`
- `codex_provider`: optional Codex provider name to patch

Section ownership:

- `config claude` / `clean claude`: `server_port`, `big_model`, `middle_model`, `small_model`, `default_claude_model`, `claude_dir`
- `config openai` / `clean openai`: `base_url`, `api_key`, `codex_dir`, `codex_provider`
- `config` / `clean`: all managed fields above
