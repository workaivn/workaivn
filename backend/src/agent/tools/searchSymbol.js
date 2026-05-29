export async function searchSymbolTool({

  query,

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
	  
	  const synonyms = {

		  stream: [
			"token",
			"sse",
			"res.write"
		  ],

		  upload: [
			"multer",
			"file",
			"activefiles"
		  ],

		  chat: [
			"savechat",
			"messages"
		  ],

		  route: [
			"router",
			"post",
			"get"
		  ],

		  bug: [
			"error",
			"catch",
			"throw"
		  ]

		};
		const expandedKeywords =
		  [...keywords];

		keywords.forEach(k => {

		  if (synonyms[k]) {

			expandedKeywords.push(
			  ...synonyms[k]
			);

		  }

		});
  const results = [];

  for (const file of activeFiles) {

    const chunks =
      file.chunks || [];

    for (const chunk of chunks) {

      const symbol =
        String(
          chunk.name || ""
        ).toLowerCase();

      const type =
        String(
          chunk.type || ""
        ).toLowerCase();

      const content =
        String(
          chunk.content || ""
        ).toLowerCase();

      let score = 0;

      /* =====================
         EXACT SYMBOL
      ===================== */

      if (symbol === q)
        score += 1000;

      if (symbol.includes(q))
        score += 700;

      if (q.includes(symbol))
        score += 500;

      /* =====================
         KEYWORD IN SYMBOL
      ===================== */

      keywords.forEach(k => {

        if (
          symbol.includes(k)
        ) {

          score += 120;

        }

      });

      /* =====================
         KEYWORD IN CONTENT
      ===================== */

      keywords.forEach(k => {

        if (
          content.includes(k)
        ) {

          score += 20;

        }

      });

      /* =====================
         EXPORT BOOST
      ===================== */

      if (
        content.includes(
          "export "
        )
      ) {

        score += 30;

      }

      /* =====================
         ROUTE BOOST
      ===================== */

      if (

        content.includes(
          "router."
        )

        ||

        content.includes(
          "app."
        )

      ) {

        score += 50;

      }

      /* =====================
         ERROR BOOST
      ===================== */

      if (

        q.includes("error")

        ||

        q.includes("bug")

        ||

        q.includes("lỗi")

        ||

        q.includes("cannot")

      ) {

        if (

          content.includes("catch")

          ||

          content.includes("throw")

          ||

          content.includes("error")

        ) {

          score += 80;

        }

      }

      /* =====================
         STREAM BOOST
      ===================== */

      if (

        q.includes("stream")

        ||

        q.includes("token")

      ) {

        if (

          content.includes("stream")

          ||

          content.includes("token")

          ||

          content.includes("res.write")

        ) {

          score += 100;

        }

      }

      /* =====================
         UPLOAD BOOST
      ===================== */

      if (

        q.includes("upload")

        ||

        q.includes("file")

      ) {

        if (

          content.includes("multer")

          ||

          content.includes("upload")

          ||

          content.includes("activefiles")

        ) {

          score += 100;

        }

      }

      if (
        score <= 0
      ) continue;

      results.push({

        file:
          file.name,

        symbol:
          chunk.name,

        type:
          chunk.type,

        score,

        preview:
          content.slice(
            0,
            1000
          )

      });

    }

  }

  results.sort(
    (a,b) =>
      b.score - a.score
  );

  return {

    success: true,

    results:
      results.slice(0,30)

  };

}