import path from "path";
import { DATA_DIR, ROOT, readJsonIfExists, resolveSyncTarget } from "./config.mjs";
import { FIELD_ORDER } from "./schema.mjs";
import { runLarkCliJson } from "./lark-cli.mjs";
import { loadOrFetchPromptPayload } from "./prompt-source.mjs";
import {
  normalizePromptToRow,
  promptToSitePrompt,
  rowObjectToSitePrompt,
  rowValuesToObject
} from "./prompt-utils.mjs";

function getSnapshotPath(locale) {
  return path.join(DATA_DIR, `prompts.${locale}.json`);
}

function getPromptAnalysisPath() {
  return path.join(ROOT, "analysis", "prompt-analysis.json");
}

function loadPromptAnalysisById() {
  const payload = readJsonIfExists(getPromptAnalysisPath());

  if (!payload || !Array.isArray(payload.prompts)) {
    return new Map();
  }

  return new Map(payload.prompts.map((entry) => [String(entry.id), entry]));
}

function isSnapshotPayload(payload, { locale, model }) {
  return (
    payload &&
    payload.locale === locale &&
    payload.model === model &&
    Array.isArray(payload.prompts)
  );
}

function sanitizeSitePrompt(prompt) {
  return {
    id: prompt.id,
    title: prompt.title || "",
    description: prompt.description || "",
    prompt: prompt.prompt || "",
    translatedPrompt: prompt.translatedPrompt || "",
    language: prompt.language || "",
    featured: Boolean(prompt.featured),
    sourceLink: prompt.sourceLink || "",
    sourcePublishedAt: prompt.sourcePublishedAt || "",
    authorName: prompt.authorName || "",
    authorLink: prompt.authorLink || "",
    detailUrl: prompt.detailUrl || "",
    media: Array.isArray(prompt.media) ? prompt.media : [],
    mediaThumbnails: Array.isArray(prompt.mediaThumbnails) ? prompt.mediaThumbnails : [],
    thumbnailUrl: prompt.thumbnailUrl || "",
    referenceImages: Array.isArray(prompt.referenceImages) ? prompt.referenceImages : [],
    categories: Array.isArray(prompt.categories) ? prompt.categories : [],
    sourcePlatform: prompt.sourcePlatform || "",
    likes: Number.isFinite(Number(prompt.likes)) ? Number(prompt.likes) : 0,
    resultsCount: Number.isFinite(Number(prompt.resultsCount)) ? Number(prompt.resultsCount) : 0,
    needReferenceImages: Boolean(prompt.needReferenceImages),
    analysis: prompt.analysis && typeof prompt.analysis === "object" ? prompt.analysis : null
  };
}

function getLatestIso(values) {
  const timestamps = values
    .map((value) => Date.parse(value || ""))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left);

  if (timestamps.length === 0) {
    return new Date().toISOString();
  }

  return new Date(timestamps[0]).toISOString();
}

function buildSitePayload({
  prompts,
  locale,
  model,
  generatedAt,
  dataSource,
  dataSourceLabel,
  sourceTotal = 0,
  sourceTotalPages = 0,
  fallbackReason = "",
  validation = null
}) {
  const analysisById = loadPromptAnalysisById();
  const promptsWithAnalysis = prompts.map((prompt) => ({
    ...prompt,
    analysis: analysisById.get(String(prompt.id)) || prompt.analysis || null
  }));

  return {
    generatedAt,
    locale,
    model,
    total: sourceTotal || promptsWithAnalysis.length,
    sampleCount: promptsWithAnalysis.length,
    totalPages: sourceTotalPages,
    dataSource,
    dataSourceLabel,
    fallbackReason,
    validation,
    analysis: {
      available: analysisById.size > 0,
      analyzedCount: analysisById.size,
      selectedCount: [...analysisById.values()].filter((entry) => entry.selected).length
    },
    prompts: promptsWithAnalysis.map(sanitizeSitePrompt)
  };
}

async function loadSnapshotPayload(target) {
  const snapshotPath = getSnapshotPath(target.locale);
  const localSnapshot = readJsonIfExists(snapshotPath);

  if (isSnapshotPayload(localSnapshot, target)) {
    return {
      payload: localSnapshot,
      snapshotPath,
      source: "local-file"
    };
  }

  const loaded = await loadOrFetchPromptPayload({
    locale: target.locale,
    model: target.model,
    forceRefresh: process.env.YOUMIND_FORCE_REFRESH === "1",
    preferCache: true,
    allowStaleFallbackOnError: true
  });

  return {
    payload: loaded.payload,
    snapshotPath: loaded.cachePath,
    source: loaded.source
  };
}

function listAllRowsWithLark(baseToken, tableId) {
  const rows = [];
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
    const fieldOrder = Array.isArray(data.fields) && data.fields.length > 0 ? data.fields : FIELD_ORDER;

    for (const values of data.data || []) {
      rows.push(rowValuesToObject(values, fieldOrder));
    }

    if (!data.has_more) {
      break;
    }

    offset += Array.isArray(data.data) && data.data.length > 0 ? data.data.length : 100;
  }

  return rows;
}

