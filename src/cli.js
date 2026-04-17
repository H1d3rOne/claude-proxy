#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const readline = require("readline/promises");
const toml = require("@iarna/toml");
const { Command } = require("commander");
const {
  addProfile,
  clearConfigSection,
  DEFAULT_BIG_MODEL,
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_MIDDLE_MODEL,
  DEFAULT_SMALL_MODEL,
  deleteProfile,
  getDefaultConfigDisplayPath,
  getDefaultConfigPath,
  loadConfig,
  readConfigDocument,
  setActiveProfile,
  updateClaudeConfig,
  updateProfile
} = require("./config");
const {
  applyClaudeManagedHostConfig,
  applyManagedHostConfig,
  applyOpenAIManagedHostConfig,
  cleanClaudeManagedHostConfig,
  cleanManagedHostConfig,
  cleanOpenAIManagedHostConfig
} = require("./services/client-config-manager");
const { ensureProxy, stopProxy } = require("./services/host-manager");
const { startServer } = require("./proxy/server");
const { runUpdate } = require("./services/updater");
const { pathExists, readJson } = require("./utils");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function formatErrorMessage(error) {
  return error && error.message ? error.message : String(error);
}

function getConfigOptionDescription() {
  return `Path to config.toml (default: ${getDefaultConfigDisplayPath()})`;
}

function resolveConfigPath(options, command) {
  return command?.optsWithGlobals?.().config || options?.config || getDefaultConfigPath();
}

function createStepLogger(config) {
  return (event) => {
    const suffix = event.error ? ` (${formatErrorMessage(event.error)})` : "";
    console.log(`[local] ${event.label}: ${event.status}${suffix}`);
  };
}

function getActiveProfile(config) {
  return Array.isArray(config?.profiles)
    ? config.profiles.find((profile) => profile.name === config.active_profile) || null
    : null;
}

async function withPromptSession(action) {
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk.toString("utf8"));
    }

    const answers = chunks.join("").split(/\r?\n/);
    let answerIndex = 0;

    const session = {
      async question(prompt) {
        process.stdout.write(prompt);
        return answers[answerIndex++] ?? "";
      },
      close() {}
    };

    return action(session);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    return await action(rl);
  } finally {
    rl.close();
  }
}

async function promptForValue(rl, question, defaultValue, options = {}) {
  for (;;) {
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    const value = answer || defaultValue || "";

    if (options.required !== false && !value) {
      console.log(`Invalid value for ${question}. Please try again.`);
      continue;
    }

    if (typeof options.validate === "function") {
      const validation = options.validate(value);
      if (validation !== true) {
        console.log(validation || `Invalid value for ${question}. Please try again.`);
        continue;
      }
    }

    return value;
  }
}

async function promptForProfileSelectionWithSession(rl, config, label) {
  const profiles = Array.isArray(config?.profiles) ? config.profiles : [];
  if (profiles.length === 0) {
    throw new Error('No profiles configured. Run "claude-proxy config add" first.');
  }

  const defaultIndex = Math.max(
    0,
    profiles.findIndex((profile) => profile.name === config.active_profile)
  );

  console.log("Available profiles:");
  profiles.forEach((profile, index) => {
    const activeSuffix = profile.name === config.active_profile ? " (active)" : "";
    const providerSuffix =
      profile.model_provider && profile.model_provider !== profile.name
        ? ` [${profile.model_provider}]`
        : "";
    console.log(`  ${index + 1}. ${profile.name}${providerSuffix}${activeSuffix}`);
  });

  for (;;) {
    const answer = await promptForValue(
      rl,
      label,
      String(defaultIndex + 1),
      {
        validate(value) {
          const numericChoice = Number(value);
          if (
            Number.isInteger(numericChoice) &&
            numericChoice >= 1 &&
            numericChoice <= profiles.length
          ) {
            return true;
          }

          if (profiles.some((profile) => profile.name === value)) {
            return true;
          }

          return "Please choose an existing profile number or name.";
        }
      }
    );

    const numericChoice = Number(answer);
    if (Number.isInteger(numericChoice) && numericChoice >= 1 && numericChoice <= profiles.length) {
      return profiles[numericChoice - 1];
    }

    const namedProfile = profiles.find((profile) => profile.name === answer);
    if (namedProfile) {
      return namedProfile;
    }
  }
}

