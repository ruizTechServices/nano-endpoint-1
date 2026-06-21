# Design specification

- Product: **Orin Local**, a private endpoint chat utility.
- Surface: one responsive screen, no sidebar and no marketing shell.
- Container: open 860px transcript column with a slim full-width header and sticky composer.
- Palette: true near-white `#fbfcfe`, ink `#111827`, slate `#64748b`, cobalt `#2456d8`, coral `#d54949`.
- Type: native modern sans stack; readable 16px body with compact 13px utility chrome.
- Controls: one filled send action, one restrained destructive outline action, visible focus rings.
- Memory: compact disclosure above the composer plus context/cadence text below the input.
- Responsive: edge-to-edge transcript and composer below 640px; header and destructive control remain visible.
- Motion: short message entry and activity pulse, disabled under reduced-motion preference.
- Endpoint-provided `message.thinking` is requested and displayed in a collapsed **Thinking** disclosure, separate from the final answer. It is treated as untrusted Markdown and rendered with the same safe DOM renderer.

Concept reference: `C:/Users/giost/.codex/generated_images/019ee87f-eb76-7583-be3b-34c6bf7e46c0/exec-b8484b20-7f68-40b0-b4c8-b1da097c7704.png`.
