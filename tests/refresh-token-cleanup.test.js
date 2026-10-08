import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../config/db.js";

const previousBatchSize = process.env.REFRESH_TOKEN_CLEANUP_BATCH_SIZE;
process.env.REFRESH_TOKEN_CLEANUP_BATCH_SIZE = "2";
const { refreshTokensCleanUp } = await import("../config/refreshTokensCleanUp.js");
if (previousBatchSize === undefined) delete process.env.REFRESH_TOKEN_CLEANUP_BATCH_SIZE;
else process.env.REFRESH_TOKEN_CLEANUP_BATCH_SIZE = previousBatchSize;

test("refresh-token cleanup deletes stale rows by jti in numeric batches", async () => {
  const originalGetConnection = db.getConnection;
  const deletedBatches = [];
  let released = 0;
  db.getConnection = async () => ({
    release() { released += 1; },
    async execute(sql) {
      assert.match(sql, /SELECT jti FROM refresh_tokens/);
      assert.doesNotMatch(sql, /SELECT id FROM refresh_tokens/);
      return [[{ jti: "token-1" }, { jti: "token-2" }, { jti: "token-3" }]];
    },
    async query(sql, params) {
      assert.match(sql, /DELETE FROM refresh_tokens WHERE jti IN \(\?\)/);
      deletedBatches.push(params[0]);
      return [{ affectedRows: params[0].length }];
    },
  });

  try {
    await refreshTokensCleanUp();
    assert.deepEqual(deletedBatches, [["token-1", "token-2"], ["token-3"]]);
    assert.equal(released, 3);
  } finally {
    db.getConnection = originalGetConnection;
  }
});
