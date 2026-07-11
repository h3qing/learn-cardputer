import { describe, it, expect } from "vitest";
import { pickResume, type LessonRef } from "./progress";

const LESSONS: LessonRef[] = [
  { slug: "a", order: 1, title: "A" },
  { slug: "b", order: 2, title: "B" },
  { slug: "c", order: 3, title: "C" },
];

describe("pickResume", () => {
  it("returns the last-visited lesson when it exists", () => {
    expect(pickResume(LESSONS, "b")?.slug).toBe("b");
  });

  it("falls back to the first lesson when nothing was visited", () => {
    expect(pickResume(LESSONS, null)?.slug).toBe("a");
  });

  it("falls back to the first lesson when the stored slug no longer exists", () => {
    expect(pickResume(LESSONS, "deleted-lesson")?.slug).toBe("a");
  });

  it("handles an empty lesson list", () => {
    expect(pickResume([], "a")).toBeUndefined();
  });
});
