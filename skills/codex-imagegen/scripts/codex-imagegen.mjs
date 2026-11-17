#!/usr/bin/env node
// Generate or edit images through Codex CLI's built-in imagegen skill.
// Replaces the codex-image plugin, which breaks on codex-cli >= 0.16x:
//   - `--full-auto` was removed  -> use `--sandbox workspace-write`
//   - `codex` on PATH may be a terminal shim (cmux) that swallows output -> resolve the real binary
//   - stdin left open makes `codex exec` wait on "Reading additional input from stdin" -> stdin ignored
//   - prompt/paths were re-joined into one string, so paths with spaces split -> real argv parsing
//
// Usage:
//   codex-imagegen.mjs status
//   codex-imagegen.mjs generate [--model M] [--ref PATH]... [--out DIR] [--name STEM] -- <prompt>
//   codex-imagegen.mjs edit <input> [--model M] [--ref PATH]... [--out DIR] [--name STEM] -- <prompt>
// Default model: $CODEX_IMAGE_MODEL, else gpt-6.1-terra.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_MODEL = process.env.CODEX_IMAGE_MODEL || "gpt-6.1-terra";
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");

function resolveCodex() {
  if (process.env.CODEX_BIN && fs.existsSync(process.env.CODEX_BIN)) return process.env.CODEX_BIN;
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir || /cmux-cli-shims|cmuxterm/.test(dir)) continue;
    const candidate = path.join(dir, "codex");
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const head = fs.readFileSync(candidate, { encoding: "utf8", flag: "r" }).slice(0, 200);
      if (/cmux/.test(head)) continue; // a shim copied elsewhere
      return candidate;
    } catch {}
  }
  for (const c of ["/opt/homebrew/bin/codex", "/usr/local/bin/codex"]) if (fs.existsSync(c)) return c;
  return null;
}

function parse(argv) {
  const o = { refs: [], model: DEFAULT_MODEL, out: null, name: null, input: null, prompt: "" };
  const dd = argv.indexOf("--");
  const flags = dd === -1 ? argv : argv.slice(0, dd);
  o.prompt = (dd === -1 ? [] : argv.slice(dd + 1)).join(" ").trim();
  for (let i = 0; i < flags.length; i++) {
    const t = flags[i];
    const v = () => {
      const x = flags[++i];
      if (x === undefined) throw new Error(`Missing value for ${t}`);
      return x;
    };
    if (t === "--model" || t === "-m") o.model = v();
    else if (t === "--ref" || t === "-i") o.refs.push(v());
    else if (t === "--out") o.out = v();
    else if (t === "--name") o.name = v();
    else if (!t.startsWith("-") && o.input === null) o.input = t;
    else throw new Error(`Unknown argument: ${t}`);
  }
  return o;
}

function stamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "").replace("T", "-");
}

