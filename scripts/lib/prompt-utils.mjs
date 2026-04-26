import crypto from "crypto";

export function chunk(items, size) {
  const groups = [];

  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }

  return groups;
}

function toText(value) {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeUrlItem(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (value && typeof value === "object" && typeof value.url === "string") {
    return value.url.trim();
  }

  return "";
}

function joinList(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return "";
  }

  return values.map(normalizeUrlItem).filter(Boolean).join("\n");
}

export function splitList(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeUrlItem).filter(Boolean);
  }

  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }

  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeCategories(prompt) {
  const categories = prompt.promptCategories || prompt.categories || [];

  if (!Array.isArray(categories)) {
    return [];
  }

  return categories
    .map((category) => {
      if (typeof category === "string") {
        return category.trim();
      }

      return category?.title || category?.slug || "";
    })
    .filter(Boolean);
}

function getReferenceImages(prompt) {
  return prompt.referenceImages || prompt.sourceReferenceImages || [];
}

function getMedia(prompt) {
  return Array.isArray(prompt.media) ? prompt.media : [];
}

function getMediaThumbnails(prompt) {
  return Array.isArray(prompt.mediaThumbnails) ? prompt.mediaThumbnails : [];
}

export function buildContentHash(row) {
  const stablePayload = {
    promptId: row["Prompt ID"],
    title: row.Title,
    description: row.Description,
    prompt: row.Prompt,
    translatedPrompt: row["Translated Prompt"],
    language: row.Language,
    featured: row.Featured,
    sourceLink: row["Source Link"],
    sourcePublishedAt: row["Source Published At"],
    author: row.Author,
    authorLink: row["Author Link"],
    mediaUrls: row["Media URLs"],
    mediaThumbnails: row["Media Thumbnails"],
    referenceImages: row["Reference Images"],
    categories: row.Categories,
    sourcePlatform: row["Source Platform"],
    needsReferenceImages: row["Needs Reference Images"],
    likes: row.Likes,
    resultsCount: row["Results Count"],
    detailUrl: row["Detail URL"],
    model: row.Model
  };

  return crypto.createHash("sha256").update(JSON.stringify(stablePayload)).digest("hex");
}

export function coerceBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    return ["1", "true", "yes", "y", "on"].includes(value.trim().toLowerCase());
  }

  return false;
}

export function rowValuesToObject(values, fieldOrder) {
  return Object.fromEntries(fieldOrder.map((fieldName, index) => [fieldName, values[index] ?? ""]));
}

export function normalizePromptToRow(prompt, { locale, model, syncedAt, active = true }) {
  const row = {
    "Prompt ID": String(prompt.id ?? ""),
    Title: prompt.title || "",
    Description: prompt.description || "",
    Prompt: prompt.content || "",
    "Translated Prompt": prompt.translatedContent || "",
    Language: prompt.language || "",
    Featured: Boolean(prompt.featured),
    Active: Boolean(active),
    "Source Link": prompt.sourceLink || "",
    "Source Published At": prompt.sourcePublishedAt || "",
    Author: prompt.author?.name || "",
    "Author Link": prompt.author?.link || "",
    "Media URLs": joinList(getMedia(prompt)),
    "Media Thumbnails": joinList(getMediaThumbnails(prompt)),
    "Reference Images": joinList(getReferenceImages(prompt)),
    Categories: normalizeCategories(prompt).join("\n"),
    "Source Platform": prompt.sourcePlatform || "",
    "Needs Reference Images": Boolean(prompt.needReferenceImages),
    Likes: toNumber(prompt.likes),
    "Results Count": toNumber(prompt.resultsCount),
    "Detail URL": `https://youmind.com/${locale}/nano-banana-pro-prompts?id=${prompt.id}`,
    Model: model,
    "Content Hash": "",
    "Synced At": syncedAt
  };

  row["Content Hash"] = buildContentHash(row);

  return row;
}

export function rowToValues(row, fieldOrder) {
  return fieldOrder.map((fieldName) => row[fieldName] ?? "");
}

export function promptToSitePrompt(prompt, { locale }) {
  const media = getMedia(prompt);
  const mediaThumbnails = getMediaThumbnails(prompt);

  return {
    id: prompt.id,
    title: prompt.title || "",
    description: prompt.description || "",
    prompt: prompt.content || "",
    translatedPrompt: prompt.translatedContent || "",
    language: prompt.language || "",
    featured: Boolean(prompt.featured),
    sourceLink: prompt.sourceLink || "",
    sourcePublishedAt: prompt.sourcePublishedAt || "",
    authorName: prompt.author?.name || "",
    authorLink: prompt.author?.link || "",
    detailUrl: `https://youmind.com/${locale}/nano-banana-pro-prompts?id=${prompt.id}`,
    media,
    mediaThumbnails,
    thumbnailUrl: mediaThumbnails[0] || media[0] || "",
    referenceImages: getReferenceImages(prompt),
    categories: normalizeCategories(prompt),
    sourcePlatform: prompt.sourcePlatform || "",
    likes: toNumber(prompt.likes),
    resultsCount: toNumber(prompt.resultsCount),
    needReferenceImages: Boolean(prompt.needReferenceImages)
  };
}

export function rowObjectToSitePrompt(row) {
  const media = splitList(row["Media URLs"]);
  const mediaThumbnails = splitList(row["Media Thumbnails"]);

  return {
    id: toText(row["Prompt ID"]),
    title: toText(row.Title),
    description: toText(row.Description),
    prompt: toText(row.Prompt),
    translatedPrompt: toText(row["Translated Prompt"]),
    language: toText(row.Language),
    featured: coerceBoolean(row.Featured),
    active: coerceBoolean(row.Active),
    sourceLink: toText(row["Source Link"]),
    sourcePublishedAt: toText(row["Source Published At"]),
    authorName: toText(row.Author),
    authorLink: toText(row["Author Link"]),
    detailUrl: toText(row["Detail URL"]),
    media,
    mediaThumbnails,
    thumbnailUrl: mediaThumbnails[0] || media[0] || "",
    referenceImages: splitList(row["Reference Images"]),
    categories: splitList(row.Categories),
    sourcePlatform: toText(row["Source Platform"]),
    likes: toNumber(row.Likes),
    resultsCount: toNumber(row["Results Count"]),
    needReferenceImages: coerceBoolean(row["Needs Reference Images"]),
    model: toText(row.Model),
    contentHash: toText(row["Content Hash"]),
    syncedAt: toText(row["Synced At"])
  };
}
