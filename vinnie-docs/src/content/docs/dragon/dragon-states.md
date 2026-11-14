---
title: "Dragon States"
description: "How the dragon reacts to each agent state."
sidebar:
  order: 2
---
The dragon's behavior is taken directly from the running task's status in the agent runtime.

| Agent status | Dragon behavior |
| --- | --- |
| Idle (no task) | Breathing, blinking, slow tail sway, glancing around; follows the cursor if enabled |
| `thinking` | Head lowered slightly, slow observing movements, brighter cyan glow |
| `planning` | Raises its head and looks around, attentive |
| `executing` | Focused posture, wings partly open with a slight flutter, quicker tail |
| `waiting_for_permission` | Turns to look at you and holds still while you decide |
| `verifying` | Lowers its head and scans, examining |
| `paused` | Neutral and still, half-facing you |
| `completed` | Relaxed and pleased: wings half spread, a short celebratory lift |
| `failed` or `stopped` | Head and neck lowered, wings folded tight, glow dimmed |
| `cancelled` | Returns to a neutral resting pose |

A finished task's posture is held for a few seconds (completed 6 s, failed 10 s, cancelled 3 s), then the dragon
rests again. Starting a new task ends the hold at once.

## Small reactions

On top of the postures, the dragon reacts briefly to some events: it perks up when a task starts, nods when a tool
starts, and flinches when a tool fails. A failed tool doesn't change the posture: the task is still running.

## Animations

Breathing, blinking, and wing folding use the animation clips stored in the model (`Idle_Breathe`, `Blink`,
`Wings_Fold`). Head, neck, tail, jaw, and wing-lift movements are small procedural rotations on the model's own
rig, kept within ranges the rig was built for.

## Status bar indicator

The dragon mark at the left of the status bar still shows a short status (*Vinnie: Idle*, *Reading server.js*, …),
whether or not the 3D dragon is shown.
