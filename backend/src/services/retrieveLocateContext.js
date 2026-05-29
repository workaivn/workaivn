export function retrieveLocateContext({
  query = "",
  symbolIndex = [],
  activeFiles = []
}) {

  const q =
    String(query || "")
      .toLowerCase()
      .trim();

  const results = [];

  for (const symbol of symbolIndex) {

    const name =
      String(
        symbol.symbol || ""
      ).toLowerCase();

    let score = 0;

    if (name === q)
      score += 1000;

    if (name.includes(q))
      score += 700;

    if (q.includes(name))
      score += 500;

    if (!score)
      continue;

    results.push({
      ...symbol,
      score
    });

  }

  results.sort(
    (a,b) =>
      b.score - a.score
  );

  const files = [];

  for (const file of activeFiles) {

    const fileName =
      String(
        file.name || ""
      ).toLowerCase();

    if (
      fileName.includes(q)
    ) {

      files.push({
        file: file.name,
        score: 500
      });

    }

  }

  return {

    intent:
      "locate",

    symbols:
      results.slice(0,20),

    files:
      files.slice(0,20)

  };

}