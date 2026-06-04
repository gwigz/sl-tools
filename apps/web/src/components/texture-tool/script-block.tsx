"use client";

import { useMemo } from "react";

type TokenType = "plain" | "comment" | "string" | "const" | "keyword" | "func" | "number";

const TOKEN_RE = new RegExp(
  [
    String.raw`(\/\/[^\n]*|--[^\n]*)`, // 1 comment
    String.raw`("(?:[^"\\]|\\.)*")`, // 2 string
    String.raw`\b(ANIM_ON|LOOP|PING_PONG|REVERSE|SMOOTH|ROTATE|SCALE|ALL_SIDES|LINK_THIS|LINK_SET|LINK_ROOT|LINK_ALL_OTHERS|LINK_ALL_CHILDREN|TRUE|FALSE)\b`, // 3 const
    String.raw`\b(default|state_entry|integer|float|string|key|vector|rotation|local|function|return|end|if|then|else)\b`, // 4 keyword
    String.raw`(ll\.[A-Za-z]\w*|ll[A-Z]\w*|bit32\.bor|bit32)`, // 5 func
    String.raw`(\d+\.?\d*)`, // 6 number
  ].join("|"),
  "g",
);

const COLORS: Record<TokenType, string> = {
  plain: "",
  comment: "text-muted-foreground italic",
  string: "text-emerald-600 dark:text-emerald-400",
  const: "text-sky-600 dark:text-sky-400",
  keyword: "text-violet-600 dark:text-violet-400",
  func: "text-blue-600 dark:text-blue-400",
  number: "text-amber-600 dark:text-amber-400",
};

function tokenize(src: string) {
  const tokens: { type: TokenType; value: string }[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(src)) !== null) {
    if (match.index > last) {
      tokens.push({ type: "plain", value: src.slice(last, match.index) });
    }
    let type: TokenType = "plain";
    if (match[1]) type = "comment";
    else if (match[2]) type = "string";
    else if (match[3]) type = "const";
    else if (match[4]) type = "keyword";
    else if (match[5]) type = "func";
    else if (match[6]) type = "number";
    tokens.push({ type, value: match[0] });
    last = match.index + match[0].length;
  }
  if (last < src.length) tokens.push({ type: "plain", value: src.slice(last) });
  return tokens;
}

export function ScriptBlock({ code }: { code: string }) {
  const tokens = useMemo(() => tokenize(code), [code]);
  return (
    <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      <code>
        {tokens.map((token, i) => (
          <span key={i} className={COLORS[token.type]}>
            {token.value}
          </span>
        ))}
      </code>
    </pre>
  );
}
