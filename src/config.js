const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const readline = require("readline/promises");
const toml = require("@iarna/toml");

const DEFAULT_CLIENT_API_KEY = "arbitrary value";
const DEFAULT_BIG_MODEL = "gpt-5.4";
const DEFAULT_MIDDLE_MODEL = "gpt-5.3-codex";
const DEFAULT_SMALL_MODEL = "gpt-5.2-codex";
const DEFAULT_CLAUDE_MODEL = "opus[1m]";
const LEGACY_TOP_LEVEL_FIELDS = ["hosts", "type", "name", "enabled", "host", "user", "sync_project"];
const CONFIG_SECTION_FIELDS = {
  claude: ["server_port", "big_model", "middle_model", "small_model", "default_claude_model", "claude_dir"],
  openai: ["base_url", "api_key", "codex_dir", "codex_provider"]
};

function expandHome(inputPath) {
  if (!inputPath || typeof inputPath !== "string") {
    return inputPath;
  }

  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function normalizeLocalPath(inputPath, baseDir) {
  const expanded = expandHome(inputPath);
  if (!expanded) {
    return expanded;
  }

  if (path.isAbsolute(expanded)) {
    return expanded;
  }

  return path.resolve(baseDir, expanded);
}

function getDefaultConfigDir() {
  return path.join(os.homedir(), ".claude-proxy");
}

function getDefaultConfigPath() {
  return path.join(getDefaultConfigDir(), "config.toml");
}

function getDefaultConfigDisplayPath() {
  return "<home>/.claude-proxy/config.toml";
}

function createDefaultConfigDocument() {
  return {
    server_host: "127.0.0.1",
    server_port: 8082,
    base_url: "",
    api_key: "",
    big_model: DEFAULT_BIG_MODEL,
    middle_model: DEFAULT_MIDDLE_MODEL,
    small_model: DEFAULT_SMALL_MODEL,
    default_claude_model: DEFAULT_CLAUDE_MODEL,
    home_dir: "~",
    claude_dir: "~/.claude",
    codex_dir: "~/.codex"
  };
}

function isPlaceholderValue(value) {
  if (value == null) {
    return true;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return true;
  }

  const lowered = normalized.toLowerCase();
  return (
    lowered.startsWith("replace-with-") ||
    lowered.startsWith("your-") ||
    lowered === "changeme" ||
    lowered === "todo"
  );
}

function applyHostRuntimePaths(host, runtime = {}) {
  const pathApi = runtime.pathApi || path;
  const projectRoot = runtime.projectRoot || host.project_root;
  const claudeDir = runtime.claudeDir || host.claude_dir;
  const codexDir = runtime.codexDir || host.codex_dir;
  const configPath = runtime.configPath || host.config_path || pathApi.join(projectRoot, "config.toml");
  const runtimeDir = pathApi.join(claudeDir, "claude-proxy");
  const stateDir = pathApi.join(runtimeDir, "state");
  const logsDir = pathApi.join(runtimeDir, "logs");

  return {
    ...host,
    project_root: projectRoot,
    claude_dir: claudeDir,
    codex_dir: codexDir,
    runtime_dir: runtimeDir,
    state_dir: stateDir,
    logs_dir: logsDir,
    settings_path: pathApi.join(claudeDir, "settings.json"),
    backups_dir: pathApi.join(runtimeDir, "backups"),
    sessions_file: pathApi.join(stateDir, "sessions.txt"),
    pid_file: pathApi.join(stateDir, "proxy.pid"),
    managed_state_file: pathApi.join(stateDir, "managed-files.json"),
    server_log_file: pathApi.join(logsDir, "server.log"),
    codex_config_path: pathApi.join(codexDir, "config.toml"),
    codex_auth_path: pathApi.join(codexDir, "auth.json"),
    config_path: configPath
  };
}

function validateConfigDocument(document) {
  const legacyFields = LEGACY_TOP_LEVEL_FIELDS.filter((key) =>
    Object.prototype.hasOwnProperty.call(document, key)
  );

  if (legacyFields.length > 0) {
    throw new Error(
      "Only the single-machine top-level config format is supported now. " +
        `Remove legacy fields: ${legacyFields.join(", ")}.`
    );
  }
}

function getPromptValue(document, key, fallback) {
  const value = document[key];
  if (value == null || value === "") {
    return fallback;
  }
  return String(value);
}

function collectConfigPrompts(document = {}) {
  return [
    {
      target: "server_host",
      question: "Server host",
      defaultValue: getPromptValue(document, "server_host", "127.0.0.1"),
      required: true
    },
    {
      target: "server_port",
      question: "Server port",
      defaultValue: String(document.server_port || 8082),
      required: true
    },
    {
      target: "base_url",
      question: "base_url",
      defaultValue: getPromptValue(document, "base_url", ""),
      required: true
    },
    {
      target: "api_key",
      question: "api_key",
      defaultValue: getPromptValue(document, "api_key", ""),
      required: true
    },
    {
      target: "big_model",
      question: "Large model mapping",
      defaultValue: getPromptValue(document, "big_model", DEFAULT_BIG_MODEL),
      required: true
    },
    {
      target: "middle_model",
      question: "Middle model mapping",
      defaultValue: getPromptValue(document, "middle_model", DEFAULT_MIDDLE_MODEL),
      required: true
    },
    {
      target: "small_model",
      question: "Small model mapping",
      defaultValue: getPromptValue(document, "small_model", DEFAULT_SMALL_MODEL),
      required: true
    },
    {
      target: "default_claude_model",
      question: "Default Claude model",
      defaultValue: getPromptValue(document, "default_claude_model", DEFAULT_CLAUDE_MODEL),
      required: true
    },
    {
      target: "home_dir",
      question: "Home directory",
      defaultValue: getPromptValue(document, "home_dir", "~"),
      required: true
    },
    {
      target: "claude_dir",
      question: "Claude config directory",
      defaultValue: getPromptValue(document, "claude_dir", "~/.claude"),
      required: true
    },
    {
      target: "codex_dir",
      question: "Codex config directory",
      defaultValue: getPromptValue(document, "codex_dir", "~/.codex"),
      required: true
    },
    {
      target: "codex_provider",
      question: "Codex provider name (optional)",
      defaultValue: getPromptValue(document, "codex_provider", ""),
      required: false
    }
  ];
}

function collectConfigPromptsForSection(document = {}, section) {
  if (!section || section === "all") {
    return collectConfigPrompts(document);
  }

  const targets = new Set(CONFIG_SECTION_FIELDS[section] || []);
  if (targets.size === 0) {
    throw new Error(`Unknown config section: ${section}`);
  }

  return collectConfigPrompts(document).filter((entry) => targets.has(entry.target));
}

function normalizeConfigDocument(document, resolvedConfigPath, options = {}) {
  const configDir = path.dirname(resolvedConfigPath);
  const runtimeProjectRoot = options.runtimeProjectRoot || configDir;
  const homeDir = normalizeLocalPath(document.home_dir || "~", configDir);
  const claudeDir = normalizeLocalPath(document.claude_dir || path.join(homeDir, ".claude"), configDir);
  const codexDir = normalizeLocalPath(document.codex_dir || path.join(homeDir, ".codex"), configDir);
  const localConfig = applyHostRuntimePaths(
    {
      name: "local",
      type: "local",
      base_url: document.base_url || "",
      api_key: document.api_key || "",
      client_api_key: DEFAULT_CLIENT_API_KEY,
      big_model: document.big_model || DEFAULT_BIG_MODEL,
      middle_model: document.middle_model || DEFAULT_MIDDLE_MODEL,
      small_model: document.small_model || DEFAULT_SMALL_MODEL,
      default_claude_model: document.default_claude_model || DEFAULT_CLAUDE_MODEL,
      codex_provider: document.codex_provider || null,
      home_dir: homeDir,
      project_root: runtimeProjectRoot,
      claude_dir: claudeDir,
      codex_dir: codexDir,
      config_path: resolvedConfigPath
    },
    {
      projectRoot: runtimeProjectRoot,
      claudeDir,
      codexDir,
      configPath: resolvedConfigPath
    }
  );

  return {
    server_host: document.server_host || "127.0.0.1",
    server_port: Number(document.server_port || 8082),
    __configPath: resolvedConfigPath,
    __projectRoot: runtimeProjectRoot,
    ...localConfig
  };
}

async function readConfigDocument(configPath, options = {}) {
  const resolvedConfigPath = path.resolve(configPath || getDefaultConfigPath());
  let raw;
  try {
    raw = await fs.readFile(resolvedConfigPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" && options.allowMissing) {
      return {
        resolvedConfigPath,
        document: createDefaultConfigDocument()
      };
    }
    if (error.code === "ENOENT") {
      const defaultConfigPath = getDefaultConfigPath();
      const defaultConfigDisplayPath = getDefaultConfigDisplayPath();
      const usesDefaultConfigPath = !configPath || resolvedConfigPath === defaultConfigPath;
      const displayPath = usesDefaultConfigPath ? defaultConfigDisplayPath : resolvedConfigPath;
      const hint = usesDefaultConfigPath
        ? `Run "claude-proxy config" first to create the default config at ${defaultConfigDisplayPath}.`
        : `Please check whether the file exists, or rerun with the same --config path used during "claude-proxy config".`;
      throw new Error(
        `Config file not found: ${displayPath}. ${hint} You can use "config_example.toml" in the project root as a reference.`
      );
    }
    throw error;
  }

  return {
    resolvedConfigPath,
    document: toml.parse(raw)
  };
}

async function writeConfigDocument(configPath, document) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, toml.stringify(document), "utf8");
}

