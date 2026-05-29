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
	 const lowerText =
	  text.toLowerCase();

	const fileName =
	  String(
		f.name || ""
	  ).toLowerCase();

	const pathName =
	  String(
		f.path || ""
	  ).toLowerCase();

    const keywords =
	  q.split(/\s+/);

	let score = 0;
	
	/* ===== SYMBOL BOOST ===== */

	const functionMatches = [

	  ...text.matchAll(
		/function\s+([a-zA-Z0-9_]+)/g
	  ),

	  ...text.matchAll(
		/export\s+function\s+([a-zA-Z0-9_]+)/g
	  )

	];

	for (const m of functionMatches) {

	  const fn =
		String(m[1] || "")
		  .toLowerCase();

	  if (!fn) continue;

	  if (
		q.includes(fn)
	  ) {

		score += 300;

	  }

	}
	
	const ext =
	  fileName
		.split(".")
		.pop();

	if (
	  q.includes("react") &&
	  ["jsx","tsx"].includes(ext)
	) {

	  score += 25;

	}

	if (
	  q.includes("backend") &&
	  ["js","ts"].includes(ext)
	) {

	  score += 15;

	}
	const semanticMap = {

			  image: [
				"upload",
				"multer",
				"cloudinary",
				"sharp",
				"image",
				"preview",
				"src",
				"url"
			  ],

			  auth: [
				"jwt",
				"token",
				"authorization",
				"login",
				"user"
			  ],

			  chat: [
				"message",
				"conversation",
				"chat",
				"history"
			  ],

			  patch: [
				"replace",
				"applyPatch",
				"writeFile"
			  ]

			};

	for (const k of keywords) {

	  if (
		k.length < 2
	  ) continue;

	  if (
		  lowerText.includes(k)
		) {

		  score += 10;

		}

		if (
		  fileName.includes(k)
		) {

		  score += 20;

		}

		if (
		  pathName.includes(k)
		) {

		  score += 15;

		}

	}
	for (const [topic, related] of Object.entries(semanticMap)) {

	  if (
		q.includes(topic)
	  ) {

		for (const word of related) {

		  if (
			lowerText.includes(
			  word.toLowerCase()
			)
		  ) {

			score += 12;

		  }

		}

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

      const lines =
		text.split("\n");

		let preview = "";

		const matchIndex =
		  lines.findIndex(line =>

			keywords.some(k =>

			  line
				.toLowerCase()
				.includes(k)

			)

		  );

		if (matchIndex >= 0) {

		  preview = lines
			.slice(
			  Math.max(0, matchIndex - 10),
			  matchIndex + 25
			)
			.join("\n");

		} else {

		  preview = lines
			.slice(0, 40)
			.join("\n");

		}

		results.push({

		  file:
			f.name,

		  score,

		  preview

		});

    }

  }

	results.sort((a,b) => {

	  // exact filename boost
	  if (
		  a.file.toLowerCase() ===
		  q
		) return -1;

	  return b.score - a.score;

	});
	
	return {

	  success: true,

	  results:
		results.slice(0,5)

	};

}