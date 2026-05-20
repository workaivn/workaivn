export function buildFileMeta(
  files = []
) {

  return files.map(file => {

    const name =
      file.name
        ?.toLowerCase() || "";

    let role =
      "unknown";

    let framework =
      "unknown";

    let responsibility =
      "general";

    /* =====================
       ROLE
    ===================== */

    if (
      name.includes("route")
    ) {

      role = "router";

      responsibility =
        "api endpoints";

    }

    else if (
      name.includes("controller")
    ) {

      role = "controller";

      responsibility =
        "request handling";

    }

    else if (
      name.includes("service")
    ) {

      role = "service";

      responsibility =
        "business logic";

    }

    else if (
      name.includes("model")
    ) {

      role = "model";

      responsibility =
        "database layer";

    }

    else if (
      name.includes("middleware")
    ) {

      role = "middleware";

      responsibility =
        "request middleware";

    }

    else if (
      name.includes("component")
    ) {

      role = "ui component";

      responsibility =
        "frontend rendering";

    }

    /* =====================
       FRAMEWORK
    ===================== */

    const allText =

      (file.chunks || [])
        .map(c =>

          c.content || ""

        )
        .join("\n")
        .toLowerCase();

    if (
      allText.includes(
        "express"
      )
    ) {

      framework =
        "express";

    }

    if (
      allText.includes(
        "react"
      )
    ) {

      framework =
        "react";

    }

    if (
      allText.includes(
        "mongoose"
      )
    ) {

      framework =
        "mongoose";

    }

    return {

      file:
        file.name,

      role,

      framework,

      responsibility

    };

  });

}