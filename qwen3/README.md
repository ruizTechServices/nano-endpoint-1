# Qwen3 reference material

This directory contains two different kinds of documentation:

- `Qwen.html` and `Qwen_files/`: an archived upstream Qwen webpage and its downloaded assets. This snapshot is reference material and is not the local endpoint contract.
- `tool-use.md`: the application-specific guide for prompting the three tools exposed to `qwen3:1.7b` by Orin Local.

The exact deployed model tag, endpoint URL, request/response contract, and operational constraints are defined under [`../orin-nano/`](../orin-nano/docs.md). The local application fixes the model to `qwen3:1.7b` and does not substitute another Qwen variant mentioned by the archived page.

Tool execution occurs in the client application:

```text
User prompt
  -> qwen3:1.7b selects an allowlisted function
  -> Orin Local validates and executes it
  -> Orin Local deterministically renders validated fields
```

The model and Orin endpoint do not independently receive arbitrary web, shell, filesystem, or device access.
