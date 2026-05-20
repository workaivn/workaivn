export function buildFlowMap(
  files = []
) {

  const flows = [];
	const knownFunctions =
	  new Set();

	files.forEach(file => {

	  (file.chunks || [])
		.forEach(chunk => {

		  if (
			chunk.name
		  ) {

			knownFunctions.add(
			  chunk.name
			);

		  }

		});

	});
  files.forEach(file => {

    (file.chunks || [])
      .forEach(chunk => {

        const text =
          chunk.content || "";
		if (
		  !chunk.name
		) {
		  return;
		}
        const calls =
          [];
		const unique =
		  new Set();
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
			  "console",
			  "push",
			  "slice",
			  "includes",
			  "trim",
			  "json",
			  "status",
			  "findById",
			  "findOne",
			  "create",
			  "save",
			  "log",
			  "parse",
			  "stringify",
			  "then",
			  "catch"
			].includes(fn)
          ) {

            if (
			  !unique.has(fn)
			) {

			  unique.add(fn);

			  if (
				  knownFunctions.has(fn)
				) {

				  calls.push(fn);

				}

			}

          }

        }

        if (

		  calls.length &&

		  chunk.name

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