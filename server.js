const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
};

function loadDotEnv() {
  try {
    const text = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    text.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!match) return;
      const key = match[1];
      const value = match[2].replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    });
  } catch {
    /* .env 是可选的 */
  }
}

loadDotEnv();

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function normalizeSteps(raw) {
  if (!raw || !Array.isArray(raw.steps)) return null;
  const steps = raw.steps
    .slice(0, 6)
    .map((step) => ({
      title: String(step && step.title ? step.title : "").trim().slice(0, 140),
      minutes: Number(step && step.minutes),
    }))
    .filter((step) => step.title);

  if (steps.length < 2) return null;

  steps.forEach((step) => {
    if (!Number.isFinite(step.minutes) || step.minutes < 1 || step.minutes > 30) {
      step.minutes = 5;
    }
    step.minutes = Math.round(step.minutes);
  });

  steps[0].minutes = Math.min(steps[0].minutes, 2);
  return steps;
}

async function generateWithLLM(title) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    const error = new Error("missing_api_key");
    error.code = "missing_api_key";
    throw error;
  }

  const prompt = [
    "你是一个反拖延教练。用户正在拖延的任务是：",
    title,
    "",
    "请把它拆成 4 个连续的小步骤，要求：",
    "1. 第一步必须在 2 分钟内完成，必须是一个具体动作（打开、翻到、写下、圈出、运行），不能写“认真复习”“好好准备”这种模糊动作。",
    "2. 每一步都要小到用户不好意思拒绝，时间从 2、5、10、15 分钟里选。",
    "3. 步骤之间递进，不要重复。",
    "4. 用中文，每条标题不超过 30 个字。",
    "5. 只返回 JSON，不要解释。格式：",
    '{"steps":[{"title":"...","minutes":2},{"title":"...","minutes":5},{"title":"...","minutes":10},{"title":"...","minutes":15}]}',
  ].join("\n");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "你是反拖延教练，只输出 JSON。" },
          { role: "user", content: prompt },
        ],
        temperature: 0.6,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`llm_http_${response.status}`);
    }

    const data = await response.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : "";
    const cleaned = String(content).replace(/^```json\s*|```$/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return normalizeSteps(parsed);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleBreakdown(req, res) {
  try {
    const body = await readBody(req);
    const payload = JSON.parse(body || "{}");
    const title = String(payload.title || "").trim().slice(0, 200);
    if (!title) {
      sendJSON(res, 400, { error: "empty_title" });
      return;
    }

    const steps = await generateWithLLM(title);
    if (!steps) {
      sendJSON(res, 502, { error: "invalid_llm_output" });
      return;
    }
    sendJSON(res, 200, { steps, source: "llm" });
  } catch (error) {
    if (error.code === "missing_api_key") {
      sendJSON(res, 200, {
        steps: null,
        source: "template",
        message: "没有配置 DEEPSEEK_API_KEY，前端会使用内置模板拆解。",
      });
      return;
    }
    sendJSON(res, 502, {
      error: "llm_failed",
      message: "大模型拆解失败，前端会使用内置模板。",
    });
  }
}

const server = http.createServer(async (req, res) => {
  const requestURL = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestURL.pathname === "/api/health") {
    sendJSON(res, 200, {
      ok: true,
      llm: Boolean(process.env.DEEPSEEK_API_KEY),
    });
    return;
  }

  if (requestURL.pathname === "/api/breakdown") {
    if (req.method !== "POST") {
      sendJSON(res, 405, { error: "method_not_allowed" });
      return;
    }
    await handleBreakdown(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(requestURL.pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  const relative = pathname.replace(/^\/+/, "");
  const filePath = path.join(ROOT, relative);
  const insideRoot = filePath === ROOT || filePath.startsWith(ROOT + path.sep);

  if (!insideRoot) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(error.code === "ENOENT" ? 404 : 500, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(content);
  });
});

server.listen(PORT, () => {
  console.log(`两分钟启动器 running at http://localhost:${PORT}`);
  console.log(
    process.env.DEEPSEEK_API_KEY
      ? "DeepSeek 拆解：已开启"
      : "DeepSeek 拆解：未配置，使用内置模板"
  );
});
