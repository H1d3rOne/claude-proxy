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
const PROFILE_FIELDS = [
  "base_url",
  "api_key",
  "big_model",
  "middle_model",
  "small_model",
  "default_claude_model"
];
const CONFIG_SECTION_FIELDS = {
  claude: ["server_port", "big_model", "middle_model", "small_model", "default_claude_model", "claude_dir"],
  openai: ["base_url", "api_key", "codex_dir"]
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
    home_dir: "~",
    claude_dir: "~/.claude",
    codex_dir: "~/.codex",
    profiles: []
  };
}

function createDefaultProfile(modelProvider = "OpenAI", overrides = {}) {
  return {
    model_provider: modelProvider,
    name: modelProvider,
    base_url: "",
    api_key: "",
    big_model: DEFAULT_BIG_MODEL,
    middle_model: DEFAULT_MIDDLE_MODEL,
    small_model: DEFAULT_SMALL_MODEL,
    default_claude_model: DEFAULT_CLAUDE_MODEL,
    ...overrides
  };
}

function isLegacyFlatConfig(document = {}) {
  return PROFILE_FIELDS.some((key) => Object.prototype.hasOwnProperty.call(document, key));
}

function normalizeProfileDocument(profile, fallbackName) {
  const modelProvider =
    profile?.model_provider != null && String(profile.model_provider).trim()
      ? String(profile.model_provider).trim()
      : profile?.name != null && String(profile.name).trim()
        ? String(profile.name).trim()
        : fallbackName;

  return createDefaultProfile(
    modelProvider,
    {
      name:
        profile?.name != null && String(profile.name).trim()
          ? String(profile.name).trim()
          : modelProvider,
      base_url: profile?.base_url || "",
      api_key: profile?.api_key || "",
      big_model: profile?.big_model || DEFAULT_BIG_MODEL,
      middle_model: profile?.middle_model || DEFAULT_MIDDLE_MODEL,
      small_model: profile?.small_model || DEFAULT_SMALL_MODEL,
      default_claude_model: profile?.default_claude_model || DEFAULT_CLAUDE_MODEL
    }
  );
}

function getProfilesState(document = {}) {
  if (isLegacyFlatConfig(document)) {
    return {
      documentVersion: "legacy-flat",
      activeProfileName: "default",
      profiles: [
        createDefaultProfile("default", {
          name: "default",
          base_url: document.base_url || "",
          api_key: document.api_key || "",
          big_model: document.big_model || DEFAULT_BIG_MODEL,
          middle_model: document.middle_model || DEFAULT_MIDDLE_MODEL,
          small_model: document.small_model || DEFAULT_SMALL_MODEL,
          default_claude_model: document.default_claude_model || DEFAULT_CLAUDE_MODEL
        })
      ]
    };
  }

  const profiles = Array.isArray(document.profiles)
    ? document.profiles.map((profile, index) =>
        normalizeProfileDocument(profile, `profile-${index + 1}`)
      )
    : [];

  return {
    documentVersion: "profiles",
    activeProfileName: document.active_profile || profiles[0]?.model_provider || null,
    profiles
  };
}

