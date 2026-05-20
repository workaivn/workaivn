export function buildFlowMap(
  files = []
) {

  const flows = [];

  files.forEach(file => {

    (file.chunks || [])
      .forEach(chunk => {

        const text =
          chunk.content || "";

        const calls =
          [];

        const matches =
          text.matchAll(
            /([a-zA-Z0-9_]+)\s*\(/g
          );

        for (const m of matches) {

          const fn =
            m[1];

          if (
            ![
              "if",
              "for",
              "map",
              "filter",
              "return",
              "console"
            ].includes(fn)
          ) {

            calls.push(fn);

          }

        }

        if (
          calls.length
        ) {

          flows.push({

            file:
              file.name,

            function:
              chunk.name,

            calls

          });

        }

      });

  });

  return flows;

}