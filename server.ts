import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { GoogleGenAI, Type, ThinkingLevel } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function buildFallbackFollowUp(code: string, previousQuestions: string[] = []): { question: string; focusArea: string } {
  const lower = code.toLowerCase();
  const candidates: { question: string; focusArea: string }[] = [];

  if (
    lower.includes("dict") ||
    lower.includes("{}") ||
    lower.includes("map") ||
    lower.includes("seen") ||
    lower.includes("prev_map") ||
    lower.includes("prevmap")
  ) {
    candidates.push({
      question: "I see you’re using a hash map. What’s the time and space complexity?",
      focusArea: "Complexity & Hash Map",
    });
  }

  if (/\bif\b/.test(lower)) {
    candidates.push({
      question: "Walk me through what that if-statement is checking.",
      focusArea: "Conditional Logic",
    });
  }

  if (lower.includes("target -") || lower.includes("target-") || lower.includes("complement") || lower.includes("diff")) {
    candidates.push({
      question: "You're calculating the complement here—how does your logic avoid using the same array index twice?",
      focusArea: "Edge Case Check",
    });
  }

  if ((lower.match(/\bfor\b/g) || []).length >= 2) {
    candidates.push({
      question: "It looks like you're writing nested loops—what will the time complexity be as the input array grows?",
      focusArea: "Time Complexity",
    });
  } else if (/\bfor\b|\bwhile\b/.test(lower)) {
    candidates.push({
      question: "Walk me through what happens on each iteration of your loop and what you store.",
      focusArea: "Loop Invariant",
    });
  }

  candidates.push(
    {
      question: "I see you’re using a hash map. What’s the time and space complexity?",
      focusArea: "Complexity Analysis",
    },
    {
      question: "Walk me through what that if-statement is checking.",
      focusArea: "Code Walkthrough",
    },
    {
      question: "If the input array has duplicate numbers like [3, 3] for target 6, how does your code handle it?",
      focusArea: "Duplicate Edge Case",
    }
  );

  const unused = candidates.find((c) => !previousQuestions.includes(c.question));
  return unused || candidates[previousQuestions.length % candidates.length];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms`));
    }, ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "1mb" }));

  // 1. Follow-up question endpoint when user types silently for 6+ seconds
  app.post("/api/interviewer/follow-up", async (req, res) => {
    const { code = "", language = "python", transcript = [], previousQuestions = [] } = req.body || {};

    try {
      const ai = getAiClient();
      const recentTranscriptText = Array.isArray(transcript)
        ? transcript
            .slice(-6)
            .map((t: { speaker: string; text: string }) => `${t.speaker.toUpperCase()}: ${t.text}`)
            .join("\n")
        : "";

      const prompt = `You are a supportive yet rigorous Big Tech senior software engineer conducting a technical coding interview with an HBCU Computer Science student on the "Two Sum" problem.
The student has been typing code silently for over 6 seconds without speaking out loud.
Inspect their current ${language} code and recent spoken transcript, and ask ONE short, natural, spoken follow-up question (10 to 20 words max) that prompts them to vocalize their thought process about the exact lines they are writing, their time/space complexity, or a conditional check.

Avoid repeating these previous questions: ${JSON.stringify(previousQuestions)}

Current ${language} code:
\`\`\`${language}
${code}
\`\`\`

Recent transcript:
${recentTranscriptText || "(Candidate has not spoken yet while typing)"}`;

      const response = await withTimeout(
        ai.models.generateContent({
          model: "gemini-3.8-flash",
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                question: {
                  type: Type.STRING,
                  description: "A single conversational sentence under 20 words to be spoken aloud via TTS.",
                },
                focusArea: {
                  type: Type.STRING,
                  description: "Short 2-3 word label such as 'Hash Map Lookup', 'Time Complexity', or 'Conditional Check'.",
                },
              },
              required: ["question", "focusArea"],
            },
          },
        }),
        3500
      );

      const parsed = JSON.parse((response.text ?? "{}").trim());
      if (parsed && typeof parsed.question === "string" && parsed.question.trim().length > 0) {
        return res.json({
          question: parsed.question.trim(),
          focusArea: parsed.focusArea || "Live Code Check-In",
        });
      }
      return res.json(buildFallbackFollowUp(code, previousQuestions));
    } catch (error: any) {
      console.error("Gemini follow-up error or timeout, using smart code-aware fallback:", error?.message);
      return res.json(buildFallbackFollowUp(code, previousQuestions));
    }
  });

  // 2. Final Scorecard evaluation endpoint when user clicks Finish
  app.post("/api/interviewer/scorecard", async (req, res) => {
    const {
      code = "",
      language = "python",
      transcript = [],
      deadAirPercent = 0,
      fillerCount = 0,
      fillerBreakdown = {},
      totalDurationSec = 60,
    } = req.body || {};

    const userUtterances = Array.isArray(transcript)
      ? transcript.filter((t: { speaker: string }) => t.speaker === "candidate").map((t: { text: string }) => t.text)
      : [];
    const fullTranscriptText = Array.isArray(transcript)
      ? transcript.map((t: { timestamp: string; speaker: string; text: string }) => `[${t.timestamp}] ${t.speaker}: ${t.text}`).join("\n")
      : "";

    // Deterministic baseline heuristics in case transcript is very short or fallback is needed
    const combinedLower = userUtterances.join(" ").toLowerCase();
    const heuristicComplexity =
      /o\(n\)|o\(1\)|o\(n\^2\)|linear time|constant time|quadratic|time complexity|space complexity|big o/i.test(
        combinedLower
      );
    const heuristicTradeoffs =
      /brute force|nested loop|trade-off|tradeoff|versus|instead of|hash map|hashmap|dictionary|memory for speed|space for time|two pass|one pass/i.test(
        combinedLower
      );

    try {
      const ai = getAiClient();
      const prompt = `You are an elite technical interview coach for HBCU Computer Science students preparing for SWE internships and full-time roles.
Evaluate this candidate's "Two Sum" think-aloud coding interview session.

Session Telemetry:
- Duration: ${totalDurationSec} seconds
- Dead-Air Percentage: ${deadAirPercent}%
- Filler Word Count: ${fillerCount} (${JSON.stringify(fillerBreakdown)})

Candidate's Final ${language} Code:
\`\`\`${language}
${code}
\`\`\`

Full Interview Transcript:
${fullTranscriptText || "(No speech recorded during session)"}

Analyze:
1. Did the candidate explicitly state Time and/or Space Complexity in their spoken transcript? Provide a boolean and a concise 1-sentence evidence note.
2. Did the candidate discuss algorithmic trade-offs (e.g., comparing brute-force O(n^2) nested loops vs O(n) hash map / memory vs speed)? Provide a boolean and a concise 1-sentence evidence note.
3. Provide an overall communication readiness score (0-100) and a crisp 1-sentence executive summary.
4. Write 3 specific, actionable, encouraging coaching tips tailored directly to their code, their transcript quotes, dead-air (${deadAirPercent}%), and filler word usage (${fillerCount}).`;

      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              statedComplexity: {
                type: Type.BOOLEAN,
                description: "True if the candidate verbally stated time or space complexity.",
              },
              complexityEvidence: {
                type: Type.STRING,
                description: "1-sentence explanation of what complexity they stated or what was missed.",
              },
              discussedTradeoffs: {
                type: Type.BOOLEAN,
                description: "True if the candidate verbally discussed trade-offs between approaches.",
              },
              tradeoffsEvidence: {
                type: Type.STRING,
                description: "1-sentence explanation of the trade-offs they discussed or what they should have compared.",
              },
              overallScore: {
                type: Type.INTEGER,
                description: "Overall think-aloud interview score from 0 to 100.",
              },
              headlineVerdict: {
                type: Type.STRING,
                description: "Bold 1-sentence takeaway summarizing their technical communication.",
              },
              tips: {
                type: Type.ARRAY,
                description: "Exactly 3 specific coaching tips based on their code and transcript.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: {
                      type: Type.STRING,
                      description: "Short action-oriented title (3-6 words).",
                    },
                    category: {
                      type: Type.STRING,
                      description: "Category label e.g. 'Vocal Pacing', 'Complexity Callout', 'Code Walkthrough'.",
                    },
                    detail: {
                      type: Type.STRING,
                      description: "Specific 2-sentence tip referencing their actual code or speech patterns.",
                    },
                  },
                  required: ["title", "category", "detail"],
                },
              },
            },
            required: [
              "statedComplexity",
              "complexityEvidence",
              "discussedTradeoffs",
              "tradeoffsEvidence",
              "overallScore",
              "headlineVerdict",
              "tips",
            ],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim());
      if (parsed && Array.isArray(parsed.tips) && parsed.tips.length > 0) {
        return res.json({
          ...parsed,
          tips: parsed.tips.slice(0, 3),
        });
      }
      throw new Error("Incomplete JSON scorecard from model");
    } catch (error: any) {
      console.error("Gemini scorecard fallback triggered:", error?.message);
      const baseScore = Math.max(
        42,
        Math.min(
          96,
          85 -
            Math.max(0, deadAirPercent - 20) * 0.6 -
            Math.min(20, fillerCount * 2) +
            (heuristicComplexity ? 8 : -8) +
            (heuristicTradeoffs ? 7 : -7)
        )
      );

      return res.json({
        statedComplexity: heuristicComplexity,
        complexityEvidence: heuristicComplexity
          ? "You explicitly referenced Big-O runtime and memory bounds while walking through your solution."
          : "You wrote the implementation without verbally declaring the O(n) time and O(n) space complexity before finishing.",
        discussedTradeoffs: heuristicTradeoffs,
        tradeoffsEvidence: heuristicTradeoffs
          ? "You contrasted the O(n²) nested-loop baseline against trading O(n) extra hash map memory for O(1) lookups."
          : "State the brute-force O(n²) approach first so the interviewer hears why you are trading O(n) hash map space for speed.",
        overallScore: Math.round(baseScore),
        headlineVerdict:
          deadAirPercent <= 25 && heuristicComplexity
            ? "Strong technical narration with clear algorithmic reasoning and controlled vocal pacing."
            : "Solid coding foundation—Tighten up silent typing stretches and vocalize Big-O trade-offs upfront.",
        tips: [
          {
            title: "Narrate Intent Before Typing Blocks",
            category: "Dead-Air Control",
            detail: `Your session recorded ${deadAirPercent}% dead-air. Before writing your loop or dictionary assignment, state a 5-second headline like "Now I'll map each number to its index so I can check complements in O(1) time."`,
          },
          {
            title: "Anchor Every Data Structure to a Trade-Off",
            category: "Algorithmic Framing",
            detail: heuristicTradeoffs
              ? "You did a great job naming the hash map approach—take it one level further by mentioning hash collisions or memory overhead on massive inputs."
              : "Interviewers grade how you choose tools, not just syntax. Explicitly say: 'A nested loop takes O(n²) time, so I'm using a hash map to trade O(n) space for O(n) time.'",
          },
          {
            title: "Replace Filler Words With Tactical Pauses",
            category: "Executive Presence",
            detail: `We detected ${fillerCount} filler words during your walkthrough. When tracing edge cases like duplicate values in Two Sum, take a silent 1-second breath instead of saying "um" or "like."`,
          },
        ],
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`CodeSpeak server running on http://localhost:${PORT}`);
  });
}

startServer();
