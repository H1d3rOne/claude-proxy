const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  cleanClaudeSettings,
  patchClaudeSettings
} = require("../src/services/host-manager");

function createHostFixture(rootDir) {
  const projectRoot = path.join(rootDir, "project with spaces");
  const claudeDir = path.join(rootDir, "claude with spaces");
  const runtimeDir = path.join(claudeDir, "claude-proxy");
  const stateDir = path.join(runtimeDir, "state");
  const logsDir = path.join(runtimeDir, "logs");

  return {
    name: "local",
    type: "local",
    project_root: projectRoot,
    claude_dir: claudeDir,
    runtime_dir: runtimeDir,
    state_dir: stateDir,
    logs_dir: logsDir,
    settings_path: path.join(claudeDir, "settings.json"),
    backups_dir: path.join(claudeDir, "backups"),
    sessions_file: path.join(stateDir, "sessions.txt"),
    pid_file: path.join(stateDir, "proxy.pid"),
    server_log_file: path.join(logsDir, "server.log"),
    config_path: path.join(projectRoot, "config.toml")
  };
}

test("patchClaudeSettings manages env and hooks and cleanClaudeSettings removes only managed state", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-config-"));
  const host = createHostFixture(rootDir);
  const config = {
    server_port: 8082,
    small_model: "gpt-5.2-codex",
    middle_model: "gpt-5.3-codex",
    big_model: "gpt-5.4",
    default_claude_model: "opus[1m]"
  };

  await fs.mkdir(host.project_root, { recursive: true });
  await fs.mkdir(host.claude_dir, { recursive: true });
  await fs.writeFile(
    host.settings_path,
    JSON.stringify(
      {
        env: {
          KEEP_ME: "yes",
          ANTHROPIC_API_KEY: "old-key"
        },
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: "command", command: "echo keep start" }]
            },
            {
              hooks: [
                {
                  type: "command",
                  command: "/bin/zsh /Users/Apple/.claude/bin/ensure-claude-code-proxy.sh"
                }
              ]
            }
          ],
          SessionEnd: [
            {
              hooks: [{ type: "command", command: "echo keep end" }]
            },
            {
              hooks: [
                {
                  type: "command",
                  command: "/bin/zsh /Users/Apple/.claude/bin/stop-claude-code-proxy.sh"
                }
              ]
            }
          ]
        }
      },
      null,
      2
    )
  );

  await patchClaudeSettings(config, host);

  const patched = JSON.parse(await fs.readFile(host.settings_path, "utf8"));
  assert.equal(patched.env.KEEP_ME, "yes");
  assert.equal(patched.env.ANTHROPIC_API_KEY, "arbitrary value");
  assert.equal(patched.env.ANTHROPIC_BASE_URL, "http://localhost:8082");
  assert.equal(patched.model, "opus[1m]");

  const ensureHook = patched.hooks.SessionStart
    .flatMap((group) => group.hooks || [])
    .find((hook) => hook.command.includes("internal ensure-proxy"));
  const stopHook = patched.hooks.SessionEnd
    .flatMap((group) => group.hooks || [])
    .find((hook) => hook.command.includes("internal stop-proxy"));

  assert.ok(ensureHook);
  assert.ok(stopHook);
  assert.match(ensureHook.command, /^claude-proxy internal ensure-proxy /);
  assert.match(stopHook.command, /^claude-proxy internal stop-proxy /);
  assert.match(ensureHook.command, /--config '[^']*project with spaces\/config\.toml'/);
  assert.doesNotMatch(ensureHook.command, /src\/cli\.js/);
  assert.doesNotMatch(stopHook.command, /src\/cli\.js/);
  assert.doesNotMatch(ensureHook.command, /--host/);
  assert.doesNotMatch(stopHook.command, /--host/);
  assert.equal(
    patched.hooks.SessionStart
      .flatMap((group) => group.hooks || [])
      .some((hook) => hook.command.includes("ensure-claude-code-proxy.sh")),
    false
  );
  assert.equal(
    patched.hooks.SessionEnd
      .flatMap((group) => group.hooks || [])
      .some((hook) => hook.command.includes("stop-claude-code-proxy.sh")),
    false
  );

  await cleanClaudeSettings(config, host);

  const cleaned = JSON.parse(await fs.readFile(host.settings_path, "utf8"));
  assert.deepEqual(cleaned.env, { KEEP_ME: "yes" });
  assert.equal(cleaned.model, undefined);
  assert.deepEqual(cleaned.hooks.SessionStart, [
    {
      hooks: [{ type: "command", command: "echo keep start" }]
    }
  ]);
  assert.deepEqual(cleaned.hooks.SessionEnd, [
    {
      hooks: [{ type: "command", command: "echo keep end" }]
    }
  ]);

  await fs.rm(rootDir, { recursive: true, force: true });
});
