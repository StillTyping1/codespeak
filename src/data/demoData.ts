import { LanguageKey, ScorecardData, TranscriptEntry } from "../types";

export const STARTER_CODE: Record<LanguageKey, string> = {
  python: `def two_sum(nums: list[int], target: int) -> list[int]:
    # Speak your approach out loud as you code!
    seen = {}
    
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
        
    return []`,
  javascript: `function twoSum(nums, target) {
  // Speak your approach out loud as you code!
  const seen = new Map();

  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (seen.has(complement)) {
      return [seen.get(complement), i];
    }
    seen.set(nums[i], i);
  }

  return [];
}`,
  java: `import java.util.HashMap;
import java.util.Map;

class Solution {
    public int[] twoSum(int[] nums, int target) {
        // Speak your approach out loud as you code!
        Map<Integer, Integer> seen = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int complement = target - nums[i];
            if (seen.containsKey(complement)) {
                return new int[] { seen.get(complement), i };
            }
            seen.put(nums[i], i);
        }
        return new int[] {};
    }
}`,
};

export const INITIAL_BLANK_CODE: Record<LanguageKey, string> = {
  python: `def two_sum(nums: list[int], target: int) -> list[int]:
    # Start talking through your brute-force vs optimal idea,
    # then write your solution below:
    `,
  javascript: `function twoSum(nums, target) {
  // Start talking through your brute-force vs optimal idea,
  // then write your solution below:
  
}`,
  java: `import java.util.*;

class Solution {
    public int[] twoSum(int[] nums, int target) {
        // Start talking through your brute-force vs optimal idea:
        
    }
}`,
};

export const FILLER_WORDS = [
  "um",
  "uh",
  "umm",
  "uhh",
  "like",
  "basically",
  "literally",
  "actually",
  "honestly",
];

export const FILLER_PHRASES = ["you know", "sort of", "kind of", "i mean"];

export function analyzeFillersInText(text: string): {
  total: number;
  breakdown: Record<string, number>;
  matchedTokens: string[];
} {
  const lower = text.toLowerCase();
  const breakdown: Record<string, number> = {};
  const matchedTokens: string[] = [];
  let total = 0;

  for (const phrase of FILLER_PHRASES) {
    const regex = new RegExp(`\\b${phrase}\\b`, "gi");
    const matches = lower.match(regex);
    if (matches && matches.length > 0) {
      breakdown[phrase] = (breakdown[phrase] || 0) + matches.length;
      total += matches.length;
      matchedTokens.push(phrase);
    }
  }

  const words = lower.replace(/[^a-z\s']/g, " ").split(/\s+/).filter(Boolean);
  for (const word of words) {
    if (FILLER_WORDS.includes(word)) {
      breakdown[word] = (breakdown[word] || 0) + 1;
      total += 1;
      if (!matchedTokens.includes(word)) {
        matchedTokens.push(word);
      }
    }
  }

  return { total, breakdown, matchedTokens };
}

export const DEMO_SESSION_CODE = `def two_sum(nums: list[int], target: int) -> list[int]:
    # One-pass Hash Map: store {value: index}
    # Time Complexity: O(n) | Space Complexity: O(n)
    prev_map = {}

    for idx, val in enumerate(nums):
        complement = target - val
        if complement in prev_map:
            return [prev_map[complement], idx]
        prev_map[val] = idx

    return []`;

export const DEMO_TRANSCRIPT: TranscriptEntry[] = [
  {
    id: "demo-1",
    speaker: "candidate",
    timestamp: "00:08",
    elapsedSec: 8,
    text: "Okay, so we're given an array of integers nums and a target integer, and we need to return the two indices that add up to target.",
    fillersDetected: [],
  },
  {
    id: "demo-2",
    speaker: "candidate",
    timestamp: "00:22",
    elapsedSec: 22,
    text: "Um, the brute force way would be nested loops checking every pair, which takes O(n^2) time and O(1) space, but we can definitely do better.",
    fillersDetected: ["um"],
  },
  {
    id: "demo-3",
    speaker: "candidate",
    timestamp: "00:38",
    elapsedSec: 38,
    text: "I'm going to trade space for time by using a Python dictionary called prev_map to store each number and its index as we iterate.",
    fillersDetected: [],
  },
  {
    id: "demo-4",
    speaker: "interviewer",
    timestamp: "00:49",
    elapsedSec: 49,
    text: "I noticed you typed the complement check silently for 6 seconds—why do we insert into prev_map after the if-check instead of before?",
    focusArea: "6s Silent Typing Trigger",
  },
  {
    id: "demo-5",
    speaker: "candidate",
    timestamp: "01:04",
    elapsedSec: 64,
    text: "Great catch! Basically, if target is 6 and nums has a 3, checking before inserting prevents us from using the exact same index twice, like [3, 3] vs a single 3.",
    fillersDetected: ["basically", "like"],
  },
  {
    id: "demo-6",
    speaker: "candidate",
    timestamp: "01:19",
    elapsedSec: 79,
    text: "So overall, our time complexity is O(n) because dictionary lookups are O(1) on average, and space complexity is O(n) in the worst case.",
    fillersDetected: [],
  },
];

export const DEMO_SCORECARD: ScorecardData = {
  deadAirPercent: 14,
  fillerCount: 3,
  fillerBreakdown: {
    um: 1,
    basically: 1,
    like: 1,
  },
  statedComplexity: true,
  complexityEvidence:
    "Stated both O(n²) brute-force bounds and final O(n) time / O(n) space complexity with hash table lookup justification.",
  discussedTradeoffs: true,
  tradeoffsEvidence:
    "Explicitly contrasted nested loops (O(1) space, O(n²) time) against trading O(n) dictionary memory for single-pass speed.",
  overallScore: 92,
  headlineVerdict:
    "Interview-Ready Communication: Crisp problem framing, proactive trade-off analysis, and strong recovery after the 6-second silent typing nudge.",
  totalDurationSec: 86,
  wordsSpoken: 142,
  interviewerPromptsCount: 1,
  tips: [
    {
      title: "Narrate the Loop Invariant While Typing",
      category: "6s Silence Recovery",
      detail:
        "You went silent for 6.2 seconds while writing `if complement in prev_map:`. Keep the interviewer engaged by reading your condition aloud: 'Before storing the current value, I'm checking if its complement was already seen.'",
    },
    {
      title: "Trim Hedge Words During Edge-Case Proofs",
      category: "Vocal Precision",
      detail:
        "Your explanation of why `[3, 3]` works without self-collision was technically spot-on, but included 'basically' and 'like'. Stating edge-case invariants without qualifiers makes you sound like a senior engineer.",
    },
    {
      title: "Proactively Dry-Run Example 1 With Index Values",
      category: "Verification Habit",
      detail:
        "After stating your O(n) time and O(n) space complexity, spend 15 seconds tracing `nums = [2, 7, 11, 15], target = 9` line-by-line to prove `prev_map` returns `[0, 1]` before clicking Finish.",
    },
  ],
};
