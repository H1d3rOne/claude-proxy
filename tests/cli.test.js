const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");

function execFileAsync(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

test("cli help exposes local-only public commands and hides internal commands", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["./src/cli.js", "help"],
    { cwd: projectRoot }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /\bstart\b/);
  assert.match(stdout, /\bstop\b/);
  assert.match(stdout, /\bconfig\b/);
  assert.match(stdout, /\bclean\b/);
  assert.match(stdout, /config(?: \[options\])?\s+Manage the local proxy configuration/);
  assert.doesNotMatch(stdout, /\bserve\b/);
  assert.match(stdout, /Default config path: <home>\/\.claude-proxy\/config\.toml/);
  assert.doesNotMatch(stdout, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(stdout, /claude-proxy config\s+Interactively configure the local proxy and apply local Claude\/Codex settings/);
  assert.match(stdout, /claude-proxy config claude\s+Interactively configure Claude settings only/);
  assert.match(stdout, /claude-proxy config openai\s+Interactively configure OpenAI\/Codex settings only/);
  assert.match(stdout, /claude-proxy config get\s+Show the current local proxy, Claude, and Codex configuration summary/);
  assert.match(stdout, /clean(?: \[options\])?\s+Restore local Claude or OpenAI settings from backups/);
  assert.match(stdout, /claude-proxy clean\s+Restore local Claude\/Codex settings and clear config\.toml owned fields/);
  assert.match(stdout, /claude-proxy start\s+Start the local proxy server only/);
  assert.match(stdout, /claude-proxy stop\s+Stop the managed local proxy server/);
  assert.match(stdout, /claude-proxy help config/);
  assert.match(stdout, /claude-proxy help start/);
  assert.match(stdout, /claude-proxy help stop/);
  assert.doesNotMatch(stdout, /\bremote\b/);
  assert.doesNotMatch(stdout, /--host/);
  assert.doesNotMatch(stdout, /--include-disabled/);
  assert.doesNotMatch(stdout, /\binternal\b/);
});

test("config help exposes get plus optional claude/openai subcommands", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["./src/cli.js", "help", "config"],
    { cwd: projectRoot }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Usage: claude-proxy config \[options\] \[command\]/);
  assert.match(stdout, /\bget\b/);
  assert.match(stdout, /\bclaude\b/);
  assert.match(stdout, /\bopenai\b/);
  assert.match(stdout, /claude-proxy config/);
  assert.match(stdout, /claude-proxy config claude/);
  assert.match(stdout, /claude-proxy config openai/);
  assert.match(stdout, /claude-proxy config get/);
});

test("clean help exposes optional claude and openai subcommands while clean itself restores all", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["./src/cli.js", "help", "clean"],
    { cwd: projectRoot }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Usage: claude-proxy clean \[options\] \[command\]/);
  assert.match(stdout, /claude-proxy clean/);
  assert.match(stdout, /claude-proxy clean claude/);
  assert.match(stdout, /claude-proxy clean openai/);
  assert.match(stdout, /claude(?: \[options\])?\s+Restore Claude settings from backups/);
  assert.match(stdout, /openai(?: \[options\])?\s+Restore OpenAI\/Codex settings from backups/);
});

