import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CACHE_DIR, ROOT, ensureDirSync, resolveSyncTarget } from "./lib/config.mjs";
import { runLarkCliJson, runLarkCliJsonAsync } from "./lib/lark-cli.mjs";
import { ensureFeishuFieldsWithLark } from "./ensure-feishu-fields-lark.mjs";

const COVER_FIELD_NAME = process.env.COVER_FIELD_NAME || "Preview Cover";
const GALLERY_VIEW_NAME = process.env.GALLERY_VIEW_NAME || "Gallery";
const DEFAULT_LIMIT = 0;
const MAX_BYTES = 20 * 1024 * 1024;

function readNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function summarizeError(error) {
  return errorMessage(error).split(/\r?\n/).find(Boolean) || "unknown error";
}

function isRetryableError(error) {
  return /rate_limit|frequency limit|try again later|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|timeout|5\d{2}/i.test(
    errorMessage(error)
  );
}

async function withRetries(label, operation, options = {}) {
  const attempts = Math.max(1, options.attempts || 1);
  const baseDelayMs = options.baseDelayMs || 1000;
  const maxDelayMs = options.maxDelayMs || 60000;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isRetryableError(error)) {
        throw error;
      }

      const jitter = Math.floor(Math.random() * 500);
      const delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1)) + jitter;
      console.warn(
        `  retry ${label} attempt=${attempt + 1}/${attempts} after=${delayMs}ms reason=${summarizeError(error)}`
      );
      await sleep(delayMs);
    }
  }

  throw new Error(`Unexpected retry exit for ${label}`);
}

function getFieldIndex(fields, name) {
  const index = fields.findIndex((field) => String(field) === name);
  return index >= 0 ? index : null;
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeUrlToken).filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value.split(/\r?\n/).map(normalizeUrlToken).filter(Boolean);
}

function normalizeUrlToken(value) {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  const markdownUrl = text.match(/\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);

  if (markdownUrl) {
    return markdownUrl[1];
  }

  const rawUrl = text.match(/https?:\/\/[^\s)\]]+/i);

  if (rawUrl) {
    return rawUrl[0];
  }

  return text;
}

function hasAttachment(value) {
  if (!value) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return String(value).trim() !== "";
}

function extFromContentType(contentType) {
  if (/png/i.test(contentType)) return ".png";
  if (/webp/i.test(contentType)) return ".webp";
  if (/gif/i.test(contentType)) return ".gif";
  return ".jpg";
}

function safeFileStem(value) {
  return String(value || "cover").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80) || "cover";
}

function listAllFields(baseToken, tableId) {
  const fields = [];
  let offset = 0;

  while (true) {
    const response = runLarkCliJson([
      "base",
      "+field-list",
      "--base-token",
      baseToken,
      "--table-id",
      tableId,
      "--limit",
      "100",
      "--offset",
      String(offset)
    ]);

    const data = response.data || {};
    fields.push(...(data.items || []));

    if (!data.has_more && fields.length >= (data.total || fields.length)) {
      break;
    }

    offset += 100;
  }

  return fields;
}

function listAllViews(baseToken, tableId) {
  const response = runLarkCliJson([
    "base",
    "+view-list",
    "--base-token",
    baseToken,
    "--table-id",
    tableId
  ]);

  return response.data?.items || [];
}

function ensureGalleryViewCover({ baseToken, tableId, coverFieldId }) {
  const views = listAllViews(baseToken, tableId);
  let view = views.find((item) => item.view_name === GALLERY_VIEW_NAME);

  if (!view) {
    const created = runLarkCliJson([
      "base",
      "+view-create",
      "--base-token",
      baseToken,
      "--table-id",
      tableId,
      "--json",
      JSON.stringify({
        view_name: GALLERY_VIEW_NAME,
        view_type: "gallery"
      })
    ]);
    view = created.data?.view;
  }

  if (!view?.view_id) {
    throw new Error(`Unable to resolve Gallery view id for ${GALLERY_VIEW_NAME}`);
  }

  runLarkCliJson([
    "base",
    "+view-set-card",
    "--base-token",
    baseToken,
    "--table-id",
    tableId,
    "--view-id",
    view.view_id,
    "--json",
    JSON.stringify({
      cover_field: coverFieldId
    })
  ]);

  return view;
}

function listRecordsNeedingCover({ baseToken, tableId, limit }) {
  const records = [];
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

    const data = response.data || {};
    const fields = data.fields || [];
    const promptIdIndex = getFieldIndex(fields, "Prompt ID");
    const titleIndex = getFieldIndex(fields, "Title");
    const activeIndex = getFieldIndex(fields, "Active");
    const mediaThumbnailsIndex = getFieldIndex(fields, "Media Thumbnails");
    const mediaUrlsIndex = getFieldIndex(fields, "Media URLs");
    const coverIndex = getFieldIndex(fields, COVER_FIELD_NAME);

    if (promptIdIndex === null || coverIndex === null) {
      throw new Error(`Required fields missing in record-list response. fields=${JSON.stringify(fields)}`);
    }

    for (let index = 0; index < (data.record_id_list || []).length; index += 1) {
      const row = data.data?.[index] || [];
      const active = activeIndex === null ? true : Boolean(row[activeIndex]);

      if (!active || hasAttachment(row[coverIndex])) {
        continue;
      }

      const sourceUrl =
        splitList(mediaThumbnailsIndex === null ? "" : row[mediaThumbnailsIndex])[0] ||
        splitList(mediaUrlsIndex === null ? "" : row[mediaUrlsIndex])[0] ||
        "";

      if (!sourceUrl) {
        continue;
      }

      records.push({
        recordId: data.record_id_list[index],
        promptId: row[promptIdIndex] || "",
        title: titleIndex === null ? "" : row[titleIndex] || "",
        sourceUrl
      });

      if (limit > 0 && records.length >= limit) {
        return records;
      }
    }

    if (!data.has_more) {
      break;
    }

    offset += (data.data || []).length || 100;
  }

  return records;
}

