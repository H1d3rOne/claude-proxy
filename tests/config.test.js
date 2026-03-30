const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  clearConfigSection,
  collectConfigPrompts,
  getDefaultConfigDir,
  getDefaultConfigDisplayPath,
  getDefaultConfigPath,
  loadConfig,
  readConfigDocument,
  writeConfigDocument
} = require("../src/config");

test("loadConfig normalizes a flat local config document", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-load-"));
  const configPath = path.join(rootDir, "config.toml");

  await fs.writeFile(
    configPath,
    [
      'server_host = "127.0.0.1"',
      "server_port = 8082",
      'base_url = "https://local.example/v1"',
      'api_key = "sk-local"',
      'big_model = "gpt-5.4"',
      'middle_model = "gpt-5.3-codex"',
      'small_model = "gpt-5.2-codex"',
      'default_claude_model = "opus[1m]"',
      'codex_provider = "custom"',
      ""
    ].join("\n")
  );

  const config = await loadConfig(configPath);
  assert.equal(config.server_host, "127.0.0.1");
  assert.equal(config.server_port, 8082);
  assert.equal(config.name, "local");
  assert.equal(config.type, "local");
  assert.equal(config.project_root, rootDir);
  assert.match(config.claude_dir, /\.claude$/);
  assert.match(config.codex_dir, /\.codex$/);
  assert.equal(config.base_url, "https://local.example/v1");
  assert.equal(config.api_key, "sk-local");
  assert.equal(config.client_api_key, "arbitrary value");
  assert.equal(config.codex_provider, "custom");

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("collectConfigPrompts returns all interactive fields in stable order", () => {
  const prompts = collectConfigPrompts({
    server_host: "127.0.0.1",
    server_port: 8082,
    base_url: "",
    api_key: "",
    big_model: "gpt-5.4",
    middle_model: "gpt-5.3-codex",
    small_model: "gpt-5.2-codex",
    default_claude_model: "opus[1m]",
    home_dir: "~",
    claude_dir: "~/.claude",
    codex_dir: "~/.codex",
    codex_provider: ""
  });

  assert.deepEqual(
    prompts.map((item) => item.target),
    [
      "server_host",
      "server_port",
      "base_url",
      "api_key",
      "big_model",
      "middle_model",
      "small_model",
      "default_claude_model",
      "home_dir",
      "claude_dir",
      "codex_dir",
      "codex_provider"
    ]
  );
});

test("getDefaultConfigPath always resolves to ~/.claude-proxy/config.toml", () => {
  assert.equal(getDefaultConfigDir(), path.join(os.homedir(), ".claude-proxy"));
  assert.equal(getDefaultConfigPath(), path.join(os.homedir(), ".claude-proxy", "config.toml"));
  assert.equal(getDefaultConfigDisplayPath(), "<home>/.claude-proxy/config.toml");
});

test("readConfigDocument can synthesize a starter flat config when the target file is missing", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-missing-"));
  const configPath = path.join(rootDir, "missing.toml");

  const { resolvedConfigPath, document } = await readConfigDocument(configPath, {
    allowMissing: true
  });

  assert.equal(resolvedConfigPath, configPath);
  assert.equal(document.server_host, "127.0.0.1");
  assert.equal(document.server_port, 8082);
  assert.equal(document.base_url, "");
  assert.equal(document.api_key, "");
  assert.equal(document.big_model, "gpt-5.4");
  assert.equal(document.middle_model, "gpt-5.3-codex");
  assert.equal(document.small_model, "gpt-5.2-codex");
  assert.equal(document.default_claude_model, "opus[1m]");

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("readConfigDocument reports a helpful message when the default config is missing", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-default-missing-"));
  const previousHome = process.env.HOME;
  process.env.HOME = rootDir;

  try {
    const defaultConfigPath = getDefaultConfigPath();

    await assert.rejects(
      () => readConfigDocument(),
      (error) => {
        assert.match(
          error.message,
          /Config file not found: <home>\/\.claude-proxy\/config\.toml/
        );
        assert.doesNotMatch(
          error.message,
          new RegExp(defaultConfigPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        );
        assert.match(
          error.message,
          /Run "claude-proxy config" first to create the default config at <home>\/\.claude-proxy\/config\.toml/
        );
        assert.match(error.message, /config_example\.toml/);
        return true;
      }
    );
  } finally {
    if (previousHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("writeConfigDocument creates parent directories for a new user-scoped config", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-write-"));
  const configPath = path.join(rootDir, "nested", "claude-proxy", "config.toml");

  await writeConfigDocument(configPath, {
    server_host: "127.0.0.1",
    server_port: 8082,
    base_url: "",
    api_key: "",
    big_model: "gpt-5.4",
    middle_model: "gpt-5.3-codex",
    small_model: "gpt-5.2-codex",
    default_claude_model: "opus[1m]"
  });

  const saved = await fs.readFile(configPath, "utf8");
  assert.match(saved, /server_host = "127\.0\.0\.1"/);
  assert.match(saved, /base_url = ""/);
  assert.doesNotMatch(saved, /\[\[hosts\]\]/);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("loadConfig rejects legacy multi-host documents", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-legacy-hosts-"));
  const configPath = path.join(rootDir, "config.toml");

  await fs.writeFile(
    configPath,
    [
      'server_host = "127.0.0.1"',
      "server_port = 8082",
      "",
      "[[hosts]]",
      'name = "local"',
      'type = "local"',
      'base_url = "https://local.example/v1"',
      'api_key = "sk-local"',
      ""
    ].join("\n")
  );

  await assert.rejects(
    () => loadConfig(configPath),
    /Only the single-machine top-level config format is supported now/
  );

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("clearConfigSection removes only Claude-owned fields from config.toml", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-clear-claude-"));
  const configPath = path.join(rootDir, "config.toml");

  await writeConfigDocument(configPath, {
    server_host: "127.0.0.1",
    server_port: 8082,
    base_url: "https://local.example/v1",
    api_key: "sk-local",
    big_model: "gpt-5.4",
    middle_model: "gpt-5.3-codex",
    small_model: "gpt-5.2-codex",
    default_claude_model: "opus[1m]",
    home_dir: "~",
    claude_dir: "~/.claude-custom",
    codex_dir: "~/.codex-custom",
    codex_provider: "custom"
  });

  const changed = await clearConfigSection(configPath, "claude");
  assert.equal(changed, true);

  const { document } = await readConfigDocument(configPath);
  assert.equal(document.server_port, undefined);
  assert.equal(document.big_model, undefined);
  assert.equal(document.middle_model, undefined);
  assert.equal(document.small_model, undefined);
  assert.equal(document.default_claude_model, undefined);
  assert.equal(document.claude_dir, undefined);
  assert.equal(document.base_url, "https://local.example/v1");
  assert.equal(document.api_key, "sk-local");
  assert.equal(document.codex_dir, "~/.codex-custom");
  assert.equal(document.codex_provider, "custom");

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("clearConfigSection removes only OpenAI-owned fields from config.toml", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-clear-openai-"));
  const configPath = path.join(rootDir, "config.toml");

  await writeConfigDocument(configPath, {
    server_host: "127.0.0.1",
    server_port: 8082,
    base_url: "https://local.example/v1",
    api_key: "sk-local",
    big_model: "gpt-5.4",
    middle_model: "gpt-5.3-codex",
    small_model: "gpt-5.2-codex",
    default_claude_model: "opus[1m]",
    home_dir: "~",
    claude_dir: "~/.claude-custom",
    codex_dir: "~/.codex-custom",
    codex_provider: "custom"
  });

  const changed = await clearConfigSection(configPath, "openai");
  assert.equal(changed, true);

  const { document } = await readConfigDocument(configPath);
  assert.equal(document.base_url, undefined);
  assert.equal(document.api_key, undefined);
  assert.equal(document.codex_dir, undefined);
  assert.equal(document.codex_provider, undefined);
  assert.equal(document.big_model, "gpt-5.4");
  assert.equal(document.middle_model, "gpt-5.3-codex");
  assert.equal(document.small_model, "gpt-5.2-codex");
  assert.equal(document.default_claude_model, "opus[1m]");
  assert.equal(document.claude_dir, "~/.claude-custom");

  await fs.rm(rootDir, { recursive: true, force: true });
});
