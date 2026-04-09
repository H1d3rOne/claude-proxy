# Multi-Profile Config Design

## Goal

Replace the current single upstream configuration with a `profiles` array so the CLI can store multiple upstreams, switch the active Codex credentials interactively, and edit any saved profile in place.

## Scope

This change covers the local single-machine CLI only.

It changes:

- the persisted `config.toml` schema
- `claude-proxy config` subcommands and help text
- Codex sync behavior when changing the active profile
- profile editing behavior through a dedicated command
- summary output in `config get`
- tests and example config

It does not add remote host support or change proxy request conversion behavior beyond reading from the active profile.

## Current Problem

The current config document stores one upstream only:

- `base_url`
- `api_key`
- `big_model`
- `middle_model`
- `small_model`
- `default_claude_model`

That makes switching between work and personal upstreams destructive because the user has to overwrite the single stored set of values.

## Design Summary

Split the config into:

- global runtime settings that stay at the top level
- a `profiles` array containing upstream configurations
- an `active_profile` top-level field naming the selected profile

`claude-proxy config` becomes a command group. The default action is removed. The new workflow is:

- `claude-proxy config add`
- `claude-proxy config use`
- `claude-proxy config alt`
- `claude-proxy config del`
- `claude-proxy config get`
- `claude-proxy config claude`

`config use` presents the existing profiles, lets the user choose one, stores that choice in `active_profile`, and syncs the selected profile into Codex by updating:

- Codex `model_provider`
- the selected provider's `base_url`
- `OPENAI_API_KEY`

## Config Format

### Global Fields

These remain top-level:

- `server_host`
- `server_port`
- `home_dir`
- `claude_dir`
- `codex_dir`
- `active_profile`

### Profile Fields

Each profile stores:

- `model_provider`
- `base_url`
- `api_key`
- `big_model`
- `middle_model`
- `small_model`
- `default_claude_model`

### Example

```toml
server_host = "127.0.0.1"
server_port = 8082
home_dir = "~"
claude_dir = "~/.claude"
codex_dir = "~/.codex"
active_profile = "work"

[[profiles]]
model_provider = "work"
base_url = "https://api.work.example/v1"
api_key = "sk-work"
big_model = "gpt-5.4"
middle_model = "gpt-5.3-codex"
small_model = "gpt-5.2-codex"
default_claude_model = "opus[1m]"

[[profiles]]
model_provider = "personal"
base_url = "https://api.personal.example/v1"
api_key = "sk-personal"
big_model = "gpt-5.4"
middle_model = "gpt-5.3-codex"
small_model = "gpt-5.2-codex"
default_claude_model = "opus[1m]"
```

## Command Behavior

### `claude-proxy config add`

Interactive command that prompts for:

- `model_provider`
- `base_url`
- `api_key`
- `big_model`
- `middle_model`
- `small_model`
- `default_claude_model`

Rules:

- `model_provider` must be non-empty
- `model_provider` must be unique across `profiles`
- `base_url` and `api_key` must be non-empty and not placeholder values
- if this is the first profile, set `active_profile` to the new `model_provider` automatically
- `config add` does not update Claude or Codex automatically

### `claude-proxy config use`

Interactive command that:

1. loads the profile list
2. shows the available `model_provider` values
3. lets the user choose one
4. writes `active_profile`
5. patches Codex config and auth using the selected profile only

Rules:

- if there are no profiles, fail with a clear message telling the user to run `config add`
- if the chosen profile is already active, keep the same `active_profile` value and still apply Codex sync
- Claude settings are not changed by this command

Codex changes are:

- set `model_provider` to the selected profile's `model_provider`
- set `model_providers.<model_provider>.base_url` to the selected profile's `base_url`
- set `OPENAI_API_KEY` to the selected profile's `api_key`

### `claude-proxy config alt`

Interactive command that:

1. shows the profile list
2. lets the user choose one
3. prompts for that profile's editable fields
4. rewrites that profile in `profiles`

Editable fields are:

- `base_url`
- `api_key`
- `big_model`
- `middle_model`
- `small_model`
- `default_claude_model`

Rules:

- `model_provider` is the stable identifier and is not edited through `config alt`
- `config alt` edits only the selected profile and does not modify Claude or Codex files directly

### `claude-proxy config del`

Interactive command that:

1. shows the profile list
2. lets the user choose one
3. removes it from `profiles`

Rules:

- if there are no profiles, fail with a clear message
- deleting the active profile is rejected with a clear error
- after deletion, no external Claude or Codex files are changed

### `claude-proxy config claude`

This command remains interactive and updates Claude settings only.

It keeps prompting for:

- `server_port`
- `big_model`
- `middle_model`
- `small_model`
- `default_claude_model`
- `claude_dir`

The model fields come from the active profile and are written back into the active profile selected by `active_profile`. `server_port` and `claude_dir` remain global.

Rules:

- if there is no active profile, fail with a clear message
- the command still patches Claude settings after saving
- it does not modify Codex files

### `claude-proxy config get`

Summary output includes:

- config file path and existence
- global fields
- active profile name
- active profile values
- every saved profile with full detail
- Claude status summary
- Codex status summary

Secrets continue to be shown exactly as today because the user explicitly wants every profile detail displayed, including `api_key`.

### Removed Behavior

The old default `claude-proxy config` action is removed. Running `claude-proxy config` without a subcommand should show help instead of prompting for a full flat config.

The old `claude-proxy config openai` command is removed because profile management now owns upstream selection.

## Loading and Runtime Behavior

`loadConfig()` resolves the active profile and returns one normalized config object that merges:

- global top-level values
- active profile values
- derived runtime paths

Proxy startup and request forwarding continue to read from the normalized config object, so they automatically use the active profile.

## Migration

The loader must remain backward-compatible with the existing flat document.

When reading a flat legacy document:

- top-level runtime fields stay top-level
- the old single-upstream fields are treated as an implicit profile
- the implicit `model_provider` is `default`
- `active_profile` resolves to `default`

Migration is persisted when a write path runs:

- `config add`
- `config use`
- `config alt`
- `config del`
- `config claude`

The first write after loading a legacy flat document rewrites the file into the new schema with:

- `active_profile = "default"`
- one `[[profiles]]` entry containing the old upstream values and `model_provider = "default"`

This keeps existing installs usable without a dedicated migration command.

## Cleaning Behavior

`clean`, `clean claude`, and `clean openai` keep restoring external managed files only.

They must not delete profiles or `active_profile` from `config.toml`, because those are now durable user-managed selections rather than temporary applied fields.

## Error Handling

User-facing errors should be explicit for:

- missing config file
- no profiles configured
- active profile not found
- duplicate `model_provider`
- invalid `server_port`
- empty or placeholder `base_url`
- empty or placeholder `api_key`
- attempting to delete the active profile

## Test Plan

Add or update tests for:

- loading the new schema
- loading legacy flat config as an implicit `default` profile
- writing migrated config on first mutating command
- `config add` prompt flow and persisted document
- `config use` choosing a profile and setting Codex `model_provider`, provider `base_url`, and auth
- `config alt` editing one selected profile in place
- `config del` removing a non-active profile
- rejecting delete of the active profile
- `config claude` editing the active profile model fields plus global Claude settings
- `config get` summary showing active profile and full detail for all profiles
- help output reflecting the new commands and removed ones

## Risks

The main behavioral asymmetry is intentional:

- switching profiles updates Codex
- editing an alternate profile through `config alt` does not switch or apply it
- Claude keeps its last applied settings until `config claude` is run again

This is acceptable because the user explicitly wants `config use` to sync Codex only, while `config alt` is for offline profile editing.

The CLI help and docs must state this clearly to avoid confusion.
