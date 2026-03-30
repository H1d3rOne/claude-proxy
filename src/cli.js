#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const toml = require("@iarna/toml");
const { Command } = require("commander");
const {
  clearConfigSection,
  getDefaultConfigDisplayPath,
  getDefaultConfigPath,
  loadConfig,
  promptForConfig,
  promptForConfigSection,
  readConfigDocument
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
  const codexProvider = getCodexProviderName(codexConfig, config.codex_provider || null);
  const codexBaseUrl = codexProvider
    ? codexConfig.model_providers?.[codexProvider]?.base_url
    : codexConfig.base_url;

  const codexAuthExists = await pathExists(config.codex_auth_path);
  const codexAuth = await readJson(config.codex_auth_path, {});

  return [
    formatSection("Config File", [
      `path: ${resolvedConfigPath}`,
      `exists: ${configExists ? "yes" : "no"}`,
      `server_host: ${formatValue(document.server_host)}`,
      `server_port: ${formatValue(document.server_port)}`,
      `base_url: ${formatValue(document.base_url)}`,
      `api_key: ${formatValue(document.api_key)}`,
      `big_model: ${formatValue(document.big_model)}`,
      `middle_model: ${formatValue(document.middle_model)}`,
      `small_model: ${formatValue(document.small_model)}`,
      `default_claude_model: ${formatValue(document.default_claude_model)}`,
      `home_dir: ${formatValue(document.home_dir)}`,
      `claude_dir: ${formatValue(document.claude_dir)}`,
      `codex_dir: ${formatValue(document.codex_dir)}`,
      `codex_provider: ${formatValue(document.codex_provider)}`
    ]),
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
      "  claude-proxy config",
      "    Interactively configure the local proxy and apply local Claude/Codex settings",
      "  claude-proxy config claude",
      "    Interactively configure Claude settings only",
      "  claude-proxy config openai",
      "    Interactively configure OpenAI/Codex settings only",
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
    .description("Manage the local proxy configuration")
    .option("--config <path>", getConfigOptionDescription())
    .addHelpText(
      "after",
      [
        "",
        "Subcommands:",
        "  claude-proxy config",
        "  claude-proxy config claude",
        "  claude-proxy config openai",
        "  claude-proxy config get",
        ""
      ].join("\n")
    )
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const config = await promptForConfig(configPath, {
        runtimeProjectRoot: PROJECT_ROOT
      });
      await applyLocalConfig(config);
    });

  configCommand
    .command("claude")
    .description("Interactively configure Claude settings only")
    .option("--config <path>", getConfigOptionDescription())
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const config = await promptForConfigSection(configPath, "claude", {
        runtimeProjectRoot: PROJECT_ROOT
      });
      await applyClaudeConfig(config);
    });

  configCommand
    .command("openai")
    .description("Interactively configure OpenAI/Codex settings only")
    .option("--config <path>", getConfigOptionDescription())
    .action(async (options, command) => {
      const configPath = resolveConfigPath(options, command);
      const config = await promptForConfigSection(configPath, "openai", {
        runtimeProjectRoot: PROJECT_ROOT
      });
      await applyOpenAIConfig(config);
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