function clearConfigDocumentSection(document, section) {
  const fields = CONFIG_SECTION_FIELDS[section];
  if (!fields) {
    throw new Error(`Unknown config section: ${section}`);
  }

  const cleaned = { ...document };
  for (const field of fields) {
    delete cleaned[field];
  }
  return cleaned;
}

async function clearConfigSection(configPath, section) {
  const resolvedConfigPath = path.resolve(configPath || getDefaultConfigPath());

  try {
    await fs.access(resolvedConfigPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const { document } = await readConfigDocument(resolvedConfigPath);
  validateConfigDocument(document);
  await writeConfigDocument(resolvedConfigPath, clearConfigDocumentSection(document, section));
  return true;
}

async function loadConfig(configPath, options = {}) {
  const { resolvedConfigPath, document } = await readConfigDocument(configPath, {
    allowMissing: options.allowMissing
  });
  validateConfigDocument(document);
  const config = normalizeConfigDocument(document, resolvedConfigPath, {
    runtimeProjectRoot: options.runtimeProjectRoot
  });

  if (
    !options.allowIncomplete &&
    (isPlaceholderValue(config.base_url) || isPlaceholderValue(config.api_key))
  ) {
    throw new Error("Config must include non-empty base_url and api_key.");
  }

  return config;
}

function setDocumentValue(document, target, value) {
  if (target === "server_port") {
    document.server_port = Number(value);
    return;
  }

  if (target === "codex_provider") {
    if (value) {
      document.codex_provider = value;
    } else {
      delete document.codex_provider;
    }
    return;
  }

  document[target] = value;
}

function isValidPromptValue(target, value) {
  if (target === "codex_provider") {
    return true;
  }

  if (!value) {
    return false;
  }

  if (target === "server_port") {
    const port = Number(value);
    return Number.isInteger(port) && port > 0;
  }

  return true;
}

async function promptForConfig(configPath, options = {}) {
  const { resolvedConfigPath, document } = await readConfigDocument(configPath, {
    allowMissing: true
  });
  validateConfigDocument(document);
  const prompts = collectConfigPromptsForSection(document, "all");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    for (const entry of prompts) {
      for (;;) {
        const suffix = entry.defaultValue ? ` [${entry.defaultValue}]` : "";
        const answer = await rl.question(`${entry.question}${suffix}: `);
        const value = answer.trim() || entry.defaultValue;

        if (!isValidPromptValue(entry.target, value)) {
          console.log(`Invalid value for ${entry.target}. Please try again.`);
          continue;
        }

        setDocumentValue(document, entry.target, value);
        break;
      }
    }
  } finally {
    rl.close();
  }

  await writeConfigDocument(resolvedConfigPath, document);
  return normalizeConfigDocument(document, resolvedConfigPath, {
    runtimeProjectRoot: options.runtimeProjectRoot
  });
}

async function promptForConfigSection(configPath, section, options = {}) {
  const { resolvedConfigPath, document } = await readConfigDocument(configPath, {
    allowMissing: true
  });
  validateConfigDocument(document);
  const prompts = collectConfigPromptsForSection(document, section);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    for (const entry of prompts) {
      for (;;) {
        const suffix = entry.defaultValue ? ` [${entry.defaultValue}]` : "";
        const answer = await rl.question(`${entry.question}${suffix}: `);
        const value = answer.trim() || entry.defaultValue;

        if (!isValidPromptValue(entry.target, value)) {
          console.log(`Invalid value for ${entry.target}. Please try again.`);
          continue;
        }

        setDocumentValue(document, entry.target, value);
        break;
      }
    }
  } finally {
    rl.close();
  }

  await writeConfigDocument(resolvedConfigPath, document);
  return normalizeConfigDocument(document, resolvedConfigPath, {
    runtimeProjectRoot: options.runtimeProjectRoot
  });
}

module.exports = {
  DEFAULT_BIG_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLIENT_API_KEY,
  DEFAULT_MIDDLE_MODEL,
  DEFAULT_SMALL_MODEL,
  applyHostRuntimePaths,
  clearConfigSection,
  collectConfigPrompts,
  collectConfigPromptsForSection,
  expandHome,
  getDefaultConfigDir,
  getDefaultConfigDisplayPath,
  getDefaultConfigPath,
  isPlaceholderValue,
  loadConfig,
  normalizeLocalPath,
  promptForConfig,
  promptForConfigSection,
  readConfigDocument,
  writeConfigDocument
};
