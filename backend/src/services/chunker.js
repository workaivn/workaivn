export function chunkText(
  text,
  size = 3000
) {

  if (!text) {
    return [];
  }

  const chunks = [];

  for (
    let i = 0;
    i < text.length;
    i += size
  ) {

    chunks.push(
      text.slice(i, i + size)
    );

  }

  return chunks;
}

/* =========================
   SIMPLE SUMMARY
========================= */

export function summarizeFile(
  name,
  text
) {

  const lines =
    text
      .split("\n")
      .slice(0, 80)
      .join("\n");

  return `

FILE: ${name}

Preview:
${lines}

`;

}