async function downloadCover({ promptId, sourceUrl }) {
  const response = await fetch(sourceUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/135 Safari/537.36"
    },
    signal: AbortSignal.timeout(readNumberEnv("COVER_DOWNLOAD_TIMEOUT_MS", 30000))
  });

  if (!response.ok) {
    throw new Error(`download failed ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType && !/^image\//i.test(contentType)) {
    throw new Error(`not an image: ${contentType}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length > MAX_BYTES) {
    throw new Error(`image too large: ${bytes.length} bytes`);
  }

  const coverDir = path.join(CACHE_DIR, "gallery-covers");
  ensureDirSync(coverDir);
  const filePath = path.join(coverDir, `${safeFileStem(promptId)}${extFromContentType(contentType)}`);
  fs.writeFileSync(filePath, bytes);

  return filePath;
}

async function uploadCover({ baseToken, tableId, record, filePath }) {
  const relativeFilePath = path.relative(ROOT, filePath);

  await runLarkCliJsonAsync([
    "base",
    "+record-upload-attachment",
    "--base-token",
    baseToken,
    "--table-id",
    tableId,
    "--record-id",
    record.recordId,
    "--field-id",
    COVER_FIELD_NAME,
    "--file",
    relativeFilePath,
    "--name",
    `${safeFileStem(record.promptId)}${path.extname(filePath)}`
  ]);
}

async function runWithConcurrency(records, worker) {
  const concurrency = Math.max(1, readNumberEnv("COVER_SYNC_CONCURRENCY", 2));
  let cursor = 0;
  let completed = 0;
  let uploaded = 0;
  let failed = 0;

  async function runNext() {
    while (cursor < records.length) {
      const index = cursor;
      cursor += 1;
      const record = records[index];

      try {
        await worker(record, index);
        uploaded += 1;
      } catch (error) {
        failed += 1;
        console.warn(
          `  failed prompt=${record.promptId || record.recordId}: ${error instanceof Error ? error.message : String(error)}`
        );
      } finally {
        completed += 1;
        if (completed === records.length || completed % 10 === 0) {
          console.log(`  covers processed=${completed}/${records.length} uploaded=${uploaded} failed=${failed}`);
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, records.length) }, () => runNext());
  await Promise.all(workers);

  return { uploaded, failed };
}

async function main() {
  const target = resolveSyncTarget();
  const limit = readNumberEnv("COVER_LIMIT", DEFAULT_LIMIT);

  ensureFeishuFieldsWithLark({
    baseToken: target.baseToken,
    tableId: target.tableId
  });

  const coverField = listAllFields(target.baseToken, target.tableId).find(
    (field) => field.field_name === COVER_FIELD_NAME
  );

  if (!coverField?.field_id) {
    throw new Error(`Unable to resolve ${COVER_FIELD_NAME} field id.`);
  }

  const view = ensureGalleryViewCover({
    baseToken: target.baseToken,
    tableId: target.tableId,
    coverFieldId: coverField.field_id
  });
  console.log(`Gallery view configured. view=${view.view_name} cover=${COVER_FIELD_NAME} (${coverField.field_id})`);

  const records = listRecordsNeedingCover({
    baseToken: target.baseToken,
    tableId: target.tableId,
    limit
  });

  console.log(
    `Found ${records.length} records needing covers${limit > 0 ? ` (limited by COVER_LIMIT=${limit})` : ""}.`
  );

  if (records.length === 0) {
    return;
  }

  const result = await runWithConcurrency(records, async (record) => {
    const filePath = await withRetries(`download prompt=${record.promptId || record.recordId}`, () => downloadCover(record), {
      attempts: Math.max(1, readNumberEnv("COVER_DOWNLOAD_RETRIES", 3)),
      baseDelayMs: readNumberEnv("COVER_DOWNLOAD_RETRY_DELAY_MS", 1000),
      maxDelayMs: readNumberEnv("COVER_DOWNLOAD_RETRY_MAX_DELAY_MS", 15000)
    });

    await withRetries(
      `upload prompt=${record.promptId || record.recordId}`,
      () =>
        uploadCover({
          baseToken: target.baseToken,
          tableId: target.tableId,
          record,
          filePath
        }),
      {
        attempts: Math.max(1, readNumberEnv("COVER_UPLOAD_RETRIES", 6)),
        baseDelayMs: readNumberEnv("COVER_UPLOAD_RETRY_DELAY_MS", 4000),
        maxDelayMs: readNumberEnv("COVER_UPLOAD_RETRY_MAX_DELAY_MS", 60000)
      }
    );
  });

  console.log(`Finished gallery cover sync. uploaded=${result.uploaded} failed=${result.failed}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
