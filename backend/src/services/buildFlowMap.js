export function buildFlowMap(
  files = []
) {

  const flows = [];
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
			  "catch",
			  "toLowerCase",
			  "toUpperCase",
			  "replace",
			  "split",
			  "join",
			  "sort",
			  "forEach",
			  "String",
			  "Number",
			  "Boolean",
			  "Object",
			  "Array",
			  "Date",
			  "Promise",
			  "JSON",
			  "Math",
			  "Set",
			  "Map"
			].includes(fn)
          ) {

            if (
			  !unique.has(fn)
			) {

			  unique.add(fn);

			  calls.push(fn);

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