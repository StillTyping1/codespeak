# CodeSpeak

An AI mock interviewer that listens while you code and speaks up when you go quiet.

## Why I built this

I'm a CS sophomore prepping for technical interviews, and I noticed something:
I practice LeetCode in complete silence, but real interviews grade how well
you explain your thinking out loud. So the first time I'd actually talk through
a problem was in the interview itself.

I surveyed 21 HBCU CS and STEM students to see if it wasn't just me.
81% said they don't always talk out loud when they practice, and over half
said nerves or explaining their thinking was the hardest part of an interview.

CodeSpeak gives you that practice. It acts like an interviewer sitting next to you.

## How it works

1. You start a coding problem and talk through your approach. A live transcript
   picks up what you say and flags filler words like "um" and "like."
2. If you type for 6 seconds without saying anything, the AI interviewer jumps
   in and asks a follow-up out loud, based on the code you've written so far.
   Something like "Walk me through what that if-statement is checking."
3. When you finish, you get a scorecard: how much dead air there was, how many
   filler words you used, whether you mentioned time and space complexity,
   and three tips for next time.

It doesn't tell you if your answer is right mid-interview, since real
interviewers don't either. The feedback comes at the end.

## Built with

- React + TypeScript (Vite) for the frontend
- Node.js server that calls the Gemini API for follow-up questions and coaching tips
- Web Speech API for live speech-to-text, and speechSynthesis for the interviewer's voice

If Gemini takes too long to respond, the app falls back to a question based on
your current code so the interview keeps moving.

## Running it locally

```
npm install
cp .env.example .env    # then add your Gemini API key
npm run dev
```

Works best in Chrome, since it uses the browser's speech recognition.

## Background

I built the first version in one day for the AfroTech 2026 Future of XYZ
Innovation Challenge, using Google AI Studio to speed up development.

## What's next

- More problems beyond Two Sum
- Behavioral and system design rounds
- Piloting it with my school's coding club, Bulldog Coders
