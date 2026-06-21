const BLOCK_START = /^(?:#{1,6}\s|```|>\s?|[-*+]\s|\d+\.\s|(?:-{3,}|\*{3,})\s*$)/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const INLINE_TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;

function appendInline(parent, source) {
  let cursor = 0;
  for (const match of source.matchAll(INLINE_TOKEN)) {
    parent.append(document.createTextNode(source.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith("*")) {
      const emphasis = document.createElement("em");
      emphasis.textContent = token.slice(1, -1);
      parent.append(emphasis);
    } else {
      const parts = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      const link = document.createElement("a");
      link.textContent = parts[1];
      link.href = parts[2];
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      parent.append(link);
    }
    cursor = match.index + token.length;
  }
  parent.append(document.createTextNode(source.slice(cursor)));
}

function appendMultilineInline(parent, lines) {
  lines.forEach((line, index) => {
    if (index) parent.append(document.createElement("br"));
    appendInline(parent, line);
  });
}

function splitTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTable(lines, index) {
  return index + 1 < lines.length && lines[index].includes("|") && TABLE_DIVIDER.test(lines[index + 1]);
}

function appendTable(fragment, lines, index) {
  const headers = splitTableRow(lines[index]);
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headers.forEach((value) => {
    const cell = document.createElement("th");
    appendInline(cell, value);
    headerRow.append(cell);
  });
  head.append(headerRow);
  table.append(head);

  const body = document.createElement("tbody");
  let cursor = index + 2;
  while (cursor < lines.length && lines[cursor].trim() && lines[cursor].includes("|")) {
    const row = document.createElement("tr");
    splitTableRow(lines[cursor]).forEach((value) => {
      const cell = document.createElement("td");
      appendInline(cell, value);
      row.append(cell);
    });
    body.append(row);
    cursor += 1;
  }
  table.append(body);
  const wrapper = document.createElement("div");
  wrapper.className = "markdown__table-wrap";
  wrapper.append(table);
  fragment.append(wrapper);
  return cursor;
}

export function renderMarkdown(markdown = "") {
  const fragment = document.createDocumentFragment();
  const root = document.createElement("div");
  root.className = "markdown";
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim().replace(/[^a-zA-Z0-9_+-]/g, "");
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      if (language) code.dataset.language = language;
      code.textContent = codeLines.join("\n");
      pre.append(code);
      root.append(pre);
      continue;
    }

    if (isTable(lines, index)) {
      index = appendTable(root, lines, index);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      appendInline(element, heading[2]);
      root.append(element);
      index += 1;
      continue;
    }

    if (/^(?:-{3,}|\*{3,})\s*$/.test(line)) {
      root.append(document.createElement("hr"));
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      const quote = document.createElement("blockquote");
      appendMultilineInline(quote, quoteLines);
      root.append(quote);
      continue;
    }

    const listMatch = line.match(/^([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]);
      const list = document.createElement(ordered ? "ol" : "ul");
      const pattern = ordered ? /^\d+\.\s+(.+)$/ : /^[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const itemMatch = lines[index].match(pattern);
        if (!itemMatch) break;
        const item = document.createElement("li");
        appendInline(item, itemMatch[1]);
        list.append(item);
        index += 1;
      }
      root.append(list);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !BLOCK_START.test(lines[index]) &&
      !isTable(lines, index)
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendMultilineInline(paragraph, paragraphLines);
    root.append(paragraph);
  }

  fragment.append(root);
  return fragment;
}
