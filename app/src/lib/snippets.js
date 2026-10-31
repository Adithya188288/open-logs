// Copy-paste snippets for sending logs. Plain HTTP, no SDK. Events are batched: one request per many events
// keeps Workers request costs low (send arrays of up to 10,000 events / 5 MB).

/**
 * @param {string} endpoint  full ingest URL
 * @param {string} source  source name (for the example message)
 * @param {string} hint  shortened token shown in comments, e.g. "ol_Ab3d…9xYz"
 */
export function snippets(endpoint, source, hint) {
  return {
    JavaScript: {
      tag: 'fetch',
      file: 'logger.js',
      code: `// No package needed: uses the built-in fetch (Node 18+, Bun, Deno).
// Events are queued and sent in batches, one request per second at most.
const ENDPOINT = "${endpoint}";
const queue = [];

export function log(level, message, fields = {}) {
  queue.push({ ts: Date.now(), level, message, ...fields });
  if (queue.length >= 500) flush();
}

export async function flush() {
  if (queue.length === 0) return;
  await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.LOGS_TOKEN}\`, // ${hint}
      "Content-Type": "application/json",
    },
    body: JSON.stringify(queue.splice(0)),
  });
}

setInterval(flush, 1000).unref();

log("error", "payment failed", { service: "${source}", order_id: 4821 });
await flush(); // also call flush() before your process exits`,
    },
    Python: {
      tag: 'stdlib',
      file: 'logger.py',
      code: `import json, os, time, urllib.request

ENDPOINT = "${endpoint}"
queue = []

def log(level, message, **fields):
    queue.append({"ts": int(time.time() * 1000), "level": level, "message": message, **fields})
    if len(queue) >= 500:
        flush()

def flush():
    if not queue:
        return
    body = json.dumps(queue).encode()
    queue.clear()
    req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "Authorization": "Bearer " + os.environ["LOGS_TOKEN"],  # ${hint}
        "Content-Type": "application/json",
    })
    urllib.request.urlopen(req, timeout=5)

log("error", "payment failed", service="${source}", order_id=4821)
flush()  # call regularly (e.g. every second) and before exit`,
    },
    Go: {
      tag: 'net/http',
      file: 'main.go',
      code: `package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"time"
)

const endpoint = "${endpoint}"

var queue []map[string]any

func logEvent(level, message string, fields map[string]any) {
	fields["ts"], fields["level"], fields["message"] = time.Now().UnixMilli(), level, message
	queue = append(queue, fields)
}

// flush sends everything queued in one request. Call it every second or so, and before exit.
func flush() error {
	if len(queue) == 0 {
		return nil
	}
	body, _ := json.Marshal(queue)
	queue = nil
	req, _ := http.NewRequest("POST", endpoint, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+os.Getenv("LOGS_TOKEN")) // ${hint}
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err == nil {
		res.Body.Close()
	}
	return err
}

func main() {
	logEvent("error", "payment failed", map[string]any{"service": "${source}", "order_id": 4821})
	flush()
}`,
    },
    HTTP: {
      tag: 'curl',
      file: 'terminal',
      code: `# Send an array to batch many events in one request.
curl -X POST ${endpoint} \\
  -H "Authorization: Bearer $LOGS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '[{"level":"error","message":"payment failed","service":"${source}","order_id":4821}]'`,
    },
  };
}

export const PLATFORMS = /** @type {const} */ (['JavaScript', 'Python', 'Go', 'HTTP']);
