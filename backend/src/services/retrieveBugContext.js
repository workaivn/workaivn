export function retrieveBugContext({
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
        x => x.length > 2
      );

  /* =====================
     ROOT FUNCTIONS
  ===================== */

  const rootFunctions =
    symbolIndex
      .map(symbol => {

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
      )
      .slice(0,20);

  /* =====================
     CALLEES
  ===================== */

  const callees = [];

  rootFunctions.forEach(fn => {

    const calls =
      callGraph[
        fn.symbol
      ] || [];

    calls.forEach(c => {

      callees.push({

        from:
          fn.symbol,

        to:
          c

      });

    });

  });

  /* =====================
     CALLERS
  ===================== */

  const callers = [];

  Object.entries(
    callGraph
  ).forEach(
    ([from, list]) => {

      rootFunctions.forEach(fn => {

        if (
          Array.isArray(list) &&
          list.includes(
            fn.symbol
          )
        ) {

          callers.push({

            from,
            to:
              fn.symbol

          });

        }

      });

    }
  );

  /* =====================
     RELATED FILES
  ===================== */

  const relatedFiles = [];

  const functionNames =
    new Set([
      ...rootFunctions.map(
        x => x.symbol
      )
    ]);

  activeFiles.forEach(file => {

    const hit =
      (file.chunks || [])
        .some(chunk =>

          functionNames.has(
            chunk.name
          )

        );

    if (hit) {

      relatedFiles.push({

        file:
          file.name

      });

    }

  });

  /* =====================
     CHUNK MATCH
  ===================== */

  const matchedChunks = [];

  activeFiles.forEach(file => {

    (file.chunks || [])
      .forEach(chunk => {

        const haystack = `

${chunk.name || ""}

${chunk.type || ""}

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

          matchedChunks.push({

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

  /* =====================
     BUG HOTSPOTS
  ===================== */

  const bugHotspots = [];

  activeFiles.forEach(file => {

    (file.chunks || [])
      .forEach(chunk => {

        const content =
          String(
            chunk.content || ""
          ).toLowerCase();

        let score = 0;

        const bugWords = [

          "catch",
          "throw",
          "error",
          "exception",

          "res.end",
          "res.write",
          "res.send",
          "res.json",

          "finally",

          "undefined",
          "null",

          "stream",

          "socket",

          "promise",

          "await",

          "upload",

          "token",

          "duplicate",

          "cannot"

        ];

        bugWords.forEach(word => {

          if (
            content.includes(word)
          ) {

            score++;

          }

        });

        if (
          score >= 3
        ) {

          bugHotspots.push({

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

  /* =====================
     RETURN
  ===================== */

  return {

    intent:
      "bugfix",

    rootFunctions,

    callers:
      callers.slice(0,30),

    callees:
      callees.slice(0,30),

    files:
      relatedFiles,

    matchedChunks:
      matchedChunks
        .sort(
          (a,b) =>
            b.score - a.score
        )
        .slice(0,30),

    bugHotspots:
      bugHotspots
        .sort(
          (a,b) =>
            b.score - a.score
        )
        .slice(0,20)

  };

}