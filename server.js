#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { version: VERSION } = require("./package.json");

loadDotenvFiles();
useClaudeSubscriptionBilling();

const PORT = Number(process.env.BRIDGE_PORT) || 8787;
const CLAUDE_CMD = process.env.CLAUDE_CMD || "claude";
const TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT_MS) || 30000;
const MODEL = process.env.BRIDGE_MODEL;
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN;
const MAX_REQUEST_BYTES = 1_000_000;

function loadDotenvFiles() {
  parseDotenvFile(path.join(process.cwd(), ".env"));
  parseDotenvFile(path.join(os.homedir(), ".claude-bridge", ".env"));
}

function parseDotenvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) value = value.slice(1, -1);

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function useClaudeSubscriptionBilling() {
  delete process.env.ANTHROPIC_API_KEY;
}

function composePrompt(systemPrompt, userText) {
  if (!systemPrompt) return userText;
  return `${systemPrompt}\n\n---\n\n${userText}`;
}

function buildClaudeCliArguments(prompt, modelOverride) {
  const commandArguments = ["-p", prompt, "--output-format", "text"];
  const modelToUse = modelOverride || MODEL;
  if (modelToUse) commandArguments.push("--model", modelToUse);
  return commandArguments;
}

function runClaudeCli(prompt, modelOverride) {
  return new Promise((resolve, reject) => {
    const claudeProcess = spawn(CLAUDE_CMD, buildClaudeCliArguments(prompt, modelOverride), {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let hasSettled = false;

    const timeoutId = setTimeout(() => {
      if (hasSettled) return;
      hasSettled = true;
      claudeProcess.kill("SIGKILL");
      reject(new Error(`Claude CLI timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    claudeProcess.stdout.on("data", (data) => (stdout += data.toString()));
    claudeProcess.stderr.on("data", (data) => (stderr += data.toString()));

    claudeProcess.on("error", (error) => {
      if (hasSettled) return;
      hasSettled = true;
      clearTimeout(timeoutId);
      if (error.code === "ENOENT") {
        reject(new Error(
          `'${CLAUDE_CMD}' not found. Install: npm install -g @anthropic-ai/claude-code`
        ));
      } else {
        reject(error);
      }
    });

    claudeProcess.on("close", (exitCode) => {
      if (hasSettled) return;
      hasSettled = true;
      clearTimeout(timeoutId);
      if (exitCode !== 0) {
        reject(new Error(stderr.trim() || `Claude CLI exited with code ${exitCode}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function setPermissiveCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function respondJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let hasExceededLimit = false;
    request.on("data", (chunk) => {
      if (hasExceededLimit) return;
      body += chunk;
      if (body.length > MAX_REQUEST_BYTES) {
        hasExceededLimit = true;
        const error = new Error("Request body exceeds 1 MB limit");
        error.statusCode = 413;
        reject(error);
      }
    });
    request.on("end", () => {
      if (!hasExceededLimit) resolve(body);
    });
    request.on("error", (error) => {
      if (!hasExceededLimit) reject(error);
    });
  });
}

function isAuthorizedRequest(request) {
  if (!BRIDGE_TOKEN) return true;
  if (request.method === "OPTIONS") return true;
  if (request.method === "GET" && request.url === "/health") return true;
  const authHeader = request.headers.authorization || "";
  return authHeader === `Bearer ${BRIDGE_TOKEN}`;
}

async function handlePromptRequest(request, response) {
  try {
    const body = await readRequestBody(request);
    const { systemPrompt, userText, model } = JSON.parse(body || "{}");

    if (!userText || typeof userText !== "string") {
      respondJson(response, 400, { error: "Missing userText" });
      return;
    }
    if (model !== undefined && typeof model !== "string") {
      respondJson(response, 400, { error: "model must be a string" });
      return;
    }

    const answer = await runClaudeCli(composePrompt(systemPrompt, userText), model);
    respondJson(response, 200, { answer });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    respondJson(response, statusCode, { error: error.message || String(error) });
    if (statusCode === 413) request.destroy();
  }
}

const server = http.createServer(async (request, response) => {
  setPermissiveCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (!isAuthorizedRequest(request)) {
    respondJson(response, 401, { error: "Unauthorized" });
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    respondJson(response, 200, { status: "ok", model: MODEL || "default" });
    return;
  }

  if (request.method !== "POST") {
    respondJson(response, 405, { error: "Method not allowed" });
    return;
  }

  await handlePromptRequest(request, response);
});

function printStartupBanner() {
  const colors = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    border: "\x1b[38;5;215m",
    orange: "\x1b[38;5;215m",
    mascotBody: "\x1b[38;5;173m",
    mascotHighlight: "\x1b[48;5;180m",
    white: "\x1b[38;5;255m",
    muted: "\x1b[38;5;245m",
    dim: "\x1b[38;5;240m"
  };

  const stripAnsiCodes = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
  const visibleWidth = (text) => [...stripAnsiCodes(text)].length;
  const padRight = (text, width) => text + " ".repeat(Math.max(0, width - visibleWidth(text)));

  const mascot = [
    `${colors.mascotBody} ▐${colors.mascotHighlight}▛███▜${colors.reset}${colors.mascotBody}▌${colors.reset}`,
    `${colors.mascotBody}▝▜${colors.mascotHighlight}█████${colors.reset}${colors.mascotBody}▛▘${colors.reset}`,
    `${colors.mascotBody}  ▘▘ ▝▝${colors.reset}`
  ];

  const leftColumn = [
    "",
    `  ${colors.bold}${colors.white}Welcome to Claude Bridge!${colors.reset}`,
    "",
    `         ${mascot[0]}`,
    `         ${mascot[1]}`,
    `         ${mascot[2]}`,
    "",
    `  ${colors.muted}HTTP proxy for the Claude CLI${colors.reset}`,
    `  ${colors.muted}Billed to your Pro/Max plan${colors.reset}`
  ];

  const rightColumn = [
    "",
    `  ${colors.bold}${colors.orange}Tips for getting started${colors.reset}`,
    `  ${colors.muted}curl localhost:${PORT}/health${colors.reset}`,
    "",
    `  ${colors.bold}${colors.orange}Endpoints${colors.reset}`,
    `  ${colors.muted}POST${colors.reset}  ${colors.white}/${colors.reset}        send prompt`,
    `  ${colors.muted}GET ${colors.reset}  ${colors.white}/health${colors.reset}  liveness`,
    "",
    `  ${colors.bold}${colors.orange}Config${colors.reset}  ${colors.dim}:${PORT} · ${MODEL || "default"} · ${TIMEOUT_MS}ms${BRIDGE_TOKEN ? " · auth" : ""}${colors.reset}`
  ];

  const leftColumnWidth = 34;
  const rightColumnWidth = 43;
  const innerWidth = leftColumnWidth + 1 + rightColumnWidth;
  const rowCount = Math.max(leftColumn.length, rightColumn.length);

  const title = ` Claude Bridge v${VERSION} · @oxkunle `;
  const borderDashCount = innerWidth - visibleWidth(title) - 1;
  const topBorder =
    `${colors.border}╭─${colors.bold}${colors.orange}${title}${colors.reset}` +
    `${colors.border}${"─".repeat(borderDashCount)}╮${colors.reset}`;
  const bottomBorder = `${colors.border}╰${"─".repeat(innerWidth)}╯${colors.reset}`;

  const bannerLines = [topBorder];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const leftCell = padRight(leftColumn[rowIndex] || "", leftColumnWidth);
    const rightCell = padRight(rightColumn[rowIndex] || "", rightColumnWidth);
    bannerLines.push(
      `${colors.border}│${colors.reset}${leftCell}${colors.border}│${colors.reset}${rightCell}${colors.border}│${colors.reset}`
    );
  }
  bannerLines.push(bottomBorder);

  console.log(bannerLines.join("\n"));
  console.log(`${colors.dim}  Listening on http://localhost:${PORT}${colors.reset}`);
}

server.listen(PORT, "127.0.0.1", printStartupBanner);
