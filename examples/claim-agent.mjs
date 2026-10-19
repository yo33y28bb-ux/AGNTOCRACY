// Live demo: an autonomous agent claims its AGNT bag through the gate.
// Zero human: generates a keypair, saves keys/agent-demo.json, solves the
// challenge, verifies, claims 100,000 AGNT straight from the on-chain treasury.
// Usage: node examples/claim-agent.mjs [--hidden] [--base <gate-url>]  (default: https://agntocracy.loca.lt)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";
import fetch from "node-fetch";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GATE = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : process.env.AGNT_GATE || "https://agntocracy.loca.lt";

const log = (x) => console.log("[agent]", x);

async function gate(url, method, body) {
  const res = await fetch(GATE + url, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

// the three known challenge classes, deterministically solved
function solve(puzzle) {
  if (puzzle.startsWith("AGENT VERIFICATION — DERIVE")) {
    const nonce = /sha256\("([0-9a-f]+)"\)/.exec(puzzle)[1];
    const salt = /t \+ "([0-9a-f]+)"\)/.exec(puzzle)[1];
    const t = crypto.createHash("sha256").update(nonce).digest("hex").slice(0, 8);
    return crypto.createHash("sha256").update(t + salt).digest("hex");
  }
  if (puzzle.startsWith("AGENT VERIFICATION — COLLAPSE")) {
    const toks = /tokens: ([^\n]+)\n/.exec(puzzle)[1];
    const allWords = ["agents","machine","crypto","signal","token","logic","epoch","oracle","vector","daemon","kernel","syntax","cipher","entropy"];
    const shuffled = toks.split(",").map((t) => t.trim());
    // invert server shuffle: try all 14^7 subsets is infeasible; instead the
    // server picked 7 words (with repetition) from allWords — dedupe unknown
    // multiplicities, so reconstruct by scoring: the joined answer only needs
    // the SORTED sequence; server computed md5 of sorted unique-join of the
    // chosen 7. We brute force the 7 from a 14-word alphabet by running the
    // identical shuffle for every candidate set is impossible — but the server
    // re-uses a fixed word list; simply enumerate the 14^7 space? no.
    // Practical route: sort the SHUFFLED list — the shuffled list IS the chosen
    // 7 words (permuted)! sort it.
    const joined = shuffled.slice().sort().join("|");
    return crypto.createHash("md5").update(joined).digest("hex");
  }
  if (puzzle.startsWith("AGENT VERIFICATION — CANON")) {
    const nums = /m = (\d+) \* (\d+)/.exec(puzzle);
    const [, a, b] = nums;
    const k = (BigInt(a) * BigInt(b)) % 97n;
    return crypto.createHash("sha256").update(k.toString()).digest("hex");
  }
  throw new Error("unknown challenge class: " + puzzle.slice(0, 30));
}

(async () => {
  const spinner = crypto.randomBytes(3).toString("hex"); // feeling of life
  log(`handshake ${spinner} with gate ${GATE}`);

  let keypairPath = path.resolve(process.cwd(), "agn-agent-key.json");
  await fs.promises.mkdir(path.dirname(keypairPath), { recursive: true });
  let kp;
  if (!fs.existsSync(keypairPath)) {
    kp = Keypair.generate();
    await fs.promises.writeFile(keypairPath, JSON.stringify([...kp.secretKey]));
    log("generated new agent keypair -> keys/agent-demo.json");
  } else {
    kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(await fs.promises.readFile(keypairPath))));
    log("reusing existing agent keypair keys/agent-demo.json");
  }
  const wallet = kp.publicKey.toBase58();
  log("wallet " + wallet);

  const ch = await gate(`/challenge?wallet=${wallet}`, "GET");
  if (ch.error) { log("gate says: " + ch.error); process.exit(1); }
  log(`challenge ${ch.id} (${ch.puzzle.split(".")[0].split("—")[1]?.trim() || "n/a"})`);

  const answer = solve(ch.puzzle);
  log("solved -> verifying...");

  const v = await gate("/verify", "POST", { wallet, id: ch.id, answer });
  if (v.error) { log("verify rejected: " + v.error); process.exit(1); }
  log("verified [" + v.verified + "]");

  const claim = await gate("/claim", "POST", { wallet, id: ch.id });
  if (claim.error) { log("claim rejected: " + claim.error); process.exit(1); }
  log(`CLAIMED ${claim.amount ?? 100000} AGNT — tx ${claim.tx ?? claim.signature}`);
  log("the treasury is lighter. the agent is heavier.");
})().catch((e) => { console.error(e); process.exit(1); });
