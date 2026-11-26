export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
    const systemPrompt = typeof body.system === "string" ? body.system.slice(0, 2000) : "";
    const temperature = Math.min(Math.max(Number(body.temperature) || 0.7, 0), 2);
    const userName = typeof body.userName === "string" ? body.userName.slice(0, 60) : "there";

    const cleanMessages = messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
      .map((m) => ({
        role: m.role === "user" ? "user" : "model",
        text: m.text.trim().slice(0, 8000),
      }));

    if (!cleanMessages.length) {
      return res.status(400).json({ error: "No valid messages provided" });
    }

    const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
    const geminiModel = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();

    if (geminiKey) {
      const payload = {
        contents: cleanMessages.map((m) => ({
          role: m.role,
          parts: [{ text: m.text }],
        })),
        generationConfig: {
          temperature,
        },
      };

      if (systemPrompt) {
        payload.systemInstruction = {
          parts: [{ text: systemPrompt }],
        };
      }

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const upstream = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await upstream.json().catch(() => null);
      if (!upstream.ok) {
        const msg = data?.error?.message || `Upstream error (${upstream.status})`;
        return res.status(upstream.status).json({ error: msg });
      }

      const replyText = (data?.candidates?.[0]?.content?.parts || [])
        .map((p) => (typeof p?.text === "string" ? p.text : ""))
        .join("")
        .trim();

      if (replyText) {
        return res.status(200).json({ reply: replyText, source: "server-llm" });
      }
    }

    const lastUserText = cleanMessages[cleanMessages.length - 1].text;
    const reply = buildDynamicFallback(lastUserText, userName, systemPrompt);
    return res.status(200).json({ reply, source: "server-engine" });
  } catch (err) {
    return res.status(500).json({ error: err?.message || "Internal server error" });
  }
}

function buildDynamicFallback(prompt, userName, systemPrompt) {
  const q = prompt.trim();
  const ql = q.toLowerCase();
  const first = userName.split(/\s+/)[0] || "there";

  if (/^(hi+|hey+|hello+|yo+|sup|hola|good morning|good afternoon|good evening)[!.?]*\$/i.test(ql)) {
    return `Hey ${first}! How's it going?\n\nI'm ready to help with code, debugging, explanations, writing, or brainstorming. What are we working on today?`;
  }
  if (/python.*json|parse json/.test(ql)) {
    return "Here's a clean Python snippet to read and parse JSON safely:\n\n```python\nimport json\nfrom pathlib import Path\n\ndata = json.loads(Path(\"data.json\").read_text(encoding=\"utf-8\"))\nprint(json.dumps(data, indent=2))\n```\n\n- Uses `pathlib.Path` with UTF-8 encoding.\n- Pretty-prints with `indent=2`.";
  }
  if (/linux.*disk|disk space/.test(ql)) {
    return "Check disk space cleanly with `df -h`:\n\n```bash\ndf -h --total\n```\n\n- `-h` formats sizes in human-readable units (GB/MB).\n- Run `du -sh * | sort -hr | head -n 10` to find the largest folders in the current directory.";
  }
  if (/readme/.test(ql)) {
    return "Here's a clean starter `README.md`:\n\n```markdown\n# Gavio Project\n\nConcise overview of what this project does.\n\n## Quick Start\n1. Install dependencies\n2. Add required environment variables in Vercel\n3. Deploy or start the dev server\n```\n\nLet me know your stack if you want setup steps tailored to it.";
  }
  if (/async|await/.test(ql)) {
    return "**`async` and `await`** make asynchronous flows read step-by-step:\n\n1. An `async` function always returns a `Promise`.\n2. `await` pauses inside that function until the `Promise` resolves.\n\n```javascript\nasync function loadData(url) {\n  const res = await fetch(url);\n  if (!res.ok) throw new Error(`HTTP ${res.status}`);\n  return await res.json();\n}\n```";
  }

  const hint = systemPrompt ? `\n\n*Guided by your system prompt: ${systemPrompt}*` : "";
  return `Here's a thoughtful take on **${q}**, ${first}:\n\n- **Start Simple:** Get a minimal, working version running first so every assumption is verified.\n- **Refine Iteratively:** Once the core flow works, polish edge cases, error handling, and UX.\n\nWant me to write code, walk through an example, or break down a specific step for this?${hint}`;
}
