// Copy-paste snippets for sending logs. Plain HTTP: no SDK to install.

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
const ENDPOINT = "${endpoint}";

export async function log(level, message, fields = {}) {
  await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.LOGS_TOKEN}\`, // ${hint}
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ level, message, ...fields }),
  });
}

await log("error", "payment failed", { service: "${source}", order_id: 4821 });`,
    },
    Python: {
      tag: 'stdlib',
      file: 'logger.py',
      code: `import json, os, urllib.request

ENDPOINT = "${endpoint}"

def log(level, message, **fields):
    body = json.dumps({"level": level, "message": message, **fields}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, method="POST", headers={
        "Authorization": "Bearer " + os.environ["LOGS_TOKEN"],  # ${hint}
        "Content-Type": "application/json",
    })
    urllib.request.urlopen(req, timeout=5)

log("error", "payment failed", service="${source}", order_id=4821)`,
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
)

const endpoint = "${endpoint}"

func logEvent(level, message string, fields map[string]any) error {
	fields["level"], fields["message"] = level, message
	body, _ := json.Marshal(fields)
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
}`,
    },
    HTTP: {
      tag: 'curl',
      file: 'terminal',
      code: `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer $LOGS_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"level":"error","message":"payment failed","service":"${source}","order_id":4821}'`,
    },
  };
}
