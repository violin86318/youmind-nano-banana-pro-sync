import { resolveSyncTarget } from "./lib/config.mjs";
import { runLarkCliJson, runLarkCliJsonAsync } from "./lib/lark-cli.mjs";
import { loadOrFetchPromptPayload } from "./lib/prompt-source.mjs";
import { normalizePromptToRow } from "./lib/prompt-utils.mjs";
import { LOOKUP_FIELDS } from "./lib/schema.mjs";
import { ensureFeishuFieldsWithLark } from "./ensure-feishu-fields-lark.mjs";

function resolveLookupIndexes(fields) {
  const indexes = new Map(fields.map((field, index) => [String(field), index]));
  const promptIdIndex = indexes.get(LOOKUP_FIELDS[0]);
  const contentHashIndex = indexes.get(LOOKUP_FIELDS[1]);
  const activeIndex = indexes.get(LOOKUP_FIELDS[2]);

  if (
    !Number.isInteger(promptIdIndex) ||
    !Number.isInteger(contentHashIndex) ||
    !Number.isInteger(activeIndex)
  ) {
    throw new Error(
      `Required lookup fields are missing from lark-cli response. fields=${JSON.stringify(fields)}`
    );
  }

  return {
    promptIdIndex,
    contentHashIndex,
    activeIndex
  };
}

function listAllExistingRecords(baseToken, tableId) {
  const records = new Map();
  let offset = 0;

  while (true) {
    const response = runLarkCliJson([
      "base",
      "+record-list",
      "--base-token",
      baseToken,
      "--table-id",
      tableId,
      "--limit",
      "100",
      "--offset",
      String(offset)
    ]);

    const data = response.data;
    const { promptIdIndex, contentHashIndex, activeIndex } = resolveLookupIndexes(data.fields || []);

    for (let index = 0; index < data.record_id_list.length; index += 1) {
      const row = data.data[index] || [];
      const promptId = row[promptIdIndex] ? String(row[promptIdIndex]) : "";

      if (!promptId) {
        continue;
      }

      records.set(promptId, {
        recordId: data.record_id_list[index],
        contentHash: row[contentHashIndex] ? String(row[contentHashIndex]) : "",
        active: Boolean(row[activeIndex])
      });
    }

    if (!data.has_more) {
      break;
    }

    offset += 100;
  }

  return records;
}

function batchCreateWithLark(baseToken, tableId, rows) {
  return runWithConcurrency(rows, "created", (row) =>
    runLarkCliJsonAsync([
      "base",
      "+record-upsert",
      "--base-token",
      baseToken,
      "--table-id",
      tableId,
      "--json",
      JSON.stringify(row)
    ])
  );
}

function batchUpdateWithLark(baseToken, tableId, updates) {
  return runWithConcurrency(updates, "updated", (entry) =>
    runLarkCliJsonAsync([
      "base",
      "+record-upsert",
      "--base-token",
      baseToken,
      "--table-id",
      tableId,
      "--record-id",
      entry.recordId,
      "--json",
      JSON.stringify(entry.fields)
    ])
  );
}

async function runWithConcurrency(items, progressVerb, worker) {
  const concurrency = Math.max(1, Number(process.env.LARK_SYNC_CONCURRENCY || 4));
  let cursor = 0;
  let completed = 0;

  async function runNext() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
      completed += 1;

      if (completed === items.length || completed % 50 === 0) {
        console.log(`  ${progressVerb} ${completed}/${items.length}`);
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runNext()
  );

  await Promise.all(workers);
}

async function main() {
  const target = resolveSyncTarget();
  const syncedAt = new Date().toISOString();

  ensureFeishuFieldsWithLark({
    baseToken: target.baseToken,
    tableId: target.tableId
  });

  const { payload, source } = await loadOrFetchPromptPayload({
    locale: target.locale,
    model: target.model,
    forceRefresh: process.env.YOUMIND_FORCE_REFRESH === "1",
    onProgress({ page, totalPages, fetched, total }) {
      console.log(`  page ${page}/${totalPages} fetched=${fetched}/${total}`);
    }
  });

  console.log(
    source === "cache"
      ? `Using cached prompts snapshot (${payload.prompts.length} rows)`
      : source === "stale-cache"
        ? `Using stale cached prompts snapshot after fetch failure (${payload.prompts.length} rows)`
      : `Fetched fresh prompts snapshot (${payload.prompts.length} rows)`
  );

  console.log("Loading existing Feishu records ...");
  const existing = listAllExistingRecords(target.baseToken, target.tableId);

  const desiredRows = payload.prompts.map((prompt) =>
    normalizePromptToRow(prompt, {
      locale: target.locale,
      model: target.model,
      syncedAt,
      active: true
    })
  );

  const desiredIds = new Set(desiredRows.map((row) => row["Prompt ID"]));
  const creates = [];
  const updates = [];
  const deactivations = [];

  for (const row of desiredRows) {
    const promptId = row["Prompt ID"];
    const current = existing.get(promptId);

    if (!current) {
      creates.push(row);
      continue;
    }

    if (current.contentHash !== row["Content Hash"] || current.active !== true) {
      updates.push({
        recordId: current.recordId,
        fields: row
      });
    }
  }

  for (const [promptId, current] of existing.entries()) {
    if (!desiredIds.has(promptId) && current.active) {
      deactivations.push({
        recordId: current.recordId,
        fields: {
          Active: false
        }
      });
    }
  }

  console.log(
    `Sync plan: create=${creates.length} update=${updates.length} deactivate=${deactivations.length}`
  );

  if (creates.length > 0) {
    console.log("Creating new records ...");
    await batchCreateWithLark(target.baseToken, target.tableId, creates);
  }

  if (updates.length > 0) {
    console.log("Updating changed records ...");
    await batchUpdateWithLark(target.baseToken, target.tableId, updates);
  }

  if (deactivations.length > 0) {
    console.log("Marking stale records inactive ...");
    await batchUpdateWithLark(target.baseToken, target.tableId, deactivations);
  }

  console.log(
    `Finished. total=${payload.prompts.length} created=${creates.length} updated=${updates.length} inactive=${deactivations.length}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