function existing(p) {
  const abs = path.resolve(p);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${abs}`);
  return abs;
}

async function run(mode, argv) {
  const o = parse(argv);
  if (!o.prompt) throw new Error(`Missing prompt. Usage: ${mode} ${mode === "edit" ? "<input> " : ""}[options] -- <prompt>`);
  const codex = resolveCodex();
  if (!codex) throw new Error("codex CLI not found. Install with `npm install -g @openai/codex` or set CODEX_BIN.");

  const outDir = path.resolve(o.out || path.join(process.cwd(), "codex-images"));
  fs.mkdirSync(outDir, { recursive: true });
  const stem = o.name || `${stamp()}${mode === "edit" ? "-edit" : ""}`;
  const images = [];
  if (mode === "edit") {
    if (!o.input) throw new Error("edit needs an input image path.");
    images.push(existing(o.input));
  }
  for (const r of o.refs) images.push(existing(r));

  const instruction = [
    "Use the imagegen skill. Built-in image_gen tool path only; do not use the CLI fallback and do not ask for OPENAI_API_KEY.",
    mode === "edit"
      ? "The first attached image is the edit target. Preserve everything the request does not ask to change."
      : images.length ? "The attached images are references for style and character; do not copy their backgrounds unless asked." : "",
    images.length > (mode === "edit" ? 1 : 0) && mode === "edit" ? "Any further attached images are style or character references." : "",
    `Save every image as PNG into the directory "${outDir}" (quote it; it may contain spaces) named ${stem}-<n>.png (n = 1, 2, ...), unless the request names exact paths.`,
    "For each saved image print exactly one line: SAVED: <absolute path>",
    "Do not modify any other files.",
    "",
    "Request:",
    o.prompt,
  ].filter((l) => l !== "").join("\n");

  const args = ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "--ephemeral", "-m", o.model, "-C", process.cwd()];
  if (!outDir.startsWith(path.resolve(process.cwd()) + path.sep)) args.push("--add-dir", outDir);
  for (const img of images) args.push("--image", img);
  args.push("--", instruction);

  console.error(`codex-imagegen: ${path.basename(codex)} model=${o.model} out=${outDir} refs=${images.length}`);
  const status = await new Promise((resolve, reject) => {
    const child = spawn(codex, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "inherit"] });
    let buf = "";
    child.stdout.on("data", (d) => { buf += d; process.stdout.write(d); });
    child.on("error", reject);
    child.on("close", (code, sig) => resolve({ code: code ?? (sig ? 1 : 0), buf }));
  });

  // Codex sometimes saves elsewhere (e.g. splits a path on spaces). Never trust the reported
  // location: dedupe, then copy anything outside outDir into it so --out is always honoured.
  const reported = [...new Set([...status.buf.matchAll(/^SAVED: (.+)$/gm)].map((m) => m[1].trim()))].filter((p) => fs.existsSync(p));
  const saved = [];
  for (const p of reported) {
    if (p.startsWith(outDir + path.sep)) { saved.push(p); continue; }
    let dest = path.join(outDir, path.basename(p));
    for (let n = 2; fs.existsSync(dest); n++) dest = path.join(outDir, `${path.parse(p).name}-${n}${path.extname(p)}`);
    fs.copyFileSync(p, dest);
    console.error(`codex-imagegen: ${p} was outside --out; copied to ${dest}`);
    console.log(`SAVED: ${dest}`);
    saved.push(dest);
  }
  if (status.code !== 0) process.exitCode = status.code;
  else if (saved.length === 0) {
    console.error("codex-imagegen: codex finished but reported no saved image that exists on disk.");
    process.exitCode = 2;
  }
}

function status() {
  const codex = resolveCodex();
  const lines = [];
  const ok = (b, label, detail) => lines.push(`${b ? "OK  " : "FAIL"} ${label}: ${detail}`);
  ok(!!codex, "codex binary", codex || "not found");
  let ready = !!codex;
  if (codex) {
    const v = spawnSync(codex, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    ok(v.status === 0, "version", (v.stdout || v.stderr).trim());
    const l = spawnSync(codex, ["login", "status"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const loggedIn = l.status === 0 && /logged in/i.test(l.stdout + l.stderr);
    ok(loggedIn, "login", loggedIn ? "logged in" : "run `codex login`");
    ready &&= v.status === 0 && loggedIn;
  }
  const skill = path.join(CODEX_HOME, "skills", ".system", "imagegen", "SKILL.md");
  ok(fs.existsSync(skill), "imagegen skill", fs.existsSync(skill) ? skill : "missing; update codex");
  let known = "unknown (no models_cache.json)";
  try {
    known = fs.readFileSync(path.join(CODEX_HOME, "models_cache.json"), "utf8").includes(`"${DEFAULT_MODEL}"`) ? "listed" : "NOT listed";
  } catch {}
  ok(known !== "NOT listed", "default model", `${DEFAULT_MODEL} (${known})`);
  ready &&= fs.existsSync(skill) && known !== "NOT listed";
  console.log([`Ready: ${ready ? "yes" : "no"}`, ...lines].join("\n"));
  if (!ready) process.exitCode = 1;
}

const [cmd, ...rest] = process.argv.slice(2);
try {
  if (cmd === "status") status();
  else if (cmd === "generate" || cmd === "edit") await run(cmd, rest);
  else {
    console.log("Usage: codex-imagegen.mjs status | generate [opts] -- <prompt> | edit <input> [opts] -- <prompt>");
    process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  console.error(`codex-imagegen: ${e.message}`);
  process.exitCode = 1;
}