async function promptForProfileSelection(config, label) {
  return withPromptSession((rl) => promptForProfileSelectionWithSession(rl, config, label));
}

async function promptForNewProfile(config) {
  const activeProfile = getActiveProfile(config);
  const existingNames = new Set((config.profiles || []).map((profile) => profile.name));

  return withPromptSession(async (rl) => {
    const name = await promptForValue(rl, "name", "", {
      validate(value) {
        if (!value) {
          return "name must be non-empty.";
        }
        if (existingNames.has(value)) {
          return `Profile already exists: ${value}`;
        }
        return true;
      }
    });
    const modelProvider = await promptForValue(rl, "model_provider", "OpenAI");

    return {
      name,
      model_provider: modelProvider,
      base_url: await promptForValue(rl, "base_url", activeProfile?.base_url || ""),
      api_key: await promptForValue(rl, "api_key", activeProfile?.api_key || ""),
      big_model: await promptForValue(
        rl,
        "Large model mapping",
        activeProfile?.big_model || DEFAULT_BIG_MODEL
      ),
      middle_model: await promptForValue(
        rl,
        "Middle model mapping",
        activeProfile?.middle_model || DEFAULT_MIDDLE_MODEL
      ),
      small_model: await promptForValue(
        rl,
        "Small model mapping",
        activeProfile?.small_model || DEFAULT_SMALL_MODEL
      ),
      default_claude_model: await promptForValue(
        rl,
        "Default Claude model",
        activeProfile?.default_claude_model || DEFAULT_CLAUDE_MODEL
      )
    };
  });
}

async function promptForProfileEditsWithSession(rl, profile, existingNames = new Set()) {
  return {
    name: await promptForValue(rl, "name", profile?.name || profile?.model_provider || "", {
      validate(value) {
        if (!value) {
          return "name must be non-empty.";
        }
        if (existingNames.has(value)) {
          return `Profile already exists: ${value}`;
        }
        return true;
      }
    }),
    base_url: await promptForValue(rl, "base_url", profile?.base_url || ""),
    api_key: await promptForValue(rl, "api_key", profile?.api_key || ""),
    big_model: await promptForValue(
      rl,
      "Large model mapping",
      profile?.big_model || DEFAULT_BIG_MODEL
    ),
    middle_model: await promptForValue(
      rl,
      "Middle model mapping",
      profile?.middle_model || DEFAULT_MIDDLE_MODEL
    ),
    small_model: await promptForValue(
      rl,
      "Small model mapping",
      profile?.small_model || DEFAULT_SMALL_MODEL
    ),
    default_claude_model: await promptForValue(
      rl,
      "Default Claude model",
      profile?.default_claude_model || DEFAULT_CLAUDE_MODEL
    )
  };
}

async function promptForProfileEdits(profile) {
  return withPromptSession((rl) => promptForProfileEditsWithSession(rl, profile));
}

async function promptForClaudeSettings(config) {
  const activeProfile = getActiveProfile(config);
  if (!activeProfile) {
    throw new Error('No active profile configured. Run "claude-proxy config add" first.');
  }

  return withPromptSession(async (rl) => ({
    server_port: Number(
      await promptForValue(rl, "Server port", String(config.server_port || 8082), {
        validate(value) {
          const port = Number(value);
          return Number.isInteger(port) && port > 0
            ? true
            : "Server port must be a positive integer.";
        }
      })
    ),
    big_model: await promptForValue(
      rl,
      "Large model mapping",
      activeProfile.big_model || DEFAULT_BIG_MODEL
    ),
    middle_model: await promptForValue(
      rl,
      "Middle model mapping",
      activeProfile.middle_model || DEFAULT_MIDDLE_MODEL
    ),
    small_model: await promptForValue(
      rl,
      "Small model mapping",
      activeProfile.small_model || DEFAULT_SMALL_MODEL
    ),
    default_claude_model: await promptForValue(
      rl,
      "Default Claude model",
      activeProfile.default_claude_model || DEFAULT_CLAUDE_MODEL
    ),
    claude_dir: await promptForValue(
      rl,
      "Claude config directory",
      config.claude_dir || ""
    )
  }));
}

async function applyLocalConfig(config) {
  const logStep = createStepLogger(config);
  await applyManagedHostConfig(config, config, { onProgress: logStep });
  console.log("Configured local environment");
}

