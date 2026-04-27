import path from "path";
import fs from "fs";
import { ROOT, SITE_DIR, ensureDirSync, writeJsonSync } from "./lib/config.mjs";
import { loadSitePayloadForBuild } from "./lib/site-source.mjs";

const DETAIL_CHUNK_SIZE = 100;

function writeSiteJsonSync(filePath, value) {
  ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

function copyAnalysisReports() {
  const sourceDir = path.join(ROOT, "analysis", "reports");
  const targetDir = path.join(SITE_DIR, "reports");

  if (!fs.existsSync(sourceDir)) {
    return;
  }

  ensureDirSync(targetDir);

  for (const fileName of fs.readdirSync(sourceDir)) {
    if (!fileName.endsWith(".md")) {
      continue;
    }

    fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
  }
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function compactImages(prompt) {
  const thumbnails = Array.isArray(prompt.mediaThumbnails) ? prompt.mediaThumbnails : [];
  const media = Array.isArray(prompt.media) ? prompt.media : [];
  const images = thumbnails.length ? thumbnails : media;

  return images.filter(Boolean).slice(0, 1);
}

function buildIndexPrompt(prompt, detailChunk) {
  const promptPreview = truncateText(prompt.translatedPrompt || prompt.prompt, 160);
  const description = truncateText(prompt.description, 220);
  const mediaPreview = compactImages(prompt);

  return {
    id: prompt.id,
    title: prompt.title || "",
    description,
    promptPreview,
    promptLength: Math.max(
      String(prompt.prompt || "").length,
      String(prompt.translatedPrompt || "").length
    ),
    language: prompt.language || "",
    featured: Boolean(prompt.featured),
    sourcePublishedAt: prompt.sourcePublishedAt || "",
    authorName: prompt.authorName || "",
    thumbnailUrl: prompt.thumbnailUrl || mediaPreview[0] || "",
    mediaCount: Math.max(
      Array.isArray(prompt.media) ? prompt.media.length : 0,
      Array.isArray(prompt.mediaThumbnails) ? prompt.mediaThumbnails.length : 0
    ),
    referenceImageCount: Array.isArray(prompt.referenceImages) ? prompt.referenceImages.length : 0,
    categories: Array.isArray(prompt.categories) ? prompt.categories : [],
    sourcePlatform: prompt.sourcePlatform || "",
    needReferenceImages: Boolean(prompt.needReferenceImages),
    detailChunk
  };
}

function writeSplitSiteData(payload) {
  const detailDir = path.join(SITE_DIR, "data", "prompts");
  ensureDirSync(detailDir);

  for (const fileName of fs.readdirSync(detailDir)) {
    if (fileName.endsWith(".json")) {
      fs.rmSync(path.join(detailDir, fileName));
    }
  }

  const indexPrompts = [];
  const prompts = Array.isArray(payload.prompts) ? payload.prompts : [];

  for (let index = 0; index < prompts.length; index += DETAIL_CHUNK_SIZE) {
    const chunkPrompts = prompts.slice(index, index + DETAIL_CHUNK_SIZE);
    const chunkName = `chunk-${String(index / DETAIL_CHUNK_SIZE).padStart(4, "0")}.json`;

    writeSiteJsonSync(path.join(detailDir, chunkName), {
      generatedAt: payload.generatedAt,
      chunk: chunkName,
      prompts: chunkPrompts
    });

    for (const prompt of chunkPrompts) {
      indexPrompts.push(buildIndexPrompt(prompt, chunkName));
    }
  }

  writeSiteJsonSync(path.join(SITE_DIR, "data", "index.json"), {
    ...payload,
    prompts: indexPrompts,
    detail: {
      chunkSize: DETAIL_CHUNK_SIZE,
      chunkCount: Math.ceil(prompts.length / DETAIL_CHUNK_SIZE)
    }
  });
}

async function main() {
  const { payload, source } = await loadSitePayloadForBuild();
  const outputPath = path.join(SITE_DIR, "data", "prompts.json");

  writeJsonSync(outputPath, payload);
  writeSplitSiteData(payload);
  copyAnalysisReports();

  console.log(`Site data written to ${outputPath}`);
  console.log(`Site index written to ${path.join(SITE_DIR, "data", "index.json")}`);
  console.log(`Site source: ${payload.dataSourceLabel} (${source})`);

  if (payload.validation?.checked) {
    console.log(
      `Feishu validation passed. expected=${payload.validation.expectedCount} actual=${payload.validation.actualCount}`
    );
  }

  if (payload.fallbackReason) {
    console.warn(`Fell back to YouMind source: ${payload.fallbackReason}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
