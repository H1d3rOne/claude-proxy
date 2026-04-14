const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");

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

function runCliWithInput(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["./src/cli.js", ...args], {
      cwd: options.cwd || projectRoot,
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(
        `cli exited with code=${code} signal=${signal} stdout=${stdout} stderr=${stderr}`
      );
      error.code = code;
      error.signal = signal;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    child.stdin.end(options.input || "");
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
  assert.match(stdout, /config(?: \[options\])?\s+Manage named upstream profiles and local runtime settings/);
  assert.doesNotMatch(stdout, /\bserve\b/);
  assert.match(stdout, /Default config path: <home>\/\.claude-proxy\/config\.toml/);
  assert.doesNotMatch(stdout, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(stdout, /claude-proxy config add\s+Add a named upstream profile/);
  assert.match(stdout, /claude-proxy config use\s+Choose the active profile and sync Codex credentials/);
  assert.match(stdout, /claude-proxy config alt\s+Edit a saved upstream profile in place/);
  assert.match(stdout, /claude-proxy config del\s+Delete a non-active upstream profile/);
  assert.match(stdout, /claude-proxy config claude\s+Interactively configure Claude settings only/);
  assert.match(stdout, /claude-proxy config get\s+Show the current local proxy, Claude, and Codex configuration summary/);
  assert.doesNotMatch(stdout, /claude-proxy config\s+Interactively configure the local proxy and apply local Claude\/Codex settings/);
  assert.doesNotMatch(stdout, /claude-proxy config openai/);
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
  assert.match(stdout, /\bupdate\b/);
  assert.match(stdout, /claude-proxy update\s+Update the current claude-proxy installation/);
  assert.match(stdout, /claude-proxy help update/);
});

test("help update presents usage and the update description", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["./src/cli.js", "help", "update"],
    { cwd: projectRoot }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Usage: claude-proxy update/);
  assert.match(stdout, /Update the current claude-proxy installation/);
});

