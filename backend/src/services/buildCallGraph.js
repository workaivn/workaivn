export function buildCallGraph(
  files = []
) {

  const graph = {};

  files.forEach(file => {

    (file.chunks || [])
      .forEach(chunk => {

        if (
          !chunk?.name ||
          !chunk?.content
        ) {
          return;
        }

        const fn =
          chunk.name;

        graph[fn] = [];

        const matches =
          chunk.content.matchAll(
            /([a-zA-Z0-9_]+)\s*\(/g
          );

        for (const m of matches) {

          const called =
            m[1];

          if (
            called !== fn
          ) {

            if (
			  !graph[fn]
				.includes(called)
			) {

			  graph[fn]
				.push(called);

			}

          }

        }

      });

  });

  return graph;

}