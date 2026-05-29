export function buildSymbolIndex(
  files = []
) {

  const symbols = [];

  files.forEach(file => {

    (file.chunks || [])
      .forEach(chunk => {

        if (
          !chunk?.name ||
          chunk.name === "anonymous"
        ) {
          return;
        }

        symbols.push({

		  symbol:
			chunk.name,

		  type:
			chunk.type,

		  file:
			chunk.file,

		  content:
			chunk.content
			  ?.slice(0,500),

		  length:
			chunk.content?.length || 0

		});

      });

  });

  return symbols;

}