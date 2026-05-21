import { exec }
  from "child_process";

export async function searchCodeTool({

  query,

  activeFiles = []

}) {

  const q =
    String(query || "")
      .toLowerCase();

  const results = [];

  for (const f of activeFiles) {

    const text =
      String(
        f.content || ""
      );

    const keywords =
	  q.split(/\s+/);

	if (

	  keywords.some(k =>

		k.length > 1 &&

		text
		  .toLowerCase()
		  .includes(k)

	  )

	) {

      results.push({

        file:
          f.name,

        preview:
          text
            .slice(0, 500)

      });

    }

  }

  return {

    success: true,

    results

  };

}