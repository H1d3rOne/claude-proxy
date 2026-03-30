const express = require("express");
const fs = require("fs/promises");
const { DEFAULT_CLIENT_API_KEY } = require("../config");
const { ensureDir, writeText } = require("../utils");
const {
  convertClaudeToOpenAI,
  convertOpenAIToClaudeResponse,
  mapClaudeModelToOpenAI,
  streamOpenAiToClaude
} = require("./converters");

function resolveChatCompletionsUrl(baseUrl) {
  const upstreamUrl = new URL(String(baseUrl));
  const normalizedPath = upstreamUrl.pathname.replace(/\/+$/, "");

  upstreamUrl.pathname =
    !normalizedPath || normalizedPath === "/"
      ? "/v1/chat/completions"
      : `${normalizedPath}/chat/completions`;

  return upstreamUrl.toString();
}

function extractClientApiKey(request) {
  const xApiKey = request.headers["x-api-key"];
  if (xApiKey) {
    return String(xApiKey);
  }

  const auth = request.headers.authorization;
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length);
  }

  return null;
}

function validateClientApiKey(request, config) {
  if (!config.client_api_key) {
    return true;
  }
  return extractClientApiKey(request) === config.client_api_key;
}

async function parseUpstreamError(response) {
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return json.error?.message || json.message || text;
  } catch {
    return text || `Upstream request failed with status ${response.status}`;
  }
}

function createUpstreamHeaders(config) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.api_key}`
  };
}

function estimateInputTokens(messageRequest) {
  let totalChars = 0;
  if (typeof messageRequest.system === "string") {
    totalChars += messageRequest.system.length;
  } else if (Array.isArray(messageRequest.system)) {
    totalChars += messageRequest.system
      .filter((block) => block && typeof block.text === "string")
      .reduce((sum, block) => sum + block.text.length, 0);
  }

  for (const message of messageRequest.messages || []) {
    if (typeof message.content === "string") {
      totalChars += message.content.length;
      continue;
    }

    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block && typeof block.text === "string") {
          totalChars += block.text.length;
        }
      }
    }
  }

  return Math.max(1, Math.floor(totalChars / 4));
}

async function startServer(config, host) {
  const app = express();
  app.use(express.json({ limit: "100mb" }));
  const baseUrl = host.base_url || config.base_url;
  const apiKey = host.api_key || config.api_key;
  const clientApiKey = host.client_api_key || DEFAULT_CLIENT_API_KEY;
  const smallModel = host.small_model || config.small_model;

  app.get("/", async (request, response) => {
    response.json({
      message: "Claude-to-OpenAI API Proxy (Node rewrite)",
      status: "running",
      upstream_base_url: baseUrl,
      listen: `${config.server_host}:${config.server_port}`,
      host: host.name
    });
  });

  app.get("/health", async (request, response) => {
    response.json({
      status: "healthy",
      upstream_base_url: baseUrl,
      api_key_configured: Boolean(apiKey),
      client_api_key_configured: Boolean(clientApiKey),
      host: host.name
    });
  });

  app.get("/test-connection", async (request, response) => {
    try {
      const upstreamResponse = await fetch(resolveChatCompletionsUrl(baseUrl), {
        method: "POST",
        headers: createUpstreamHeaders({ api_key: apiKey }),
        body: JSON.stringify({
          model: smallModel,
          messages: [{ role: "user", content: "Hello" }],
          max_tokens: 5
        })
      });

      if (!upstreamResponse.ok) {
        throw new Error(await parseUpstreamError(upstreamResponse));
      }

      const payload = await upstreamResponse.json();
      response.json({
        status: "success",
        model_used: smallModel,
        response_id: payload.id || null
      });
    } catch (error) {
      response.status(503).json({
        status: "failed",
        message: error.message
      });
    }
  });

  app.post("/v1/messages/count_tokens", async (request, response) => {
    response.json({
      input_tokens: estimateInputTokens(request.body || {})
    });
  });

  app.post("/v1/messages", async (request, response) => {
    if (!validateClientApiKey(request, { client_api_key: clientApiKey })) {
      response.status(401).json({
        type: "error",
        error: {
          type: "authentication_error",
          message: "Invalid Claude client API key."
        }
      });
      return;
    }

    let openaiRequest;
    try {
      openaiRequest = convertClaudeToOpenAI(request.body, {
        big_model: host.big_model || config.big_model,
        middle_model: host.middle_model || config.middle_model,
        small_model: smallModel
      });
    } catch (error) {
      response.status(400).json({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: error.message
        }
      });
      return;
    }

    const abortController = new AbortController();
    request.on("aborted", () => abortController.abort());
    response.on("close", () => {
      if (!response.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const upstreamResponse = await fetch(resolveChatCompletionsUrl(baseUrl), {
        method: "POST",
        headers: createUpstreamHeaders({ api_key: apiKey }),
        body: JSON.stringify(openaiRequest),
        signal: abortController.signal
      });

      if (!upstreamResponse.ok) {
        response.status(upstreamResponse.status).json({
          type: "error",
          error: {
            type: "api_error",
            message: await parseUpstreamError(upstreamResponse)
          }
        });
        return;
      }

      if (openaiRequest.stream) {
        response.status(200);
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Access-Control-Allow-Headers", "*");
        response.flushHeaders();
        await streamOpenAiToClaude(upstreamResponse, response, request.body, abortController);
        response.end();
        return;
      }

      const upstreamJson = await upstreamResponse.json();
      const claudeResponse = convertOpenAIToClaudeResponse(upstreamJson, request.body);
      response.json(claudeResponse);
    } catch (error) {
      const status = error.name === "AbortError" ? 499 : 500;
      response.status(status).json({
        type: "error",
        error: {
          type: "api_error",
          message: error.message
        }
      });
    }
  });

  await ensureDir(host.state_dir);
  await ensureDir(host.logs_dir);

  return new Promise((resolve, reject) => {
    const server = app.listen(config.server_port, config.server_host, async () => {
      await writeText(host.pid_file, `${process.pid}\n`);
      resolve(server);
    });

    server.on("error", async (error) => {
      try {
        await fs.rm(host.pid_file, { force: true });
      } catch {}
      reject(error);
    });

    const cleanup = async () => {
      try {
        await fs.rm(host.pid_file, { force: true });
      } catch {}
      process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });
}

module.exports = {
  mapClaudeModelToOpenAI,
  resolveChatCompletionsUrl,
  startServer
};
