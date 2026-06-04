export type ScriptLanguage = "lsl" | "slua";

export interface ScriptOptions {
  cols: number;
  rows: number;
  fps: number;
  frameCount: number;
  loop: boolean;
  reverse: boolean;
  pingPong: boolean;
  face: string;
  link: string | null;
}

function animFlags(o: ScriptOptions) {
  const flags = ["ANIM_ON"];
  if (o.loop) flags.push("LOOP");
  if (o.reverse) flags.push("REVERSE");
  if (o.pingPong) flags.push("PING_PONG");
  return flags;
}

function alignArgs(rows: [code: string, comment: string][], indent: string, token: string) {
  const width = Math.max(...rows.map(([code]) => code.length));
  return rows
    .map(([code, comment]) => `${indent}${code.padEnd(width)}  ${token} ${comment}`)
    .join("\n");
}

export function buildScript(language: ScriptLanguage, options: ScriptOptions) {
  return language === "slua" ? buildSluaScript(options) : buildLslScript(options);
}

export function buildLslScript(o: ScriptOptions) {
  const { cols, rows, fps, frameCount, face, link } = o;
  const flags = animFlags(o).join(" | ");
  const length = Math.min(frameCount, cols * rows);

  const head = link
    ? `        llSetLinkTextureAnim(${link}, ${flags}, ${face},`
    : `        llSetTextureAnim(${flags}, ${face},`;

  const args = alignArgs(
    [
      [`${cols}, ${rows},`, `${cols} columns × ${rows} rows`],
      ["0.0,", "start frame"],
      [`${length}.0,`, "frames to play"],
      [fps.toFixed(2), "rate (fps)"],
    ],
    "            ",
    "//",
  );

  return `default
{
    state_entry()
    {
${head}
${args}
        );
    }
}
`;
}

export function buildSluaScript(o: ScriptOptions) {
  const { cols, rows, fps, frameCount, face, link } = o;
  const flags = animFlags(o);
  // Luau has no `|` operator, so multiple flags are combined with bit32.bor().
  const mode = flags.length === 1 ? flags[0] : `bit32.bor(${flags.join(", ")})`;
  const length = Math.min(frameCount, cols * rows);

  const head = link
    ? `ll.SetLinkTextureAnim(${link}, ${mode}, ${face},`
    : `ll.SetTextureAnim(${mode}, ${face},`;

  const args = alignArgs(
    [
      [`${cols}, ${rows},`, `${cols} columns × ${rows} rows`],
      ["0.0,", "start frame"],
      [`${length}.0,`, "frames to play"],
      [fps.toFixed(2), "rate (fps)"],
    ],
    "    ",
    "--",
  );

  return `${head}
${args}
)
`;
}
