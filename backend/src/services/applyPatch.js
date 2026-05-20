import fs from "fs";

export function applyPatch(
  filePath,
  find,
  replace
) {
	
	
	if (

  filePath.includes("..") ||

  filePath.includes("/etc") ||

  filePath.includes("node_modules")

) {

  return {
    success: false,
    error:
      "Invalid path"
  };

}

  try {

    let text =
      fs.readFileSync(
        filePath,
        "utf8"
      );

    if (
      !text.includes(find)
    ) {

      return {
        success: false,
        error:
          "Find text not found"
      };

    }

    text =
		  text
			.split(find)
			.join(replace);

    fs.writeFileSync(
      filePath,
      text
    );

    return {
      success: true
    };

  } catch (err) {

    return {
      success: false,
      error: err.message
    };

  }

}