test("config help exposes add, use, alt, del, get, and claude subcommands", async () => {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ["./src/cli.js", "help", "config"],
    { cwd: projectRoot }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Usage: claude-proxy config \[options\] \[command\]/);
  assert.match(stdout, /\badd\b/);
  assert.match(stdout, /\buse\b/);
  assert.match(stdout, /\balt\b/);
  assert.match(stdout, /\bdel\b/);
  assert.match(stdout, /\bget\b/);
  assert.match(stdout, /\bclaude\b/);
  assert.doesNotMatch(stdout, /\bopenai\b/);
  assert.match(stdout, /claude-proxy config add/);
  assert.match(stdout, /claude-proxy config use/);
  assert.match(stdout, /claude-proxy config alt/);
  assert.match(stdout, /claude-proxy config del/);
  assert.match(stdout, /claude-proxy config claude/);
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
      'active_profile = "work"',
      `claude_dir = ${JSON.stringify(claudeDir)}`,
      `codex_dir = ${JSON.stringify(codexDir)}`,
      "",
      "[[profiles]]",
      'name = "Work Provider"',
      'model_provider = "work"',
      'base_url = "https://upstream.example/v1"',
      'api_key = "sk-config"',
      'big_model = "gpt-5.4"',
      'middle_model = "gpt-5.3-codex"',
      'small_model = "gpt-5.2-codex"',
      'default_claude_model = "opus[1m]"',
      "",
      "[[profiles]]",
      'name = "Personal Workspace"',
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
      'model_provider = "work"',
      "",
      "[model_providers.work]",
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
  assert.match(stdout, /active_profile: work/);
  assert.match(stdout, /profiles: 2/);
  assert.match(stdout, /Active Profile/);
  assert.match(stdout, /name: Work Provider/);
  assert.match(stdout, /model_provider: work/);
  assert.match(stdout, /api_key: sk-config/);
  assert.match(stdout, /Profiles/);
  assert.match(stdout, /name: Work Provider/);
  assert.match(stdout, /model_provider: work \(active\)/);
  assert.match(stdout, /name: Personal Workspace/);
  assert.match(stdout, /model_provider: personal/);
  assert.match(stdout, /api_key: sk-personal/);
  assert.match(stdout, /Claude/);
  assert.match(stdout, /ANTHROPIC_BASE_URL: http:\/\/localhost:8082/);
  assert.match(stdout, /ensure-proxy hook: installed/);
  assert.match(stdout, /stop-proxy hook: installed/);
  assert.match(stdout, /Codex Config/);
  assert.match(stdout, /provider: work/);
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
  assert.match(stdout, /active_profile: \(not set\)/);
  assert.match(stdout, /profiles: 0/);
  assert.match(stdout, /Active Profile/);
  assert.match(stdout, /name: \(not set\)/);
  assert.match(stdout, /model_provider: \(not set\)/);
  assert.match(stdout, /base_url: \(not set\)/);
  assert.match(stdout, /api_key: \(not set\)/);
  assert.match(stdout, /Profiles/);
  assert.match(stdout, /\(none\)/);
  assert.match(stdout, /claude_dir: \(not set\)/);
  assert.match(stdout, /codex_dir: \(not set\)/);

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("config use updates active_profile and syncs Codex credentials for the chosen profile", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-cli-use-"));
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
      `claude_dir = ${JSON.stringify(claudeDir)}`,
      `codex_dir = ${JSON.stringify(codexDir)}`,
      'active_profile = "work"',
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
      'name = "Personal Workspace"',
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
  await fs.writeFile(
    path.join(codexDir, "config.toml"),
    [
      'model_provider = "work"',
      'name = "Work Provider"',
      "",
      "[model_providers.work]",
      'name = "Work Provider"',
      'base_url = "https://old.example/v1"',
      ""
    ].join("\n")
  );
  await fs.writeFile(
    path.join(codexDir, "auth.json"),
    JSON.stringify({ OPENAI_API_KEY: "sk-old" }, null, 2)
  );

  const { stdout, stderr } = await runCliWithInput(
    ["config", "use", "--config", configPath],
    { input: "2\n" }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Configured OpenAI environment/);

  const { document } = await require("../src/config").readConfigDocument(configPath);
  assert.equal(document.active_profile, "personal");

  const codexConfig = await fs.readFile(path.join(codexDir, "config.toml"), "utf8");
  const codexAuth = JSON.parse(await fs.readFile(path.join(codexDir, "auth.json"), "utf8"));
  assert.match(codexConfig, /model_provider = "personal"/);
  assert.match(codexConfig, /name = "Personal Workspace"/);
  assert.match(codexConfig, /\[model_providers\.personal\]/);
  assert.match(codexConfig, /\[model_providers\.personal\][\s\S]*name = "Personal Workspace"/);
  assert.match(codexConfig, /base_url = "https:\/\/personal\.example\/v1"/);
  assert.doesNotMatch(codexConfig, /\[model_providers\.work\]/);
  assert.equal(codexAuth.OPENAI_API_KEY, "sk-personal");

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("config add defaults model_provider to OpenAI and name to the same value", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-cli-add-defaults-"));
  const configPath = path.join(rootDir, "config.toml");

  const { stdout, stderr } = await runCliWithInput(
    ["config", "add", "--config", configPath],
    { input: "\n\nhttps://openai.example/v1\nsk-openai\n\n\n\n\n" }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Added profile: OpenAI/);

  const { document } = await require("../src/config").readConfigDocument(configPath);
  assert.equal(document.active_profile, "OpenAI");
  assert.equal(document.profiles[0].model_provider, "OpenAI");
  assert.equal(document.profiles[0].name, "OpenAI");

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("config alt edits the chosen profile in place", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-cli-alt-"));
  const configPath = path.join(rootDir, "config.toml");

  await fs.writeFile(
    configPath,
    [
      'server_host = "127.0.0.1"',
      "server_port = 8082",
      'active_profile = "work"',
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

  const { stdout, stderr } = await runCliWithInput(
    ["config", "alt", "--config", configPath],
    { input: "2\nPersonal Workspace\nhttps://edited.example/v1\nsk-edited\n\n\n\n\n" }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Updated profile: personal/);

  const { document } = await require("../src/config").readConfigDocument(configPath);
  assert.equal(document.active_profile, "work");
  assert.equal(document.profiles[1].model_provider, "personal");
  assert.equal(document.profiles[1].name, "Personal Workspace");
  assert.equal(document.profiles[1].base_url, "https://edited.example/v1");
  assert.equal(document.profiles[1].api_key, "sk-edited");

  await fs.rm(rootDir, { recursive: true, force: true });
});

test("config del removes the chosen non-active profile", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-cli-del-"));
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
      "",
      "[[profiles]]",
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

  const { stdout, stderr } = await runCliWithInput(
    ["config", "del", "--config", configPath],
    { input: "2\n" }
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Deleted profile: personal/);

  const { document } = await require("../src/config").readConfigDocument(configPath);
  assert.equal(document.active_profile, "work");
  assert.deepEqual(
    document.profiles.map((profile) => profile.model_provider),
    ["work"]
  );

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
