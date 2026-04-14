const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  applyClaudeManagedHostConfig,
  applyManagedHostConfig,
  applyOpenAIManagedHostConfig,
  cleanClaudeManagedHostConfig,
  cleanOpenAIManagedHostConfig
} = require("../src/services/client-config-manager");

function createHostFixture(rootDir) {
  const projectRoot = path.join(rootDir, "project with spaces");
  const claudeDir = path.join(rootDir, "claude-home");
  const codexDir = path.join(rootDir, "codex-home");
  const runtimeDir = path.join(claudeDir, "claude-proxy");
  const stateDir = path.join(runtimeDir, "state");
  const logsDir = path.join(runtimeDir, "logs");

  return {
    name: "local host",
    profile_name: "Personal Workspace",
    type: "local",
    base_url: "https://host-specific.example/v1",
    api_key: "host-openai-key",
    client_api_key: "arbitrary value",
    big_model: "gpt-5.4",
    middle_model: "gpt-5.3-codex",
    small_model: "gpt-5.2-codex",
    default_claude_model: "opus[1m]",
    model_provider: "personal",
    project_root: projectRoot,
    claude_dir: claudeDir,
    codex_dir: codexDir,
    runtime_dir: runtimeDir,
    state_dir: stateDir,
    logs_dir: logsDir,
    settings_path: path.join(claudeDir, "settings.json"),
    backups_dir: path.join(runtimeDir, "backups"),
    sessions_file: path.join(stateDir, "sessions.txt"),
    pid_file: path.join(stateDir, "proxy.pid"),
    managed_state_file: path.join(stateDir, "managed-files.json"),
    server_log_file: path.join(logsDir, "server.log"),
    codex_config_path: path.join(codexDir, "config.toml"),
    codex_auth_path: path.join(codexDir, "auth.json"),
    config_path: path.join(projectRoot, "config.toml")
  };
}

