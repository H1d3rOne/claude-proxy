const test = require("node:test");
const assert = require("node:assert/strict");

const { execFileWithFallbacks } = require("../src/utils");

test("execFileWithFallbacks tries later candidates after ENOENT", async () => {
  const { stdout } = await execFileWithFallbacks(
    ["definitely-missing-command-for-claude-proxy-tests", process.execPath],
    ["-e", "process.stdout.write('ok')"]
  );

  assert.equal(stdout, "ok");
});

test("execFileWithFallbacks reports a clear ENOENT when all candidates are missing", async () => {
  await assert.rejects(
    () =>
      execFileWithFallbacks(
        [
          "definitely-missing-command-for-claude-proxy-tests-a",
          "definitely-missing-command-for-claude-proxy-tests-b"
        ],
        []
      ),
    (error) => {
      assert.equal(error.code, "ENOENT");
      assert.match(error.message, /Command not found:/);
      return true;
    }
  );
});
