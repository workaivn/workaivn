export function buildImportGraph(
  files = []
) {

  const graph = {};

  files.forEach(file => {

    graph[file.name] = [];

    (file.chunks || [])
      .forEach(chunk => {

        const text =
          chunk.content || "";

        const matches =
          text.matchAll(
            /import\s+.*?from\s+["'](.+?)["']/g
          );

        for (const m of matches) {

          graph[file.name]
            .push(m[1]);

        }

      });

  });

  return graph;

}