test("config get prints config, Claude, and Codex summaries with key fields", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-cli-get-"));
  const configPath = path.join(rootDir, "config.toml");
  const claudeDir = path.join(rootDir, "claude-home");
  const codexDir = path.join(rootDir, "codex-home");

  await fs.mkdir(claudeDir, { recursive: true });
  await fs.mkdir(codexDir, { recursive: true });

  await fs.writeFile(
    configPath,
    [
      'server_host = "127.0.0.1"',
      "server_port = 8082",
      'base_url = "https://upstream.example/v1"',
      'api_key = "sk-config"',
      'big_model = "gpt-5.4"',
      'middle_model = "gpt-5.3-codex"',
      'small_model = "gpt-5.2-codex"',
      'default_claude_model = "opus[1m]"',
      `claude_dir = ${JSON.stringify(claudeDir)}`,
      `codex_dir = ${JSON.stringify(codexDir)}`,
      'codex_provider = "custom"',
      ""
    ].join("\n")
  );

  await fs.writeFile(
    path.join(claudeDir, "settings.json"),
    JSON.stringify(
      {
        env: {
          ANTHROPIC_BASE_URL: "http://localhost:8082",
          ANTHROPIC_API_KEY: "arbitrary value",
          ANTHROPIC_MODEL: "gpt-5.4"
        },
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "claude-proxy internal ensure-proxy --config '/tmp/config.toml'"
                }
              ]
            }
          ],
          SessionEnd: [
            {
              hooks: [
                {
                  type: "command",
                  command: "claude-proxy internal stop-proxy --config '/tmp/config.toml'"
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

  await fs.writeFile(
    path.join(codexDir, "config.toml"),
    [
      'model_provider = "custom"',
      "",
      "[model_providers.custom]",
      'name = "custom"',
      'base_url = "https://upstream.example/v1"',
      ""
    ].join("\n")
  );

  await fs.writeFile(
    path.join(codexDir, "auth.json"),
    JSON.stringify(
      {
        OPENAI_API_KEY: "sk-codex-auth"
      },
      null,
      2
    )
  );

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["./src/cli.js", "config", "get", "--config", configPath],
    { cwd: projectRoot }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Config File/);
  assert.match(stdout, new RegExp(configPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(stdout, /api_key: sk-config/);
  assert.match(stdout, /Claude/);
  assert.match(stdout, /ANTHROPIC_BASE_URL: http:\/\/localhost:8082/);
  assert.match(stdout, /ensure-proxy hook: installed/);
  assert.match(stdout, /stop-proxy hook: installed/);
  assert.match(stdout, /Codex Config/);
  assert.match(stdout, /provider: custom/);
  assert.match(stdout, /base_url: https:\/\/upstream\.example\/v1/);
  assert.match(stdout, /Codex Auth/);
  assert.match(stdout, /OPENAI_API_KEY: sk-codex-auth/);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("config get shows missing config file fields as not set instead of normalized defaults", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-cli-get-missing-fields-"));
  const configPath = path.join(rootDir, "config.toml");

  await fs.writeFile(
    configPath,
    [
      'server_host = "127.0.0.1"',
      "server_port = 8082",
      'home_dir = "~"',
      ""
    ].join("\n")
  );

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["./src/cli.js", "config", "get", "--config", configPath],
    { cwd: projectRoot }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /base_url: \(not set\)/);
  assert.match(stdout, /api_key: \(not set\)/);
  assert.match(stdout, /big_model: \(not set\)/);
  assert.match(stdout, /middle_model: \(not set\)/);
  assert.match(stdout, /small_model: \(not set\)/);
  assert.match(stdout, /default_claude_model: \(not set\)/);
  assert.match(stdout, /claude_dir: \(not set\)/);
  assert.match(stdout, /codex_dir: \(not set\)/);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("start prints the listening address after the server is ready", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-cli-start-"));
  const configPath = path.join(rootDir, "config.toml");

  await fs.writeFile(
    configPath,
    [
      'server_host = "127.0.0.1"',
      "server_port = 18082",
      'base_url = "https://upstream.example/v1"',
      'api_key = "sk-config"',
      ""
    ].join("\n")
  );

  const child = execFile(process.execPath, ["./src/cli.js", "start", "--config", configPath], {
    cwd: projectRoot
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for start output. stdout=${stdout} stderr=${stderr}`));
    }, 5000);

    const onData = () => {
      if (stdout.includes("Proxy listening on 127.0.0.1:18082")) {
        clearTimeout(timeout);
        child.kill("SIGTERM");
        resolve();
      }
    };

    child.stdout.on("data", onData);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      if (stdout.includes("Proxy listening on 127.0.0.1:18082")) {
        clearTimeout(timeout);
        resolve();
        return;
      }
      clearTimeout(timeout);
      reject(new Error(`start exited before readiness output. code=${code} signal=${signal} stdout=${stdout} stderr=${stderr}`));
    });
  });

  assert.equal(stderr, "");
  assert.match(stdout, /Proxy listening on 127\.0\.0\.1:18082/);

  await fs.rm(rootDir, { recursive: true, force: true });
});
