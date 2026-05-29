export async function searchSymbolTool({

  query,

  activeFiles = []

}) {

  const results = [];

  for (const f of activeFiles) {

    const chunks =
      f.chunks || [];

    for (const c of chunks) {

      const symbol =
        String(
          c.name || ""
        ).toLowerCase();

      const q =
        String(
          query || ""
        ).toLowerCase();

      let score = 0;

      if (symbol === q)
        score += 1000;

      if (symbol.includes(q))
        score += 700;

      if (q.includes(symbol))
        score += 500;

      if (!score)
        continue;

      results.push({

        file:
          f.name,

        symbol:
          c.name,

        type:
          c.type,

        score,

        preview:
          String(
            c.content || ""
          ).slice(0,1000)

      });

    }

  }

  results.sort(
    (a,b)=>
      b.score-a.score
  );

  return {

    success:true,

    results:
      results.slice(0,20)

  };

}