test("applyManagedHostConfig patches Claude and Codex files and split clean commands restore them independently", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-managed-"));
  const host = createHostFixture(rootDir);
  const config = {
    server_port: 8082,
    __configPath: path.join(rootDir, "custom", "config.toml")
  };
  const applyEvents = [];
  const cleanClaudeEvents = [];
  const cleanOpenAIEvents = [];

  await fs.mkdir(host.project_root, { recursive: true });
  await fs.mkdir(host.claude_dir, { recursive: true });
  await fs.mkdir(host.codex_dir, { recursive: true });
  await fs.writeFile(
    host.settings_path,
    JSON.stringify(
      {
        env: {
          KEEP_ME: "yes"
        },
        hooks: {
          SessionStart: [{ hooks: [{ type: "command", command: "echo keep start" }] }]
        }
      },
      null,
      2
    )
  );
  await fs.writeFile(
    host.codex_config_path,
    [
      'model_provider = "custom"',
      "",
      "[model_providers.custom]",
      'name = "custom"',
      'base_url = "https://old.example/v1"',
      'wire_api = "responses"',
      'requires_openai_auth = true',
      ""
    ].join("\n")
  );
  await fs.writeFile(
    host.codex_auth_path,
    JSON.stringify(
      {
        OPENAI_API_KEY: "old-openai-key",
        KEEP_ME: "yes"
      },
      null,
      2
    )
  );

  await applyManagedHostConfig(config, host, {
    onProgress(event) {
      applyEvents.push(event);
    }
  });

  const patchedSettings = JSON.parse(await fs.readFile(host.settings_path, "utf8"));
  assert.equal(patchedSettings.env.ANTHROPIC_BASE_URL, "http://localhost:8082");
  assert.equal(patchedSettings.env.ANTHROPIC_API_KEY, "arbitrary value");
  assert.equal(patchedSettings.env.KEEP_ME, "yes");
  assert.match(
    patchedSettings.hooks.SessionStart[1].hooks[0].command,
    /--config '.*custom\/config\.toml'/
  );

  const patchedCodexConfig = await fs.readFile(host.codex_config_path, "utf8");
  assert.match(patchedCodexConfig, /model_provider = "personal"/);
  assert.match(patchedCodexConfig, /name = "Personal Workspace"/);
  assert.match(patchedCodexConfig, /\[model_providers\.personal\]/);
  assert.match(patchedCodexConfig, /\[model_providers\.personal\][\s\S]*name = "Personal Workspace"/);
  assert.match(patchedCodexConfig, /base_url = "https:\/\/host-specific\.example\/v1"/);
  assert.doesNotMatch(patchedCodexConfig, /\[model_providers\.custom\]/);

  const patchedAuth = JSON.parse(await fs.readFile(host.codex_auth_path, "utf8"));
  assert.equal(patchedAuth.OPENAI_API_KEY, "host-openai-key");
  assert.equal(patchedAuth.KEEP_ME, "yes");

  await cleanClaudeManagedHostConfig(config, host, {
    onProgress(event) {
      cleanClaudeEvents.push(event);
    }
  });

  const restoredClaudeSettings = JSON.parse(await fs.readFile(host.settings_path, "utf8"));
  assert.deepEqual(restoredClaudeSettings, {
    env: {
      KEEP_ME: "yes"
    },
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "echo keep start" }] }]
    }
  });

  const codexConfigAfterClaudeClean = await fs.readFile(host.codex_config_path, "utf8");
  assert.match(codexConfigAfterClaudeClean, /base_url = "https:\/\/host-specific\.example\/v1"/);

  const authAfterClaudeClean = JSON.parse(await fs.readFile(host.codex_auth_path, "utf8"));
  assert.deepEqual(authAfterClaudeClean, {
    OPENAI_API_KEY: "host-openai-key",
    KEEP_ME: "yes"
  });

  const stateAfterClaudeClean = JSON.parse(await fs.readFile(host.managed_state_file, "utf8"));
  assert.deepEqual(Object.keys(stateAfterClaudeClean.files).sort(), ["codex_auth", "codex_config"]);

  assert.deepEqual(
    applyEvents.map((event) => `${event.status}:${event.label}`),
    [
      `started:Update Codex config (${host.codex_config_path})`,
      `completed:Update Codex config (${host.codex_config_path})`,
      `started:Update Codex auth (${host.codex_auth_path})`,
      `completed:Update Codex auth (${host.codex_auth_path})`,
      `started:Update Claude settings (${host.settings_path})`,
      `completed:Update Claude settings (${host.settings_path})`,
      `started:Write managed state (${host.managed_state_file})`,
      `completed:Write managed state (${host.managed_state_file})`
    ]
  );

  assert.deepEqual(
    cleanClaudeEvents.map((event) => `${event.status}:${event.label}`),
    [
      `started:Restore Claude settings (${host.settings_path})`,
      `completed:Restore Claude settings (${host.settings_path})`,
      `started:Write managed state (${host.managed_state_file})`,
      `completed:Write managed state (${host.managed_state_file})`
    ]
  );

  await cleanOpenAIManagedHostConfig(config, host, {
    onProgress(event) {
      cleanOpenAIEvents.push(event);
    }
  });

  const restoredCodexConfig = await fs.readFile(host.codex_config_path, "utf8");
  assert.match(restoredCodexConfig, /base_url = "https:\/\/old\.example\/v1"/);

  const restoredAuth = JSON.parse(await fs.readFile(host.codex_auth_path, "utf8"));
  assert.deepEqual(restoredAuth, {
    OPENAI_API_KEY: "old-openai-key",
    KEEP_ME: "yes"
  });

  await assert.rejects(() => fs.readFile(host.managed_state_file, "utf8"), /ENOENT/);

  assert.deepEqual(
    cleanOpenAIEvents.map((event) => `${event.status}:${event.label}`),
    [
      `started:Restore Codex config (${host.codex_config_path})`,
      `completed:Restore Codex config (${host.codex_config_path})`,
      `started:Restore Codex auth (${host.codex_auth_path})`,
      `completed:Restore Codex auth (${host.codex_auth_path})`,
      `started:Remove managed state (${host.managed_state_file})`,
      `completed:Remove managed state (${host.managed_state_file})`
    ]
  );

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("partial config apply updates only the requested section and managed state", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-partial-managed-"));
  const host = createHostFixture(rootDir);
  const claudeOnlyConfig = {
    server_port: 9090,
    small_model: "claude-small",
    middle_model: "claude-middle",
    big_model: "claude-big",
    default_claude_model: "sonnet",
    __configPath: path.join(rootDir, "config.toml")
  };
  const openAiOnlyConfig = {
    api_key: "new-openai-key",
    base_url: "https://new-upstream.example/v1",
    model_provider: "workspace",
    profile_name: "Workspace Provider",
    __configPath: path.join(rootDir, "config.toml")
  };
  host.big_model = undefined;
  host.middle_model = undefined;
  host.small_model = undefined;
  host.default_claude_model = undefined;
  host.base_url = undefined;
  host.api_key = undefined;
  host.model_provider = undefined;

  await fs.mkdir(host.project_root, { recursive: true });
  await fs.mkdir(host.claude_dir, { recursive: true });
  await fs.mkdir(host.codex_dir, { recursive: true });
  await fs.writeFile(
    host.settings_path,
    JSON.stringify(
      {
        env: {
          KEEP_ME: "yes"
        }
      },
      null,
      2
    )
  );
  await fs.writeFile(
    host.codex_config_path,
    [
      'base_url = "https://old.example/v1"',
      ""
    ].join("\n")
  );
  await fs.writeFile(
    host.codex_auth_path,
    JSON.stringify(
      {
        OPENAI_API_KEY: "old-openai-key"
      },
      null,
      2
    )
  );

  await applyClaudeManagedHostConfig(claudeOnlyConfig, host);

  const claudePatched = JSON.parse(await fs.readFile(host.settings_path, "utf8"));
  assert.equal(claudePatched.env.ANTHROPIC_BASE_URL, "http://localhost:9090");
  assert.equal(claudePatched.model, "sonnet");

  const codexConfigAfterClaudeApply = await fs.readFile(host.codex_config_path, "utf8");
  assert.match(codexConfigAfterClaudeApply, /https:\/\/old\.example\/v1/);
  const codexAuthAfterClaudeApply = JSON.parse(await fs.readFile(host.codex_auth_path, "utf8"));
  assert.equal(codexAuthAfterClaudeApply.OPENAI_API_KEY, "old-openai-key");

  let state = JSON.parse(await fs.readFile(host.managed_state_file, "utf8"));
  assert.deepEqual(Object.keys(state.files), ["claude_settings"]);

  await applyOpenAIManagedHostConfig(openAiOnlyConfig, host);

  const codexConfigAfterOpenAIApply = await fs.readFile(host.codex_config_path, "utf8");
  assert.match(codexConfigAfterOpenAIApply, /model_provider = "workspace"/);
  assert.match(codexConfigAfterOpenAIApply, /name = "Workspace Provider"/);
  assert.match(codexConfigAfterOpenAIApply, /\[model_providers\.workspace\]/);
  assert.match(codexConfigAfterOpenAIApply, /\[model_providers\.workspace\][\s\S]*name = "Workspace Provider"/);
  assert.match(codexConfigAfterOpenAIApply, /base_url = "https:\/\/new-upstream\.example\/v1"/);
  const codexAuthAfterOpenAIApply = JSON.parse(await fs.readFile(host.codex_auth_path, "utf8"));
  assert.equal(codexAuthAfterOpenAIApply.OPENAI_API_KEY, "new-openai-key");

  state = JSON.parse(await fs.readFile(host.managed_state_file, "utf8"));
  assert.deepEqual(Object.keys(state.files).sort(), ["claude_settings", "codex_auth", "codex_config"]);

  await fs.rm(rootDir, { recursive: true, force: true });
});
