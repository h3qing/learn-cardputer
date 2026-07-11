import type { Metadata } from "next";
import HomeView from "@/components/HomeView";
import { getCourse } from "@/lib/lessons";

export function generateMetadata(): Metadata {
  const course = getCourse("en");
  return { title: { absolute: course.title }, description: course.tagline };
}

export default function EnglishHomePage() {
  return <HomeView locale="en" />;
}
