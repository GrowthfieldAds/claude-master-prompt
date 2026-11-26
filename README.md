# master-prompt

A Claude Code mod. Type your message, tap **✨ Master prompt** above the prompt box, then send: the message is expanded
into a complete, step-by-step brief (goal, context, numbered steps, requirements, quality bar, deliverables, open
questions) before it reaches Claude, with nothing from your draft dropped. Your original words ride along so Claude can
check the rewrite. Starting a message with `mp` does the same without the button.

The bar also shows your 5-hour and weekly usage, how full the chat is, and how long the prompt cache stays warm.

Install, at the prompt of a terminal session:

```
/plugin install master-prompt --marketplace GrowthfieldAds/claude-master-prompt
```

From a shell (for example a cloud environment's setup script):

```
claude plugin install master-prompt@master-prompt --marketplace GrowthfieldAds/claude-master-prompt
```
