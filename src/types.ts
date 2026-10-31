export type LanguageKey = "python" | "javascript" | "java";

export interface TranscriptEntry {
  id: string;
  speaker: "candidate" | "interviewer";
  text: string;
  timestamp: string;
  elapsedSec: number;
  fillersDetected?: string[];
  focusArea?: string;
}

export interface CoachingTip {
  title: string;
  category: string;
  detail: string;
}

export interface ScorecardData {
  deadAirPercent: number;
  fillerCount: number;
  fillerBreakdown: Record<string, number>;
  statedComplexity: boolean;
  complexityEvidence: string;
  discussedTradeoffs: boolean;
  tradeoffsEvidence: string;
  overallScore: number;
  headlineVerdict: string;
  tips: CoachingTip[];
  totalDurationSec: number;
  wordsSpoken: number;
  interviewerPromptsCount: number;
}

export interface TestCaseResult {
  id: number;
  inputDisplay: string;
  expectedDisplay: string;
  actualDisplay: string;
  passed: boolean;
}