function validateFeishuPromptsAgainstSnapshot(feishuPrompts, snapshotPayload, target) {
  if (!snapshotPayload) {
    return {
      checked: false,
      ok: true,
      expectedCount: 0,
      actualCount: feishuPrompts.length,
      duplicateIds: [],
      missingIds: [],
      changedIds: [],
      extraIds: []
    };
  }

  const expected = new Map(
    snapshotPayload.prompts.map((prompt) => {
      const row = normalizePromptToRow(prompt, {
        locale: target.locale,
        model: target.model,
        syncedAt: snapshotPayload.fetchedAt,
        active: true
      });

      return [row["Prompt ID"], row["Content Hash"]];
    })
  );

  const actual = new Map();
  const duplicateIds = [];

  for (const prompt of feishuPrompts) {
    const promptId = String(prompt.id);

    if (actual.has(promptId)) {
      duplicateIds.push(promptId);
    }

    actual.set(promptId, prompt.contentHash || "");
  }

  const missingIds = [];
  const changedIds = [];
  const extraIds = [];

  for (const [promptId, expectedHash] of expected.entries()) {
    if (!actual.has(promptId)) {
      missingIds.push(promptId);
      continue;
    }

    if (actual.get(promptId) !== expectedHash) {
      changedIds.push(promptId);
    }
  }

  for (const promptId of actual.keys()) {
    if (!expected.has(promptId)) {
      extraIds.push(promptId);
    }
  }

  return {
    checked: true,
    ok:
      duplicateIds.length === 0 &&
      missingIds.length === 0 &&
      changedIds.length === 0 &&
      extraIds.length === 0,
    expectedCount: expected.size,
    actualCount: actual.size,
    duplicateIds: duplicateIds.slice(0, 5),
    missingIds: missingIds.slice(0, 5),
    changedIds: changedIds.slice(0, 5),
    extraIds: extraIds.slice(0, 5)
  };
}

function formatValidationIssue(validation) {
  return [
    `expected=${validation.expectedCount}`,
    `actual=${validation.actualCount}`,
    validation.duplicateIds.length > 0 ? `duplicates=${validation.duplicateIds.join(",")}` : "",
    validation.missingIds.length > 0 ? `missing=${validation.missingIds.join(",")}` : "",
    validation.changedIds.length > 0 ? `changed=${validation.changedIds.join(",")}` : "",
    validation.extraIds.length > 0 ? `extra=${validation.extraIds.join(",")}` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function summarizeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "unknown error");
  return message.replace(/\s+/g, " ").trim().slice(0, 320);
}

function buildPayloadFromSnapshot(snapshotPayload, target, fallbackReason = "") {
  const prompts = snapshotPayload.prompts.map((prompt) =>
    promptToSitePrompt(prompt, { locale: target.locale })
  );

  return buildSitePayload({
    prompts,
    locale: target.locale,
    model: target.model,
    generatedAt: snapshotPayload.fetchedAt || new Date().toISOString(),
    dataSource: fallbackReason ? "youmind-fallback" : "youmind",
    dataSourceLabel: fallbackReason ? "YouMind Fallback" : "YouMind Snapshot",
    sourceTotal: snapshotPayload.total || snapshotPayload.prompts.length,
    sourceTotalPages: snapshotPayload.totalPages || 0,
    fallbackReason
  });
}

export async function loadSitePayloadForBuild() {
  const target = resolveSyncTarget({ requireBase: false });
  const siteSourceMode = process.env.SITE_SOURCE_MODE || "auto";
  const snapshotResult = await loadSnapshotPayload(target);
  const snapshotPayload = snapshotResult.payload;
  const shouldTryFeishu =
    siteSourceMode !== "public-only" && Boolean(target.baseToken) && Boolean(target.tableId);

  if (shouldTryFeishu) {
    try {
      const rows = listAllRowsWithLark(target.baseToken, target.tableId);
      const prompts = rows
        .map((row) => rowObjectToSitePrompt(row))
        .filter((prompt) => prompt.active !== false)
        .filter((prompt) => !prompt.model || prompt.model === target.model);
      const validation = validateFeishuPromptsAgainstSnapshot(prompts, snapshotPayload, target);

      if (!validation.ok) {
        throw new Error(`Feishu validation failed: ${formatValidationIssue(validation)}`);
      }

      return {
        source: "feishu",
        payload: buildSitePayload({
          prompts,
          locale: target.locale,
          model: target.model,
          generatedAt: getLatestIso([
            ...prompts.map((prompt) => prompt.syncedAt),
            snapshotPayload?.fetchedAt
          ]),
          dataSource: "feishu",
          dataSourceLabel: "Feishu Base",
          sourceTotal: snapshotPayload?.total || prompts.length,
          sourceTotalPages: snapshotPayload?.totalPages || 0,
          validation
        })
      };
    } catch (error) {
      if (siteSourceMode === "feishu-only") {
        throw error;
      }

      const fallbackReason = summarizeErrorMessage(error);

      return {
        source: "youmind-fallback",
        payload: buildPayloadFromSnapshot(snapshotPayload, target, fallbackReason)
      };
    }
  }

  return {
    source: "youmind",
    payload: buildPayloadFromSnapshot(snapshotPayload, target)
  };
}
