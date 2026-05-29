export function retrieveCodeContext({
  query = "",
  symbolIndex = [],
  callGraph = {},
  activeFiles = []
}) {

  const q =
    String(query || "")
      .toLowerCase()
      .trim();

  const keywords =
    q
      .split(/\s+/)
      .filter(
        k => k.length > 2
      );

  /* =========================
     SYMBOL MATCH
  ========================= */

  const matchedSymbols =
    symbolIndex
      .map(symbol => {

        const name =
          String(
            symbol.symbol || ""
          ).toLowerCase();

        let score = 0;

        if (name === q) {
          score += 1000;
        }

        if (name.includes(q)) {
          score += 700;
        }

        if (q.includes(name)) {
          score += 500;
        }

        keywords.forEach(k => {

          if (
            name.includes(k)
          ) {
            score += 100;
          }

        });

        return {
          ...symbol,
          score
        };

      })
      .filter(
        x => x.score > 0
      )
      .sort(
        (a,b) =>
          b.score - a.score
      );

  /* =========================
     FILE MATCH
  ========================= */

  const matchedFiles =
    activeFiles
      .map(file => {

        const haystack = `

${file.name || ""}

${file.summary || ""}

${String(
  file.content || ""
).slice(0,5000)}

`
        .toLowerCase();

        let score = 0;

        keywords.forEach(k => {

          if (
            haystack.includes(k)
          ) {

            score += 10;

          }

        });

        return {
          name:
            file.name,

          score,

          chunks:
            file.chunks || []

        };

      })
      .filter(
        f => f.score > 0
      )
      .sort(
        (a,b) =>
          b.score - a.score
      )
      .slice(0,10);

  /* =========================
     FUNCTION MATCH
  ========================= */

  const likelyFunctions = [];

  matchedFiles.forEach(file => {

    (file.chunks || [])
      .forEach(chunk => {

        const haystack = `

${chunk.name || ""}

${chunk.content || ""}

`
        .toLowerCase();

        let score = 0;

        keywords.forEach(k => {

          if (
            haystack.includes(k)
          ) {

            score += 10;

          }

        });

        if (
          score > 0
        ) {

          likelyFunctions.push({

            file:
              file.name,

            function:
              chunk.name,

            type:
              chunk.type,

            score

          });

        }

      });

  });

  /* =========================
     CALL GRAPH
  ========================= */

  const relatedFunctions =
    [];

  matchedSymbols
    .slice(0,20)
    .forEach(fn => {

      const calls =
        callGraph[
          fn.symbol
        ] || [];

      calls.forEach(c => {

        relatedFunctions.push(c);

      });

    });

  return {

    matchedSymbols:
      matchedSymbols
        .slice(0,20),

    matchedFunctions:
      matchedSymbols
        .slice(0,20),

    matchedFiles:
      matchedFiles
        .map(x => ({
          file:
            x.name,
          score:
            x.score
        })),

    likelyFunctions:
      likelyFunctions
        .sort(
          (a,b) =>
            b.score - a.score
        )
        .slice(0,20),

    relatedFunctions:
      [
        ...new Set(
          relatedFunctions
        )
      ].slice(0,30)

  };

}