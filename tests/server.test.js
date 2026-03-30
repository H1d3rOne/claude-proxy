const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { startServer } = require("../src/proxy/server");

function createHostFixture(rootDir) {
  const claudeDir = path.join(rootDir, "claude-home");
  const runtimeDir = path.join(claudeDir, "claude-proxy");
  const stateDir = path.join(runtimeDir, "state");
  const logsDir = path.join(runtimeDir, "logs");

  return {
    name: "local",
    type: "local",
    base_url: "https://host-upstream.example/v1",
    api_key: "host-upstream-key",
    client_api_key: "arbitrary value",
    big_model: "gpt-5.4",
    middle_model: "gpt-5.3-codex",
    small_model: "gpt-5.2-codex",
    project_root: rootDir,
    claude_dir: claudeDir,
    runtime_dir: runtimeDir,
    state_dir: stateDir,
    logs_dir: logsDir,
    settings_path: path.join(claudeDir, "settings.json"),
    backups_dir: path.join(claudeDir, "backups"),
    sessions_file: path.join(stateDir, "sessions.txt"),
    pid_file: path.join(stateDir, "proxy.pid"),
    server_log_file: path.join(logsDir, "server.log"),
    config_path: path.join(rootDir, "config.toml")
  };
}

function httpJsonRequest({ port, pathName, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathName,
        method,
        headers
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: text ? JSON.parse(text) : null
          });
        });
      }
    );

    request.on("error", reject);
    if (body) {
      request.write(JSON.stringify(body));
    }
    request.end();
  });
}

test("server proxies Claude requests to an OpenAI-compatible upstream", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-server-"));
  const host = createHostFixture(rootDir);
  const config = {
    server_host: "127.0.0.1",
    server_port: 0,
    big_model: "fallback-big-model",
    middle_model: "fallback-middle-model",
    small_model: "fallback-small-model"
  };

  let upstreamCall;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(options.signal.aborted, false);

    upstreamCall = {
      url,
      headers: options.headers,
      body: JSON.parse(options.body)
    };

    return {
      ok: true,
      async json() {
        return {
          id: "chatcmpl_test",
          choices: [
            {
              message: {
                content: "Hello from upstream."
              },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 4
          }
        };
      }
    };
  };

  const server = await startServer(config, host);

  try {
    const port = server.address().port;
    const response = await httpJsonRequest({
      port,
      pathName: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "arbitrary value"
      },
      body: {
        model: "claude-3-opus",
        max_tokens: 256,
        messages: [{ role: "user", content: "Hello" }]
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(upstreamCall.url, "https://host-upstream.example/v1/chat/completions");
    assert.equal(upstreamCall.headers.Authorization, "Bearer host-upstream-key");
    assert.equal(upstreamCall.body.model, "gpt-5.4");
    assert.deepEqual(response.body, {
      id: "chatcmpl_test",
      type: "message",
      role: "assistant",
      model: "claude-3-opus",
      content: [{ type: "text", text: "Hello from upstream." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 4
      }
    });
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("server adds /v1 for Claude upstream requests when base_url has no path", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-server-"));
  const host = createHostFixture(rootDir);
  host.base_url = "https://host-upstream.example";

  const config = {
    server_host: "127.0.0.1",
    server_port: 0,
    big_model: "fallback-big-model",
    middle_model: "fallback-middle-model",
    small_model: "fallback-small-model"
  };

  let upstreamCall;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    upstreamCall = {
      url,
      headers: options.headers,
      body: JSON.parse(options.body)
    };

    return {
      ok: true,
      async json() {
        return {
          id: "chatcmpl_root_base_url",
          choices: [
            {
              message: {
                content: "Hello from upstream."
              },
              finish_reason: "stop"
            }
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 4
          }
        };
      }
    };
  };

  const server = await startServer(config, host);

  try {
    const port = server.address().port;
    const response = await httpJsonRequest({
      port,
      pathName: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "arbitrary value"
      },
      body: {
        model: "claude-3-opus",
        max_tokens: 256,
        messages: [{ role: "user", content: "Hello" }]
      }
    });

    assert.equal(response.statusCode, 200);
    assert.equal(upstreamCall.url, "https://host-upstream.example/v1/chat/completions");
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test("test-connection uses the same normalized upstream path", async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "claude-proxy-server-"));
  const host = createHostFixture(rootDir);
  host.base_url = "https://host-upstream.example";

  const config = {
    server_host: "127.0.0.1",
    server_port: 0,
    big_model: "fallback-big-model",
    middle_model: "fallback-middle-model",
    small_model: "fallback-small-model"
  };

  let upstreamCall;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    upstreamCall = {
      url,
      headers: options.headers,
      body: JSON.parse(options.body)
    };

    return {
      ok: true,
      async json() {
        return {
          id: "chatcmpl_test_connection"
        };
      }
    };
  };

  const server = await startServer(config, host);

  try {
    const port = server.address().port;
    const response = await httpJsonRequest({
      port,
      pathName: "/test-connection",
      method: "GET"
    });

    assert.equal(response.statusCode, 200);
    assert.equal(upstreamCall.url, "https://host-upstream.example/v1/chat/completions");
    assert.equal(upstreamCall.body.model, "gpt-5.2-codex");
    assert.equal(response.body.status, "success");
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