function toPersistentProfilesDocument(document = {}, profiles, activeProfileName) {
  const nextDocument = { ...document };

  for (const field of PROFILE_FIELDS) {
    delete nextDocument[field];
  }
  delete nextDocument.codex_provider;

  nextDocument.profiles = profiles.map((profile) => ({
    model_provider: profile.model_provider,
    name: profile.name,
    base_url: profile.base_url,
    api_key: profile.api_key,
    big_model: profile.big_model,
    middle_model: profile.middle_model,
    small_model: profile.small_model,
    default_claude_model: profile.default_claude_model
  }));

  if (activeProfileName) {
    nextDocument.active_profile = activeProfileName;
  } else {
    delete nextDocument.active_profile;
  }

  return nextDocument;
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

  if (
    Object.prototype.hasOwnProperty.call(document, "profiles") &&
    !Array.isArray(document.profiles)
  ) {
    throw new Error("Config field profiles must be an array.");
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
  const { documentVersion, profiles, activeProfileName } = getProfilesState(document);
  const activeProfile =
    profiles.find((profile) => profile.model_provider === activeProfileName) || profiles[0] || null;
  const localConfig = applyHostRuntimePaths(
    {
      name: "local",
      type: "local",
      base_url: activeProfile?.base_url || "",
      api_key: activeProfile?.api_key || "",
      client_api_key: DEFAULT_CLIENT_API_KEY,
      big_model: activeProfile?.big_model || DEFAULT_BIG_MODEL,
      middle_model: activeProfile?.middle_model || DEFAULT_MIDDLE_MODEL,
      small_model: activeProfile?.small_model || DEFAULT_SMALL_MODEL,
      default_claude_model: activeProfile?.default_claude_model || DEFAULT_CLAUDE_MODEL,
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
    active_profile: activeProfile?.model_provider || null,
    model_provider: activeProfile?.model_provider || null,
    profile_name: activeProfile?.name || activeProfile?.model_provider || null,
    profiles,
    __documentVersion: documentVersion,
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
        ? `Run "claude-proxy config add" first to create the default config at ${defaultConfigDisplayPath}.`
        : `Please check whether the file exists, or rerun with the same --config path used during "claude-proxy config add".`;
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

  document[target] = value;
}

function isValidPromptValue(target, value) {
  if (!value) {
    return false;
  }

  if (target === "server_port") {
    const port = Number(value);
    return Number.isInteger(port) && port > 0;
  }

  return true;
}

function validateProfileName(name) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    throw new Error("Profile model_provider must be non-empty.");
  }
  return normalizedName;
}

function createValidatedProfile(profile) {
  const normalizedProfile = normalizeProfileDocument(
    profile,
    validateProfileName(profile?.model_provider || profile?.name)
  );

  if (isPlaceholderValue(normalizedProfile.base_url) || isPlaceholderValue(normalizedProfile.api_key)) {
    throw new Error("Profile must include non-empty base_url and api_key.");
  }

  return normalizedProfile;
}

async function readMutableConfigDocument(configPath, options = {}) {
  const { resolvedConfigPath, document } = await readConfigDocument(configPath, {
    allowMissing: options.allowMissing
  });
  validateConfigDocument(document);
  return {
    resolvedConfigPath,
    document,
    ...getProfilesState(document)
  };
}

async function addProfile(configPath, profile, options = {}) {
  const { resolvedConfigPath, document, profiles, activeProfileName } = await readMutableConfigDocument(
    configPath,
    { allowMissing: true }
  );
  const nextProfile = createValidatedProfile(profile);

  if (profiles.some((entry) => entry.model_provider === nextProfile.model_provider)) {
    throw new Error(`Profile already exists: ${nextProfile.model_provider}`);
  }

  const nextProfiles = [...profiles, nextProfile];
  const nextActiveProfileName = activeProfileName || nextProfile.model_provider;
  const nextDocument = toPersistentProfilesDocument(document, nextProfiles, nextActiveProfileName);

  await writeConfigDocument(resolvedConfigPath, nextDocument);
  return normalizeConfigDocument(nextDocument, resolvedConfigPath, {
    runtimeProjectRoot: options.runtimeProjectRoot
  });
}

async function setActiveProfile(configPath, profileName, options = {}) {
  const normalizedName = validateProfileName(profileName);
  const { resolvedConfigPath, document, profiles } = await readMutableConfigDocument(configPath, {
    allowMissing: true
  });

  if (!profiles.some((entry) => entry.model_provider === normalizedName)) {
    throw new Error(`Profile not found: ${normalizedName}`);
  }

  const nextDocument = toPersistentProfilesDocument(document, profiles, normalizedName);
  await writeConfigDocument(resolvedConfigPath, nextDocument);
  return normalizeConfigDocument(nextDocument, resolvedConfigPath, {
    runtimeProjectRoot: options.runtimeProjectRoot
  });
}

async function updateProfile(configPath, profileName, updates = {}, options = {}) {
  const normalizedName = validateProfileName(profileName);
  const {
    resolvedConfigPath,
    document,
    profiles,
    activeProfileName
  } = await readMutableConfigDocument(configPath, {
    allowMissing: true
  });

  if (!profiles.some((entry) => entry.model_provider === normalizedName)) {
    throw new Error(`Profile not found: ${normalizedName}`);
  }

  const nextProfiles = profiles.map((profile) => {
    if (profile.model_provider !== normalizedName) {
      return profile;
    }

    return createValidatedProfile({
      ...profile,
      ...updates,
      model_provider: profile.model_provider
    });
  });

  const nextDocument = toPersistentProfilesDocument(document, nextProfiles, activeProfileName);
  await writeConfigDocument(resolvedConfigPath, nextDocument);
  return normalizeConfigDocument(nextDocument, resolvedConfigPath, {
    runtimeProjectRoot: options.runtimeProjectRoot
  });
}

async function deleteProfile(configPath, profileName, options = {}) {
  const normalizedName = validateProfileName(profileName);
  const {
    resolvedConfigPath,
    document,
    profiles,
    activeProfileName
  } = await readMutableConfigDocument(configPath, {
    allowMissing: true
  });

  if (!profiles.some((entry) => entry.model_provider === normalizedName)) {
    throw new Error(`Profile not found: ${normalizedName}`);
  }

  if (activeProfileName === normalizedName) {
    throw new Error(`Cannot delete the active profile: ${normalizedName}`);
  }

  const nextProfiles = profiles.filter((entry) => entry.model_provider !== normalizedName);
  const nextDocument = toPersistentProfilesDocument(document, nextProfiles, activeProfileName);
  await writeConfigDocument(resolvedConfigPath, nextDocument);
  return normalizeConfigDocument(nextDocument, resolvedConfigPath, {
    runtimeProjectRoot: options.runtimeProjectRoot
  });
}

async function updateClaudeConfig(configPath, updates = {}, options = {}) {
  const {
    resolvedConfigPath,
    document,
    profiles,
    activeProfileName
  } = await readMutableConfigDocument(configPath, {
    allowMissing: true
  });

  if (!activeProfileName || profiles.length === 0) {
    throw new Error('No active profile configured. Run "claude-proxy config add" first.');
  }

  const nextProfiles = profiles.map((profile) => {
    if (profile.model_provider !== activeProfileName) {
      return profile;
    }

    return {
      ...profile,
      big_model: updates.big_model || profile.big_model,
      middle_model: updates.middle_model || profile.middle_model,
      small_model: updates.small_model || profile.small_model,
      default_claude_model:
        updates.default_claude_model || profile.default_claude_model
    };
  });

  const nextDocument = toPersistentProfilesDocument(
    {
      ...document,
      server_port: updates.server_port ?? document.server_port,
      claude_dir: updates.claude_dir ?? document.claude_dir
    },
    nextProfiles,
    activeProfileName
  );

  await writeConfigDocument(resolvedConfigPath, nextDocument);
  return normalizeConfigDocument(nextDocument, resolvedConfigPath, {
    runtimeProjectRoot: options.runtimeProjectRoot
  });
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
  addProfile,
  DEFAULT_BIG_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLIENT_API_KEY,
  DEFAULT_MIDDLE_MODEL,
  DEFAULT_SMALL_MODEL,
  applyHostRuntimePaths,
  clearConfigSection,
  collectConfigPrompts,
  collectConfigPromptsForSection,
  deleteProfile,
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
  setActiveProfile,
  updateClaudeConfig,
  updateProfile,
  writeConfigDocument
};
