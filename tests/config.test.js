const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  addProfile,
  clearConfigSection,
  collectConfigPrompts,
  deleteProfile,
  getDefaultConfigDir,
  getDefaultConfigDisplayPath,
  getDefaultConfigPath,
  loadConfig,
  readConfigDocument,
  setActiveProfile,
  updateClaudeConfig,
  updateProfile,
  writeConfigDocument
} = require("../src/config");

test("loadConfig normalizes a profile-based config document using the active profile", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-load-"));
  const configPath = path.join(rootDir, "config.toml");

  await fs.writeFile(
    configPath,
    [
      'server_host = "127.0.0.1"',
      "server_port = 8082",
      'active_profile = "Work Provider"',
      "",
      "[[profiles]]",
      'name = "Work Provider"',
      'model_provider = "work"',
      'base_url = "https://work.example/v1"',
      'api_key = "sk-work"',
      'big_model = "gpt-5.4"',
      'middle_model = "gpt-5.3-codex"',
      'small_model = "gpt-5.2-codex"',
      'default_claude_model = "opus[1m]"',
      "",
      "[[profiles]]",
      'name = "Personal Provider"',
      'model_provider = "personal"',
      'base_url = "https://personal.example/v1"',
      'api_key = "sk-personal"',
      'big_model = "gpt-4.1"',
      'middle_model = "gpt-4.1-mini"',
      'small_model = "gpt-4.1-nano"',
      'default_claude_model = "sonnet"',
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
  assert.equal(config.active_profile, "Work Provider");
  assert.equal(config.model_provider, "work");
  assert.equal(config.profile_name, "Work Provider");
  assert.equal(config.base_url, "https://work.example/v1");
  assert.equal(config.api_key, "sk-work");
  assert.equal(config.big_model, "gpt-5.4");
  assert.equal(config.default_claude_model, "opus[1m]");
  assert.equal(config.client_api_key, "arbitrary value");
  assert.equal(config.profiles.length, 2);
  assert.deepEqual(
    config.profiles.map((profile) => profile.model_provider),
    ["work", "personal"]
  );
  assert.deepEqual(
    config.profiles.map((profile) => profile.name),
    ["Work Provider", "Personal Provider"]
  );

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("loadConfig defaults a missing profile name to model_provider", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-profile-name-"));
  const configPath = path.join(rootDir, "config.toml");

  await fs.writeFile(
    configPath,
    [
      'server_host = "127.0.0.1"',
      "server_port = 8082",
      'active_profile = "work"',
      "",
      "[[profiles]]",
      'model_provider = "work"',
      'base_url = "https://work.example/v1"',
      'api_key = "sk-work"',
      'big_model = "gpt-5.4"',
      'middle_model = "gpt-5.3-codex"',
      'small_model = "gpt-5.2-codex"',
      'default_claude_model = "opus[1m]"',
      ""
    ].join("\n")
  );

  const config = await loadConfig(configPath);

  assert.equal(config.profile_name, "work");
  assert.equal(config.profiles[0].name, "work");

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("loadConfig treats the legacy flat document as an implicit default profile", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-legacy-flat-"));
  const configPath = path.join(rootDir, "config.toml");

  await fs.writeFile(
    configPath,
    [
      'server_host = "127.0.0.1"',
      "server_port = 8082",
      'base_url = "https://legacy.example/v1"',
      'api_key = "sk-legacy"',
      'big_model = "gpt-5.4"',
      'middle_model = "gpt-5.3-codex"',
      'small_model = "gpt-5.2-codex"',
      'default_claude_model = "opus[1m]"',
      ""
    ].join("\n")
  );

  const config = await loadConfig(configPath);

  assert.equal(config.active_profile, "default");
  assert.equal(config.base_url, "https://legacy.example/v1");
  assert.equal(config.api_key, "sk-legacy");
  assert.equal(config.profiles.length, 1);
  assert.equal(config.model_provider, "default");
  assert.equal(config.profile_name, "default");
  assert.equal(config.profiles[0].model_provider, "default");
  assert.equal(config.profiles[0].name, "default");
  assert.equal(config.profiles[0].base_url, "https://legacy.example/v1");
  assert.equal(config.profiles[0].api_key, "sk-legacy");

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
    codex_dir: "~/.codex"
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
      "codex_dir"
    ]
  );

  assert.equal(
    prompts.find((item) => item.target === "base_url")?.question,
    "base_url"
  );
  assert.equal(
    prompts.find((item) => item.target === "api_key")?.question,
    "api_key"
  );
});

test("getDefaultConfigPath always resolves to ~/.claude-proxy/config.toml", () => {
  assert.equal(getDefaultConfigDir(), path.join(os.homedir(), ".claude-proxy"));
  assert.equal(getDefaultConfigPath(), path.join(os.homedir(), ".claude-proxy", "config.toml"));
  assert.equal(getDefaultConfigDisplayPath(), "<home>/.claude-proxy/config.toml");
});

test("readConfigDocument can synthesize a starter profile-based config when the target file is missing", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-missing-"));
  const configPath = path.join(rootDir, "missing.toml");

  const { resolvedConfigPath, document } = await readConfigDocument(configPath, {
    allowMissing: true
  });

  assert.equal(resolvedConfigPath, configPath);
  assert.equal(document.server_host, "127.0.0.1");
  assert.equal(document.server_port, 8082);
  assert.equal(document.home_dir, "~");
  assert.equal(document.claude_dir, "~/.claude");
  assert.equal(document.codex_dir, "~/.codex");
  assert.deepEqual(document.profiles, []);
  assert.equal(document.active_profile, undefined);

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
          /Run "claude-proxy config add" first to create the default config at <home>\/\.claude-proxy\/config\.toml/
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
    codex_dir: "~/.codex-custom"
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
    codex_dir: "~/.codex-custom"
  });

  const changed = await clearConfigSection(configPath, "openai");
  assert.equal(changed, true);

  const { document } = await readConfigDocument(configPath);
  assert.equal(document.base_url, undefined);
  assert.equal(document.api_key, undefined);
  assert.equal(document.codex_dir, undefined);
  assert.equal(document.big_model, "gpt-5.4");
  assert.equal(document.middle_model, "gpt-5.3-codex");
  assert.equal(document.small_model, "gpt-5.2-codex");
  assert.equal(document.default_claude_model, "opus[1m]");
  assert.equal(document.claude_dir, "~/.claude-custom");

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("addProfile migrates a legacy flat config into profiles and keeps the legacy entry active", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-add-profile-"));
  const configPath = path.join(rootDir, "config.toml");

  await fs.writeFile(
    configPath,
    [
      'server_host = "127.0.0.1"',
      "server_port = 8082",
      'base_url = "https://legacy.example/v1"',
      'api_key = "sk-legacy"',
      'big_model = "gpt-5.4"',
      'middle_model = "gpt-5.3-codex"',
      'small_model = "gpt-5.2-codex"',
      'default_claude_model = "opus[1m]"',
      ""
    ].join("\n")
  );

  await addProfile(configPath, {
    name: "Personal Provider",
    model_provider: "personal",
    base_url: "https://personal.example/v1",
    api_key: "sk-personal",
    big_model: "gpt-4.1",
    middle_model: "gpt-4.1-mini",
    small_model: "gpt-4.1-nano",
    default_claude_model: "sonnet"
  });

  const { document } = await readConfigDocument(configPath);
  assert.equal(document.active_profile, "default");
  assert.equal(document.profiles.length, 2);
  assert.deepEqual(
    document.profiles.map((profile) => profile.model_provider),
    ["default", "personal"]
  );
  assert.deepEqual(
    document.profiles.map((profile) => profile.name),
    ["default", "Personal Provider"]
  );
  assert.equal(document.profiles[0].base_url, "https://legacy.example/v1");
  assert.equal(document.profiles[1].api_key, "sk-personal");
  assert.equal(document.base_url, undefined);
  assert.equal(document.api_key, undefined);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("addProfile rejects duplicate profile names", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-add-duplicate-"));
  const configPath = path.join(rootDir, "config.toml");

  await writeConfigDocument(configPath, {
    server_host: "127.0.0.1",
    server_port: 8082,
    active_profile: "Work Provider",
    profiles: [
      {
        name: "Work Provider",
        model_provider: "work",
        base_url: "https://work.example/v1",
        api_key: "sk-work",
        big_model: "gpt-5.4",
        middle_model: "gpt-5.3-codex",
        small_model: "gpt-5.2-codex",
        default_claude_model: "opus[1m]"
      }
    ]
  });

  await assert.rejects(
    () =>
      addProfile(configPath, {
        name: "Work Provider",
        model_provider: "work",
        base_url: "https://duplicate.example/v1",
        api_key: "sk-duplicate",
        big_model: "gpt-5.4",
        middle_model: "gpt-5.3-codex",
        small_model: "gpt-5.2-codex",
        default_claude_model: "opus[1m]"
      }),
    /Profile already exists: Work Provider/
  );

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("addProfile allows repeated model_provider values when names differ", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-add-duplicate-provider-"));
  const configPath = path.join(rootDir, "config.toml");

  await writeConfigDocument(configPath, {
    server_host: "127.0.0.1",
    server_port: 8082,
    active_profile: "Work Provider",
    profiles: [
      {
        name: "Work Provider",
        model_provider: "OpenAI",
        base_url: "https://work.example/v1",
        api_key: "sk-work",
        big_model: "gpt-5.4",
        middle_model: "gpt-5.3-codex",
        small_model: "gpt-5.2-codex",
        default_claude_model: "opus[1m]"
      }
    ]
  });

  await addProfile(configPath, {
    name: "Personal Provider",
    model_provider: "OpenAI",
    base_url: "https://personal.example/v1",
    api_key: "sk-personal",
    big_model: "gpt-4.1",
    middle_model: "gpt-4.1-mini",
    small_model: "gpt-4.1-nano",
    default_claude_model: "sonnet"
  });

  const { document } = await readConfigDocument(configPath);
  assert.equal(document.active_profile, "Work Provider");
  assert.deepEqual(
    document.profiles.map((profile) => profile.name),
    ["Work Provider", "Personal Provider"]
  );
  assert.deepEqual(
    document.profiles.map((profile) => profile.model_provider),
    ["OpenAI", "OpenAI"]
  );

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("setActiveProfile updates the selected model provider", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-set-active-"));
  const configPath = path.join(rootDir, "config.toml");

  await writeConfigDocument(configPath, {
    server_host: "127.0.0.1",
    server_port: 8082,
    active_profile: "Work Provider",
    profiles: [
      {
        name: "Work Provider",
        model_provider: "work",
        base_url: "https://work.example/v1",
        api_key: "sk-work",
        big_model: "gpt-5.4",
        middle_model: "gpt-5.3-codex",
        small_model: "gpt-5.2-codex",
        default_claude_model: "opus[1m]"
      },
      {
        name: "Personal Provider",
        model_provider: "personal",
        base_url: "https://personal.example/v1",
        api_key: "sk-personal",
        big_model: "gpt-4.1",
        middle_model: "gpt-4.1-mini",
        small_model: "gpt-4.1-nano",
        default_claude_model: "sonnet"
      }
    ]
  });

  await setActiveProfile(configPath, "Personal Provider");

  const { document } = await readConfigDocument(configPath);
  assert.equal(document.active_profile, "Personal Provider");

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("updateProfile updates the selected non-active profile in place", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-update-profile-"));
  const configPath = path.join(rootDir, "config.toml");

  await writeConfigDocument(configPath, {
    server_host: "127.0.0.1",
    server_port: 8082,
    active_profile: "Work Provider",
    profiles: [
      {
        name: "Work Provider",
        model_provider: "work",
        base_url: "https://work.example/v1",
        api_key: "sk-work",
        big_model: "gpt-5.4",
        middle_model: "gpt-5.3-codex",
        small_model: "gpt-5.2-codex",
        default_claude_model: "opus[1m]"
      },
      {
        name: "Personal Provider",
        model_provider: "personal",
        base_url: "https://personal.example/v1",
        api_key: "sk-personal",
        big_model: "gpt-4.1",
        middle_model: "gpt-4.1-mini",
        small_model: "gpt-4.1-nano",
        default_claude_model: "sonnet"
      }
    ]
  });

  await updateProfile(configPath, "Personal Provider", {
    name: "Personal Workspace",
    base_url: "https://edited.example/v1",
    api_key: "sk-edited",
    big_model: "gpt-4.1"
  });

  const { document } = await readConfigDocument(configPath);
  assert.equal(document.active_profile, "Work Provider");
  assert.equal(document.profiles[1].model_provider, "personal");
  assert.equal(document.profiles[1].name, "Personal Workspace");
  assert.equal(document.profiles[1].base_url, "https://edited.example/v1");
  assert.equal(document.profiles[1].api_key, "sk-edited");

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("deleteProfile removes a non-active profile", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-delete-profile-"));
  const configPath = path.join(rootDir, "config.toml");

  await writeConfigDocument(configPath, {
    server_host: "127.0.0.1",
    server_port: 8082,
    active_profile: "Work Provider",
    profiles: [
      {
        name: "Work Provider",
        model_provider: "work",
        base_url: "https://work.example/v1",
        api_key: "sk-work",
        big_model: "gpt-5.4",
        middle_model: "gpt-5.3-codex",
        small_model: "gpt-5.2-codex",
        default_claude_model: "opus[1m]"
      },
      {
        name: "Personal Provider",
        model_provider: "personal",
        base_url: "https://personal.example/v1",
        api_key: "sk-personal",
        big_model: "gpt-4.1",
        middle_model: "gpt-4.1-mini",
        small_model: "gpt-4.1-nano",
        default_claude_model: "sonnet"
      }
    ]
  });

  await deleteProfile(configPath, "Personal Provider");

  const { document } = await readConfigDocument(configPath);
  assert.equal(document.active_profile, "Work Provider");
  assert.deepEqual(
    document.profiles.map((profile) => profile.model_provider),
    ["work"]
  );

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("deleteProfile rejects deleting the active profile", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-delete-active-"));
  const configPath = path.join(rootDir, "config.toml");

  await writeConfigDocument(configPath, {
    server_host: "127.0.0.1",
    server_port: 8082,
    active_profile: "Work Provider",
    profiles: [
      {
        name: "Work Provider",
        model_provider: "work",
        base_url: "https://work.example/v1",
        api_key: "sk-work",
        big_model: "gpt-5.4",
        middle_model: "gpt-5.3-codex",
        small_model: "gpt-5.2-codex",
        default_claude_model: "opus[1m]"
      }
    ]
  });

  await assert.rejects(
    () => deleteProfile(configPath, "Work Provider"),
    /Cannot delete the active profile: Work Provider/
  );

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("updateClaudeConfig updates global Claude settings and the active profile model mappings", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-update-claude-"));
  const configPath = path.join(rootDir, "config.toml");

  await writeConfigDocument(configPath, {
    server_host: "127.0.0.1",
    server_port: 8082,
    claude_dir: "~/.claude",
    active_profile: "Work Provider",
    profiles: [
      {
        name: "Work Provider",
        model_provider: "work",
        base_url: "https://work.example/v1",
        api_key: "sk-work",
        big_model: "gpt-5.4",
        middle_model: "gpt-5.3-codex",
        small_model: "gpt-5.2-codex",
        default_claude_model: "opus[1m]"
      },
      {
        name: "Personal Provider",
        model_provider: "personal",
        base_url: "https://personal.example/v1",
        api_key: "sk-personal",
        big_model: "gpt-4.1",
        middle_model: "gpt-4.1-mini",
        small_model: "gpt-4.1-nano",
        default_claude_model: "sonnet"
      }
    ]
  });

  await updateClaudeConfig(configPath, {
    server_port: 9090,
    claude_dir: "~/.claude-custom",
    big_model: "claude-big",
    middle_model: "claude-middle",
    small_model: "claude-small",
    default_claude_model: "sonnet"
  });

  const { document } = await readConfigDocument(configPath);
  assert.equal(document.server_port, 9090);
  assert.equal(document.claude_dir, "~/.claude-custom");
  assert.equal(document.profiles[0].model_provider, "work");
  assert.equal(document.profiles[0].name, "Work Provider");
  assert.equal(document.profiles[0].big_model, "claude-big");
  assert.equal(document.profiles[0].middle_model, "claude-middle");
  assert.equal(document.profiles[0].small_model, "claude-small");
  assert.equal(document.profiles[0].default_claude_model, "sonnet");
  assert.equal(document.profiles[1].model_provider, "personal");
  assert.equal(document.profiles[1].name, "Personal Provider");
  assert.equal(document.profiles[1].big_model, "gpt-4.1");
  assert.equal(document.big_model, undefined);
  assert.equal(document.middle_model, undefined);

  await fs.rm(rootDir, { recursive: true, force: true });
});
