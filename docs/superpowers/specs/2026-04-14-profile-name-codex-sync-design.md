# Profile Name And Codex Sync Design

## Goal

Extend each `profiles` entry with a `name` field and make `claude-proxy config use` fully rewrite the Codex provider selection for the chosen profile.

This keeps `profiles` as a list, uses `model_provider` as the stable identifier, and uses `name` as the provider display name written into Codex.

## Scope

This change covers:

- the persisted profile schema in `config.toml`
- interactive prompts for `config add` and `config alt`
- `config get` output for active and saved profiles
- Codex config sync during `config use`
- migration defaults for older profile entries that do not include `name`
- tests and config examples

It does not change:

- profile identity, which remains `model_provider`
- Claude sync behavior
- proxy request conversion behavior

## Design Summary

Each `[[profiles]]` entry gains:

- `name`
- `model_provider`
- `base_url`
- `api_key`
- `big_model`
- `middle_model`
- `small_model`
- `default_claude_model`

Rules:

- `model_provider` remains the unique key used by `active_profile`, profile lookup, and deletion
- `name` is the Codex-facing display name for the selected provider
- when `name` is missing, it defaults to that profile's `model_provider`
- when adding a new profile, the default `model_provider` prompt value is `OpenAI`

## Config Format

### Profile Fields

Each entry in `[[profiles]]` stores:

- `name`
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
active_profile = "OpenAI"

[[profiles]]
name = "OpenAI"
model_provider = "OpenAI"
base_url = "https://api.openai.example/v1"
api_key = "sk-openai"
big_model = "gpt-5.4"
middle_model = "gpt-5.3-codex"
small_model = "gpt-5.2-codex"
default_claude_model = "opus[1m]"

[[profiles]]
name = "Z.AI"
model_provider = "zai"
base_url = "https://api.z.ai/v1"
api_key = "sk-zai"
big_model = "gpt-5.4"
middle_model = "gpt-5.3-codex"
small_model = "gpt-5.2-codex"
default_claude_model = "opus[1m]"
```

## Command Behavior

### `claude-proxy config add`

Prompt order:

- `model_provider` with default `OpenAI`
- `name` with default equal to the chosen `model_provider`
- `base_url`
- `api_key`
- `big_model`
- `middle_model`
- `small_model`
- `default_claude_model`

Rules:

- `model_provider` must be non-empty
- `model_provider` must be unique across `profiles`
- `name` may be left blank only if the prompt falls back to `model_provider`
- `config add` still does not sync Claude or Codex automatically

### `claude-proxy config alt`

After the user selects a profile, the edit flow prompts for:

- `name`
- `base_url`
- `api_key`
- `big_model`
- `middle_model`
- `small_model`
- `default_claude_model`

Rules:

- `model_provider` remains the stable identifier and is not edited here
- `name` is directly editable
- empty `name` falls back to the selected profile's `model_provider`

### `claude-proxy config get`

The summary output must show `name` in:

- the Active Profile section
- every entry under the Profiles list

The Profiles section continues to render as a single list block instead of repeated titled sections.

### `claude-proxy config use`

This command still:

1. shows the available profiles
2. lets the user choose one
3. writes `active_profile`
4. syncs the selected profile to Codex only

Codex sync must now:

- set top-level `model_provider` to the selected profile's `model_provider`
- set top-level `name` to the selected profile's `name`
- ensure `[model_providers.<model_provider>]` exists for the selected profile
- set that provider entry's `name` to the selected profile's `name`
- set that provider entry's `base_url` to the selected profile's `base_url`

When the currently stored provider key differs from the selected `model_provider`, the document should be rewritten so the active provider data lives under the selected key. Old provider keys that only represented the previous active profile should not remain as stale duplicates after the switch.

`OPENAI_API_KEY` sync stays unchanged and continues to come from the selected profile's `api_key`.

## Migration And Normalization

Older profile entries may already exist without `name`.

Normalization rules:

- if `profile.name` is present and non-empty, keep it
- otherwise set `name = model_provider`
- if a legacy profile used `name` as the old identifier field, continue treating that value as the fallback source for `model_provider`

Persistence rules:

- write `name` into each saved profile
- stop writing any removed top-level provider fields such as `codex_provider`

## Runtime Behavior

`loadConfig()` should continue to expose the selected profile as the active runtime config, and should additionally expose:

- `name` as the active profile display name
- `model_provider` as the stable active profile key

The active profile still drives:

- request routing base URL
- API key
- Claude model mappings
- Codex sync target

## Testing

Tests should cover:

- profile normalization when `name` is missing
- default `model_provider = "OpenAI"` during interactive add
- `config alt` editing `name`
- `config get` rendering `name` for active and saved profiles
- `config use` rewriting Codex top-level `model_provider` and `name`
- `config use` moving provider settings under `[model_providers.<selected model_provider>]`
- preserving `OPENAI_API_KEY` sync behavior

## Acceptance Criteria

- `config.toml` persists `[[profiles]]` entries with both `name` and `model_provider`
- existing configs without `name` continue to work without manual edits
- `claude-proxy config get` displays full profile details including `name`
- `claude-proxy config use` updates `~/.codex/config.toml` so the selected profile controls top-level `model_provider`, top-level `name`, and the active provider section key
