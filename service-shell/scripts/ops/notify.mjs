#!/usr/bin/env node
// Credentials stay outside the repository. Usage: node scripts/ops/notify.mjs < message.txt
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { setGlobalProxyFromEnv } from "node:http";
setGlobalProxyFromEnv();
const file = process.env.CANTOR_NOTIFY_CONFIG || "/workspace/.cloud-tools/config/cantor-notify.json";
const config = JSON.parse(readFileSync(file, "utf8"));
const path = process.argv.includes("--identity") ? "/identity" : "/notify";
const body = JSON.stringify(path === "/identity" ? {} : { text: readFileSync(0, "utf8").trim() });
const timestamp = String(Date.now());
const signature = createHmac("sha256", config.signingKey).update(`${timestamp}\n${path}\n${body}`).digest("hex");
const response = await fetch(new URL(path, config.url), { method: "POST", body, headers: { "content-type": "application/json", "x-cantor-timestamp": timestamp, "x-cantor-signature": signature }, signal: AbortSignal.timeout(20_000) });
const result = await response.json();
if (!response.ok) { process.stderr.write(`Notification failed: ${result.error || response.status}\n`); process.exitCode = 1; }
else process.stdout.write(`${JSON.stringify(result)}\n`);
