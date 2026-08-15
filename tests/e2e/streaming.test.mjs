// Protocol test for the simulator's exec / port-forward streaming subresources.
//
// These speak the Kubernetes channel.k8s.io framing ([channelByte, ...payload])
// that the PWA's openBearerPodExec/openBearerPodPortForward emit through the
// /api/kube-stream worker. We connect a WebSocket straight to the simulator so
// the protocol is verified independently of the browser.
//
// NOTE: the full browser -> /api/kube-stream -> cluster path for bearer-token
// clusters requires a runtime with native binary WebSocket relaying (Cloudflare
// Workers' WebSocketPair). vinext's Node runtime (dev and `start`) delivers
// binary frames as stringified arrays, so that end-to-end path can't be
// exercised under `node ... dev`; this test covers the streaming contract that
// path depends on. Client-certificate clusters stream via the companion instead.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 7455;
const TOKEN = "streamtest";
const base = `ws://127.0.0.1:${PORT}`;
const authHeaders = { headers: { authorization: `Bearer ${TOKEN}` } };
let sim;

const delay = ms => new Promise(r => setTimeout(r, ms));
const frame = (channel, text) => Buffer.concat([Buffer.from([channel]), Buffer.from(text)]);

before(async () => {
  sim = spawn(process.execPath, [resolve(here, "kube-simulator.mjs")], {
    env: { ...process.env, HEIMDALL_SIM_PORT: String(PORT), HEIMDALL_SIM_TOKEN: TOKEN },
    stdio: "ignore",
  });
  // Wait for the HTTP server to accept connections.
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (res.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("simulator did not start");
});

after(() => {
  sim?.kill();
});

test("exec streams stdout and responds to stdin commands", async () => {
  const ws = new WebSocket(
    `${base}/api/v1/namespaces/kube-system/pods/coredns-abc/exec?container=main`,
    ["v5.channel.k8s.io"],
    authHeaders,
  );
  const out = [];
  const result = await new Promise((res, rej) => {
    ws.on("open", () => setTimeout(() => ws.send(frame(0, "whoami\r")), 100));
    ws.on("message", d => {
      const b = Buffer.isBuffer(d) ? d : Buffer.from(d);
      if (b[0] === 1) out.push(b.subarray(1).toString());
      if (out.join("").includes("root\n")) {
        ws.close();
        res(out.join(""));
      }
    });
    ws.on("error", rej);
    setTimeout(() => rej(new Error(`exec timed out; got: ${JSON.stringify(out.join(""))}`)), 5000);
  });
  assert.match(result, /Simulated shell for coredns-abc/); // greeting on stdout
  assert.match(result, /root\n/); // whoami response
});

test("exec negotiates the channel.k8s.io subprotocol", async () => {
  const ws = new WebSocket(
    `${base}/api/v1/namespaces/default/pods/x/exec?container=main`,
    ["v5.channel.k8s.io", "v4.channel.k8s.io"],
    authHeaders,
  );
  const protocol = await new Promise((res, rej) => {
    ws.on("open", () => {
      res(ws.protocol);
      ws.close();
    });
    ws.on("error", rej);
    setTimeout(() => rej(new Error("open timed out")), 5000);
  });
  assert.equal(protocol, "v5.channel.k8s.io");
});

test("port-forward tunnels bytes back on the data channel", async () => {
  const ws = new WebSocket(
    `${base}/api/v1/namespaces/kube-system/pods/coredns-abc/portforward?ports=8080`,
    ["v4.channel.k8s.io"],
    authHeaders,
  );
  const echoed = await new Promise((res, rej) => {
    ws.on("open", () => setTimeout(() => ws.send(frame(0, "PING")), 100));
    ws.on("message", d => {
      const b = Buffer.isBuffer(d) ? d : Buffer.from(d);
      if (b[0] === 0) {
        ws.close();
        res(b.subarray(1).toString());
      }
    });
    ws.on("error", rej);
    setTimeout(() => rej(new Error("port-forward timed out")), 5000);
  });
  assert.equal(echoed, "PING");
});

test("streaming subresources reject a missing/invalid token", async () => {
  const ws = new WebSocket(
    `${base}/api/v1/namespaces/kube-system/pods/coredns-abc/exec?container=main`,
    ["v5.channel.k8s.io"],
    { headers: { authorization: "Bearer wrong" } },
  );
  const rejected = await new Promise(res => {
    ws.on("open", () => {
      ws.close();
      res(false);
    });
    ws.on("error", () => res(true)); // 401 during upgrade surfaces as an error
    ws.on("unexpected-response", () => res(true));
    setTimeout(() => res(false), 5000);
  });
  assert.equal(rejected, true);
});
