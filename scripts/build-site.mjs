import path from "path";
import fs from "fs";
import { ROOT, SITE_DIR, ensureDirSync, writeJsonSync } from "./lib/config.mjs";
import { loadSitePayloadForBuild } from "./lib/site-source.mjs";

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

async function main() {
  const { payload, source } = await loadSitePayloadForBuild();
  const outputPath = path.join(SITE_DIR, "data", "prompts.json");

  writeJsonSync(outputPath, payload);
  copyAnalysisReports();

  console.log(`Site data written to ${outputPath}`);
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
