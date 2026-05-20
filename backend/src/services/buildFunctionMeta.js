export function buildFunctionMeta(
  files = []
) {

  const meta = [];

  files.forEach(file => {

    (file.chunks || [])
      .forEach(chunk => {

        if (
          !chunk.name
        ) {
          return;
        }

        const text =
          (
            chunk.content || ""
          ).toLowerCase();

        let purpose =
          "general logic";

        let sideEffects =
          [];

        /* =====================
           PURPOSE
        ===================== */

        if (
          text.includes(
            "save"
          )
        ) {

          purpose =
            "persist data";

        }

        if (
          text.includes(
            "chat"
          )
        ) {

          purpose =
            "chat handling";

        }

        if (
          text.includes(
            "upload"
          )
        ) {

          purpose =
            "file upload";

        }

        if (
          text.includes(
            "auth"
          )
        ) {

          purpose =
            "authentication";

        }

        /* =====================
           SIDE EFFECTS
        ===================== */

        if (
          text.includes(
            ".save("
          )
        ) {

          sideEffects.push(
            "database write"
          );

        }

        if (
          text.includes(
            "fs.write"
          )
        ) {

          sideEffects.push(
            "filesystem write"
          );

        }

        meta.push({

          function:
            chunk.name,

          file:
            file.name,

          purpose,

          sideEffects

        });

      });

  });

  return meta;

}