import CardputerDevice from "@/components/CardputerDevice";
import { DoneMark } from "@/components/Progress";
import ResumeButton from "@/components/ResumeButton";
import { getAllLessons, getCourse, shortTopics } from "@/lib/lessons";
import { STRINGS, type Locale } from "@/lib/i18n";

function DifficultyDots({ level }: { level: number }) {
  return (
    <span className="difficulty" aria-label={`${level}/5`}>
      {Array.from({ length: 5 }, (_, i) => (i < level ? "●" : "○")).join("")}
    </span>
  );
}

export default function HomeView({ locale }: { locale: Locale }) {
  const t = STRINGS[locale];
  const course = getCourse(locale);
  const lessons = getAllLessons(locale);
  const prefix = locale === "en" ? "/en" : "";

  return (
    <main>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{t.eyebrow}</p>
          <h1>{course.title}</h1>
          <p className="hero-tagline">{course.tagline}</p>
          <p className="hero-intro">{course.intro}</p>
          <div className="hero-actions">
            {lessons.length > 0 && (
              <ResumeButton
                lessons={lessons.map((l) => ({ slug: l.slug, order: l.order, title: l.title }))}
                locale={locale}
              />
            )}
            <a className="btn-ghost" href="#lessons">
              {t.browseBtn}
            </a>
          </div>
        </div>
        <CardputerDevice locale={locale} />
      </section>

      <section id="lessons" className="roadmap-section">
        <h2 className="section-title">
          <span className="section-title-silk">BUS</span>
          {t.busTitle}
        </h2>
        <p className="section-note">{t.busNote(lessons.length)}</p>
        <ol className="roadmap">
          {lessons.map((lesson) => (
            <li key={lesson.slug} className="roadmap-item">
              <a href={`${prefix}/lessons/${lesson.slug}`} className="lesson-card">
                <div className="lesson-card-head">
                  <span className="lesson-ref">
                    U{lesson.order} · {shortTopics(lesson.hardware)}
                  </span>
                  <DoneMark slug={lesson.slug} />
                </div>
                <h3>{lesson.title}</h3>
                <p className="lesson-summary">{lesson.summary}</p>
                <div className="lesson-meta">
                  <DifficultyDots level={lesson.difficulty} />
                  <span>{t.hours(lesson.estHours)}</span>
                  <span className="lesson-project">
                    {t.project}
                    {lesson.project}
                  </span>
                </div>
              </a>
            </li>
          ))}
        </ol>
      </section>

      <section id="about" className="about-section">
        <h2 className="section-title">
          <span className="section-title-silk">README</span>
          {t.aboutTitle}
        </h2>
        <div className="about-grid">
          {t.aboutCards.map((card) => (
            <div key={card.title}>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
