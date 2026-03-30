const fs = require("fs/promises");
const path = require("path");
const toml = require("@iarna/toml");
const {
  backupFile,
  copyFile,
  ensureDir,
  pathExists,
  readJson,
  writeJson
} = require("../utils");
const { cleanClaudeSettings, patchClaudeSettings } = require("./host-manager");

function getEmptyManagedState() {
  return {
    version: 1,
    files: {}
  };
}

function reportProgress(options, event) {
  if (typeof options?.onProgress === "function") {
    options.onProgress(event);
  }
}

async function runManagedStep(options, label, action) {
  reportProgress(options, { label, status: "started" });
  try {
    const result = await action();
    reportProgress(options, { label, status: "completed" });
    return result;
  } catch (error) {
    reportProgress(options, { label, status: "failed", error });
    throw error;
  }
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

async function writeToml(targetPath, value) {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, toml.stringify(value), "utf8");
}

async function loadManagedState(host) {
  const state = await readJson(host.managed_state_file, getEmptyManagedState());
  return {
    version: 1,
    files: {},
    ...state
  };
}

async function ensureManagedBackup(host, state, key, targetPath) {
  if (state.files[key]) {
    return state;
  }

  const existed = await pathExists(targetPath);
  const backupPath = existed ? await backupFile(targetPath, host.backups_dir) : null;
  state.files[key] = {
    existed,
    target_path: targetPath,
    backup_path: backupPath
  };
  return state;
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

function patchCodexConfigDocument(document, host, config = {}) {
  const patched = { ...document };
  const providerName = getCodexProviderName(
    patched,
    host.codex_provider || config.codex_provider || null
  );
  const baseUrl = host.base_url || config.base_url;

  if (providerName) {
    patched.model_providers = patched.model_providers || {};
    patched.model_providers[providerName] = {
      ...(patched.model_providers[providerName] || {}),
      base_url: baseUrl
    };
    return patched;
  }

  patched.base_url = baseUrl;
  return patched;
}

async function patchCodexConfig(config, host, state) {
  await ensureManagedBackup(host, state, "codex_config", host.codex_config_path);
  const document = await readToml(host.codex_config_path, {});
  await writeToml(host.codex_config_path, patchCodexConfigDocument(document, host, config));
}

async function patchCodexAuth(config, host, state) {
  await ensureManagedBackup(host, state, "codex_auth", host.codex_auth_path);
  const auth = await readJson(host.codex_auth_path, {});
  auth.OPENAI_API_KEY = host.api_key || config.api_key;
  await writeJson(host.codex_auth_path, auth);
}

function getManagedApplyEntries(host, config, state) {
  return {
    codex_config: {
      label: `Update Codex config (${host.codex_config_path})`,
      action: () => patchCodexConfig(config, host, state)
    },
    codex_auth: {
      label: `Update Codex auth (${host.codex_auth_path})`,
      action: () => patchCodexAuth(config, host, state)
    },
    claude_settings: {
      label: `Update Claude settings (${host.settings_path})`,
      action: async () => {
        await ensureManagedBackup(host, state, "claude_settings", host.settings_path);
        await patchClaudeSettings(config, host, { configPath: config.__configPath });
      }
    }
  };
}

async function applyManagedEntries(config, host, selectedKeys, options = {}) {
  await ensureDir(host.backups_dir);
  await ensureDir(host.state_dir);

  const state = await loadManagedState(host);
  const entries = getManagedApplyEntries(host, config, state);

  for (const key of selectedKeys) {
    const entry = entries[key];
    if (!entry) {
      continue;
    }

    await runManagedStep(options, entry.label, entry.action);
  }

  await runManagedStep(options, `Write managed state (${host.managed_state_file})`, async () => {
    await writeJson(host.managed_state_file, state);
  });
}

async function applyClaudeManagedHostConfig(config, host, options = {}) {
  return applyManagedEntries(config, host, ["claude_settings"], options);
}

async function applyOpenAIManagedHostConfig(config, host, options = {}) {
  return applyManagedEntries(config, host, ["codex_config", "codex_auth"], options);
}

async function applyManagedHostConfig(config, host, options = {}) {
  return applyManagedEntries(config, host, ["codex_config", "codex_auth", "claude_settings"], options);
}

async function restoreManagedFile(host, entry) {
  await backupFile(entry.target_path, host.backups_dir);

  if (entry.existed && entry.backup_path && (await pathExists(entry.backup_path))) {
    await copyFile(entry.backup_path, entry.target_path);
    return;
  }

  await fs.rm(entry.target_path, { force: true });
}

function getManagedEntries(host) {
  return {
    claude_settings: {
      key: "claude_settings",
      label: "Restore Claude settings",
      targetPath: host.settings_path,
      fallbackLabel: "Clean Claude settings",
      fallback: (config) => cleanClaudeSettings(config, host)
    },
    codex_config: {
      key: "codex_config",
      label: "Restore Codex config",
      targetPath: host.codex_config_path
    },
    codex_auth: {
      key: "codex_auth",
      label: "Restore Codex auth",
      targetPath: host.codex_auth_path
    }
  };
}

async function finalizeManagedState(host, state, options = {}) {
  if (Object.keys(state.files || {}).length === 0) {
    await runManagedStep(options, `Remove managed state (${host.managed_state_file})`, async () => {
      await fs.rm(host.managed_state_file, { force: true });
    });
    return;
  }

  await runManagedStep(options, `Write managed state (${host.managed_state_file})`, async () => {
    await writeJson(host.managed_state_file, state);
  });
}

async function cleanManagedEntries(config, host, selectedKeys, options = {}) {
  const state = await loadManagedState(host);
  const fileEntries = state.files || {};
  const managedEntries = getManagedEntries(host);
  let changed = false;

  for (const key of selectedKeys) {
    const descriptor = managedEntries[key];
    if (!descriptor) {
      continue;
    }

    const entry = fileEntries[key];
    if (entry) {
      await runManagedStep(options, `${descriptor.label} (${descriptor.targetPath})`, async () => {
        await restoreManagedFile(host, entry);
      });
      delete state.files[key];
      changed = true;
      continue;
    }

    if (descriptor.fallback) {
      await runManagedStep(
        options,
        `${descriptor.fallbackLabel} (${descriptor.targetPath})`,
        async () => {
          await descriptor.fallback(config);
        }
      );
      changed = true;
      continue;
    }

    reportProgress(options, {
      label: `${descriptor.label} (${descriptor.targetPath})`,
      status: "skipped"
    });
  }

  if (!changed) {
    return false;
  }

  await finalizeManagedState(host, state, options);
  return true;
}

async function cleanClaudeManagedHostConfig(config, host, options = {}) {
  return cleanManagedEntries(config, host, ["claude_settings"], options);
}

async function cleanOpenAIManagedHostConfig(config, host, options = {}) {
  return cleanManagedEntries(config, host, ["codex_config", "codex_auth"], options);
}

async function cleanManagedHostConfig(config, host, options = {}) {
  return cleanManagedEntries(config, host, ["claude_settings", "codex_config", "codex_auth"], options);
}

module.exports = {
  applyClaudeManagedHostConfig,
  applyManagedHostConfig,
  applyOpenAIManagedHostConfig,
  cleanClaudeManagedHostConfig,
  cleanManagedHostConfig,
  cleanOpenAIManagedHostConfig,
  patchCodexConfigDocument
};