async function applyClaudeConfig(config) {
  const logStep = createStepLogger(config);
  await applyClaudeManagedHostConfig(config, config, { onProgress: logStep });
  console.log("Configured Claude environment");
}

async function applyOpenAIConfig(config) {
  const logStep = createStepLogger(config);
  await applyOpenAIManagedHostConfig(config, config, { onProgress: logStep });
  console.log("Configured OpenAI environment");
}

async function clearConfigSectionsWithLog(config, sections, prefix) {
  const logStep = createStepLogger(config);

  for (const section of sections) {
    const label = `Clear ${prefix || section} config fields (${config.__configPath})`;
    logStep({ label, status: "started" });
    const changed = await clearConfigSection(config.__configPath, section);
    logStep({ label, status: changed ? "completed" : "skipped" });
  }
}

async function cleanClaudeConfig(config) {
  const logStep = createStepLogger(config);
  await cleanClaudeManagedHostConfig(config, config, { onProgress: logStep });
  await clearConfigSectionsWithLog(config, ["claude"], "Claude");
  console.log("Restored Claude configuration");
}

async function cleanOpenAIConfig(config) {
  const logStep = createStepLogger(config);
  await cleanOpenAIManagedHostConfig(config, config, { onProgress: logStep });
  await clearConfigSectionsWithLog(config, ["openai"], "OpenAI");
  console.log("Restored OpenAI configuration");
}

async function cleanAllConfig(config) {
  const logStep = createStepLogger(config);
  await cleanManagedHostConfig(config, config, { onProgress: logStep });
  await clearConfigSectionsWithLog(config, ["claude", "openai"]);
  console.log("Restored local configuration");
}

function formatValue(value) {
  if (value == null || value === "") {
    return "(not set)";
  }
  return String(value);
}

function flattenHooks(groups) {
  return Array.isArray(groups) ? groups.flatMap((group) => group?.hooks || []) : [];
}

function hasManagedHook(settings, actionToken) {
  const groups =
    actionToken === "ensure-proxy"
      ? settings?.hooks?.SessionStart
      : settings?.hooks?.SessionEnd;
  return flattenHooks(groups).some((hook) =>
    typeof hook?.command === "string" && hook.command.includes(`internal ${actionToken}`)
  );
}

function getCodexProviderName(document, preferredProvider) {
  const providers =
    document.model_providers && typeof document.model_providers === "object"
      ? document.model_providers
      : null;

  if (providers && preferredProvider && providers[preferredProvider]) {
    return preferredProvider;
  }

  if (providers && document.model_provider && providers[document.model_provider]) {
    return document.model_provider;
  }

  if (!providers) {
    return null;
  }

  return Object.keys(providers)[0] || null;
}

