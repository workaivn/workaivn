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

	let score = 0;

	for (const k of keywords) {

	  if (
		k.length < 2
	  ) continue;

	  if (

		text
		  .toLowerCase()
		  .includes(k)

	  ) {

		score += 10;

	  }

	}

	// semantic boosts

	if (
	  q.includes("preview")
	) {

	  if (
		text.includes("upload")
	  ) score += 20;

	  if (
		text.includes("image")
	  ) score += 20;

	  if (
		text.includes("multer")
	  ) score += 25;

	  if (
		text.includes("cloudinary")
	  ) score += 20;

	  if (
		text.includes("url")
	  ) score += 15;

	}

	if (
	  score > 0
	) {

      results.push({

        file:
          f.name,
		
		score,

        preview:
		  text
			.split("\n")
			.slice(0, 40)
			.join("\n")

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
		results.slice(0,5)

	};

}