const crypto = require("crypto");

const CONSTANTS = {
  ROLE_USER: "user",
  ROLE_ASSISTANT: "assistant",
  ROLE_SYSTEM: "system",
  ROLE_TOOL: "tool",
  CONTENT_TEXT: "text",
  CONTENT_IMAGE: "image",
  CONTENT_TOOL_USE: "tool_use",
  CONTENT_TOOL_RESULT: "tool_result",
  TOOL_FUNCTION: "function",
  STOP_END_TURN: "end_turn",
  STOP_MAX_TOKENS: "max_tokens",
  STOP_TOOL_USE: "tool_use",
  EVENT_MESSAGE_START: "message_start",
  EVENT_MESSAGE_STOP: "message_stop",
  EVENT_MESSAGE_DELTA: "message_delta",
  EVENT_CONTENT_BLOCK_START: "content_block_start",
  EVENT_CONTENT_BLOCK_STOP: "content_block_stop",
  EVENT_CONTENT_BLOCK_DELTA: "content_block_delta",
  EVENT_PING: "ping",
  DELTA_TEXT: "text_delta",
  DELTA_INPUT_JSON: "input_json_delta"
};

function randomMessageId(prefix = "msg") {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function mapClaudeModelToOpenAI(claudeModel, config) {
  if (!claudeModel) {
    return config.big_model;
  }

  const model = String(claudeModel);
  if (
    model.startsWith("gpt-") ||
    model.startsWith("o1-") ||
    model.startsWith("o3-") ||
    model.startsWith("ep-") ||
    model.startsWith("doubao-") ||
    model.startsWith("deepseek-")
  ) {
    return model;
  }

  const lower = model.toLowerCase();
  if (lower.includes("haiku")) {
    return config.small_model;
  }
  if (lower.includes("sonnet")) {
    return config.middle_model;
  }
  if (lower.includes("opus")) {
    return config.big_model;
  }
  return config.big_model;
}

function convertSystemPrompt(system) {
  if (!system) {
    return null;
  }

  if (typeof system === "string") {
    return system.trim() || null;
  }

  if (Array.isArray(system)) {
    const blocks = system
      .filter((block) => block && block.type === CONSTANTS.CONTENT_TEXT)
      .map((block) => block.text || "")
      .filter(Boolean);
    return blocks.join("\n\n").trim() || null;
  }

  return null;
}

function convertClaudeUserMessage(message) {
  if (typeof message.content === "string") {
    return { role: CONSTANTS.ROLE_USER, content: message.content };
  }

  const content = [];
  for (const block of message.content || []) {
    if (!block || !block.type) {
      continue;
    }
    if (block.type === CONSTANTS.CONTENT_TEXT) {
      content.push({ type: "text", text: block.text || "" });
    }
    if (
      block.type === CONSTANTS.CONTENT_IMAGE &&
      block.source &&
      block.source.type === "base64" &&
      block.source.media_type &&
      block.source.data
    ) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`
        }
      });
    }
  }

  if (content.length === 1 && content[0].type === "text") {
    return { role: CONSTANTS.ROLE_USER, content: content[0].text };
  }

  return { role: CONSTANTS.ROLE_USER, content };
}

function convertClaudeAssistantMessage(message) {
  if (typeof message.content === "string") {
    return { role: CONSTANTS.ROLE_ASSISTANT, content: message.content };
  }

  const textParts = [];
  const toolCalls = [];

  for (const block of message.content || []) {
    if (!block || !block.type) {
      continue;
    }
    if (block.type === CONSTANTS.CONTENT_TEXT) {
      textParts.push(block.text || "");
    }
    if (block.type === CONSTANTS.CONTENT_TOOL_USE) {
      toolCalls.push({
        id: block.id || randomMessageId("tool"),
        type: CONSTANTS.TOOL_FUNCTION,
        function: {
          name: block.name || "",
          arguments: JSON.stringify(block.input || {})
        }
      });
    }
  }

  const payload = {
    role: CONSTANTS.ROLE_ASSISTANT,
    content: textParts.length > 0 ? textParts.join("") : null
  };

  if (toolCalls.length > 0) {
    payload.tool_calls = toolCalls;
  }

  return payload;
}

function normalizeToolResultContent(content) {
  if (content == null) {
    return "No content provided";
  }
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && item.type === CONSTANTS.CONTENT_TEXT) {
          return item.text || "";
        }
        return JSON.stringify(item);
      })
      .join("\n")
      .trim();
  }
  return JSON.stringify(content);
}

function convertClaudeToolResults(message) {
  const toolMessages = [];
  for (const block of message.content || []) {
    if (!block || block.type !== CONSTANTS.CONTENT_TOOL_RESULT) {
      continue;
    }
    toolMessages.push({
      role: CONSTANTS.ROLE_TOOL,
      tool_call_id: block.tool_use_id,
      content: normalizeToolResultContent(block.content)
    });
  }
  return toolMessages;
}

function convertClaudeToOpenAI(claudeRequest, config) {
  const messages = [];
  const systemPrompt = convertSystemPrompt(claudeRequest.system);
  if (systemPrompt) {
    messages.push({ role: CONSTANTS.ROLE_SYSTEM, content: systemPrompt });
  }

  for (let index = 0; index < (claudeRequest.messages || []).length; index += 1) {
    const message = claudeRequest.messages[index];
    if (!message) {
      continue;
    }

    if (message.role === CONSTANTS.ROLE_USER) {
      messages.push(convertClaudeUserMessage(message));
      continue;
    }

    if (message.role === CONSTANTS.ROLE_ASSISTANT) {
      messages.push(convertClaudeAssistantMessage(message));

      const nextMessage = claudeRequest.messages[index + 1];
      const hasToolResult =
        nextMessage &&
        nextMessage.role === CONSTANTS.ROLE_USER &&
        Array.isArray(nextMessage.content) &&
        nextMessage.content.some((block) => block && block.type === CONSTANTS.CONTENT_TOOL_RESULT);

      if (hasToolResult) {
        index += 1;
        messages.push(...convertClaudeToolResults(nextMessage));
      }
    }
  }

  const payload = {
    model: mapClaudeModelToOpenAI(claudeRequest.model, config),
    messages,
    max_tokens: Math.max(1, Math.min(Number(claudeRequest.max_tokens || 4096), 128000)),
    temperature: claudeRequest.temperature,
    stream: Boolean(claudeRequest.stream)
  };

  if (Array.isArray(claudeRequest.stop_sequences) && claudeRequest.stop_sequences.length > 0) {
    payload.stop = claudeRequest.stop_sequences;
  }

  if (typeof claudeRequest.top_p === "number") {
    payload.top_p = claudeRequest.top_p;
  }

  if (Array.isArray(claudeRequest.tools) && claudeRequest.tools.length > 0) {
    payload.tools = claudeRequest.tools
      .filter((tool) => tool && tool.name)
      .map((tool) => ({
        type: CONSTANTS.TOOL_FUNCTION,
        function: {
          name: tool.name,
          description: tool.description || "",
          parameters: tool.input_schema || { type: "object", properties: {} }
        }
      }));
  }

  if (claudeRequest.tool_choice && typeof claudeRequest.tool_choice === "object") {
    const type = claudeRequest.tool_choice.type;
    if (type === "tool" && claudeRequest.tool_choice.name) {
      payload.tool_choice = {
        type: CONSTANTS.TOOL_FUNCTION,
        function: { name: claudeRequest.tool_choice.name }
      };
    } else {
      payload.tool_choice = "auto";
    }
  }

  return payload;
}

function convertOpenAIToClaudeResponse(openaiResponse, originalRequest) {
  const choice = (openaiResponse.choices || [])[0];
  if (!choice) {
    throw new Error("No choices returned by upstream API.");
  }

  const message = choice.message || {};
  const content = [];

  if (message.content != null) {
    content.push({ type: CONSTANTS.CONTENT_TEXT, text: message.content });
  }

  for (const toolCall of message.tool_calls || []) {
    if (toolCall.type !== CONSTANTS.TOOL_FUNCTION) {
      continue;
    }
    let parsedArguments;
    try {
      parsedArguments = JSON.parse(toolCall.function?.arguments || "{}");
    } catch {
      parsedArguments = { raw_arguments: toolCall.function?.arguments || "" };
    }

    content.push({
      type: CONSTANTS.CONTENT_TOOL_USE,
      id: toolCall.id || randomMessageId("tool"),
      name: toolCall.function?.name || "",
      input: parsedArguments
    });
  }

  if (content.length === 0) {
    content.push({ type: CONSTANTS.CONTENT_TEXT, text: "" });
  }

  const finishReason = choice.finish_reason || "stop";
  const stopReasonMap = {
    stop: CONSTANTS.STOP_END_TURN,
    length: CONSTANTS.STOP_MAX_TOKENS,
    tool_calls: CONSTANTS.STOP_TOOL_USE,
    function_call: CONSTANTS.STOP_TOOL_USE
  };

  return {
    id: openaiResponse.id || randomMessageId(),
    type: "message",
    role: CONSTANTS.ROLE_ASSISTANT,
    model: originalRequest.model,
    content,
    stop_reason: stopReasonMap[finishReason] || CONSTANTS.STOP_END_TURN,
    stop_sequence: null,
    usage: {
      input_tokens: openaiResponse.usage?.prompt_tokens || 0,
      output_tokens: openaiResponse.usage?.completion_tokens || 0
    }
  };
}

function writeSseEvent(response, event, data) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function streamOpenAiToClaude(upstreamResponse, response, originalRequest, requestAbortController) {
  const messageId = randomMessageId();
  const toolCalls = new Map();
  let toolBlockCounter = 0;
  let finalStopReason = CONSTANTS.STOP_END_TURN;
  let usage = { input_tokens: 0, output_tokens: 0 };

  writeSseEvent(response, CONSTANTS.EVENT_MESSAGE_START, {
    type: CONSTANTS.EVENT_MESSAGE_START,
    message: {
      id: messageId,
      type: "message",
      role: CONSTANTS.ROLE_ASSISTANT,
      model: originalRequest.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage
    }
  });

  writeSseEvent(response, CONSTANTS.EVENT_CONTENT_BLOCK_START, {
    type: CONSTANTS.EVENT_CONTENT_BLOCK_START,
    index: 0,
    content_block: {
      type: CONSTANTS.CONTENT_TEXT,
      text: ""
    }
  });

  writeSseEvent(response, CONSTANTS.EVENT_PING, {
    type: CONSTANTS.EVENT_PING
  });

  const decoder = new TextDecoder();
  const reader = upstreamResponse.body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) {
          continue;
        }

        const chunkData = line.slice(6);
        if (chunkData === "[DONE]") {
          break;
        }

        let chunk;
        try {
          chunk = JSON.parse(chunkData);
        } catch {
          continue;
        }

        if (chunk.usage) {
          usage = {
            input_tokens: chunk.usage.prompt_tokens || usage.input_tokens || 0,
            output_tokens: chunk.usage.completion_tokens || usage.output_tokens || 0
          };
        }

        const choice = (chunk.choices || [])[0];
        if (!choice) {
          continue;
        }

        const delta = choice.delta || {};

        if (typeof delta.content === "string" && delta.content.length > 0) {
          writeSseEvent(response, CONSTANTS.EVENT_CONTENT_BLOCK_DELTA, {
            type: CONSTANTS.EVENT_CONTENT_BLOCK_DELTA,
            index: 0,
            delta: {
              type: CONSTANTS.DELTA_TEXT,
              text: delta.content
            }
          });
        }

        for (const toolDelta of delta.tool_calls || []) {
          const index = toolDelta.index || 0;
          if (!toolCalls.has(index)) {
            toolCalls.set(index, {
              id: null,
              name: null,
              started: false,
              claudeIndex: null
            });
          }

          const tool = toolCalls.get(index);
          if (toolDelta.id) {
            tool.id = toolDelta.id;
          }
          if (toolDelta.function?.name) {
            tool.name = toolDelta.function.name;
          }

          if (!tool.started && tool.id && tool.name) {
            toolBlockCounter += 1;
            tool.started = true;
            tool.claudeIndex = toolBlockCounter;
            writeSseEvent(response, CONSTANTS.EVENT_CONTENT_BLOCK_START, {
              type: CONSTANTS.EVENT_CONTENT_BLOCK_START,
              index: tool.claudeIndex,
              content_block: {
                type: CONSTANTS.CONTENT_TOOL_USE,
                id: tool.id,
                name: tool.name,
                input: {}
              }
            });
          }

          if (tool.started && typeof toolDelta.function?.arguments === "string" && toolDelta.function.arguments) {
            writeSseEvent(response, CONSTANTS.EVENT_CONTENT_BLOCK_DELTA, {
              type: CONSTANTS.EVENT_CONTENT_BLOCK_DELTA,
              index: tool.claudeIndex,
              delta: {
                type: CONSTANTS.DELTA_INPUT_JSON,
                partial_json: toolDelta.function.arguments
              }
            });
          }
        }

        if (choice.finish_reason) {
          if (choice.finish_reason === "length") {
            finalStopReason = CONSTANTS.STOP_MAX_TOKENS;
          } else if (["tool_calls", "function_call"].includes(choice.finish_reason)) {
            finalStopReason = CONSTANTS.STOP_TOOL_USE;
          } else {
            finalStopReason = CONSTANTS.STOP_END_TURN;
          }
        }
      }
    }
  } catch (error) {
    requestAbortController.abort();
    writeSseEvent(response, "error", {
      type: "error",
      error: {
        type: "api_error",
        message: error.message
      }
    });
    return;
  }

  writeSseEvent(response, CONSTANTS.EVENT_CONTENT_BLOCK_STOP, {
    type: CONSTANTS.EVENT_CONTENT_BLOCK_STOP,
    index: 0
  });

  for (const tool of toolCalls.values()) {
    if (tool.started) {
      writeSseEvent(response, CONSTANTS.EVENT_CONTENT_BLOCK_STOP, {
        type: CONSTANTS.EVENT_CONTENT_BLOCK_STOP,
        index: tool.claudeIndex
      });
    }
  }

  writeSseEvent(response, CONSTANTS.EVENT_MESSAGE_DELTA, {
    type: CONSTANTS.EVENT_MESSAGE_DELTA,
    delta: {
      stop_reason: finalStopReason,
      stop_sequence: null
    },
    usage
  });

  writeSseEvent(response, CONSTANTS.EVENT_MESSAGE_STOP, {
    type: CONSTANTS.EVENT_MESSAGE_STOP
  });
}

module.exports = {
  CONSTANTS,
  convertClaudeToOpenAI,
  convertOpenAIToClaudeResponse,
  mapClaudeModelToOpenAI,
  streamOpenAiToClaude
};
