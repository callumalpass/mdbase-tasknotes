import test from "node:test";
import assert from "node:assert/strict";
import { mapToFrontmatter } from "../dist/mapper.js";

test("mapToFrontmatter wraps plain project names as wikilinks", () => {
  const { frontmatter } = mapToFrontmatter({
    title: "Test task",
    projects: ["simple"],
  });
  assert.deepEqual(frontmatter.projects, ["[[projects/simple]]"]);
});

test("mapToFrontmatter preserves projects already in wikilink syntax", () => {
  const { frontmatter } = mapToFrontmatter({
    title: "Test task",
    projects: ["[[projecten/Bente Commercial]]"],
  });
  assert.deepEqual(frontmatter.projects, ["[[projecten/Bente Commercial]]"]);
});

test("mapToFrontmatter handles mixed plain and wikilink projects", () => {
  const { frontmatter } = mapToFrontmatter({
    title: "Test task",
    projects: ["simple", "[[projecten/Bente Commercial]]"],
  });
  assert.deepEqual(frontmatter.projects, [
    "[[projects/simple]]",
    "[[projecten/Bente Commercial]]",
  ]);
});

test("mapToFrontmatter trims project values before wrapping or preserving wikilinks", () => {
  const { frontmatter } = mapToFrontmatter({
    title: "Test task",
    projects: [" simple ", " [[projecten/Bente Commercial]] "],
  });
  assert.deepEqual(frontmatter.projects, [
    "[[projects/simple]]",
    "[[projecten/Bente Commercial]]",
  ]);
});
