import { execFile, execFileSync } from "child_process";

function formatCommandError(error) {
  const stdout = error.stdout ? String(error.stdout) : "";
  const stderr = error.stderr ? String(error.stderr) : "";
  const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
  return detail || error.message;
}

export function runLarkCli(args) {
  try {
    return execFileSync("lark-cli", args, {
      encoding: "utf8",
      env: { ...process.env, LARK_CLI_NO_PROXY: "1" },
      maxBuffer: 1024 * 1024 * 64
    }).trim();
  } catch (error) {
    throw new Error(`lark-cli ${args.join(" ")} failed:\n${formatCommandError(error)}`);
  }
}

export function runLarkCliJson(args) {
  const output = runLarkCli(args);
  return JSON.parse(output);
}

export function runLarkCliAsync(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "lark-cli",
      args,
      {
        encoding: "utf8",
        env: { ...process.env, LARK_CLI_NO_PROXY: "1" },
        maxBuffer: 1024 * 1024 * 64
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`lark-cli ${args.join(" ")} failed:\n${formatCommandError({ ...error, stdout, stderr })}`));
          return;
        }

        resolve(String(stdout || "").trim());
      }
    );
  });
}

export async function runLarkCliJsonAsync(args) {
  const output = await runLarkCliAsync(args);
  return JSON.parse(output);
}
