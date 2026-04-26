import { fileURLToPath } from "url";
import { resolveSyncTarget } from "./lib/config.mjs";
import { runLarkCliJson } from "./lib/lark-cli.mjs";
import { ALL_FIELD_DEFINITIONS } from "./lib/schema.mjs";

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

export function ensureFeishuFieldsWithLark({ baseToken, tableId }) {
  const existingFields = listAllFields(baseToken, tableId);
  const existingNames = new Set(existingFields.map((field) => String(field.field_name || "")));
  const missingFields = ALL_FIELD_DEFINITIONS.filter((field) => !existingNames.has(field.name));

  if (missingFields.length === 0) {
    console.log(`Feishu fields already complete (${existingFields.length} fields).`);
    return { created: 0, existing: existingFields.length };
  }

  console.log(
    `Adding ${missingFields.length} missing Feishu fields: ${missingFields
      .map((field) => field.name)
      .join(", ")}`
  );

  for (const field of missingFields) {
    runLarkCliJson([
      "base",
      "+field-create",
      "--base-token",
      baseToken,
      "--table-id",
      tableId,
      "--json",
      JSON.stringify(field)
    ]);
  }

  return { created: missingFields.length, existing: existingFields.length };
}

async function main() {
  const target = resolveSyncTarget();
  const result = ensureFeishuFieldsWithLark({
    baseToken: target.baseToken,
    tableId: target.tableId
  });

  console.log(`Finished ensuring Feishu fields. created=${result.created}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
