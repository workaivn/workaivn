export function retrieveCodeContext({
  query = "",
  symbolIndex = [],
  callGraph = {},
  activeFiles = []
}) {

  const q =
    String(query)
      .toLowerCase()
      .trim();

  const matchedSymbols =
    symbolIndex
      .map(s => {

        let score = 0;

        const symbol =
          String(
            s.symbol || ""
          ).toLowerCase();

        if (symbol === q)
          score += 1000;

        if (symbol.includes(q))
          score += 700;

        if (q.includes(symbol))
          score += 500;

        return {
          ...s,
          score
        };

      })
      .filter(x => x.score > 0)
      .sort(
        (a,b)=>
          b.score-a.score
      );

  const matchedFunctions =
    matchedSymbols.slice(0,20);

  const relatedFunctions =
    [];

  matchedFunctions.forEach(fn => {

    const calls =
      callGraph[
        fn.symbol
      ] || [];

    calls.forEach(c => {

      relatedFunctions.push(c);

    });

  });

  const matchedFiles =
    activeFiles
      .filter(f => {

        const file =
          f.name
            ?.toLowerCase();

        return (
          file.includes(q)
        );

      });

  return {

    matchedSymbols,

    matchedFunctions,

    relatedFunctions:
      [...new Set(
        relatedFunctions
      )].slice(0,30),

    matchedFiles

  };

}