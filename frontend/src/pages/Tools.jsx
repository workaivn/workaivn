// src/pages/Tools.jsx

import React, {
  useMemo,
  useState
} from "react";

import { tools } from "../data/tools";

export default function Tools({
  runTool
}) {
  const [query, setQuery] =
    useState("");

  const filtered =
    useMemo(() => {
      const q =
        query
          .trim()
          .toLowerCase();

      if (!q) return tools;

      return tools
        .map((group) => ({
          ...group,
          items:
            group.items.filter(
              (item) =>
                item.label
                  .toLowerCase()
                  .includes(
                    q
                  )
            )
        }))
        .filter(
          (group) =>
            group.items
              .length > 0
        );
    }, [query]);

  return (
    <section className="toolsPage">
      <div className="toolsHero">
        <h1>
          Tool Center
        </h1>

        <p>
          Công cụ AI cho
          doanh nghiệp
          Việt Nam
        </p>

        <input
          className="toolsSearch"
          placeholder="Tìm công cụ..."
          value={query}
          onChange={(e) =>
            setQuery(
              e.target
                .value
            )
          }
        />
      </div>

      {filtered.map(
        (group) => (
          <section
            key={
              group.category
            }
            className="toolGroup"
          >
            <h2>
              {
                group.category
              }
            </h2>

            <div className="toolGrid">
              {group.items.map(
                (
                  item
                ) => (
                  <button
                    key={
                      item.label
                    }
                    className="toolCard"
                    onClick={() =>
                      runTool(
                        item
                      )
                    }
                  >
                    <div className="toolIcon">
                      {
                        item.icon
                      }
                    </div>

                    <div className="toolTitle">
                      {
                        item.label
                      }
                    </div>

                    <div className="toolDesc">
                      {
                        item.desc
                      }
                    </div>
                  </button>
                )
              )}
            </div>
          </section>
        )
      )}
    </section>
  );
}