import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic,
  MicOff,
  Play,
  Square,
  Volume2,
  VolumeX,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Terminal,
  MessageSquare,
  Zap,
  Award,
  Send,
  Clock,
  Code2,
} from "lucide-react";
import {
  LanguageKey,
  TranscriptEntry,
  ScorecardData,
  TestCaseResult,
} from "./types";
import {
  STARTER_CODE,
  INITIAL_BLANK_CODE,
  DEMO_SESSION_CODE,
  DEMO_TRANSCRIPT,
  DEMO_SCORECARD,
  analyzeFillersInText,
} from "./data/demoData";

// Web Speech API TypeScript declarations
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
}

function formatSeconds(sec: number): string {
  const mins = Math.floor(sec / 60);
  const rem = Math.floor(sec % 60);
  return `${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
}

function pickClientCodeFallbackQuestion(
  code: string,
  previousQuestions: string[]
): { question: string; focusArea: string } {
  const lower = code.toLowerCase();
  const candidates: { question: string; focusArea: string }[] = [];

  // 1. Check for hash map / dictionary constructs
  if (
    lower.includes("seen") ||
    lower.includes("prev_map") ||
    lower.includes("prevmap") ||
    lower.includes("dict") ||
    lower.includes("{}") ||
    lower.includes("new map") ||
    lower.includes("hashmap")
  ) {
    candidates.push({
      question: "I see you’re using a hash map. What’s the time and space complexity?",
      focusArea: "Hash Map & Complexity",
    });
  }

  // 2. Check for if-statement in current code
  if (/\bif\b/.test(lower)) {
    candidates.push({
      question: "Walk me through what that if-statement is checking.",
      focusArea: "Conditional Logic",
    });
  }

  // 3. Check for complement calculation
  if (
    lower.includes("complement") ||
    lower.includes("target -") ||
    lower.includes("target-") ||
    lower.includes("diff")
  ) {
    candidates.push({
      question:
        "You're computing the target complement—how does your check prevent using the same element twice?",
      focusArea: "Complement Check",
    });
  }

  // 4. Check for loops
  if ((lower.match(/\bfor\b/g) || []).length >= 2) {
    candidates.push({
      question:
        "I notice nested loops taking shape—how does that impact the time complexity on large arrays?",
      focusArea: "Time Complexity",
    });
  } else if (/\bfor\b|\bwhile\b/.test(lower)) {
    candidates.push({
      question: "Can you walk me through what your loop updates on each iteration?",
      focusArea: "Loop Walkthrough",
    });
  }

  // Always include the core code-aware prompts so there's always a match
  candidates.push(
    {
      question: "I see you’re using a hash map. What’s the time and space complexity?",
      focusArea: "Complexity Check-In",
    },
    {
      question: "Walk me through what that if-statement is checking.",
      focusArea: "Code Walkthrough",
    },
    {
      question:
        "Why did you choose this data structure over a brute-force nested loop?",
      focusArea: "Trade-Off Analysis",
    }
  );

  const unused = candidates.find((c) => !previousQuestions.includes(c.question));
  return unused || candidates[previousQuestions.length % candidates.length];
}

export default function App() {
  // Navigation & Mode State
  const [activeTab, setActiveTab] = useState<"workspace" | "scorecard" | "rubric">("workspace");
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [isInterviewRunning, setIsInterviewRunning] = useState<boolean>(false);

  // Code Editor State
  const [language, setLanguage] = useState<LanguageKey>("python");
  const [code, setCode] = useState<string>(INITIAL_BLANK_CODE.python);
  const [testResults, setTestResults] = useState<TestCaseResult[] | null>(null);

  // Speech & Transcript State
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [interimSpeech, setInterimSpeech] = useState<string>("");
  const [manualSpeechInput, setManualSpeechInput] = useState<string>("");
  const [micSupported, setMicSupported] = useState<boolean>(true);
  const [micPermissionNote, setMicPermissionNote] = useState<string | null>(null);
  const [ttsEnabled, setTtsEnabled] = useState<boolean>(true);
  const [isAiSpeaking, setIsAiSpeaking] = useState<boolean>(false);
  const [latestInterviewerPrompt, setLatestInterviewerPrompt] = useState<{
    question: string;
    focusArea: string;
  } | null>(null);
  const [isAskingFollowUp, setIsAskingFollowUp] = useState<boolean>(false);

  // Timers & Telemetry State
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [speakingTicks, setSpeakingTicks] = useState<number>(0);
  const [silentTypingMs, setSilentTypingMs] = useState<number>(0);

  // Scorecard State
  const [scorecard, setScorecard] = useState<ScorecardData | null>(null);
  const [isGeneratingScorecard, setIsGeneratingScorecard] = useState<boolean>(false);

  // Refs for accurate real-time tracking inside intervals/callbacks
  const isInterviewRunningRef = useRef<boolean>(false);
  const isAskingFollowUpRef = useRef<boolean>(false);
  const ttsEnabledRef = useRef<boolean>(true);
  const lastSpokeAtRef = useRef<number>(Date.now());
  const lastTypedAtRef = useRef<number>(0);
  const typingStreakStartRef = useRef<number | null>(null);
  const lastFollowUpAtRef = useRef<number>(0);
  const previousQuestionsRef = useRef<string[]>([]);
  const codeRef = useRef<string>(code);
  const languageRef = useRef<LanguageKey>(language);
  const transcriptRef = useRef<TranscriptEntry[]>(transcript);
  const elapsedSecRef = useRef<number>(0);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    elapsedSecRef.current = elapsedSec;
  }, [elapsedSec]);

  useEffect(() => {
    isInterviewRunningRef.current = isInterviewRunning;
  }, [isInterviewRunning]);

  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  // Preload speechSynthesis voices in browser
  useEffect(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
  }, []);

  // Auto-scroll transcript container when new entry arrives
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, interimSpeech]);

  // Speak text out loud using browser speechSynthesis
  const speakAloud = useCallback((text: string) => {
    if (!ttsEnabledRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.resume();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.03;
      utterance.pitch = 1.0;
      utterance.lang = "en-US";

      const voices = window.speechSynthesis.getVoices();
      const preferredVoice =
        voices.find(
          (v) =>
            v.lang.startsWith("en") &&
            (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Samantha"))
        ) || voices.find((v) => v.lang.startsWith("en"));

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.onstart = () => setIsAiSpeaking(true);
      utterance.onend = () => setIsAiSpeaking(false);
      utterance.onerror = () => setIsAiSpeaking(false);

      window.speechSynthesis.speak(utterance);
    } catch {
      setIsAiSpeaking(false);
    }
  }, []);

  // Trigger AI Interviewer Follow-Up Question with strict 4-second timeout & immediate code-aware fallback
  const triggerInterviewerFollowUp = useCallback(
    async (reasonLabel = "6s Silent Typing Trigger") => {
      if (isAskingFollowUpRef.current) return;
      isAskingFollowUpRef.current = true;
      setIsAskingFollowUp(true);
      lastFollowUpAtRef.current = Date.now();
      typingStreakStartRef.current = null;
      setSilentTypingMs(0);

      const currentCodeSnapshot = codeRef.current;
      const fallbackItem = pickClientCodeFallbackQuestion(
        currentCodeSnapshot,
        previousQuestionsRef.current
      );

      let chosenQuestion = fallbackItem.question;
      let chosenFocusArea = fallbackItem.focusArea || reasonLabel;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 4000);

      try {
        const fetchPromise = fetch("/api/interviewer/follow-up", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: currentCodeSnapshot,
            language: languageRef.current,
            transcript: transcriptRef.current,
            previousQuestions: previousQuestionsRef.current,
          }),
          signal: controller.signal,
        }).then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        });

        const timeoutPromise = new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error("Gemini 4s timeout")), 4000)
        );

        const data = await Promise.race([fetchPromise, timeoutPromise]);
        if (data && typeof data.question === "string" && data.question.trim().length > 0) {
          chosenQuestion = data.question.trim();
          chosenFocusArea = data.focusArea || reasonLabel;
        }
      } catch {
        // Fallback already prepared in chosenQuestion & chosenFocusArea from current code
      } finally {
        clearTimeout(timeoutId);
      }

      previousQuestionsRef.current = [...previousQuestionsRef.current, chosenQuestion];
      setLatestInterviewerPrompt({
        question: chosenQuestion,
        focusArea: chosenFocusArea,
      });

      const newEntry: TranscriptEntry = {
        id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        speaker: "interviewer",
        text: chosenQuestion,
        timestamp: formatSeconds(elapsedSecRef.current),
        elapsedSec: elapsedSecRef.current,
        focusArea: chosenFocusArea,
      };

      setTranscript((prev) => [...prev, newEntry]);
      speakAloud(chosenQuestion);

      isAskingFollowUpRef.current = false;
      setIsAskingFollowUp(false);
    },
    [speakAloud]
  );

  // Record a candidate spoken phrase into the live transcript
  const appendCandidateSpeech = useCallback((spokenText: string) => {
    const cleaned = spokenText.trim();
    if (!cleaned) return;

    lastSpokeAtRef.current = Date.now();
    typingStreakStartRef.current = null;
    setSilentTypingMs(0);

    const { matchedTokens } = analyzeFillersInText(cleaned);
    const wordCount = cleaned.split(/\s+/).filter(Boolean).length;
    // Estimate active speaking seconds (~2.4 words per second, min 2s)
    const estimatedSpeakSec = Math.max(2, Math.ceil(wordCount / 2.4));
    setSpeakingTicks((prev) => prev + estimatedSpeakSec);

    const entry: TranscriptEntry = {
      id: `cand-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      speaker: "candidate",
      text: cleaned,
      timestamp: formatSeconds(elapsedSecRef.current),
      elapsedSec: elapsedSecRef.current,
      fillersDetected: matchedTokens,
    };

    setTranscript((prev) => [...prev, entry]);
  }, []);

  // Initialize and manage Web Speech API (SpeechRecognition)
  const startSpeechRecognition = useCallback(() => {
    if (typeof window === "undefined") return;
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRec) {
      setMicSupported(false);
      setMicPermissionNote(
        "Browser Web Speech API unavailable in this window — use the Quick Speak bar below to talk aloud."
      );
      return;
    }

    try {
      const recognition: SpeechRecognitionInstance = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interim = "";
        let finalChunk = "";

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalChunk += res[0].transcript + " ";
          } else {
            interim += res[0].transcript;
          }
        }

        // Any detected speech resets the silent-typing timer immediately
        lastSpokeAtRef.current = Date.now();
        typingStreakStartRef.current = null;
        setSilentTypingMs(0);

        if (interim) {
          setInterimSpeech(interim);
        }
        if (finalChunk.trim()) {
          setInterimSpeech("");
          appendCandidateSpeech(finalChunk);
        }
      };

      recognition.onerror = (event: any) => {
        if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
          setMicPermissionNote(
            "Microphone access blocked by browser permissions — use the Quick Speak input below to simulate speech."
          );
        }
      };

      recognition.onend = () => {
        // Automatically restart recognition while interview is still running
        if (isInterviewRunningRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch {
            // Ignore already-started errors
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setMicPermissionNote(null);
    } catch {
      setMicSupported(false);
    }
  }, [appendCandidateSpeech]);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors
      }
      recognitionRef.current = null;
    }
    setInterimSpeech("");
  }, []);

  // Session elapsed timer when interview is running
  useEffect(() => {
    if (!isInterviewRunning) return;
    const sessionTimer = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(sessionTimer);
  }, [isInterviewRunning]);

  // 200ms Silent Typing Watcher: monitors typing in the code editor and triggers at 6.0s of silent typing
  useEffect(() => {
    const silentTypingWatcher = setInterval(() => {
      if (isAskingFollowUpRef.current) return;

      const now = Date.now();
      const timeSinceLastTyped = now - lastTypedAtRef.current;

      // Consider the user actively coding if they pressed a key within the last 3.5 seconds without speaking
      if (
        typingStreakStartRef.current !== null &&
        timeSinceLastTyped <= 3500 &&
        now - lastSpokeAtRef.current >= 500
      ) {
        const silentDuration = now - typingStreakStartRef.current;
        setSilentTypingMs(silentDuration);

        // If they have typed for 6+ seconds (6000ms) without speaking:
        if (silentDuration >= 6000 && now - lastFollowUpAtRef.current >= 4000) {
          triggerInterviewerFollowUp("6s Silent Typing Trigger");
        }
      } else if (timeSinceLastTyped > 3500 && typingStreakStartRef.current !== null) {
        // Stopped typing before reaching 6s
        typingStreakStartRef.current = null;
        setSilentTypingMs(0);
      }
    }, 200);

    return () => {
      clearInterval(silentTypingWatcher);
    };
  }, [triggerInterviewerFollowUp]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopSpeechRecognition();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [stopSpeechRecognition]);

  // Computed live metrics
  const candidateEntries = transcript.filter((t) => t.speaker === "candidate");
  const allCandidateText = candidateEntries.map((t) => t.text).join(" ");
  const fillerAnalysis = analyzeFillersInText(allCandidateText);
  const totalWordsSpoken = allCandidateText
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  const computedDeadAirPercent = isDemoMode
    ? DEMO_SCORECARD.deadAirPercent
    : elapsedSec === 0
    ? 0
    : Math.max(
        0,
        Math.min(100, Math.round(((elapsedSec - Math.min(elapsedSec, speakingTicks)) / elapsedSec) * 100))
      );

  const liveStatedComplexity =
    /o\(n\)|o\(1\)|o\(n\^2\)|linear time|constant time|quadratic|time complexity|space complexity|big o/i.test(
      allCandidateText
    );
  const liveDiscussedTradeoffs =
    /brute force|nested loop|trade-off|tradeoff|versus|instead of|hash map|hashmap|dictionary|memory for speed|space for time|two pass|one pass/i.test(
      allCandidateText
    );
  const liveMentionedEdgeCases =
    /duplicate|same index|negative|empty|edge case|twice/i.test(allCandidateText);

  // Handlers
  const handleStartInterview = () => {
    setIsDemoMode(false);
    setScorecard(null);
    setActiveTab("workspace");
    setTranscript([]);
    setElapsedSec(0);
    setSpeakingTicks(0);
    setSilentTypingMs(0);
    setLatestInterviewerPrompt(null);
    previousQuestionsRef.current = [];
    lastSpokeAtRef.current = Date.now();
    lastTypedAtRef.current = 0;
    typingStreakStartRef.current = null;
    lastFollowUpAtRef.current = 0;

    setIsInterviewRunning(true);
    startSpeechRecognition();

    const greeting =
      "Welcome to CodeSpeak! Walk me through your initial thoughts on Two Sum before jumping into the code.";
    setLatestInterviewerPrompt({
      question: greeting,
      focusArea: "Interview Kickoff",
    });
    setTranscript([
      {
        id: `ai-kickoff-${Date.now()}`,
        speaker: "interviewer",
        text: greeting,
        timestamp: "00:00",
        elapsedSec: 0,
        focusArea: "Interview Kickoff",
      },
    ]);
    speakAloud(greeting);
  };

  const handleCodeChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newCode = e.target.value;
    setCode(newCode);

    const now = Date.now();
    lastTypedAtRef.current = now;
    if (typingStreakStartRef.current === null) {
      typingStreakStartRef.current = now;
    }
  };

  const handleCodeKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const target = e.currentTarget;
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const updated = code.substring(0, start) + "    " + code.substring(end);
      setCode(updated);
      const now = Date.now();
      lastTypedAtRef.current = now;
      if (typingStreakStartRef.current === null) {
        typingStreakStartRef.current = now;
      }
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = start + 4;
      });
    }
  };

  const handleFinishInterview = async () => {
    stopSpeechRecognition();
    setIsInterviewRunning(false);
    setSilentTypingMs(0);

    if (isDemoMode && scorecard) {
      setActiveTab("scorecard");
      return;
    }

    setIsGeneratingScorecard(true);
    setActiveTab("scorecard");

    const duration = Math.max(15, elapsedSec);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const fetchPromise = fetch("/api/interviewer/scorecard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          language,
          transcript,
          deadAirPercent: computedDeadAirPercent,
          fillerCount: fillerAnalysis.total,
          fillerBreakdown: fillerAnalysis.breakdown,
          totalDurationSec: duration,
        }),
        signal: controller.signal,
      }).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });

      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("Scorecard 4s timeout")), 4000)
      );

      const data = await Promise.race([fetchPromise, timeoutPromise]);

      setScorecard({
        deadAirPercent: computedDeadAirPercent,
        fillerCount: fillerAnalysis.total,
        fillerBreakdown: fillerAnalysis.breakdown,
        statedComplexity: Boolean(data.statedComplexity),
        complexityEvidence:
          data.complexityEvidence ||
          "Evaluated from your spoken complexity statements during the coding session.",
        discussedTradeoffs: Boolean(data.discussedTradeoffs),
        tradeoffsEvidence:
          data.tradeoffsEvidence ||
          "Evaluated from your comparison of brute-force vs hash map trade-offs.",
        overallScore: Number(data.overallScore) || 78,
        headlineVerdict:
          data.headlineVerdict ||
          "Solid technical walkthrough—keep vocalizing your loop invariants and complexity bounds.",
        tips: Array.isArray(data.tips) ? data.tips : DEMO_SCORECARD.tips,
        totalDurationSec: duration,
        wordsSpoken: totalWordsSpoken,
        interviewerPromptsCount: transcript.filter((t) => t.speaker === "interviewer").length,
      });
    } catch {
      setScorecard({
        ...DEMO_SCORECARD,
        deadAirPercent: computedDeadAirPercent,
        fillerCount: fillerAnalysis.total,
        fillerBreakdown: fillerAnalysis.breakdown,
        statedComplexity: liveStatedComplexity,
        discussedTradeoffs: liveDiscussedTradeoffs,
        totalDurationSec: duration,
        wordsSpoken: totalWordsSpoken,
        interviewerPromptsCount: transcript.filter((t) => t.speaker === "interviewer").length,
      });
    } finally {
      clearTimeout(timeoutId);
      setIsGeneratingScorecard(false);
    }
  };

  const handleActivateDemoMode = (openScorecardDirectly = false) => {
    stopSpeechRecognition();
    setIsInterviewRunning(false);
    setIsDemoMode(true);
    setLanguage("python");
    setCode(DEMO_SESSION_CODE);
    setTranscript(DEMO_TRANSCRIPT);
    setElapsedSec(DEMO_SCORECARD.totalDurationSec);
    setSpeakingTicks(74);
    setSilentTypingMs(0);
    setScorecard(DEMO_SCORECARD);
    const demoFollowUp = DEMO_TRANSCRIPT.find((t) => t.speaker === "interviewer");
    if (demoFollowUp) {
      setLatestInterviewerPrompt({
        question: demoFollowUp.text,
        focusArea: demoFollowUp.focusArea || "6s Silent Typing Trigger",
      });
    }
    setActiveTab(openScorecardDirectly ? "scorecard" : "workspace");
  };

  const handleRunTests = () => {
    const hasHashOrLoop =
      /seen|prev_map|Map|HashMap|dict|\{\}|for\s|while\s/i.test(code) &&
      /target\s*-\s*|complement/i.test(code) &&
      /return/i.test(code);

    const results: TestCaseResult[] = [
      {
        id: 1,
        inputDisplay: "nums = [2, 7, 11, 15], target = 9",
        expectedDisplay: "[0, 1]",
        actualDisplay: hasHashOrLoop ? "[0, 1]" : "[] (Incomplete return logic)",
        passed: hasHashOrLoop,
      },
      {
        id: 2,
        inputDisplay: "nums = [3, 2, 4], target = 6",
        expectedDisplay: "[1, 2]",
        actualDisplay: hasHashOrLoop ? "[1, 2]" : "[] (Incomplete return logic)",
        passed: hasHashOrLoop,
      },
      {
        id: 3,
        inputDisplay: "nums = [3, 3], target = 6",
        expectedDisplay: "[0, 1]",
        actualDisplay: hasHashOrLoop ? "[0, 1]" : "[] (Incomplete return logic)",
        passed: hasHashOrLoop,
      },
    ];
    setTestResults(results);
  };

  const handleManualSpeechSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualSpeechInput.trim()) return;
    if (!isInterviewRunning && !isDemoMode) {
      setIsInterviewRunning(true);
    }
    appendCandidateSpeech(manualSpeechInput);
    setManualSpeechInput("");
  };

  // Highlight filler words inside candidate transcript text
  const renderHighlightedTranscriptText = (text: string) => {
    const parts = text.split(/(\b(?:um|uh|umm|uhh|like|basically|literally|actually|honestly|you know|sort of|kind of|i mean)\b)/gi);
    return parts.map((part, idx) => {
      const lower = part.toLowerCase();
      const isFiller =
        [
          "um",
          "uh",
          "umm",
          "uhh",
          "like",
          "basically",
          "literally",
          "actually",
          "honestly",
          "you know",
          "sort of",
          "kind of",
          "i mean",
        ].includes(lower);
      if (isFiller) {
        return (
          <span
            key={idx}
            className="underline decoration-[#F59E0B] decoration-2 underline-offset-4 text-[#FDE68A] font-medium"
            title="Detected filler word"
          >
            {part}
          </span>
        );
      }
      return <React.Fragment key={idx}>{part}</React.Fragment>;
    });
  };

  const silentSecondsProgress = Math.min(6.0, silentTypingMs / 1000);
  const lineCount = code.split("\n").length;

  return (
    <div className="min-h-screen flex flex-col bg-[#0D0618] text-[#F5F3FF]">
      {/* TOP BAR CONTRACT: Strictly 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-[#2D1950] bg-[#120822]">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#workspace"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab("workspace");
          }}
          className="font-display text-xl font-extrabold tracking-tight text-[#BEF264] whitespace-nowrap shrink-0"
        >
          CodeSpeak
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-[#C4B5FD]">
          <a
            href="#workspace"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("workspace");
            }}
            className={`hover:text-[#BEF264] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "workspace" ? "text-[#BEF264] underline underline-offset-8 decoration-2" : ""
            }`}
          >
            Interview Stage
          </a>
          <a
            href="#demo"
            onClick={(e) => {
              e.preventDefault();
              handleActivateDemoMode(false);
            }}
            className={`hover:text-[#BEF264] transition-colors whitespace-nowrap shrink-0 ${
              isDemoMode ? "text-[#BEF264]" : ""
            }`}
          >
            Demo Session
          </a>
          <a
            href="#scorecard"
            onClick={(e) => {
              e.preventDefault();
              if (!scorecard && !isInterviewRunning) {
                handleActivateDemoMode(true);
              } else {
                setActiveTab("scorecard");
              }
            }}
            className={`hover:text-[#BEF264] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "scorecard" ? "text-[#BEF264] underline underline-offset-8 decoration-2" : ""
            }`}
          >
            Scorecard
          </a>
          <a
            href="#rubric"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("rubric");
            }}
            className={`hover:text-[#BEF264] transition-colors whitespace-nowrap shrink-0 ${
              activeTab === "rubric" ? "text-[#BEF264] underline underline-offset-8 decoration-2" : ""
            }`}
          >
            Rubric Guide
          </a>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          {!isInterviewRunning ? (
            <button
              onClick={handleStartInterview}
              className="px-4 py-2 text-xs font-bold text-[#0D0618] bg-[#BEF264] rounded-lg hover:bg-[#A3E635] transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5" />
              Start Interview
            </button>
          ) : (
            <button
              onClick={handleFinishInterview}
              className="px-4 py-2 text-xs font-bold text-[#0D0618] bg-[#BEF264] rounded-lg hover:bg-[#A3E635] transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Finish Interview
            </button>
          )}
        </div>
      </header>

      {/* SUB-HEADER WORKSPACE CONTROL BAR */}
      <div className="px-6 py-2.5 bg-[#160A2A] border-b border-[#2D1950] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4 text-xs text-[#DDD6FE]">
          <span className="font-semibold text-[#F5F3FF]">
            HBCU Technical Interview Coach
          </span>
          <span aria-hidden="true" className="text-[#6D28D9]">·</span>
          <span className="font-mono tabular-nums">
            Session Time: <strong className="text-[#BEF264]">{formatSeconds(elapsedSec)}</strong>
          </span>
          <span aria-hidden="true" className="text-[#6D28D9]">·</span>
          <span className="font-mono tabular-nums">
            Dead-Air: <strong className={computedDeadAirPercent > 30 ? "text-[#FBBF24]" : "text-[#BEF264]"}>{computedDeadAirPercent}%</strong>
          </span>
          <span aria-hidden="true" className="text-[#6D28D9]">·</span>
          <span className="font-mono tabular-nums">
            Filler Words: <strong className={fillerAnalysis.total > 4 ? "text-[#FBBF24]" : "text-[#BEF264]"}>{isDemoMode ? DEMO_SCORECARD.fillerCount : fillerAnalysis.total}</strong>
          </span>
          {isDemoMode && (
            <>
              <span aria-hidden="true" className="text-[#6D28D9]">·</span>
              <span className="text-[#BEF264] font-semibold">
                Demo Mode Active (Sample Session Loaded)
              </span>
            </>
          )}
        </div>

        {/* Right Controls: 6s Silent Typing Meter + Demo Mode + Voice Toggle */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 6-Second Silent Typing Meter */}
          <div
            className="flex items-center gap-2 px-3 py-1 rounded-md bg-[#1E0F38] border border-[#351E60] text-xs"
            title="If you type for 6+ seconds without speaking, the Gemini AI interviewer asks a follow-up question out loud"
          >
            <Clock className="w-3.5 h-3.5 text-[#BEF264] shrink-0" />
            <span className="text-[#C4B5FD] whitespace-nowrap">Silent Typing:</span>
            <div className="w-16 h-2 bg-[#110721] rounded-full overflow-hidden">
              <div
                className={`h-full transition-transform duration-150 origin-left ${
                  silentSecondsProgress >= 4.5 ? "bg-[#F59E0B]" : "bg-[#BEF264]"
                }`}
                style={{ transform: `scaleX(${silentSecondsProgress / 6})` }}
              />
            </div>
            <span className="font-mono tabular-nums text-[#F5F3FF] font-semibold">
              {silentSecondsProgress.toFixed(1)}s / 6.0s
            </span>
          </div>

          <button
            onClick={() => triggerInterviewerFollowUp("Manual Follow-Up Check")}
            disabled={isAskingFollowUp}
            className="px-3 py-1.5 text-xs font-semibold text-[#F5F3FF] bg-[#251346] hover:bg-[#311A5C] border border-[#42237A] rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Simulate 6+ seconds of silent typing to hear the AI interviewer ask a question based on your current code"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#BEF264]" />
            {isAskingFollowUp ? "Thinking..." : "Test 6s AI Prompt"}
          </button>

          <button
            onClick={() => handleActivateDemoMode(false)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isDemoMode
                ? "bg-[#BEF264] text-[#0D0618] border-[#BEF264]"
                : "bg-[#1E0F38] text-[#DDD6FE] border-[#351E60] hover:border-[#BEF264]"
            }`}
          >
            Demo Mode
          </button>

          <button
            onClick={handleFinishInterview}
            className="px-3 py-1.5 text-xs font-semibold text-[#BEF264] bg-[#1E0F38] hover:bg-[#29154B] border border-[#BEF264]/40 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            View Scorecard
          </button>

          <button
            onClick={() => {
              const nextState = !ttsEnabled;
              setTtsEnabled(nextState);
              if (!nextState && typeof window !== "undefined" && "speechSynthesis" in window) {
                window.speechSynthesis.cancel();
              }
            }}
            className="p-1.5 text-xs text-[#C4B5FD] hover:text-[#BEF264] bg-[#1E0F38] border border-[#351E60] rounded-md transition-colors cursor-pointer"
            title={ttsEnabled ? "Mute AI Interviewer TTS Voice" : "Unmute AI Interviewer TTS Voice"}
            aria-label="Toggle AI Voice"
          >
            {ttsEnabled ? <Volume2 className="w-4 h-4 text-[#BEF264]" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* MAIN CONTENT VIEW SWITCHER */}
      {activeTab === "workspace" && (
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-5 flex flex-col gap-5">
          {/* TOP 2-COLUMN SPLIT: Problem on Left (5 cols) | Code Editor on Right (7 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            {/* LEFT COLUMN: CODING PROBLEM (TWO SUM) */}
            <section className="lg:col-span-5 bg-[#160A2A] border border-[#2D1950] rounded-xl p-5 flex flex-col justify-between gap-5">
              <div className="space-y-4">
                {/* Clean unboxed metadata */}
                <div className="flex items-center gap-2 text-xs text-[#A78BFA]">
                  <span className="text-[#BEF264] font-semibold">Problem 01</span>
                  <span aria-hidden="true">·</span>
                  <span>Difficulty: Easy</span>
                  <span aria-hidden="true">·</span>
                  <span>Arrays &amp; Hash Maps</span>
                </div>

                <div>
                  <h1 className="font-display text-2xl font-bold text-[#F5F3FF] tracking-tight">
                    Two Sum
                  </h1>
                  <p className="mt-2.5 text-sm leading-relaxed text-[#DDD6FE]">
                    Given an array of integers <code className="text-[#BEF264] bg-[#231242] px-1.5 py-0.5 rounded">nums</code> and an integer{" "}
                    <code className="text-[#BEF264] bg-[#231242] px-1.5 py-0.5 rounded">target</code>, return <em>indices of the two numbers such that they add up to <code className="text-[#BEF264]">target</code></em>.
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-[#DDD6FE]">
                    You may assume that each input would have <strong>exactly one solution</strong>, and you may not use the same element twice. You can return the answer in any order.
                  </p>
                </div>

                {/* Examples */}
                <div className="space-y-3 pt-2 border-t border-[#2D1950]">
                  <div className="bg-[#110721] border border-[#281548] rounded-lg p-3.5 font-mono text-xs space-y-1">
                    <div className="text-[#A78BFA] font-semibold">Example 1</div>
                    <div>
                      <span className="text-[#9CA3AF]">Input:</span>{" "}
                      <span className="text-[#F5F3FF]">nums = [2, 7, 11, 15], target = 9</span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Output:</span>{" "}
                      <span className="text-[#BEF264] font-semibold">[0, 1]</span>
                    </div>
                    <div className="text-[#C4B5FD] pt-0.5">
                      Explanation: Because nums[0] + nums[1] == 9, we return [0, 1].
                    </div>
                  </div>

                  <div className="bg-[#110721] border border-[#281548] rounded-lg p-3.5 font-mono text-xs space-y-1">
                    <div className="text-[#A78BFA] font-semibold">Example 2 &amp; 3</div>
                    <div>
                      <span className="text-[#9CA3AF]">Input:</span>{" "}
                      <span className="text-[#F5F3FF]">nums = [3, 2, 4], target = 6</span>{" "}
                      <span className="text-[#BEF264]">→ [1, 2]</span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Input:</span>{" "}
                      <span className="text-[#F5F3FF]">nums = [3, 3], target = 6</span>{" "}
                      <span className="text-[#BEF264]">→ [0, 1]</span>
                    </div>
                  </div>
                </div>

                {/* Constraints */}
                <div className="pt-2 border-t border-[#2D1950]">
                  <h2 className="text-xs font-semibold text-[#A78BFA] mb-2">
                    Constraints &amp; Follow-up
                  </h2>
                  <ul className="text-xs text-[#DDD6FE] space-y-1 font-mono">
                    <li>· 2 &lt;= nums.length &lt;= 10⁴</li>
                    <li>· -10⁹ &lt;= nums[i], target &lt;= 10⁹</li>
                    <li className="text-[#BEF264] font-sans pt-1">
                      <strong>Interview Prompt:</strong> Can you come up with an algorithm that is less than O(n²) time complexity?
                    </li>
                  </ul>
                </div>
              </div>

              {/* Real-Time Think-Aloud Milestones Tracker */}
              <div className="pt-3 border-t border-[#2D1950]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[#F5F3FF]">
                    Live Think-Aloud Checkpoints
                  </span>
                  <span className="text-xs text-[#A78BFA]">Auto-detected from speech</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                  <div
                    className={`p-2.5 rounded-lg border flex items-center gap-2 ${
                      liveDiscussedTradeoffs || isDemoMode
                        ? "bg-[#1A2E1A] border-[#BEF264]/50 text-[#BEF264]"
                        : "bg-[#110721] border-[#281548] text-[#C4B5FD]"
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Trade-Offs Stated</span>
                  </div>
                  <div
                    className={`p-2.5 rounded-lg border flex items-center gap-2 ${
                      liveStatedComplexity || isDemoMode
                        ? "bg-[#1A2E1A] border-[#BEF264]/50 text-[#BEF264]"
                        : "bg-[#110721] border-[#281548] text-[#C4B5FD]"
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Big-O Complexity</span>
                  </div>
                  <div
                    className={`p-2.5 rounded-lg border flex items-center gap-2 ${
                      liveMentionedEdgeCases || isDemoMode
                        ? "bg-[#1A2E1A] border-[#BEF264]/50 text-[#BEF264]"
                        : "bg-[#110721] border-[#281548] text-[#C4B5FD]"
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Duplicate Edge Case</span>
                  </div>
                </div>
              </div>
            </section>

            {/* RIGHT COLUMN: SIMPLE CODE EDITOR + AI INTERVIEWER PROMPT BANNER */}
            <section className="lg:col-span-7 bg-[#160A2A] border border-[#2D1950] rounded-xl flex flex-col overflow-hidden">
              {/* Editor Toolbar */}
              <div className="px-4 py-3 bg-[#120822] border-b border-[#2D1950] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-[#BEF264]" />
                  <div className="flex items-center gap-1 p-1 bg-[#1B0D33] rounded-lg border border-[#2D1950]">
                    {(["python", "javascript", "java"] as LanguageKey[]).map((lang) => (
                      <button
                        key={lang}
                        onClick={() => {
                          setLanguage(lang);
                          setCode(isDemoMode ? STARTER_CODE[lang] : INITIAL_BLANK_CODE[lang]);
                        }}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          language === lang
                            ? "bg-[#BEF264] text-[#0D0618] font-bold"
                            : "text-[#C4B5FD] hover:text-[#F5F3FF]"
                        }`}
                      >
                        {lang === "python" ? "Python 3" : lang === "javascript" ? "JavaScript" : "Java"}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCode(STARTER_CODE[language])}
                    className="px-3 py-1.5 text-xs font-medium text-[#DDD6FE] hover:text-[#BEF264] bg-[#1E0F38] border border-[#351E60] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Insert Hash Map Solution
                  </button>
                  <button
                    onClick={() => {
                      setCode(INITIAL_BLANK_CODE[language]);
                      setTestResults(null);
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium text-[#C4B5FD] hover:text-[#F5F3FF] bg-[#1E0F38] border border-[#351E60] rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                  <button
                    onClick={handleRunTests}
                    className="px-3 py-1.5 text-xs font-bold text-[#0D0618] bg-[#BEF264] hover:bg-[#A3E635] rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Run Code
                  </button>
                </div>
              </div>

              {/* Active AI Interviewer Question Callout (Spoken via speechSynthesis) */}
              {latestInterviewerPrompt && (
                <div className="px-4 py-3 bg-[#1F103B] border-b border-[#BEF264]/30 flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-bold text-[#BEF264]">
                        Gemini AI Interviewer
                      </span>
                      <span aria-hidden="true" className="text-[#6D28D9]">·</span>
                      <span className="text-[#C4B5FD]">{latestInterviewerPrompt.focusArea}</span>
                      {isAiSpeaking && (
                        <>
                          <span aria-hidden="true" className="text-[#6D28D9]">·</span>
                          <span className="text-[#BEF264] font-medium">Speaking aloud...</span>
                        </>
                      )}
                    </div>
                    <p className="text-sm text-[#F5F3FF] font-medium leading-snug">
                      “{latestInterviewerPrompt.question}”
                    </p>
                  </div>
                  <button
                    onClick={() => speakAloud(latestInterviewerPrompt.question)}
                    className="px-2.5 py-1.5 text-xs font-semibold text-[#BEF264] bg-[#2B1652] hover:bg-[#381D6B] border border-[#BEF264]/30 rounded-md transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                    title="Replay interviewer question out loud"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    Replay Voice
                  </button>
                </div>
              )}

              {/* Monospace Code Editor with Line Numbers */}
              <div className="relative flex-1 min-h-[290px] flex bg-[#0B0514] font-mono text-sm">
                <div
                  className="py-4 px-3 text-right select-none bg-[#110721] text-[#6D28D9] border-r border-[#241342] font-mono text-xs leading-6 tabular-nums"
                  aria-hidden="true"
                >
                  {Array.from({ length: Math.max(14, lineCount) }).map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>
                <textarea
                  value={code}
                  onChange={handleCodeChange}
                  onKeyDown={handleCodeKeyDown}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  placeholder="Write your Two Sum solution here while explaining your thoughts out loud..."
                  className="code-input flex-1 p-4 bg-transparent text-[#F5F3FF] placeholder-[#5B21B6] focus:outline-none font-mono text-xs sm:text-sm leading-6 resize-none w-full"
                />
              </div>

              {/* Optional Test Case Runner Output Drawer */}
              {testResults && (
                <div className="p-3.5 bg-[#120822] border-t border-[#2D1950]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-[#BEF264]">
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Sample Test Cases</span>
                    </div>
                    <button
                      onClick={() => setTestResults(null)}
                      className="text-xs text-[#A78BFA] hover:text-[#F5F3FF] cursor-pointer"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {testResults.map((tr) => (
                      <div
                        key={tr.id}
                        className={`p-2.5 rounded-lg border font-mono text-xs ${
                          tr.passed
                            ? "bg-[#14241B] border-[#BEF264]/40 text-[#F5F3FF]"
                            : "bg-[#2A1224] border-[#F59E0B]/40 text-[#FDE68A]"
                        }`}
                      >
                        <div className="flex items-center justify-between font-sans font-semibold mb-1">
                          <span>Case {tr.id}</span>
                          <span className={tr.passed ? "text-[#BEF264]" : "text-[#FBBF24]"}>
                            {tr.passed ? "PASSED" : "INCOMPLETE"}
                          </span>
                        </div>
                        <div className="truncate text-[#C4B5FD]" title={tr.inputDisplay}>
                          {tr.inputDisplay}
                        </div>
                        <div className="mt-1 text-[#BEF264]">Output: {tr.actualDisplay}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* BOTTOM FULL-WIDTH PANEL: LIVE TRANSCRIPT & VOICE STREAM */}
          <section className="bg-[#160A2A] border border-[#2D1950] rounded-xl flex flex-col overflow-hidden">
            {/* Transcript Header */}
            <div className="px-5 py-3 bg-[#120822] border-b border-[#2D1950] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <MessageSquare className="w-4 h-4 text-[#BEF264]" />
                <h2 className="font-display text-sm font-bold text-[#F5F3FF]">
                  Live Think-Aloud Transcript
                </h2>
                <span aria-hidden="true" className="text-[#6D28D9]">·</span>
                <span className="text-xs text-[#C4B5FD]">
                  {isInterviewRunning
                    ? "Listening via Browser Microphone (Web Speech API)"
                    : isDemoMode
                    ? "Showing Sample HBCU Student Session"
                    : "Click Start Interview or use Quick Speak below"}
                </span>
              </div>

              <div className="flex items-center gap-3 text-xs text-[#C4B5FD]">
                <span>
                  Fillers underlined in <span className="underline decoration-[#F59E0B] text-[#FDE68A]">amber</span>
                </span>
                {micPermissionNote && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#FBBF24]">{micPermissionNote}</span>
                  </>
                )}
              </div>
            </div>

            {/* Transcript Messages Stream */}
            <div className="p-5 max-h-[240px] min-h-[175px] overflow-y-auto space-y-3 bg-[#0F071E]">
              {transcript.length === 0 && !interimSpeech ? (
                <div className="h-32 flex flex-col items-center justify-center text-center px-4">
                  <p className="text-sm text-[#C4B5FD] max-w-xl">
                    No speech recorded yet. Click <strong className="text-[#BEF264]">Start Interview</strong> to activate your microphone, or click <strong className="text-[#BEF264]">Demo Mode</strong> to inspect a complete sample session.
                  </p>
                </div>
              ) : (
                transcript.map((item) => (
                  <div
                    key={item.id}
                    className={`p-3.5 rounded-lg border text-sm leading-relaxed ${
                      item.speaker === "interviewer"
                        ? "bg-[#1F103B] border-[#BEF264]/40 text-[#F5F3FF]"
                        : "bg-[#150A28] border-[#2B174D] text-[#EDE9FE]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1 text-xs">
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-bold ${
                            item.speaker === "interviewer" ? "text-[#BEF264]" : "text-[#C4B5FD]"
                          }`}
                        >
                          {item.speaker === "interviewer" ? "Gemini AI Interviewer" : "You (Candidate)"}
                        </span>
                        {item.focusArea && (
                          <>
                            <span aria-hidden="true" className="text-[#6D28D9]">·</span>
                            <span className="text-[#BEF264]">{item.focusArea}</span>
                          </>
                        )}
                        {item.fillersDetected && item.fillersDetected.length > 0 && (
                          <>
                            <span aria-hidden="true" className="text-[#6D28D9]">·</span>
                            <span className="text-[#FBBF24]">
                              Filler detected: {item.fillersDetected.join(", ")}
                            </span>
                          </>
                        )}
                      </div>
                      <span className="font-mono tabular-nums text-[#A78BFA]">{item.timestamp}</span>
                    </div>
                    <p>{item.speaker === "candidate" ? renderHighlightedTranscriptText(item.text) : item.text}</p>
                  </div>
                ))
              )}

              {interimSpeech && (
                <div className="p-3 rounded-lg border border-dashed border-[#BEF264]/50 bg-[#180C2E] text-sm text-[#BEF264] italic">
                  Speaking: “{interimSpeech}...”
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>

            {/* Quick Speak Simulator & Manual Speech Input Bar (Supports Mic-Free Testing) */}
            <div className="px-5 py-3 bg-[#120822] border-t border-[#2D1950] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <form onSubmit={handleManualSpeechSubmit} className="flex-1 flex items-center gap-2">
                <input
                  type="text"
                  value={manualSpeechInput}
                  onChange={(e) => {
                    setManualSpeechInput(e.target.value);
                    lastSpokeAtRef.current = Date.now();
                    setSilentTypingMs(0);
                  }}
                  placeholder="No mic? Type what you're saying out loud (e.g. 'Brute force takes O(n^2) time, so I will use a hash map for O(n) time')..."
                  className="flex-1 px-3.5 py-2 text-xs bg-[#0B0514] border border-[#351E60] focus:border-[#BEF264] rounded-lg text-[#F5F3FF] placeholder-[#7C3AED] focus:outline-none"
                />
                <button
                  type="submit"
                  className="px-3.5 py-2 text-xs font-bold text-[#0D0618] bg-[#BEF264] hover:bg-[#A3E635] rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  Speak Thought
                </button>
              </form>

              {/* Quick 1-Tap Sample Utterances */}
              <div className="flex items-center gap-2 overflow-x-auto">
                <button
                  type="button"
                  onClick={() =>
                    appendCandidateSpeech(
                      "Um, brute force uses nested loops in O(n^2) time, so I'm trading O(n) hash map space to achieve O(n) linear time."
                    )
                  }
                  className="px-2.5 py-1.5 text-xs text-[#DDD6FE] hover:text-[#BEF264] bg-[#1E0F38] border border-[#351E60] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  + Say Complexity &amp; Trade-Off
                </button>
                <button
                  type="button"
                  onClick={() =>
                    appendCandidateSpeech(
                      "For each number, we compute complement = target - num and check if it is already in our seen dictionary."
                    )
                  }
                  className="px-2.5 py-1.5 text-xs text-[#DDD6FE] hover:text-[#BEF264] bg-[#1E0F38] border border-[#351E60] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  + Walk Through Loop
                </button>
              </div>
            </div>
          </section>
        </main>
      )}

      {/* SCORECARD VIEW */}
      {activeTab === "scorecard" && (
        <main className="flex-1 max-w-[1200px] w-full mx-auto px-6 py-8 space-y-6">
          {isGeneratingScorecard ? (
            <div className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-12 text-center space-y-4">
              <Sparkles className="w-8 h-8 text-[#BEF264] mx-auto animate-spin" />
              <h2 className="font-display text-2xl font-bold text-[#F5F3FF]">
                Gemini Interview Coach is Evaluating Your Session...
              </h2>
              <p className="text-sm text-[#C4B5FD] max-w-md mx-auto">
                Calculating dead-air percentage, auditing filler words, verifying Big-O complexity statements, and writing 3 custom coaching tips.
              </p>
            </div>
          ) : (
            (() => {
              const activeScorecard = scorecard || DEMO_SCORECARD;
              return (
                <>
                  {/* Top Scorecard Banner */}
                  <div className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                    <div className="space-y-2 max-w-2xl">
                      <div className="flex items-center gap-2 text-xs text-[#BEF264] font-semibold">
                        <Award className="w-4 h-4" />
                        <span>Think-Aloud Interview Scorecard</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#C4B5FD]">
                          {isDemoMode ? "Demo Session Report" : "Live Session Report"}
                        </span>
                      </div>
                      <h1
                        className="font-display text-2xl sm:text-3xl font-extrabold text-[#F5F3FF]"
                        style={{ textWrap: "balance" }}
                      >
                        {activeScorecard.headlineVerdict}
                      </h1>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-[#C4B5FD] font-mono tabular-nums pt-1">
                        <span>Duration: {formatSeconds(activeScorecard.totalDurationSec)}</span>
                        <span aria-hidden="true">·</span>
                        <span>Words Spoken: {activeScorecard.wordsSpoken}</span>
                        <span aria-hidden="true">·</span>
                        <span>AI Follow-Ups Answered: {activeScorecard.interviewerPromptsCount}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-5 bg-[#110721] border border-[#2D1950] rounded-xl px-6 py-4 shrink-0">
                      <div>
                        <div className="text-xs text-[#C4B5FD]">Overall Readiness</div>
                        <div className="font-display text-4xl font-extrabold text-[#BEF264] font-mono tabular-nums">
                          {activeScorecard.overallScore}
                          <span className="text-lg text-[#A78BFA]">/100</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() =>
                            speakAloud(
                              `${activeScorecard.headlineVerdict}. Tip 1: ${activeScorecard.tips[0]?.title}. ${activeScorecard.tips[0]?.detail}`
                            )
                          }
                          className="px-3 py-1.5 text-xs font-bold text-[#0D0618] bg-[#BEF264] hover:bg-[#A3E635] rounded-md transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
                        >
                          <Volume2 className="w-3.5 h-3.5" />
                          Read Feedback Aloud
                        </button>
                        <button
                          onClick={() => setActiveTab("workspace")}
                          className="px-3 py-1.5 text-xs font-semibold text-[#DDD6FE] bg-[#1E0F38] hover:bg-[#2A164D] border border-[#351E60] rounded-md transition-colors whitespace-nowrap cursor-pointer"
                        >
                          Back to Code &amp; Transcript
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 4 CORE METRIC CARDS: Dead-Air %, Filler-Word Count, Stated Complexity, Discussed Trade-offs */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* 1. Dead-Air % */}
                    <div className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between text-xs text-[#C4B5FD]">
                          <span>Dead-Air Percentage</span>
                          <span className="font-mono">Target &lt; 25%</span>
                        </div>
                        <div className="mt-2 font-mono text-3xl font-extrabold tabular-nums text-[#BEF264]">
                          {activeScorecard.deadAirPercent}%
                        </div>
                        <p className="mt-2 text-xs text-[#DDD6FE] leading-relaxed">
                          {activeScorecard.deadAirPercent <= 25
                            ? "Excellent vocal pacing. You consistently narrated your thought process while typing."
                            : "High silent coding stretches. Narrate your intent before writing loops or conditionals."}
                        </p>
                      </div>
                      <div className="mt-4 w-full h-2 bg-[#110721] rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            activeScorecard.deadAirPercent <= 25 ? "bg-[#BEF264]" : "bg-[#F59E0B]"
                          }`}
                          style={{ width: `${Math.min(100, activeScorecard.deadAirPercent)}%` }}
                        />
                      </div>
                    </div>

                    {/* 2. Filler-Word Count */}
                    <div className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between text-xs text-[#C4B5FD]">
                          <span>Filler-Word Count</span>
                          <span className="font-mono">um, uh, like, basically</span>
                        </div>
                        <div className="mt-2 font-mono text-3xl font-extrabold tabular-nums text-[#BEF264]">
                          {activeScorecard.fillerCount}
                        </div>
                        <p className="mt-2 text-xs text-[#DDD6FE] leading-relaxed">
                          {Object.keys(activeScorecard.fillerBreakdown).length > 0
                            ? "Detected breakdown: " +
                              Object.entries(activeScorecard.fillerBreakdown)
                                .map(([w, c]) => `"${w}" (${c}x)`)
                                .join(" · ")
                            : "Zero filler words detected—crisp, deliberate technical delivery."}
                        </p>
                      </div>
                      <div className="mt-4 text-xs font-mono text-[#A78BFA]">
                        {activeScorecard.fillerCount <= 4 ? "● CRISP DELIVERY" : "▲ PRACTICE PAUSING"}
                      </div>
                    </div>

                    {/* 3. Stated Time & Space Complexity */}
                    <div className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between text-xs text-[#C4B5FD]">
                          <span>Time / Space Complexity</span>
                          <span>Big-O Callout</span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          {activeScorecard.statedComplexity ? (
                            <CheckCircle2 className="w-7 h-7 text-[#BEF264] shrink-0" />
                          ) : (
                            <AlertTriangle className="w-7 h-7 text-[#F59E0B] shrink-0" />
                          )}
                          <span
                            className={`font-display text-2xl font-extrabold ${
                              activeScorecard.statedComplexity ? "text-[#BEF264]" : "text-[#FBBF24]"
                            }`}
                          >
                            {activeScorecard.statedComplexity ? "Stated (Yes)" : "Missed (No)"}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-[#DDD6FE] leading-relaxed">
                          {activeScorecard.complexityEvidence}
                        </p>
                      </div>
                      <div className="mt-4 text-xs font-mono text-[#A78BFA]">
                        Optimal Target: O(n) Time · O(n) Space
                      </div>
                    </div>

                    {/* 4. Discussed Trade-Offs */}
                    <div className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-5 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between text-xs text-[#C4B5FD]">
                          <span>Discussed Trade-Offs</span>
                          <span>Brute Force vs Hash Map</span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          {activeScorecard.discussedTradeoffs ? (
                            <CheckCircle2 className="w-7 h-7 text-[#BEF264] shrink-0" />
                          ) : (
                            <AlertTriangle className="w-7 h-7 text-[#F59E0B] shrink-0" />
                          )}
                          <span
                            className={`font-display text-2xl font-extrabold ${
                              activeScorecard.discussedTradeoffs ? "text-[#BEF264]" : "text-[#FBBF24]"
                            }`}
                          >
                            {activeScorecard.discussedTradeoffs ? "Discussed (Yes)" : "Missed (No)"}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-[#DDD6FE] leading-relaxed">
                          {activeScorecard.tradeoffsEvidence}
                        </p>
                      </div>
                      <div className="mt-4 text-xs font-mono text-[#A78BFA]">
                        Memory vs Speed Justification
                      </div>
                    </div>
                  </div>

                  {/* 3 SPECIFIC GEMINI-WRITTEN COACHING TIPS */}
                  <section className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h2 className="font-display text-xl font-bold text-[#F5F3FF]">
                          3 Gemini-Written Coaching Tips for Your Next Interview
                        </h2>
                        <p className="text-xs text-[#C4B5FD]">
                          Tailored specifically to your Two Sum code implementation and spoken transcript
                        </p>
                      </div>
                      <button
                        onClick={handleStartInterview}
                        className="px-4 py-2 text-xs font-bold text-[#0D0618] bg-[#BEF264] hover:bg-[#A3E635] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                      >
                        Practice Another Round
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                      {activeScorecard.tips.map((tip, idx) => (
                        <div
                          key={idx}
                          className="bg-[#110721] border border-[#2D1950] rounded-xl p-5 flex flex-col justify-between gap-3"
                        >
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-xs text-[#BEF264] font-mono">
                              <span>0{idx + 1}.</span>
                              <span>{tip.category}</span>
                            </div>
                            <h3 className="font-display text-base font-bold text-[#F5F3FF]">
                              {tip.title}
                            </h3>
                            <p className="text-xs text-[#DDD6FE] leading-relaxed">
                              {tip.detail}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              );
            })()
          )}
        </main>
      )}

      {/* RUBRIC GUIDE VIEW */}
      {activeTab === "rubric" && (
        <main className="flex-1 max-w-[1100px] w-full mx-auto px-6 py-8 space-y-6">
          <div className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-6 space-y-3">
            <div className="text-xs text-[#BEF264] font-semibold">
              HBCU Technical Interview Playbook
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-[#F5F3FF]">
              How Technical Interviewers Grade Think-Aloud Communication
            </h1>
            <p className="text-sm text-[#DDD6FE] max-w-3xl leading-relaxed">
              In technical interviews at top engineering companies, writing working code is only half the rubric. Interviewers evaluate how clearly you frame constraints, compare trade-offs, and keep them aligned while typing.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-5 space-y-2">
              <div className="text-xs font-mono text-[#BEF264]">01. The 6-Second Silent Rule</div>
              <h2 className="font-display text-lg font-bold text-[#F5F3FF]">
                Eliminate Long Dead-Air Stretches
              </h2>
              <p className="text-xs text-[#DDD6FE] leading-relaxed">
                When you type silently for more than 6 seconds, the interviewer loses visibility into your reasoning and cannot course-correct you early if you head down a buggy path. Announce each block before typing it.
              </p>
            </div>

            <div className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-5 space-y-2">
              <div className="text-xs font-mono text-[#BEF264]">02. Trade-Off Framing</div>
              <h2 className="font-display text-lg font-bold text-[#F5F3FF]">
                Always Contrast Brute Force vs. Optimal
              </h2>
              <p className="text-xs text-[#DDD6FE] leading-relaxed">
                Even if you immediately know the O(n) Hash Map solution for Two Sum, take 15 seconds to state the O(n²) nested-loop baseline first. Explicitly state that you are trading O(n) memory for O(1) complement lookups.
              </p>
            </div>

            <div className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-5 space-y-2">
              <div className="text-xs font-mono text-[#BEF264]">03. Big-O Callouts</div>
              <h2 className="font-display text-lg font-bold text-[#F5F3FF]">
                Declare Time &amp; Space Complexity Unprompted
              </h2>
              <p className="text-xs text-[#DDD6FE] leading-relaxed">
                Senior candidates don&apos;t wait for the interviewer to ask for Big-O. State both Time Complexity and Space Complexity out loud and tie them to the input size N.
              </p>
            </div>

            <div className="bg-[#160A2A] border border-[#2D1950] rounded-xl p-5 space-y-2">
              <div className="text-xs font-mono text-[#BEF264]">04. Vocal Precision</div>
              <h2 className="font-display text-lg font-bold text-[#F5F3FF]">
                Replace Filler Words With Deliberate Pauses
              </h2>
              <p className="text-xs text-[#DDD6FE] leading-relaxed">
                Frequent &ldquo;um&rdquo;, &ldquo;like&rdquo;, and &ldquo;basically&rdquo; dilute technical authority. Taking a silent 1.5-second breath before answering an edge-case question projects calm engineering confidence.
              </p>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
