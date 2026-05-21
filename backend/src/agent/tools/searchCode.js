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
			.split("\n")
			.slice(0, 40)
			.join("\n")

      });

    }

  }

  return {

    success: true,

    results

  };

}