async function readToml(targetPath, fallback = {}) {
  try {
    const raw = await fs.readFile(targetPath, "utf8");
    return toml.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

function formatSection(title, lines) {
  return [title, ...lines.map((line) => `  ${line}`)].join("\n");
}

function formatProfilesSection(profiles = [], activeProfileName = null) {
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return formatSection("Profiles", ["(none)"]);
  }

  const lines = [];
  for (const [index, profile] of profiles.entries()) {
    const activeSuffix = profile.name === activeProfileName ? " (active)" : "";
    lines.push(`  name: ${formatValue(profile.name)}${activeSuffix}`);
    lines.push(`- model_provider: ${formatValue(profile.model_provider)}${activeSuffix}`);
    lines.push(`  base_url: ${formatValue(profile.base_url)}`);
    lines.push(`  api_key: ${formatValue(profile.api_key)}`);
    lines.push(`  big_model: ${formatValue(profile.big_model)}`);
    lines.push(`  middle_model: ${formatValue(profile.middle_model)}`);
    lines.push(`  small_model: ${formatValue(profile.small_model)}`);
    lines.push(`  default_claude_model: ${formatValue(profile.default_claude_model)}`);

    if (index < profiles.length - 1) {
      lines.push("");
    }
  }

  return formatSection("Profiles", lines);
}

async function buildConfigSummary(configPath) {
  const resolvedConfigPath = path.resolve(configPath || getDefaultConfigPath());
  const configExists = await pathExists(resolvedConfigPath);
  const { document } = await readConfigDocument(resolvedConfigPath, {
    allowMissing: true
  });
  const config = await loadConfig(resolvedConfigPath, {
    allowIncomplete: true,
    allowMissing: true,
    runtimeProjectRoot: PROJECT_ROOT
  });

  const claudeExists = await pathExists(config.settings_path);
  const claudeSettings = await readJson(config.settings_path, {});

  const codexConfigExists = await pathExists(config.codex_config_path);
  const codexConfig = await readToml(config.codex_config_path, {});
  const codexProvider = getCodexProviderName(codexConfig, config.model_provider || null);
  const codexProviderDisplayName = codexProvider
    ? codexConfig.model_providers?.[codexProvider]?.name || codexConfig.name
    : codexConfig.name;
  const codexBaseUrl = codexProvider
    ? codexConfig.model_providers?.[codexProvider]?.base_url
    : codexConfig.base_url;

  const codexAuthExists = await pathExists(config.codex_auth_path);
  const codexAuth = await readJson(config.codex_auth_path, {});
  const activeProfile = getActiveProfile(config);
  const profileCount = Array.isArray(config.profiles) ? config.profiles.length : 0;

  return [
    formatSection("Config File", [
      `path: ${resolvedConfigPath}`,
      `exists: ${configExists ? "yes" : "no"}`,
      `server_host: ${formatValue(document.server_host)}`,
      `server_port: ${formatValue(document.server_port)}`,
      `active_profile: ${formatValue(config.active_profile)}`,
      `profiles: ${profileCount}`,
      `home_dir: ${formatValue(document.home_dir)}`,
      `claude_dir: ${formatValue(document.claude_dir)}`,
      `codex_dir: ${formatValue(document.codex_dir)}`
    ]),
    formatSection("Active Profile", [
      `name: ${formatValue(activeProfile?.name)}`,
      `model_provider: ${formatValue(activeProfile?.model_provider)}`,
      `base_url: ${formatValue(activeProfile?.base_url)}`,
      `api_key: ${formatValue(activeProfile?.api_key)}`,
      `big_model: ${formatValue(activeProfile?.big_model)}`,
      `middle_model: ${formatValue(activeProfile?.middle_model)}`,
      `small_model: ${formatValue(activeProfile?.small_model)}`,
      `default_claude_model: ${formatValue(activeProfile?.default_claude_model)}`
    ]),
    formatProfilesSection(config.profiles, config.active_profile),
    formatSection("Claude", [
      `path: ${config.settings_path}`,
      `exists: ${claudeExists ? "yes" : "no"}`,
      `ANTHROPIC_BASE_URL: ${formatValue(claudeSettings?.env?.ANTHROPIC_BASE_URL)}`,
      `ANTHROPIC_API_KEY: ${formatValue(claudeSettings?.env?.ANTHROPIC_API_KEY)}`,
      `ANTHROPIC_MODEL: ${formatValue(claudeSettings?.env?.ANTHROPIC_MODEL)}`,
      `ANTHROPIC_REASONING_MODEL: ${formatValue(claudeSettings?.env?.ANTHROPIC_REASONING_MODEL)}`,
      `model: ${formatValue(claudeSettings?.model)}`,
      `ensure-proxy hook: ${hasManagedHook(claudeSettings, "ensure-proxy") ? "installed" : "missing"}`,
      `stop-proxy hook: ${hasManagedHook(claudeSettings, "stop-proxy") ? "installed" : "missing"}`
    ]),
    formatSection("Codex Config", [
      `path: ${config.codex_config_path}`,
      `exists: ${codexConfigExists ? "yes" : "no"}`,
      `provider: ${formatValue(codexProvider)}`,
      `name: ${formatValue(codexProviderDisplayName)}`,
      `base_url: ${formatValue(codexBaseUrl)}`
    ]),
    formatSection("Codex Auth", [
      `path: ${config.codex_auth_path}`,
      `exists: ${codexAuthExists ? "yes" : "no"}`,
      `OPENAI_API_KEY: ${formatValue(codexAuth?.OPENAI_API_KEY)}`
    ])
  ].join("\n\n");
}

async function main() {
  const program = new Command();
  program.name("claude-proxy");
  program.addHelpCommand("help [command]", "Show help for the main command or a subcommand");
  program.addHelpText(
    "after",
    [
      "",
      "Config:",
      `  Default config path: ${getDefaultConfigDisplayPath()}`,
      "",
      "Common usage:",
      "  claude-proxy config add",
      "    Add a named upstream profile",
      "  claude-proxy config use",
      "    Choose the active profile and sync Codex credentials",
      "  claude-proxy config alt",
      "    Edit a saved upstream profile in place",
      "  claude-proxy config del",
      "    Delete a non-active upstream profile",
      "  claude-proxy config claude",
      "    Interactively configure Claude settings only",
      "  claude-proxy config get",
      "    Show the current local proxy, Claude, and Codex configuration summary",
      "  claude-proxy clean",
      "    Restore local Claude/Codex settings and clear config.toml owned fields",
      "  claude-proxy clean claude",
      "    Restore Claude settings from backups",
      "  claude-proxy clean openai",
      "    Restore OpenAI/Codex settings from backups",
      "  claude-proxy update",
      "    Update the current claude-proxy installation",
      "  claude-proxy start",
      "    Start the local proxy server only",
      "  claude-proxy stop",
      "    Stop the managed local proxy server",
      "",
      "More help:",
      "  claude-proxy help",
      "  claude-proxy help config",
      "  claude-proxy help start",
      "  claude-proxy help stop",
      "  claude-proxy help clean",
      "  claude-proxy help update",
      ""
    ].join("\n")
  );

  program
    .command("start")
    .description("Start the local proxy server only")
    .option("--config <path>", getConfigOptionDescription())
    .addHelpText(
      "after",
      [
        "",
        "Help:",
        "  claude-proxy help start",
        ""
      ].join("\n")
    )
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const config = await loadConfig(configPath, {
        runtimeProjectRoot: PROJECT_ROOT
      });
      await startServer(config, config);
      console.log(`Proxy listening on ${config.server_host}:${config.server_port}`);
    });

  program
    .command("stop")
    .description("Stop the managed local proxy server")
    .option("--config <path>", getConfigOptionDescription())
    .addHelpText(
      "after",
      [
        "",
        "Help:",
        "  claude-proxy help stop",
        ""
      ].join("\n")
    )
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const config = await loadConfig(configPath, {
        allowIncomplete: true,
        allowMissing: true,
        runtimeProjectRoot: PROJECT_ROOT
      });
      await stopProxy(config, config, { force: true });
      console.log("Stopped local proxy");
    });

  const configCommand = new Command("config")
    .description("Manage named upstream profiles and local runtime settings")
    .option("--config <path>", getConfigOptionDescription())
    .addHelpText(
      "after",
      [
        "",
        "Subcommands:",
        "  claude-proxy config add",
        "  claude-proxy config use",
        "  claude-proxy config alt",
        "  claude-proxy config del",
        "  claude-proxy config claude",
        "  claude-proxy config get",
        ""
      ].join("\n")
    )
    .action(async (_options, command) => {
      command.help();
    });

  configCommand
    .command("add")
    .description("Add a named upstream profile")
    .option("--config <path>", getConfigOptionDescription())
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const config = await loadConfig(configPath, {
        allowIncomplete: true,
        allowMissing: true,
        runtimeProjectRoot: PROJECT_ROOT
      });
      const profile = await promptForNewProfile(config);
      await addProfile(configPath, profile, {
        runtimeProjectRoot: PROJECT_ROOT
      });
      console.log(`Added profile: ${profile.name}`);
    });

  configCommand
    .command("use")
    .description("Choose the active profile and sync Codex credentials")
    .option("--config <path>", getConfigOptionDescription())
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const currentConfig = await loadConfig(configPath, {
        allowIncomplete: true,
        allowMissing: true,
        runtimeProjectRoot: PROJECT_ROOT
      });
      const selectedProfile = await promptForProfileSelection(currentConfig, "Choose a profile");
      await setActiveProfile(configPath, selectedProfile.name, {
        runtimeProjectRoot: PROJECT_ROOT
      });
      const config = await loadConfig(configPath, {
        runtimeProjectRoot: PROJECT_ROOT
      });
      await applyOpenAIConfig(config);
    });

  configCommand
    .command("alt")
    .description("Edit a saved upstream profile in place")
    .option("--config <path>", getConfigOptionDescription())
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const currentConfig = await loadConfig(configPath, {
        allowIncomplete: true,
        allowMissing: true,
        runtimeProjectRoot: PROJECT_ROOT
      });
      const { selectedProfile, updates } = await withPromptSession(async (rl) => {
        const selectedProfile = await promptForProfileSelectionWithSession(
          rl,
          currentConfig,
          "Edit which profile"
        );
        const updates = await promptForProfileEditsWithSession(
          rl,
          selectedProfile,
          new Set(
            currentConfig.profiles
              .map((profile) => profile.name)
              .filter((name) => name !== selectedProfile.name)
          )
        );
        return { selectedProfile, updates };
      });
      await updateProfile(configPath, selectedProfile.name, updates, {
        runtimeProjectRoot: PROJECT_ROOT
      });
      console.log(`Updated profile: ${updates.name}`);
    });

  configCommand
    .command("del")
    .description("Delete a non-active upstream profile")
    .option("--config <path>", getConfigOptionDescription())
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const currentConfig = await loadConfig(configPath, {
        allowIncomplete: true,
        allowMissing: true,
        runtimeProjectRoot: PROJECT_ROOT
      });
      const selectedProfile = await promptForProfileSelection(currentConfig, "Delete which profile");
      await deleteProfile(configPath, selectedProfile.name, {
        runtimeProjectRoot: PROJECT_ROOT
      });
      console.log(`Deleted profile: ${selectedProfile.name}`);
    });

  configCommand
    .command("claude")
    .description("Interactively configure Claude settings only")
    .option("--config <path>", getConfigOptionDescription())
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const currentConfig = await loadConfig(configPath, {
        allowIncomplete: true,
        allowMissing: true,
        runtimeProjectRoot: PROJECT_ROOT
      });
      const updates = await promptForClaudeSettings(currentConfig);
      const config = await updateClaudeConfig(configPath, updates, {
        runtimeProjectRoot: PROJECT_ROOT
      });
      await applyClaudeConfig(config);
    });

  configCommand
    .command("get")
    .description("Show the current local proxy, Claude, and Codex configuration summary")
    .option("--config <path>", getConfigOptionDescription())
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      console.log(await buildConfigSummary(configPath));
    });

  program.addCommand(configCommand);

  const cleanCommand = new Command("clean")
    .description("Restore local Claude or OpenAI settings from backups")
    .option("--config <path>", getConfigOptionDescription())
    .addHelpText(
      "after",
      [
        "",
        "Subcommands:",
        "  claude-proxy clean",
        "  claude-proxy clean claude",
        "  claude-proxy clean openai",
        "",
        "Behavior:",
        "  Does not stop the running proxy server",
        ""
      ].join("\n")
    )
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const config = await loadConfig(configPath, {
        allowIncomplete: true,
        allowMissing: true,
        runtimeProjectRoot: PROJECT_ROOT
      });
      await cleanAllConfig(config);
    });

  cleanCommand
    .command("claude")
    .description("Restore Claude settings from backups")
    .option("--config <path>", getConfigOptionDescription())
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const config = await loadConfig(configPath, {
        allowIncomplete: true,
        allowMissing: true,
        runtimeProjectRoot: PROJECT_ROOT
      });
      await cleanClaudeConfig(config);
    });

  cleanCommand
    .command("openai")
    .description("Restore OpenAI/Codex settings from backups")
    .option("--config <path>", getConfigOptionDescription())
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const config = await loadConfig(configPath, {
        allowIncomplete: true,
        allowMissing: true,
        runtimeProjectRoot: PROJECT_ROOT
      });
      await cleanOpenAIConfig(config);
    });

  program
    .command("update")
    .description("Update the current claude-proxy installation")
    .addHelpText(
      "after",
      [
        "",
        "Help:",
        "  claude-proxy help update",
        ""
      ].join("\n")
    )
    .action(async () => {
      await runUpdate(PROJECT_ROOT);
    });

  program.addCommand(cleanCommand);

  const internalCommand = new Command("internal")
    .addCommand(
      new Command("ensure-proxy")
        .requiredOption("--config <path>")
        .action(async (options) => {
          const config = await loadConfig(options.config, {
            runtimeProjectRoot: PROJECT_ROOT
          });
          await ensureProxy(config, config, options.config);
        })
    )
    .addCommand(
      new Command("stop-proxy")
        .requiredOption("--config <path>")
        .action(async (options) => {
          const config = await loadConfig(options.config, {
            allowIncomplete: true,
            allowMissing: true,
            runtimeProjectRoot: PROJECT_ROOT
          });
          await stopProxy(config, config);
        })
    );

  program.addCommand(internalCommand, { hidden: true });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
