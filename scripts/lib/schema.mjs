export const FIELD_DEFINITIONS = [
  { name: "Prompt ID", type: "text" },
  { name: "Title", type: "text" },
  { name: "Description", type: "text" },
  { name: "Prompt", type: "text" },
  { name: "Translated Prompt", type: "text" },
  { name: "Language", type: "text" },
  { name: "Featured", type: "checkbox" },
  { name: "Active", type: "checkbox" },
  { name: "Source Link", type: "text" },
  { name: "Source Published At", type: "text" },
  { name: "Author", type: "text" },
  { name: "Author Link", type: "text" },
  { name: "Media URLs", type: "text" },
  { name: "Media Thumbnails", type: "text" },
  { name: "Preview Cover", type: "attachment" },
  { name: "Reference Images", type: "text" },
  { name: "Categories", type: "text" },
  { name: "Source Platform", type: "text" },
  { name: "Needs Reference Images", type: "checkbox" },
  { name: "Likes", type: "number" },
  { name: "Results Count", type: "number" },
  { name: "Detail URL", type: "text" },
  { name: "Model", type: "text" },
  { name: "Content Hash", type: "text" },
  { name: "Synced At", type: "text" }
];

export const FIELD_ORDER = FIELD_DEFINITIONS.map((field) => field.name);
export const ALL_FIELD_DEFINITIONS = [...FIELD_DEFINITIONS];

export const LOOKUP_FIELDS = ["Prompt ID", "Content Hash", "Active"];
