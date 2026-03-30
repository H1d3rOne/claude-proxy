const test = require("node:test");
const assert = require("node:assert/strict");

const {
  convertClaudeToOpenAI,
  convertOpenAIToClaudeResponse
} = require("../src/proxy/converters");

const config = {
  big_model: "gpt-5.4",
  middle_model: "gpt-5.3-codex",
  small_model: "gpt-5.2-codex"
};

test("convertClaudeToOpenAI preserves multimodal input, tools, and tool results", () => {
  const payload = convertClaudeToOpenAI(
    {
      model: "claude-3-5-sonnet",
      system: [{ type: "text", text: "Follow system instructions." }],
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this image." },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "YWJj"
              }
            }
          ]
        },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Calling weather tool." },
            {
              type: "tool_use",
              id: "tool_1",
              name: "lookup_weather",
              input: { city: "Paris" }
            }
          ]
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: [{ type: "text", text: "18C and sunny" }]
            }
          ]
        }
      ],
      max_tokens: 1234,
      temperature: 0.2,
      top_p: 0.9,
      stop_sequences: ["STOP"],
      stream: true,
      tools: [
        {
          name: "lookup_weather",
          description: "Look up weather by city",
          input_schema: {
            type: "object",
            properties: {
              city: { type: "string" }
            }
          }
        }
      ],
      tool_choice: {
        type: "tool",
        name: "lookup_weather"
      }
    },
    config
  );

  assert.equal(payload.model, "gpt-5.3-codex");
  assert.equal(payload.stream, true);
  assert.equal(payload.max_tokens, 1234);
  assert.equal(payload.top_p, 0.9);
  assert.deepEqual(payload.stop, ["STOP"]);
  assert.equal(payload.messages[0].role, "system");
  assert.equal(payload.messages[0].content, "Follow system instructions.");
  assert.deepEqual(payload.messages[1], {
    role: "user",
    content: [
      { type: "text", text: "Describe this image." },
      {
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,YWJj"
        }
      }
    ]
  });
  assert.equal(payload.messages[2].role, "assistant");
  assert.equal(payload.messages[2].content, "Calling weather tool.");
  assert.deepEqual(payload.messages[2].tool_calls, [
    {
      id: "tool_1",
      type: "function",
      function: {
        name: "lookup_weather",
        arguments: JSON.stringify({ city: "Paris" })
      }
    }
  ]);
  assert.deepEqual(payload.messages[3], {
    role: "tool",
    tool_call_id: "tool_1",
    content: "18C and sunny"
  });
  assert.deepEqual(payload.tools, [
    {
      type: "function",
      function: {
        name: "lookup_weather",
        description: "Look up weather by city",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string" }
          }
        }
      }
    }
  ]);
  assert.deepEqual(payload.tool_choice, {
    type: "function",
    function: { name: "lookup_weather" }
  });
});

test("convertOpenAIToClaudeResponse maps text and tool calls back to Claude format", () => {
  const response = convertOpenAIToClaudeResponse(
    {
      id: "chatcmpl_test",
      choices: [
        {
          message: {
            content: "Tool call prepared.",
            tool_calls: [
              {
                id: "tool_1",
                type: "function",
                function: {
                  name: "lookup_weather",
                  arguments: JSON.stringify({ city: "Paris" })
                }
              }
            ]
          },
          finish_reason: "tool_calls"
        }
      ],
      usage: {
        prompt_tokens: 111,
        completion_tokens: 22
      }
    },
    { model: "claude-3-5-sonnet" }
  );

  assert.equal(response.id, "chatcmpl_test");
  assert.equal(response.model, "claude-3-5-sonnet");
  assert.equal(response.stop_reason, "tool_use");
  assert.deepEqual(response.usage, {
    input_tokens: 111,
    output_tokens: 22
  });
  assert.deepEqual(response.content, [
    { type: "text", text: "Tool call prepared." },
    {
      type: "tool_use",
      id: "tool_1",
      name: "lookup_weather",
      input: { city: "Paris" }
    }
  ]);
});
